-- Run once in a fresh Supabase project. All writes go through authorized RPCs.
create table public.profiles (id uuid primary key references auth.users(id), name text not null check(length(name) between 2 and 120), role text not null check(role in ('sdr','closer','admin')), active boolean not null default true);
create table public.teams (id uuid primary key default gen_random_uuid(), name text not null unique check(length(name) between 2 and 100));
create table public.campaigns (id uuid primary key default gen_random_uuid(), name text not null, description text not null default '', prize text not null default 'iPhone 13', goal integer not null default 700 check(goal>0), duration integer not null default 56 check(duration>0), starts_at timestamptz, ends_at timestamptz, state text not null default 'draft' check(state in ('draft','active','ended','finalized')), meeting_points integer not null default 1 check(meeting_points>=0), qualified_points integer not null default 3, contract_points integer not null default 7, winner_id uuid references public.profiles(id), check(qualified_points>=meeting_points and contract_points>=qualified_points), check(ends_at>starts_at), check(state='draft' or starts_at is not null and ends_at is not null), check(state='finalized' or winner_id is null));
create unique index one_open_campaign on public.campaigns ((true)) where state in ('draft','active','ended');
create table public.campaign_participants (campaign_id uuid references public.campaigns(id), profile_id uuid references public.profiles(id), team_id uuid not null references public.teams(id), primary key(campaign_id,profile_id));
create table public.opportunities (id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns(id), sdr_id uuid not null references public.profiles(id), team_id uuid not null references public.teams(id), company text not null check(length(company) between 2 and 150), contact text not null check(length(contact) between 2 and 120), phone text not null check(phone ~ '^[0-9]{10,15}$'), city text not null check(length(city) between 2 and 100), niche text not null check(length(niche) between 2 and 100), created_at timestamptz not null default now());
create table public.meetings (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.opportunities(id), closer_id uuid not null references public.profiles(id), scheduled_at timestamptz not null, status text not null default 'scheduled' check(status in ('scheduled','pending','held','qualified','no_show','cancelled','invalidated')), notes text not null default '', created_at timestamptz not null default now(), unique(opportunity_id,scheduled_at));
create table public.meeting_validations (id uuid primary key default gen_random_uuid(), meeting_id uuid not null references public.meetings(id), actor_id uuid not null references public.profiles(id), previous_status text not null, new_status text not null, notes text not null, created_at timestamptz not null default now());
create table public.contracts (id uuid primary key default gen_random_uuid(), opportunity_id uuid not null unique references public.opportunities(id), meeting_id uuid not null references public.meetings(id), closed_at date not null, amount numeric(14,2) not null check(amount>0), reference text not null check(length(reference)>=3), notes text not null default '', active boolean not null default true, confirmed_by uuid not null references public.profiles(id));
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null, entity text not null, entity_id text not null, old_state jsonb, new_state jsonb, reason text, created_at timestamptz not null default now());
insert into public.campaigns(name, description) values ('Corrida pelo iPhone 13','700 reuniões validadas. Uma conquista coletiva, um prêmio individual.');

create function public.actor_role() returns text language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() and active $$;
create function public.require_admin() returns void language plpgsql security definer set search_path=public as $$ begin if actor_role() is distinct from 'admin' then raise exception 'Acesso restrito ao administrador'; end if; end $$;
create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into audit_logs(actor_id,action,entity,entity_id,old_state,new_state,reason) values(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'profile_id',to_jsonb(OLD)->>'id'),case when TG_OP<>'INSERT' then to_jsonb(OLD) end,case when TG_OP<>'DELETE' then to_jsonb(NEW) end,nullif(current_setting('ion.reason',true),'')); return coalesce(NEW,OLD); end $$;
do $$ declare t text; begin foreach t in array array['profiles','teams','campaigns','campaign_participants','opportunities','meetings','contracts','meeting_validations'] loop execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_change()',t,t); end loop; end $$;

-- Only these projections expose competition data. No prospect information leaves them.
create view public.opportunity_scores with (security_invoker=false) as
select o.id,o.campaign_id,o.sdr_id,o.team_id,
 exists(select 1 from meetings m where m.opportunity_id=o.id and m.status in ('held','qualified')) as held,
 exists(select 1 from meetings m where m.opportunity_id=o.id and m.status='qualified') as qualified,
 exists(select 1 from contracts c join meetings m on m.id=c.meeting_id where c.opportunity_id=o.id and c.active and m.status in ('held','qualified')) as contracted,
 case when exists(select 1 from contracts c join meetings m on m.id=c.meeting_id where c.opportunity_id=o.id and c.active and m.status in ('held','qualified')) then ca.contract_points when exists(select 1 from meetings m where m.opportunity_id=o.id and m.status='qualified') then ca.qualified_points when exists(select 1 from meetings m where m.opportunity_id=o.id and m.status='held') then ca.meeting_points else 0 end as points
from opportunities o join campaigns ca on ca.id=o.campaign_id;
create function public.dashboard(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; begin
 if actor_role() is null then raise exception 'Conta inativa ou sem perfil'; end if;
 with personal as (
 select p.id,p.name,t.name as team,p.active,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held,count(s.id) filter(where s.qualified)::int as qualified,count(s.id) filter(where s.contracted)::int as contracts
 from campaign_participants cp join profiles p on p.id=cp.profile_id join teams t on t.id=cp.team_id left join opportunity_scores s on s.sdr_id=p.id and s.campaign_id=cp.campaign_id where cp.campaign_id=p_campaign group by p.id,t.name
 ), ranked as (select *,rank() over(order by points desc,contracts desc,qualified desc,held desc) as position from personal), team_scores as (
 select t.id,t.name,count(distinct cp.profile_id)::int as participants,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held from teams t join campaign_participants cp on cp.team_id=t.id and cp.campaign_id=p_campaign left join opportunity_scores s on s.sdr_id=cp.profile_id and s.campaign_id=cp.campaign_id group by t.id
 ) select jsonb_build_object('individual',coalesce((select jsonb_agg(r order by r.position,r.name) from ranked r),'[]'::jsonb),'teams',coalesce((select jsonb_agg(t order by t.points desc,t.name) from team_scores t),'[]'::jsonb),'held',(select count(*) from opportunity_scores where campaign_id=p_campaign and held),'qualified',(select count(*) from opportunity_scores where campaign_id=p_campaign and qualified),'contracts',(select count(*) from opportunity_scores where campaign_id=p_campaign and contracted),'active_sdrs',(select count(*) from personal where active)) into result;
 return result; end $$;

create function public.create_meeting(data jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cp campaign_participants; ca campaigns; op opportunities; oid uuid; mid uuid; phone_value text; begin
 if actor_role() is distinct from 'sdr' then raise exception 'Apenas SDRs podem cadastrar reuniões'; end if;
 select * into ca from campaigns where id=(data->>'campaign_id')::uuid for update;
 if ca.state<>'active' or now()<ca.starts_at or now()>=ca.ends_at then raise exception 'A campanha não está no período ativo'; end if;
 select * into cp from campaign_participants where campaign_id=ca.id and profile_id=auth.uid();
 if cp.profile_id is null then raise exception 'Você não participa desta campanha'; end if;
 if not exists(select 1 from profiles where id=(data->>'closer_id')::uuid and role='closer' and active) then raise exception 'Closer inválido'; end if;
 if (data->>'scheduled_at')::timestamptz<ca.starts_at or (data->>'scheduled_at')::timestamptz>=ca.ends_at then raise exception 'Reunião fora do período da campanha'; end if;
 phone_value:=regexp_replace(data->>'phone','[^0-9]','','g');
 -- Serializes campaign writes, preventing concurrent duplicate creation races.
 if nullif(data->>'opportunity_id','') is not null then
 select * into op from opportunities where id=(data->>'opportunity_id')::uuid and sdr_id=auth.uid() and campaign_id=ca.id;
 if op.id is null then raise exception 'Oportunidade inválida'; end if; oid:=op.id;
 else
 if exists(select 1 from opportunities where campaign_id=ca.id and phone=phone_value) then raise exception 'Possível duplicidade: selecione a oportunidade existente ou peça revisão administrativa'; end if;
 insert into opportunities(campaign_id,sdr_id,team_id,company,contact,phone,city,niche) values(ca.id,auth.uid(),cp.team_id,trim(data->>'company'),trim(data->>'contact'),phone_value,trim(data->>'city'),trim(data->>'niche')) returning id into oid;
 end if;
 insert into meetings(opportunity_id,closer_id,scheduled_at,notes) values(oid,(data->>'closer_id')::uuid,(data->>'scheduled_at')::timestamptz,coalesce(data->>'notes','')) returning id into mid;
 return mid; end $$;

create function public.validate_meeting(data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare m meetings; op opportunities; ca campaigns; target text; begin
 select o.* into op from opportunities o join meetings x on x.opportunity_id=o.id where x.id=(data->>'id')::uuid;
 select * into ca from campaigns where id=op.campaign_id for update;
 select * into m from meetings where id=(data->>'id')::uuid for update;
 if m.id is null or not (actor_role()='admin' or actor_role()='closer' and m.closer_id=auth.uid() and op.sdr_id<>auth.uid()) then raise exception 'Sem permissão para validar esta reunião'; end if;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 if m.scheduled_at>now() then raise exception 'Aguarde o horário da reunião'; end if;
 if m.status not in ('scheduled','pending','held') then raise exception 'Resultado já validado. Solicite correção administrativa'; end if;
 target:=case when (data->>'attended')::boolean then case when (data->>'qualified')::boolean then 'qualified' else 'held' end else 'no_show' end;
 insert into meeting_validations(meeting_id,actor_id,previous_status,new_status,notes) values(m.id,auth.uid(),m.status,target,coalesce(data->>'notes',''));
 update meetings set status=target,notes=coalesce(data->>'notes','') where id=m.id;
 end $$;

create function public.admin_operation(operation text,data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare ca campaigns; m meetings; op opportunities; pid uuid; team uuid; vrole text; total int; top_ids uuid[]; begin
 perform require_admin(); perform set_config('ion.reason',coalesce(data->>'reason',''),true);
 -- A global advisory lock also protects five-person team allocation and admin writes.
 perform pg_advisory_xact_lock(70013);
 if operation='team' then
 if nullif(data->>'id','') is null then insert into teams(name) values(trim(data->>'name')); else update teams set name=trim(data->>'name') where id=(data->>'id')::uuid; end if;
 elsif operation='profile' then
 pid:=(data->>'id')::uuid; vrole:=data->>'role';
 if pid=auth.uid() and (vrole<>'admin' or not (data->>'active')::boolean) then raise exception 'Você não pode remover seu próprio acesso administrativo'; end if;
 if exists(select 1 from campaign_participants where profile_id=pid) and vrole<>'sdr' then raise exception 'Participante de campanha deve manter perfil SDR'; end if;
 insert into profiles(id,name,role,active) values(pid,trim(data->>'name'),vrole,(data->>'active')::boolean) on conflict(id) do update set name=excluded.name,role=excluded.role,active=excluded.active;
 elsif operation='participant' then
 select * into ca from campaigns where id=(data->>'campaign_id')::uuid for update;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 pid:=(data->>'profile_id')::uuid; team:=(data->>'team_id')::uuid;
 if not exists(select 1 from profiles where id=pid and role='sdr' and active) then raise exception 'SDR inválido'; end if;
 if exists(select 1 from opportunities where sdr_id=pid and campaign_id=ca.id) then raise exception 'Vínculo congelado: este SDR já possui oportunidades nesta campanha'; end if;
 if data->>'remove'='true' then delete from campaign_participants where campaign_id=ca.id and profile_id=pid; return; end if;
 if (select count(*) from campaign_participants where campaign_id=ca.id and team_id=team and profile_id<>pid)>=5 then raise exception 'O time já possui cinco integrantes'; end if;
 insert into campaign_participants values(ca.id,pid,team) on conflict(campaign_id,profile_id) do update set team_id=excluded.team_id;
 elsif operation='campaign' then
 select * into ca from campaigns where id=(data->>'id')::uuid for update;
 if ca.state<>'draft' and (length(coalesce(data->>'reason',''))<8 or data->>'confirm'<>'true') then raise exception 'Alteração exige confirmação explícita e justificativa'; end if;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 update campaigns set name=trim(data->>'name'),description=coalesce(data->>'description',''),prize=trim(data->>'prize'),goal=(data->>'goal')::int,duration=(data->>'duration')::int,starts_at=nullif(data->>'starts_at','')::timestamptz,ends_at=nullif(data->>'starts_at','')::timestamptz+make_interval(days=>(data->>'duration')::int),meeting_points=(data->>'meeting_points')::int,qualified_points=(data->>'qualified_points')::int,contract_points=(data->>'contract_points')::int,state=case when data->>'activate'='true' then 'active' else ca.state end where id=ca.id;
 elsif operation='new_campaign' then
 insert into campaigns(name,prize) values(trim(data->>'name'),trim(data->>'prize'));
 elsif operation='correct_meeting' then
 if length(trim(coalesce(data->>'reason','')))<8 then raise exception 'Informe uma justificativa de ao menos 8 caracteres'; end if;
 select o.* into op from opportunities o join meetings x on x.opportunity_id=o.id where x.id=(data->>'id')::uuid;
 select * into ca from campaigns where id=op.campaign_id for update;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 select * into m from meetings where id=(data->>'id')::uuid for update;
 if m.id is null then raise exception 'Reunião não encontrada'; end if;
 if data->>'status' not in ('cancelled','invalidated','held','qualified','no_show','pending') then raise exception 'Status inválido'; end if;
 if data->>'status' in ('held','qualified') and m.scheduled_at>now() then raise exception 'Reunião futura'; end if;
 insert into meeting_validations(meeting_id,actor_id,previous_status,new_status,notes) values(m.id,auth.uid(),m.status,data->>'status',data->>'reason');
 update meetings set status=data->>'status' where id=m.id;
 elsif operation='contract' then
 select o.* into op from opportunities o join meetings x on x.opportunity_id=o.id where x.id=(data->>'meeting_id')::uuid;
 select * into ca from campaigns where id=op.campaign_id for update;
 select * into m from meetings where id=(data->>'meeting_id')::uuid for update;
 if ca.state='finalized' or m.status not in ('held','qualified') or m.id is null then raise exception 'Contrato exige reunião válida e campanha não finalizada'; end if;
 if (data->>'closed_at')::date>current_date or (data->>'closed_at')::date<(m.scheduled_at at time zone 'America/Sao_Paulo')::date then raise exception 'Fechamento deve ocorrer entre a reunião e a data atual'; end if;
 insert into contracts(opportunity_id,meeting_id,closed_at,amount,reference,notes,confirmed_by) values(op.id,m.id,(data->>'closed_at')::date,(data->>'amount')::numeric,trim(data->>'reference'),coalesce(data->>'notes',''),auth.uid());
 elsif operation='void_contract' then
 if length(trim(coalesce(data->>'reason','')))<8 then raise exception 'Justificativa obrigatória'; end if;
 select c.* into ca from campaigns c join opportunities o on o.campaign_id=c.id join contracts x on x.opportunity_id=o.id where x.id=(data->>'id')::uuid for update of c;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 update contracts set active=false where id=(data->>'id')::uuid;
 elsif operation='duplicate_exception' then
 if length(trim(coalesce(data->>'reason','')))<8 then raise exception 'Justificativa obrigatória'; end if;
 select * into op from opportunities where id=(data->>'opportunity_id')::uuid;
 select * into ca from campaigns where id=op.campaign_id for update;
 if ca.state<>'active' or now()<ca.starts_at or now()>=ca.ends_at then raise exception 'Campanha fora do período ativo'; end if;
 if not exists(select 1 from profiles where id=(data->>'closer_id')::uuid and role='closer' and active) then raise exception 'Closer inválido'; end if;
 if (data->>'scheduled_at')::timestamptz<ca.starts_at or (data->>'scheduled_at')::timestamptz>=ca.ends_at then raise exception 'Reunião fora do período da campanha'; end if;
 insert into opportunities(campaign_id,sdr_id,team_id,company,contact,phone,city,niche) values(op.campaign_id,op.sdr_id,op.team_id,op.company,op.contact,op.phone,op.city,op.niche) returning id into pid;
 insert into meetings(opportunity_id,closer_id,scheduled_at,notes) values(pid,(data->>'closer_id')::uuid,(data->>'scheduled_at')::timestamptz,data->>'reason');
 elsif operation='finalize' then
 select * into ca from campaigns where id=(data->>'id')::uuid for update;
 if ca.state not in ('active','ended') or now()<ca.ends_at or length(coalesce(data->>'reason',''))<8 then raise exception 'Encerramento exige fim do período e conferência justificada'; end if;
 select count(*) into total from opportunity_scores where campaign_id=ca.id and held;
 select array_agg((r->>'id')::uuid) into top_ids from jsonb_array_elements(dashboard(ca.id)->'individual') r where (r->>'position')::int=1;
 if total>=ca.goal then
 pid:=(data->>'winner_id')::uuid;
 if pid is null or not(pid=any(top_ids)) then raise exception 'Selecione um líder do ranking após conferir o desempate'; end if;
 else pid:=null; end if;
 update campaigns set state='finalized',winner_id=pid where id=ca.id;
 else raise exception 'Operação desconhecida'; end if;
 end $$;

-- Deny direct mutations even if a client bypasses the application.
do $$ declare t text; begin foreach t in array array['profiles','teams','campaigns','campaign_participants','opportunities','meetings','meeting_validations','contracts','audit_logs'] loop execute format('alter table public.%I enable row level security',t); execute format('revoke all on public.%I from anon,authenticated',t); execute format('grant select on public.%I to authenticated',t); end loop; end $$;
create policy profiles_read on profiles for select to authenticated using (actor_role() is not null);
create policy teams_read on teams for select to authenticated using (actor_role() is not null);
create policy campaigns_read on campaigns for select to authenticated using (actor_role() is not null);
create policy participants_read on campaign_participants for select to authenticated using (actor_role() is not null);
create policy opportunities_read on opportunities for select to authenticated using (actor_role()='admin' or actor_role()='sdr' and sdr_id=auth.uid() or actor_role()='closer' and exists(select 1 from meetings m where m.opportunity_id=opportunities.id and m.closer_id=auth.uid()));
create policy meetings_read on meetings for select to authenticated using (actor_role()='admin' or actor_role()='closer' and closer_id=auth.uid() or actor_role()='sdr' and exists(select 1 from opportunities o where o.id=meetings.opportunity_id and o.sdr_id=auth.uid()));
-- Separate helper avoids recursive policies on meetings/opportunities.
create function public.owns_opportunity(oid uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from opportunities where id=oid and sdr_id=auth.uid()) $$;
drop policy meetings_read on meetings;
create policy meetings_read on meetings for select to authenticated using (actor_role()='admin' or actor_role()='closer' and closer_id=auth.uid() or actor_role()='sdr' and owns_opportunity(opportunity_id));
create policy validations_read on meeting_validations for select to authenticated using (actor_role()='admin' or exists(select 1 from meetings m where m.id=meeting_validations.meeting_id));
create policy contracts_read on contracts for select to authenticated using (actor_role()='admin');
create policy audit_read on audit_logs for select to authenticated using (actor_role()='admin');
revoke all on opportunity_scores from public,anon,authenticated;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function actor_role(),owns_opportunity(uuid),dashboard(uuid),create_meeting(jsonb),validate_meeting(jsonb),admin_operation(text,jsonb) to authenticated;
-- Realtime only publishes public campaign configuration; prospect data is never broadcast.
-- Polling is the fallback and refreshes rankings after every critical operation.
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.campaigns; end if; end $$;

-- Small, non-sensitive invalidation feed for instant dashboard refresh.
create table public.competition_updates (campaign_id uuid primary key references campaigns(id), updated_at timestamptz not null default now());
alter table competition_updates enable row level security;
revoke all on competition_updates from anon,authenticated;
grant select on competition_updates to authenticated;
create policy updates_read on competition_updates for select to authenticated using(actor_role() is not null);
create function public.notify_competition() returns trigger language plpgsql security definer set search_path=public as $$ declare cid uuid; begin
 select o.campaign_id into cid from opportunities o where o.id=NEW.opportunity_id;
 insert into competition_updates(campaign_id,updated_at) values(cid,clock_timestamp()) on conflict(campaign_id) do update set updated_at=excluded.updated_at;
 return NEW; end $$;
revoke execute on function notify_competition() from public,anon,authenticated;
create trigger meeting_refresh after insert or update on meetings for each row execute function notify_competition();
create trigger contract_refresh after insert or update on contracts for each row execute function notify_competition();
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.competition_updates; end if; end $$;

create function public.point_history() returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if actor_role() is null then raise exception 'Conta inativa'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('date',a.created_at,'company',o.company,'action',case when a.entity='contracts' then case when a.new_state->>'active'='true' then 'Contrato confirmado' else 'Contrato anulado' end else 'Reunião: '||(a.new_state->>'status') end,'reason',a.reason) order by a.id desc) from audit_logs a join opportunities o on o.id=coalesce(a.new_state->>'opportunity_id',a.old_state->>'opportunity_id')::uuid where o.sdr_id=auth.uid() and a.entity in ('meetings','contracts')),'[]'::jsonb);
 end $$;
revoke execute on function point_history() from public,anon;
grant execute on function point_history() to authenticated;
