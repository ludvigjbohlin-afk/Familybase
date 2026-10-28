# Dataskydd för Hushållsbalans

Senast uppdaterad: 28 oktober 2026. Personuppgiftsansvarig: Ludvig Bohlin (kontakt: ludvig.j.bohlin@gmail.com).

Det här dokumentet är det interna underlaget bakom integritetspolicyn och användarvillkoren i appen. Det ska ses över när en ny funktion samlar in nya uppgifter, när en ny leverantör används och minst en gång om året. Det ersätter inte en juridisk granskning.

---

## 1. Register över behandlingar (artikel 30)

| Behandling | Uppgifter | Vilka | Rättslig grund | Var | Hur länge |
|---|---|---|---|---|---|
| Konto och inloggning | E-post, lösenord (hashat), namn, tid för godkända villkor, ev. tvåstegsfaktor | Vuxna och barn med eget konto | Avtal (6.1 b) | Supabase, Frankfurt (EU) | Tills kontot raderas |
| Hushållets planering | Sysslor, vem som gör vad, tider, klart-markeringar, kommentarer, anslagstavla, inköpslista, matsedel, aktiviteter, händelser, födelsedag (valfritt), stjärnor och fickpengar | Alla i hushållet | Avtal (6.1 b); för barn under 13 vårdnadshavarens samtycke (6.1 a, LKD 2 kap. 4 §) | Supabase, Frankfurt | Tills hushållet eller personen tas bort |
| Privata saker | Egna anteckningar som bara personen ser | Den som skrev dem | Avtal | Supabase, Frankfurt | Tills de raderas |
| Påminnelser | Pushadress (endpoint) och nycklar från webbläsaren | Den som slagit på påminnelser | Samtycke (6.1 a) | Supabase; utskick via Apple/Google/Mozilla pushtjänst | Tills påminnelser stängs av |
| Kalenderlänk | Hemlig nyckel; sysslor, aktiviteter och födelsedagar som vårdnadshavaren valt | Hushållet | Berättigat intresse / avtal | Supabase Edge Function | Tills länken byts eller hushållet tas bort |
| AI-förslag på middagar | Önskemål (namn bortplockade), datum, antal personer och barn | Vuxna som trycker på knappen | Samtycke genom handlingen (6.1 a) | Anthropic, USA (SCC) | Enligt Anthropics villkor för API (inte för träning) |
| Felsökning och missbruksskydd | Antal AI-anrop per person och dag, felrapporter, tekniska loggar | Alla | Berättigat intresse (6.1 f) | Supabase | Felrapporter 90 dagar, AI-räknare 30 dagar (rensas varje natt), Supabase-loggar enligt plan |
| Synpunkter | Text som användaren själv skriver | Den som skickar | Berättigat intresse | Supabase | 90 dagar (rensas varje natt) |
| Backup | Kopia av hushåll, medlemmar och privata saker | Alla | Berättigat intresse (säkerhet, art. 32) | Supabase, separat schema utan åtkomst för appen | 14 dagar |

Appen samlar **inte** in: personnummer, adress, GPS, kontakter, bilder, hälsouppgifter, betalkort eller reklam-id. Inga spårare, ingen reklam, inga analysverktyg från tredje part.

## 2. Leverantörer och PUB-avtal (artikel 28)

| Leverantör | Roll | Plats | Avtal | Status |
|---|---|---|---|---|
| Supabase Inc. | Databas, inloggning, Edge Functions, backup | EU (Frankfurt, eu-central-1) | Supabase DPA | **Att göra:** godkänn DPA i Supabase-panelen (Organization → Legal Documents) och spara en kopia |
| Anthropic PBC | AI-förslag på middagar | USA | Commercial Terms + DPA med SCC | **Att göra:** kontrollera att API-kontot omfattas av DPA:n (Console → Settings → Privacy) och spara en kopia |
| GitHub (Microsoft) | Värd för appens filer (GitHub Pages) | Global CDN | GitHub DPA | Lagrar inga användaruppgifter, bara statiska filer. Ingen åtgärd utöver att läsa igenom |
| Apple, Google, Mozilla | Leverans av pushnotiser | Global | Webbläsarens villkor | Innehållet i notisen är krypterat från servern (Web Push) |

Ingen leverantör får använda uppgifterna för egna syften. Ny leverantör läggs till här och i integritetspolicyn innan den används.

## 3. DPIA / riskanalys

En fullständig konsekvensbedömning krävs troligen inte (ingen storskalig behandling, inga känsliga uppgifter, ingen profilering med rättsliga följder). Eftersom barn använder appen görs ändå en förenklad bedömning.

**Beskrivning.** Ett hushåll delar planering av sysslor. En vårdnadshavare skapar hushållet och bjuder in vuxna och barn med kod eller länk. Barn kan ha eget konto.

**Nödvändighet och proportionalitet.** Varje uppgift behövs för en funktion som användaren själv valt. Födelsedag, aktiviteter, påminnelser, AI, kalenderlänk, belöningar och fickpengar är frivilliga och går att stänga av.

| Risk | Sannolikhet | Konsekvens | Åtgärd i appen | Kvar |
|---|---|---|---|---|
| Obehörig läser ett annat hushålls data | Låg | Hög | Row Level Security på alla tabeller; all åtkomst via funktioner som kontrollerar `auth.uid()`; tabeller utan klientåtkomst saknar policy | Låg |
| Barn ändrar eller ser mer än tänkt | Medel | Medel | Rollen kontrolleras i databasen (`hb_sanitize`): barn kan bara ändra sina egna saker, inköpslistan och sina inlägg; vuxna kan inte ändra hushållets inställningar | Låg |
| Kontakt med främlingar | Låg | Hög | Appen är helt stängd: inga offentliga profiler, ingen sökning efter andra användare, inget chattflöde utanför hushållet | Mycket låg |
| Kapat vuxenkonto | Medel | Hög | Lösenord minst 6 tecken, frivillig tvåstegsverifiering (TOTP) som databasen kräver när den är på (aal2) | Låg (när läckta lösenord-skyddet är på) |
| Kalenderlänken sprids | Medel | Medel | Lång slumpad nyckel, `noindex`/`no-referrer`, vårdnadshavaren väljer vad som delas, länken kan bytas direkt | Låg |
| Uppgifter till AI i USA | Medel | Låg | Bara önskemål, datum och antal; namn i hushållet byts ut innan sändning; barn kan inte använda AI; nyckeln finns bara på servern | Låg |
| Skadlig kod i sidan (XSS) | Låg | Hög | Allt användarinnehåll escapas; strikt Content Security Policy med hash; inga externa skript utom Supabase-biblioteket | Låg |
| Dataförlust | Låg | Medel | Nattlig backup i 14 dagar, export för varje användare, Supabase driftsäkerhet | Låg |
| Belöningar skapar press eller konflikt | Medel | Låg | Stjärnor, belöningar och fickpengar kan stängas av för hela hushållet | Låg |

**Slutsats.** Kvarvarande risk bedöms som låg. Bedömningen görs om vid ny funktion som rör barn, nya uppgiftstyper eller ny leverantör.

## 4. Barn

- Under 13 år: vårdnadshavare skapar hushållet och intygar samtycke innan barnet läggs till (sparas som `parentConsent`). Barnet loggar in med en barnkod.
- 13 år och äldre: kan använda appen med vårdnadshavarens kännedom. Vårdnadshavaren kan alltid se barnets sysslor och ta bort barnet ur hushållet.
- Barn ser bara sina egna sysslor om vårdnadshavaren inte väljer annat, kan inte se andra hushåll, inte använda AI och inte ändra inställningar.
- Texten till barn är kort och enkel. Ingen reklam och inga köp i appen.

## 5. Backupplan

| Vad | Hur | Hur ofta | Sparas |
|---|---|---|---|
| Hushåll, medlemmar, privata saker | `backup.take_snapshot()` via pg_cron (`hb-backup`) | Varje natt 02:15 UTC | 14 dagar |
| Hela databasen | Supabase dagliga backuper (ingår i Pro-planen, med Point-in-Time Recovery som tillval) | Dagligen | 7 dagar på Pro |
| Användarens egen kopia | Inställningar → Ladda ner mina uppgifter (JSON) | När användaren vill | Hos användaren |
| Koden | GitHub-repot | Varje ändring | Hela historiken |

**Återställa ett hushåll** (exempel, kör i SQL-redigeraren):

```sql
-- se vilka dagar som finns
select day, kind, count(*) from backup.snapshots group by 1,2 order by 1 desc;
-- läs tillbaka ett hushåll från en viss dag
update public.households h set data = s.payload->'data', version = h.version + 1
from backup.snapshots s
where s.kind = 'household' and s.ref_id = h.id::text and s.day = '2026-10-27' and h.id = '<hushållets id>';
```

Testa en återställning i en kopia av projektet minst två gånger per år.

## 6. Incidentplan (personuppgiftsincident)

1. **Upptäck och stoppa (inom 1 timme).** Byt nycklar som kan ha läckt (Supabase service role, Anthropic, VAPID, CRON_SECRET), stäng av berörd funktion, logga ut alla vid behov (Authentication → Users).
2. **Bedöm (inom 24 timmar).** Vilka uppgifter, hur många hushåll, finns barn med, kan det leda till skada? Skriv ner allt med tidpunkter.
3. **Anmäl till IMY inom 72 timmar** från upptäckt, om det inte är osannolikt att incidenten leder till risk: imy.se → Anmäl personuppgiftsincident. Komplettera senare om allt inte är känt.
4. **Informera de drabbade** utan onödigt dröjsmål om risken är hög: vad som hänt, vad de bör göra, kontakt.
5. **Åtgärda och följ upp.** Rätta felet, lägg till test, uppdatera detta dokument och riskanalysen.
6. **Dokumentera alla incidenter**, även de som inte anmäls (artikel 33.5).

Kontakt vid incident: ludvig.j.bohlin@gmail.com.

## 7. Säkerhetsåtgärder (artikel 32)

- Riktig backend: Supabase Postgres i EU, Supabase Auth med e-post och lösenord (Google/Apple och magisk länk när de slås på).
- Row Level Security på varje tabell, åtkomst via `SECURITY DEFINER`-funktioner som kontrollerar användare och roll.
- Tvåstegsverifiering (TOTP) för vuxna, som databasen kräver när den är på.
- Gräns för AI-anrop per person och dag.
- Nattlig rensning (`backup.cleanup()`, pg_cron `hb-cleanup` 02:40 UTC): felrapporter och synpunkter efter 90 dagar, AI-räknare och påminnelseloggar efter 30 dagar.
- Content Security Policy, escaping av allt innehåll, inga externa spårare.
- Nattlig backup i separat schema utan åtkomst för appen.
- Hemliga nycklar bara som Supabase secrets, aldrig i appen eller repot.

## 8. Att göra manuellt

- [ ] Slå på skydd mot läckta lösenord: Supabase → Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords".
- [ ] Godkänn och spara Supabase DPA.
- [ ] Kontrollera och spara Anthropics DPA för API-kontot.
- [ ] Låt en jurist läsa integritetspolicy, villkor och detta dokument före betald lansering.
- [ ] Höj minsta lösenordslängd till 8 tecken: Supabase → Authentication → Sign In / Providers → Email → Minimum password length.
- [ ] Överväg Supabase Pro för riktiga databasbackuper och längre loggar.
- [ ] Testa återställning av backup.
