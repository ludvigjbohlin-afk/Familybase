-- Hushallsbalans: las vad anvandarna tycker. Kor i Supabase > SQL Editor.

-- 1. Senaste feedback (Tyck till och snabbfragan "Hur fungerar appen")
select created_at::date as dag, message, detail->>'pulse' as betyg, detail->>'view' as vy, app_version
from public.app_events
where kind = 'feedback'
order by created_at desc
limit 50;

-- 2. Snabbfragan sammanstalld per manad
select date_trunc('month', created_at)::date as manad,
       count(*) filter (where message = 'pulse: good') as bra,
       count(*) filter (where message = 'pulse: ok')   as okej,
       count(*) filter (where message = 'pulse: bad')  as inte_bra
from public.app_events
where kind = 'feedback' and message like 'pulse: %'
group by 1 order by 1 desc;

-- 3. Vanligaste felen senaste 30 dagarna
select left(message, 120) as fel, count(*) as antal, count(distinct user_id) as personer, max(created_at) as senast, max(app_version) as version
from public.app_events
where kind = 'error' and created_at > now() - interval '30 days'
group by 1 order by antal desc
limit 20;

-- 4. Hur manga hushall och konton som finns
select (select count(*) from public.households) as hushall,
       (select count(*) from auth.users) as konton,
       (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days') as aktiva_senaste_veckan;
