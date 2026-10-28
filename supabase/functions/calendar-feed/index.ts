// @ts-nocheck
// Supabase Edge Function: calendar-feed
// A secret calendar link (iCalendar) that Google Calendar, Apple Calendar and Outlook can subscribe to.
// The household owner creates the link in the app; it holds a random token stored in settings.calToken.
// Anyone with the link can read the household's chores, activities, events and birthdays, so it can be changed in the app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TZ = "Europe/Stockholm";
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Stockholm",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];

export function esc(s) {
  return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1").slice(0, 200);
}
// Lines longer than 75 bytes are folded (RFC 5545), without cutting a character in half.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ""));
const ymd = s => s.replace(/-/g, "");
const hm = s => s.replace(":", "") + "00";
const safeId = s => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "x";
function isoDay(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function addMin(time, min) {
  const [h, m] = time.split(":").map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + Math.max(5, Math.min(600, Number(min) || 30)));
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
}
function nextNext(day) { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)); return isoDay(d); }
// Most recent date (on or before today) that falls on weekday wd, used as the start of a weekly series.
function lastWeekday(today, wd) {
  const d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - wd + 7) % 7));
  return isoDay(d);
}

function addDays(day, n) { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)); return isoDay(d); }
function weekStartIso(day, ws) { const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10))); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - ws + 7) % 7)); return isoDay(d); }
// every other week: k.start is the first day of a week the chore is on
function onWeek(k, day, ws) {
  const a = weekStartIso(isDate(k.start) ? k.start : "2024-01-01", ws), b = weekStartIso(day, ws);
  const n = Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 604800000);
  return ((n % 2) + 2) % 2 === 0;
}

function vevent(uid, summary, day, time, end, rrule, stamp, desc) {
  const L = ["BEGIN:VEVENT", "UID:" + uid + "@hushallsbalans", "DTSTAMP:" + stamp, "SUMMARY:" + esc(summary)];
  if (time) {
    L.push("DTSTART;TZID=" + TZ + ":" + ymd(day) + "T" + hm(time));
    L.push("DTEND;TZID=" + TZ + ":" + ymd(day) + "T" + hm(end && end > time ? end : addMin(time, 30)));
  } else {
    L.push("DTSTART;VALUE=DATE:" + ymd(day));
    L.push("DTEND;VALUE=DATE:" + ymd(nextNext(day)));
    L.push("TRANSP:TRANSPARENT");
  }
  if (rrule) L.push("RRULE:" + rrule);
  if (desc) L.push("DESCRIPTION:" + esc(desc));
  L.push("END:VEVENT");
  return L;
}

export function buildIcs(household, opts) {
  const data = (household && household.data) || {};
  const lang = opts && opts.lang === "en" ? "en" : "sv";
  const now = (opts && opts.now) || new Date();
  const today = isoDay(new Date(now.getTime() + 2 * 3600e3)); // close enough to Swedish time for picking a start date
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const members = (Array.isArray(data.members) ? data.members : []).filter(m => m && typeof m === "object");
  const only = opts && opts.member ? members.find(m => m.id === opts.member) : null;
  const nameOf = id => { const m = members.find(x => x.id === id); return m ? String(m.name || "") : ""; };
  const mine = id => !only || id === only.id;
  const T = lang === "en"
    ? { cal: "Household Balance", bday: "{n}'s birthday", min: "{n} min" }
    : { cal: "Hushållsbalans", bday: "{n} fyller år", min: "{n} min" };
  const title = T.cal + (household && household.name ? " · " + household.name : "") + (only ? " · " + only.name : "");
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hushallsbalans//Kalender//SV", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + esc(title), "X-WR-TIMEZONE:" + TZ, "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H", ...VTIMEZONE];
  const who = id => (only ? "" : nameOf(id) ? " (" + nameOf(id) + ")" : "");
  const ws = Number((data.settings || {}).weekStart) === 0 ? 0 : 1;
  // what the guardian chose to share (all on unless switched off)
  const inc = k => (data.settings || {})[k] !== false;
  // children's chores, activities and birthdays are left out unless the guardian turned them on
  const kidsOk = (data.settings || {}).calKids === true;
  const hideKid = id => { const p = members.find(x => x.id === id); return !kidsOk && !!(p && p.kid); };
  // invitations: a.with lists invited members; their answer is stored in their own hobbies as { re: "act|org|id", ans: "yes" }
  const saidYes = (mid, key) => { const p = members.find(x => x.id === mid); return !!(p && Array.isArray(p.hobbies) && p.hobbies.some(r => r && r.re === key && r.ans === "yes")); };
  const going = (kind, org, item) => (Array.isArray(item.with) ? item.with : []).filter(id => id !== org.id && !hideKid(id) && saidYes(id, kind + "|" + org.id + "|" + item.id));
  const show = (kind, org, item) => !only || org.id === only.id || going(kind, org, item).includes(only.id);
  const whoAll = (kind, org, item) => {
    const names = [org.id, ...going(kind, org, item)].filter(id => !only || id !== only.id).map(nameOf).filter(Boolean);
    return names.length ? " (" + names.join(", ") + ")" : "";
  };

  // chores
  (inc("calChores") && Array.isArray(data.tasks) ? data.tasks : []).forEach(k => {
    if (!k || typeof k !== "object" || !mine(k.owner) || hideKid(k.owner)) return;
    const f = k.freq || "weekly", time = isTime(k.time) ? k.time : "", end = time ? addMin(time, k.minutes) : "";
    const name = String(k.title || k.ref || "").trim();
    if (!name) return;
    const sum = name + who(k.owner), desc = Number(k.minutes) ? T.min.replace("{n}", Math.round(Number(k.minutes))) : "";
    const uid = "task-" + safeId(k.id);
    if (f === "daily") { if (time) out.push(...vevent(uid, sum, today, time, end, "FREQ=DAILY", stamp, desc)); return; }
    if (f === "weekly" || f === "biweekly") {
      if (k.wday === null || k.wday === undefined || k.wday === "" || isNaN(Number(k.wday))) return;
      const wd = Number(k.wday) % 7;
      let first = lastWeekday(today, wd);
      if (f === "biweekly" && !onWeek(k, first, ws)) first = addDays(first, -7);
      out.push(...vevent(uid, sum, first, time, end, "FREQ=WEEKLY;" + (f === "biweekly" ? "INTERVAL=2;" : "") + "BYDAY=" + DAYS[wd], stamp, desc));
      return;
    }
    if (!isDate(k.date)) return;
    if (f === "monthly") { out.push(...vevent(uid, sum, k.date, time, end, "FREQ=MONTHLY;BYMONTHDAY=" + Math.min(28, Number(k.date.slice(8, 10))), stamp, desc)); return; }
    if (f === "once" && !k.done) out.push(...vevent(uid, sum, k.date, time, end, "", stamp, desc));
  });

  members.forEach(m => {
    if (hideKid(m.id)) return;
    // one-off events in the family calendar
    (inc("calActs") && Array.isArray(m.events) ? m.events : []).forEach(ev => {
      if (!ev || !isDate(ev.date) || !ev.title || !show("ev", m, ev)) return;
      out.push(...vevent("ev-" + safeId(ev.id), String(ev.title) + whoAll("ev", m, ev), ev.date, isTime(ev.time) ? ev.time : "", isTime(ev.end) ? ev.end : "", "", stamp, ""));
    });
    // weekly activities (football on Tuesdays...)
    (inc("calActs") && Array.isArray(m.hobbies) ? m.hobbies : []).forEach((a, i) => {
      if (!a || typeof a !== "object" || !a.title || !Array.isArray(a.days) || !a.days.length || !show("act", m, a)) return;
      const days = a.days.map(Number).filter(d => d >= 0 && d <= 6);
      if (!days.length) return;
      const first = days.map(d => lastWeekday(today, d)).sort()[0];
      out.push(...vevent("act-" + safeId(m.id) + "-" + safeId(a.id || i), String(a.title) + whoAll("act", m, a), first, isTime(a.time) ? a.time : "", isTime(a.end) ? a.end : "", "FREQ=WEEKLY;BYDAY=" + days.map(d => DAYS[d]).join(","), stamp, ""));
    });
    // birthdays for everyone
    const b = String(m.birthday || "");
    if (inc("calBdays") && /^\d{4}-\d{2}-\d{2}$/.test(b) && b.slice(5) !== "02-29") {
      out.push(...vevent("bday-" + safeId(m.id), "\u{1F382} " + T.bday.replace("{n}", m.name || ""), today.slice(0, 4) + "-" + b.slice(5), "", "", "FREQ=YEARLY", stamp, ""));
    }
  });
  out.push("END:VCALENDAR");
  return out.map(fold).join("\r\n") + "\r\n";
}

export async function handle(req, env, makeClient) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const NOINDEX = { "X-Robots-Tag": "noindex, nofollow, noarchive", "Referrer-Policy": "no-referrer" };
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return new Response("Not found", { status: 404, headers: NOINDEX });
  const sb = makeClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data, error } = await sb.from("households").select("name, data").eq("data->settings->>calToken", token).limit(1).maybeSingle();
  if (error || !data) return new Response("Not found", { status: 404, headers: NOINDEX });
  const ics = buildIcs(data, { member: url.searchParams.get("m") || "", lang: url.searchParams.get("lang") || "sv" });
  return new Response(ics, {
    status: 200,
    headers: { ...NOINDEX, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "Content-Disposition": 'inline; filename="hushallsbalans.ics"' },
  });
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(req => handle(req, k => Deno.env.get(k), createClient));
}
