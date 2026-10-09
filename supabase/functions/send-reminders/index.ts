// @ts-nocheck
// Supabase Edge Function: send-reminders
// Runs every 5 minutes (pg_cron) and sends Web Push reminders:
//  - once a day at the time each person chose: the chores they have left today
//  - one hour before their own weekly activities and calendar events with a time
//  - 30 minutes before their own chores that have a time of day
// Also answers {test:true} from a signed-in user with a test notification.
// Keys: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET, from function secrets
// or from the table private_config (no access for app users; read here with the service role).
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- base64url ---------- */
export function b64u(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
function concat(...parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------- VAPID (RFC 8292) ---------- */
export async function vapidAuth(endpoint, publicKeyB64, privateKeyB64, subject, nowSec) {
  const pub = unb64u(publicKeyB64);
  const jwk = { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: privateKeyB64, ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(enc.encode(JSON.stringify({ aud, exp: (nowSec || Math.floor(Date.now() / 1000)) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + payload));
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${publicKeyB64}`;
}

/* ---------- payload encryption (RFC 8291, aes128gcm) ---------- */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
export async function encryptPayload(p256dhB64, authB64, plaintext) {
  const uaPublic = unb64u(p256dhB64);
  const authSecret = unb64u(authB64);
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = concat(typeof plaintext === "string" ? enc.encode(plaintext) : plaintext, new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, data));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export async function sendPush(sub, message, env, doFetch) {
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
  const auth = await vapidAuth(sub.endpoint, env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"), env("VAPID_SUBJECT") || "mailto:ludvig.j.bohlin@gmail.com");
  const res = await doFetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: auth, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "43200", Urgency: "normal" },
    body,
  });
  return res.status;
}

/* ---------- the household's schedule (same rules as the app) ---------- */
export function localParts(ms, tz) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  } catch (_e) {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  }
  const g = t => Number((parts.find(p => p.type === t) || {}).value);
  const y = g("year"), mo = g("month"), d = g("day"), h = g("hour") % 24, mi = g("minute");
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return { date, iso: isoDay(date), mins: h * 60 + mi, dow: date.getUTCDay(), hm: String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0") };
}
// Dates below are "local wall-clock" values stored in UTC fields.
function isoDay(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function dayOnly(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function weekStartOf(d, ws) { const st = dayOnly(d); st.setUTCDate(st.getUTCDate() - ((st.getUTCDay() - ws + 7) % 7)); return st; }
function periodKey(freq, d, ws) {
  if (freq === "daily") return isoDay(d);
  if (freq === "weekly") return "w" + isoDay(weekStartOf(d, ws));
  if (freq === "monthly") return d.getUTCFullYear() + "-" + d.getUTCMonth();
  return "once";
}
function occurrence(k, now, ws) {
  const f = k.freq || "weekly";
  if (f === "daily") return isoDay(now);
  if (f === "weekly") {
    if (k.wday === null || k.wday === undefined || k.wday === "") return null;
    const st = weekStartOf(now, ws);
    const d = new Date(st); d.setUTCDate(st.getUTCDate() + ((Number(k.wday) - st.getUTCDay() + 7) % 7));
    return isoDay(d);
  }
  if (!k.date) return null;
  if (f === "monthly") {
    const day = Number(String(k.date).slice(8, 10));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    return isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(day, last))));
  }
  return k.date;
}
function rotOwner(k, members, now, ws) {
  const r = k.rot;
  if (!r || !Array.isArray(r.ids)) return null;
  const ids = r.ids.filter(id => members.some(m => m.id === id));
  if (ids.length < 2) return null;
  const cur = isoDay(weekStartOf(now, ws));
  const n = Math.round((Date.parse(cur + "T00:00:00Z") - Date.parse((r.start || cur) + "T00:00:00Z")) / 604800000);
  const base = Math.max(0, ids.indexOf(r.first));
  return ids[(((base + n) % ids.length) + ids.length) % ids.length];
}
function taskName(k, lang) { return String(k.title || k.ref || "").slice(0, 60); }
export function todaysChores(data, memberId, nowMs, tz) {
  const d = data || {};
  const ws = Number((d.settings || {}).weekStart) === 0 ? 0 : 1;
  const L = localParts(nowMs, tz), now = L.date, today = L.iso;
  const members = Array.isArray(d.members) ? d.members : [];
  return (Array.isArray(d.tasks) ? d.tasks : []).filter(k => {
    if ((rotOwner(k, members, now, ws) || k.owner) !== memberId) return false;
    const f = k.freq || "weekly";
    let done = !!k.done;
    if (done && f !== "once" && k.doneAt) done = periodKey(f, localParts(Number(k.doneAt), tz).date, ws) === periodKey(f, now, ws);
    if (done) return false;
    const o = occurrence(k, now, ws);
    return !o || o <= today;
  });
}
export function upcoming(data, memberId, nowMs, tz) {
  const d = data || {};
  const L = localParts(nowMs, tz);
  const m = (Array.isArray(d.members) ? d.members : []).find(x => x.id === memberId);
  const out = [];
  const add = (key, title, time, ahead, kind) => {
    if (!/^\d{2}:\d{2}$/.test(time || "")) return;
    const diff = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) - L.mins;
    if (diff > 0 && diff <= ahead) out.push({ key: key + ":" + L.iso, title, time, kind });
  };
  if (m) {
    (Array.isArray(m.hobbies) ? m.hobbies : []).forEach(a => { if (a && typeof a === "object" && Array.isArray(a.days) && a.days.includes(L.dow)) add("a:" + a.id, a.title, a.time, 60, "act"); });
    (Array.isArray(m.events) ? m.events : []).forEach(e => { if (e && e.date === L.iso) add("e:" + e.id, e.title, e.time, 60, "act"); });
  }
  todaysChores(d, memberId, nowMs, tz).forEach(k => { if (k.time) add("c:" + k.id, taskName(k), k.time, 30, "chore"); });
  return out;
}
const TXT = {
  sv: {
    dailyTitle: n => n === 1 ? "1 syssla kvar idag" : `${n} sysslor kvar idag`,
    soon: (t, time) => `Snart: ${t}`, soonBody: time => `Kl ${time}`,
    choreSoon: t => `Dags snart: ${t}`,
    testTitle: "Påminnelser fungerar!", testBody: "Så här ser en påminnelse från Hushållsbalans ut.",
  },
  en: {
    dailyTitle: n => n === 1 ? "1 chore left today" : `${n} chores left today`,
    soon: (t) => `Soon: ${t}`, soonBody: time => `At ${time}`,
    choreSoon: t => `Coming up: ${t}`,
    testTitle: "Reminders work!", testBody: "This is what a reminder from Household Balance looks like.",
  },
};
export function buildMessages(sub, data, memberId, nowMs, sentKeys) {
  const tx = TXT[sub.lang === "en" ? "en" : "sv"];
  const L = localParts(nowMs, sub.tz);
  const msgs = [], newKeys = [];
  let markDaily = false;
  if (sub.daily_time && /^\d{2}:\d{2}$/.test(sub.daily_time) && sub.last_daily !== L.iso) {
    const due = Number(sub.daily_time.slice(0, 2)) * 60 + Number(sub.daily_time.slice(3));
    if (L.mins >= due && L.mins - due < 180) {
      markDaily = true;
      const left = todaysChores(data, memberId, nowMs, sub.tz);
      if (left.length) msgs.push({ title: tx.dailyTitle(left.length), body: left.slice(0, 4).map(k => taskName(k)).join(", ") + (left.length > 4 ? " …" : ""), tag: "daily" });
    }
  }
  if (sub.activities !== false) {
    upcoming(data, memberId, nowMs, sub.tz).forEach(u => {
      if (sentKeys.has(u.key)) return;
      newKeys.push(u.key);
      msgs.push(u.kind === "chore" ? { title: tx.choreSoon(u.title), body: tx.soonBody(u.time), tag: u.key } : { title: tx.soon(u.title), body: tx.soonBody(u.time), tag: u.key });
    });
  }
  return { msgs, newKeys, markDaily, today: L.iso };
}

/* ---------- handler ---------- */
export async function handle(req, env0, makeClient, doFetch, nowFn) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const admin = makeClient(env0("SUPABASE_URL"), env0("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const cfg = {};
  try {
    const { data } = await admin.from("private_config").select("key,value");
    (data || []).forEach(r => { cfg[r.key] = r.value; });
  } catch (_e) { /* secrets only */ }
  const env = k => env0(k) || cfg[k] || "";
  if (!env("VAPID_PUBLIC_KEY") || !env("VAPID_PRIVATE_KEY")) return json({ error: "not_setup" }, 500);
  const now = nowFn ? nowFn() : Date.now();
  let body = {};
  try { body = await req.json(); } catch (_e) { body = {}; }

  // test notification for the signed-in user
  if (body && body.test) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await admin.auth.getUser(token);
    if (error || !u || !u.user) return json({ error: "not_allowed" }, 401);
    const { data: subs } = await admin.from("push_subs").select("*").eq("user_id", u.user.id);
    if (!subs || !subs.length) return json({ error: "no_subscription" }, 404);
    let sent = 0;
    for (const s of subs) {
      const tx = TXT[s.lang === "en" ? "en" : "sv"];
      try {
        const st = await sendPush(s, { title: tx.testTitle, body: tx.testBody, tag: "test" }, env, doFetch);
        if (st === 404 || st === 410) await admin.from("push_subs").delete().eq("id", s.id);
        else if (st >= 200 && st < 300) sent++;
      } catch (_e) { /* try the next device */ }
    }
    return sent ? json({ sent }) : json({ error: "push_failed" }, 502);
  }

  // scheduled run
  if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) return json({ error: "not_allowed" }, 401);
  const { data: subs, error: sErr } = await admin.from("push_subs").select("*");
  if (sErr) return json({ error: "db" }, 500);
  if (!subs || !subs.length) return json({ sent: 0 });
  const userIds = [...new Set(subs.map(s => s.user_id))];
  const { data: mems } = await admin.from("household_members").select("user_id, household_id, member_id").in("user_id", userIds);
  const hhIds = [...new Set((mems || []).map(m => m.household_id))];
  const { data: hhs } = hhIds.length ? await admin.from("households").select("id, data").in("id", hhIds) : { data: [] };
  const { data: sentRows } = await admin.from("push_sent").select("sub_id, key").in("sub_id", subs.map(s => s.id));
  let sent = 0;
  for (const s of subs) {
    const m = (mems || []).find(x => x.user_id === s.user_id);
    const h = m && (hhs || []).find(x => x.id === m.household_id);
    if (!m || !m.member_id || !h) continue;
    const keys = new Set((sentRows || []).filter(r => r.sub_id === s.id).map(r => r.key));
    const { msgs, newKeys, markDaily, today } = buildMessages(s, h.data, m.member_id, now, keys);
    if (markDaily) await admin.from("push_subs").update({ last_daily: today }).eq("id", s.id);
    if (newKeys.length) await admin.from("push_sent").upsert(newKeys.map(key => ({ sub_id: s.id, key })), { onConflict: "sub_id,key" });
    for (const msg of msgs) {
      try {
        const st = await sendPush(s, msg, env, doFetch);
        if (st === 404 || st === 410) { await admin.from("push_subs").delete().eq("id", s.id); break; }
        if (st >= 200 && st < 300) sent++;
      } catch (_e) { /* skip */ }
    }
  }
  await admin.from("push_sent").delete().lt("sent_at", new Date(now - 3 * 86400000).toISOString());
  return json({ sent });
}

if (typeof Deno !== "undefined" && Deno.serve) {
  Deno.serve(req => handle(req, k => Deno.env.get(k), createClient, fetch));
}
