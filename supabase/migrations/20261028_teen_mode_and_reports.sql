-- Hushållsbalans: ungdomsläge (13–17 år) och rapporter
-- Kör hela filen i Supabase → SQL Editor. Den går att köra flera gånger.
--
-- Ungdom (members[].teen = true, sätts av en vuxen):
--   får alltid bocka av sina egna sysslor,
--   får lägga till, ändra och ta bort sysslor som är deras egna
--   (de förblir ägda av ungdomen, stjärnor som en vuxen satt behålls, nya får 0 stjärnor).
-- Barn och ungdomar: får lägga till egna rapporter om inlägg eller kommentarer.
-- Bara vuxna kan hantera rapporterna. Allt annat skyddas som förut.

create or replace function public.hb_sanitize(p_role text, p_mid text, p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  out_data jsonb;
  is_teen boolean := false;
  old2 jsonb;
  v_t jsonb; v_n jsonb; tasks_out jsonb := '[]'; added int := 0;
  old_tasks jsonb := case when jsonb_typeof(p_old->'tasks') = 'array' then p_old->'tasks' else '[]'::jsonb end;
  new_tasks jsonb := case when jsonb_typeof(p_new->'tasks') = 'array' then p_new->'tasks' else '[]'::jsonb end;
  old_rep jsonb := case when jsonb_typeof(p_old->'reports') = 'array' then p_old->'reports' else '[]'::jsonb end;
  new_rep jsonb := case when jsonb_typeof(p_new->'reports') = 'array' then p_new->'reports' else '[]'::jsonb end;
begin
  if p_role = 'child' and p_mid is not null then
    is_teen := exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_old->'members') = 'array' then p_old->'members' else '[]'::jsonb end) m
                        where m->>'id' = p_mid and m->'teen' = 'true'::jsonb);
  end if;

  if is_teen then
    old2 := jsonb_set(p_old, '{settings}', coalesce(p_old->'settings', '{}'::jsonb) || '{"childCheck": true}'::jsonb);
    out_data := public.hb_sanitize_base(p_role, p_mid, old2, p_new);
    if p_old ? 'settings' then out_data := jsonb_set(out_data, '{settings}', p_old->'settings'); else out_data := out_data - 'settings'; end if;
  else
    out_data := public.hb_sanitize_base(p_role, p_mid, p_old, p_new);
  end if;
  if p_role <> 'child' or p_mid is null then return out_data; end if;

  if is_teen then
    for v_t in select e from jsonb_array_elements(coalesce(out_data->'tasks', '[]'::jsonb)) e loop
      if v_t->>'owner' = p_mid then
        v_n := null;
        select e into v_n from jsonb_array_elements(new_tasks) e where e->>'id' = v_t->>'id' limit 1;
        if v_n is null then continue; end if;
        if v_n->>'owner' = p_mid then
          v_t := v_n || jsonb_build_object('owner', p_mid, 'stars', coalesce(v_t->'stars', '0'::jsonb), 'rot', coalesce(v_t->'rot', 'null'::jsonb), 'lead', coalesce(v_t->'lead', '""'::jsonb));
        end if;
      end if;
      tasks_out := tasks_out || jsonb_build_array(v_t);
    end loop;
    for v_n in select e from jsonb_array_elements(new_tasks) e loop
      exit when added >= 20 or jsonb_array_length(tasks_out) >= 400;
      if v_n->>'owner' = p_mid and coalesce(v_n->>'id', '') ~ '^[A-Za-z0-9_-]{1,64}$'
         and not exists (select 1 from jsonb_array_elements(old_tasks) x where x->>'id' = v_n->>'id') then
        tasks_out := tasks_out || jsonb_build_array(v_n || jsonb_build_object('owner', p_mid, 'stars', 0, 'rot', 'null'::jsonb, 'lead', ''));
        added := added + 1;
      end if;
    end loop;
    out_data := jsonb_set(out_data, '{tasks}', tasks_out);
    out_data := jsonb_set(out_data, '{starLog}', public.hb_own_log(p_old->'starLog', p_new->'starLog', out_data->'tasks', p_mid));
    out_data := jsonb_set(out_data, '{doneLog}', public.hb_own_log(p_old->'doneLog', p_new->'doneLog', out_data->'tasks', p_mid));
  end if;

  out_data := jsonb_set(out_data, '{reports}', old_rep || coalesce((
    select jsonb_agg(r) from (
      select jsonb_build_object('id', e->>'id', 'by', p_mid, 'what', case when e->>'what' = 'comment' then 'comment' else 'board' end,
               'ref', left(coalesce(e->>'ref', ''), 64), 'text', left(coalesce(e->>'text', ''), 140), 'author', left(coalesce(e->>'author', ''), 64),
               'why', case when e->>'why' in ('unsafe', 'mean', 'threat', 'spam', 'other') then e->>'why' else 'other' end,
               'at', case when jsonb_typeof(e->'at') = 'number' then e->'at' else to_jsonb((extract(epoch from now()) * 1000)::bigint) end,
               'done', false) r
        from jsonb_array_elements(new_rep) e
       where e->>'by' = p_mid and coalesce(e->>'id', '') ~ '^[A-Za-z0-9_-]{1,64}$'
         and not exists (select 1 from jsonb_array_elements(old_rep) x where x->>'id' = e->>'id')
       limit 5) z), '[]'::jsonb));

  out_data := jsonb_set(out_data, '{comments}', (
    select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select e from jsonb_array_elements(case when jsonb_typeof(p_old->'comments') = 'array' then p_old->'comments' else '[]'::jsonb end) e
       where e->>'by' is distinct from p_mid
      union all
      select e from jsonb_array_elements(case when jsonb_typeof(p_new->'comments') = 'array' then p_new->'comments' else '[]'::jsonb end) e
       where e->>'by' = p_mid and length(coalesce(e->>'text', '')) between 1 and 200
    ) x));
  out_data := jsonb_set(out_data, '{timeLog}', (
    select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select e from jsonb_array_elements(case when jsonb_typeof(p_old->'timeLog') = 'array' then p_old->'timeLog' else '[]'::jsonb end) e
       where e->>'m' is distinct from p_mid
      union all
      select o from jsonb_array_elements(case when jsonb_typeof(p_old->'timeLog') = 'array' then p_old->'timeLog' else '[]'::jsonb end) o
       where o->>'m' = p_mid
         and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_new->'timeLog') = 'array' then p_new->'timeLog' else '[]'::jsonb end) n where n->>'id' = o->>'id')
      union all
      select e || jsonb_build_object('min', least(greatest(round((e->>'min')::numeric)::int, 1), 240))
        from jsonb_array_elements(case when jsonb_typeof(p_new->'timeLog') = 'array' then p_new->'timeLog' else '[]'::jsonb end) e
       where e->>'m' = p_mid and jsonb_typeof(e->'min') = 'number'
         and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_old->'timeLog') = 'array' then p_old->'timeLog' else '[]'::jsonb end) o where o->>'id' = e->>'id')
         and exists (select 1 from jsonb_array_elements(coalesce(out_data->'tasks', '[]'::jsonb)) t where t->>'id' = e->>'k' and t->>'owner' = p_mid)
    ) x));
  return out_data;
end;
$function$;

-- Lets the app know the database supports these features (the app hides them until this exists).
create or replace function public.hb_features()
returns text[]
language sql
stable
set search_path to ''
as $$ select array['teen', 'reports']::text[] $$;
revoke all on function public.hb_features() from public, anon;
grant execute on function public.hb_features() to authenticated;
