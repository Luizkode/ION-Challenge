-- Apply once after 001 and 002, in staging first. No business records are deleted.
BEGIN;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK(role IN ('admin','sdr','closer','member','partner'));
ALTER TABLE public.profiles ADD COLUMN category text;
UPDATE public.profiles SET category=CASE WHEN role='admin' THEN 'admin' ELSE 'employee' END;
ALTER TABLE public.profiles ALTER COLUMN category SET NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_category_check CHECK(category IN ('admin','employee','partner'));
-- Compatible default for authorized legacy/bootstrap inserts; trigger synchronizes access.
ALTER TABLE public.profiles ALTER COLUMN category SET DEFAULT 'employee';
CREATE TABLE public.user_functions(profile_id uuid REFERENCES profiles(id),function_code text CHECK(function_code IN ('sdr','closer','traffic','designer','video_editor','copywriter')),PRIMARY KEY(profile_id,function_code));
INSERT INTO user_functions SELECT id,role FROM profiles WHERE role IN ('sdr','closer');
CREATE TABLE public.access_companies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 150),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.client_assignments(profile_id uuid REFERENCES profiles(id),company_id uuid REFERENCES access_companies(id),PRIMARY KEY(profile_id,company_id));
CREATE TABLE public.partner_companies(profile_id uuid REFERENCES profiles(id),company_id uuid REFERENCES access_companies(id),PRIMARY KEY(profile_id,company_id));
CREATE TABLE public.access_invitations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,name text NOT NULL,category text NOT NULL,functions jsonb NOT NULL,company_ids jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES profiles(id),auth_user_id uuid REFERENCES auth.users(id),requested_active boolean NOT NULL DEFAULT true,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed')),created_at timestamptz NOT NULL DEFAULT now(),detail text);
CREATE UNIQUE INDEX one_pending_access_invite ON access_invitations(lower(email)) WHERE status='pending';

CREATE FUNCTION public.has_user_function(uid uuid,code text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p JOIN user_functions f ON f.profile_id=p.id WHERE p.id=uid AND p.active AND p.category='employee' AND f.function_code=code)
$$;
CREATE FUNCTION public.has_function(code text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT has_user_function(auth.uid(),code) $$;
CREATE FUNCTION public.can_commercial() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR has_function('sdr') OR has_function('closer') $$;
CREATE FUNCTION public.can_challenger() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR has_function('closer') OR has_function('sdr') AND EXISTS(SELECT 1 FROM campaign_participants WHERE profile_id=auth.uid() AND active) $$;
CREATE FUNCTION public.current_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('category',p.category,'functions',coalesce((SELECT jsonb_agg(function_code ORDER BY function_code) FROM user_functions WHERE profile_id=p.id),'[]'::jsonb),'challenger',can_challenger()) FROM profiles p WHERE p.id=auth.uid() AND p.active
$$;
CREATE OR REPLACE FUNCTION public.owns_opportunity(oid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT can_commercial() AND EXISTS(SELECT 1 FROM opportunities WHERE id=oid AND sdr_id=auth.uid()) $$;

CREATE OR REPLACE FUNCTION public.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,old_state,new_state,reason) VALUES(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'profile_id',to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'profile_id'),CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,nullif(current_setting('ion.reason',true),''));RETURN coalesce(NEW,OLD); END $$;

-- Synchronize only legacy inserts. Updates are exclusively made by managed RPCs.
CREATE FUNCTION public.bootstrap_access_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW.role='admin' THEN UPDATE profiles SET category='admin' WHERE id=NEW.id;
 ELSIF NEW.role IN ('sdr','closer') THEN INSERT INTO user_functions VALUES(NEW.id,NEW.role) ON CONFLICT DO NOTHING;
 ELSIF NEW.role='partner' THEN UPDATE profiles SET category='partner' WHERE id=NEW.id; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER bootstrap_access AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION bootstrap_access_profile();

-- The only write path for categories, combined roles and company bindings.
CREATE FUNCTION public.manage_access(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pid uuid; old_profile profiles; cat text; codes text[]; companies uuid[]; legacy text; cid uuid; ca record; BEGIN
 PERFORM require_admin(); PERFORM pg_advisory_xact_lock(70013); PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN RAISE EXCEPTION 'Confirme a alteração e informe uma justificativa de ao menos 8 caracteres'; END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 pid:=(data->>'id')::uuid; cat:=data->>'category';
 SELECT coalesce(array_agg(DISTINCT v),'{}') INTO codes FROM jsonb_array_elements_text(coalesce(data->'functions','[]')) v;
 SELECT coalesce(array_agg(DISTINCT v::uuid),'{}') INTO companies FROM jsonb_array_elements_text(coalesce(data->'company_ids','[]')) v;
 IF cat IS NULL OR cat NOT IN ('admin','employee','partner') THEN RAISE EXCEPTION 'Categoria inválida'; END IF;
 IF cat='employee' AND cardinality(codes)=0 THEN RAISE EXCEPTION 'Selecione ao menos uma função'; END IF;
 IF cat<>'employee' AND cardinality(codes)>0 THEN RAISE EXCEPTION 'Somente colaboradores podem receber funções'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(codes) c WHERE c NOT IN ('sdr','closer','traffic','designer','video_editor','copywriter')) THEN RAISE EXCEPTION 'Função inválida'; END IF;
 IF cat='partner' AND cardinality(companies)=0 THEN RAISE EXCEPTION 'Vincule o parceiro a uma empresa'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(companies) c WHERE NOT EXISTS(SELECT 1 FROM access_companies WHERE id=c AND active)) THEN RAISE EXCEPTION 'Empresa inválida ou inativa'; END IF;
 FOR ca IN SELECT c.id FROM campaigns c JOIN campaign_participants cp ON cp.campaign_id=c.id WHERE cp.profile_id=pid AND cp.active AND c.state<>'finalized' ORDER BY c.id FOR UPDATE OF c LOOP NULL; END LOOP;
 SELECT * INTO old_profile FROM profiles WHERE id=pid FOR UPDATE;
 IF old_profile.role='admin' AND old_profile.active AND (cat<>'admin' OR NOT (data->>'active')::boolean) AND (SELECT count(*) FROM profiles WHERE role='admin' AND active)<=1 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo'; END IF;
 IF pid=auth.uid() AND (cat<>'admin' OR NOT (data->>'active')::boolean) THEN RAISE EXCEPTION 'Você não pode remover seu próprio acesso administrativo'; END IF;
 IF NOT(cat='employee' AND 'sdr'=ANY(codes)) AND EXISTS(SELECT 1 FROM campaign_participants cp JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.profile_id=pid AND cp.active AND c.state<>'finalized') THEN
 IF data->>'remove_from_campaign' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Selecione remover da campanha ao retirar a função SDR'; END IF;
 END IF;
 IF data->>'remove_from_campaign'='true' THEN UPDATE campaign_participants cp SET active=false,removed_at=now(),removed_by=auth.uid() FROM campaigns c WHERE c.id=cp.campaign_id AND cp.profile_id=pid AND cp.active AND c.state<>'finalized'; END IF;
 legacy:=CASE WHEN cat='admin' THEN 'admin' WHEN cat='partner' THEN 'partner' WHEN 'sdr'=ANY(codes) THEN 'sdr' WHEN 'closer'=ANY(codes) THEN 'closer' ELSE 'member' END;
 INSERT INTO profiles(id,name,role,active,category) VALUES(pid,trim(data->>'name'),legacy,(data->>'active')::boolean,cat) ON CONFLICT(id) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active,category=excluded.category;
 DELETE FROM user_functions WHERE profile_id=pid;
 INSERT INTO user_functions SELECT pid,c FROM unnest(codes) c;
 DELETE FROM client_assignments WHERE profile_id=pid; DELETE FROM partner_companies WHERE profile_id=pid;
 IF cat='employee' THEN INSERT INTO client_assignments SELECT pid,c FROM unnest(companies) c;
 ELSIF cat='partner' THEN INSERT INTO partner_companies SELECT pid,c FROM unnest(companies) c; END IF;
 END $$;

-- Make the old entry point private, retaining all other campaign operations.
ALTER FUNCTION public.admin_operation(text,jsonb) RENAME TO admin_operation_v2;
REVOKE EXECUTE ON FUNCTION public.admin_operation_v2(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.admin_operation(operation text,data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing profiles; codes jsonb; cat text; BEGIN
 PERFORM require_admin();
 IF operation='profile' THEN
 SELECT * INTO existing FROM profiles WHERE id=(data->>'id')::uuid;
 cat:=CASE WHEN data->>'role'='admin' THEN 'admin' WHEN data->>'role'='partner' THEN 'partner' ELSE 'employee' END;
 IF existing.role=data->>'role' THEN SELECT coalesce(jsonb_agg(function_code),'[]') INTO codes FROM user_functions WHERE profile_id=existing.id;
 ELSE codes:=CASE WHEN data->>'role' IN ('sdr','closer') THEN jsonb_build_array(data->>'role') ELSE '[]'::jsonb END; END IF;
 PERFORM manage_access(data||jsonb_build_object('category',cat,'functions',codes,'company_ids',coalesce((SELECT jsonb_agg(company_id) FROM client_assignments WHERE profile_id=existing.id),'[]'::jsonb)));
 ELSE PERFORM admin_operation_v2(operation,data); END IF;
END $$;
CREATE FUNCTION public.manage_access_company(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE cid uuid; BEGIN
 PERFORM require_admin();PERFORM set_config('ion.reason','Cadastro de empresa para controle de acesso',true);
 INSERT INTO access_companies(name) VALUES(trim(data->>'name')) RETURNING id INTO cid; RETURN cid; END $$;

CREATE FUNCTION public.validate_invite_spec(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE cat text; codes text[]; ids uuid[]; BEGIN
 cat:=data->>'category';
 SELECT coalesce(array_agg(v),'{}') INTO codes FROM jsonb_array_elements_text(coalesce(data->'functions','[]')) v;
 SELECT coalesce(array_agg(v::uuid),'{}') INTO ids FROM jsonb_array_elements_text(coalesce(data->'company_ids','[]')) v;
 IF cat IS NULL OR cat NOT IN ('admin','employee','partner') OR length(trim(coalesce(data->>'name','')))<2 OR length(data->>'name')>120 THEN RAISE EXCEPTION 'Revise categoria e nome'; END IF;
 IF cat='employee' AND cardinality(codes)=0 OR cat<>'employee' AND cardinality(codes)>0 OR EXISTS(SELECT 1 FROM unnest(codes) c WHERE c NOT IN ('sdr','closer','traffic','designer','video_editor','copywriter')) THEN RAISE EXCEPTION 'Funções inválidas'; END IF;
 IF cat='partner' AND cardinality(ids)=0 THEN RAISE EXCEPTION 'Vincule o parceiro a uma empresa'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ids) cid WHERE NOT EXISTS(SELECT 1 FROM access_companies WHERE id=cid AND active)) THEN RAISE EXCEPTION 'Empresa inválida ou inativa'; END IF;
 END $$;
REVOKE EXECUTE ON FUNCTION public.validate_invite_spec(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.begin_access_invite(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE iid uuid; BEGIN
 PERFORM require_admin(); PERFORM validate_invite_spec(data);
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN RAISE EXCEPTION 'Confirme o convite e informe uma justificativa'; END IF;
 IF coalesce(data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Email inválido'; END IF;
 INSERT INTO access_invitations(email,name,category,functions,company_ids,actor_id,detail,requested_active) VALUES(lower(trim(data->>'email')),trim(data->>'name'),data->>'category',coalesce(data->'functions','[]'),coalesce(data->'company_ids','[]'),auth.uid(),data->>'reason',coalesce((data->>'active')::boolean,true)) RETURNING id INTO iid;
 RETURN iid; END $$;
CREATE FUNCTION public.complete_access_invite(invitation_id uuid,uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE inv access_invitations; BEGIN
 PERFORM require_admin(); SELECT * INTO inv FROM access_invitations WHERE id=invitation_id FOR UPDATE;
 IF inv.id IS NULL OR inv.status<>'pending' THEN RAISE EXCEPTION 'Convite inválido'; END IF;
 IF EXISTS(SELECT 1 FROM profiles WHERE id=uid) THEN RAISE EXCEPTION 'Usuário já possui perfil. Edite o acesso existente'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND lower(email)=inv.email) THEN RAISE EXCEPTION 'Usuário do convite não corresponde ao email'; END IF;
 PERFORM manage_access(jsonb_build_object('id',uid,'name',inv.name,'category',inv.category,'functions',inv.functions,'company_ids',inv.company_ids,'active',inv.requested_active::text,'confirm','true','reason',inv.detail));
 UPDATE access_invitations SET status='completed',auth_user_id=uid WHERE id=inv.id;
END $$;
CREATE FUNCTION public.fail_access_invite(invitation_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin(); UPDATE access_invitations SET status='failed',detail=coalesce(detail,'')||' · Falha no envio ou vínculo; revisar configuração do convite' WHERE id=invitation_id AND status='pending'; END $$;

-- RLS on every new relation; clients cannot mutate any of them directly.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['user_functions','access_companies','client_assignments','partner_companies','access_invitations'] LOOP
 EXECUTE format('alter table public.%I enable row level security',t);
 EXECUTE format('revoke all on public.%I from anon,authenticated',t);
 EXECUTE format('grant select on public.%I to authenticated',t);
 EXECUTE format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_change()',t,t);
 END LOOP; END $$;
CREATE POLICY functions_read ON user_functions FOR SELECT TO authenticated USING(actor_role()='admin' OR profile_id=auth.uid() AND actor_role() IS NOT NULL);
CREATE POLICY assignments_read ON client_assignments FOR SELECT TO authenticated USING(actor_role()='admin' OR profile_id=auth.uid() AND actor_role() IS NOT NULL);
CREATE POLICY partner_bindings_read ON partner_companies FOR SELECT TO authenticated USING(actor_role()='admin' OR profile_id=auth.uid() AND actor_role()='partner');
CREATE FUNCTION public.can_read_company(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR EXISTS(SELECT 1 FROM client_assignments a JOIN profiles p ON p.id=a.profile_id WHERE a.profile_id=auth.uid() AND a.company_id=cid AND p.active AND p.category='employee') OR EXISTS(SELECT 1 FROM partner_companies a JOIN profiles p ON p.id=a.profile_id WHERE a.profile_id=auth.uid() AND a.company_id=cid AND p.active AND p.category='partner') $$;
CREATE POLICY companies_read ON access_companies FOR SELECT TO authenticated USING(can_read_company(id));
CREATE POLICY invitations_read ON access_invitations FOR SELECT TO authenticated USING(actor_role()='admin');

CREATE FUNCTION public.visible_profile(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR actor_role() IS NOT NULL AND (uid=auth.uid() OR can_commercial() AND has_user_function(uid,'closer')) $$;
DROP POLICY profiles_read ON profiles;
CREATE POLICY profiles_read ON profiles FOR SELECT TO authenticated USING(visible_profile(id));
DROP POLICY teams_read ON teams;
CREATE POLICY teams_read ON teams FOR SELECT TO authenticated USING(can_challenger());
DROP POLICY campaigns_read ON campaigns;
CREATE POLICY campaigns_read ON campaigns FOR SELECT TO authenticated USING(can_challenger());
DROP POLICY participants_read ON campaign_participants;
CREATE POLICY participants_read ON campaign_participants FOR SELECT TO authenticated USING(can_challenger());
DROP POLICY opportunities_read ON opportunities;
CREATE POLICY opportunities_read ON opportunities FOR SELECT TO authenticated USING(actor_role()='admin' OR has_function('sdr') AND sdr_id=auth.uid() OR has_function('closer') AND EXISTS(SELECT 1 FROM meetings m WHERE m.opportunity_id=opportunities.id AND m.closer_id=auth.uid()));
DROP POLICY meetings_read ON meetings;
CREATE POLICY meetings_read ON meetings FOR SELECT TO authenticated USING(actor_role()='admin' OR has_function('closer') AND closer_id=auth.uid() OR has_function('sdr') AND owns_opportunity(opportunity_id));
DROP POLICY updates_read ON competition_updates;
CREATE POLICY updates_read ON competition_updates FOR SELECT TO authenticated USING(can_challenger());
-- Explicitly revoke PUBLIC defaults for every new privileged function.
REVOKE EXECUTE ON FUNCTION public.has_user_function(uuid,text),public.has_function(text),public.can_commercial(),public.can_challenger(),public.current_access(),public.bootstrap_access_profile(),public.manage_access(jsonb),public.manage_access_company(jsonb),public.admin_operation(text,jsonb),public.begin_access_invite(jsonb),public.complete_access_invite(uuid,uuid),public.fail_access_invite(uuid),public.can_read_company(uuid),public.visible_profile(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_function(text),public.can_commercial(),public.can_challenger(),public.current_access(),public.manage_access(jsonb),public.manage_access_company(jsonb),public.admin_operation(text,jsonb),public.begin_access_invite(jsonb),public.complete_access_invite(uuid,uuid),public.fail_access_invite(uuid),public.can_read_company(uuid),public.visible_profile(uuid) TO authenticated;

create or replace function public.dashboard(p_campaign uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; begin
 if actor_role() is null then raise exception 'Conta inativa ou sem perfil'; end if; if not can_challenger() then raise exception 'Sem acesso ao Challenger'; end if;
 with personal as (
 select p.id,p.name,t.name as team,p.active,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held,count(s.id) filter(where s.qualified)::int as qualified,count(s.id) filter(where s.contracted)::int as contracts
 from campaign_participants cp join profiles p on p.id=cp.profile_id join teams t on t.id=cp.team_id left join opportunity_scores s on s.sdr_id=p.id and s.campaign_id=cp.campaign_id where cp.campaign_id=p_campaign and cp.active group by p.id,t.name
 ), ranked as (select *,rank() over(order by points desc,contracts desc,qualified desc,held desc) as position from personal), team_scores as (
 select t.id,t.name,count(distinct cp.profile_id)::int as participants,coalesce(sum(s.points),0)::int as points,count(s.id) filter(where s.held)::int as held from teams t join campaign_participants cp on cp.team_id=t.id and cp.campaign_id=p_campaign and cp.active left join opportunity_scores s on s.sdr_id=cp.profile_id and s.campaign_id=cp.campaign_id group by t.id
 ) select jsonb_build_object('individual',coalesce((select jsonb_agg(r order by r.position,r.name) from ranked r),'[]'::jsonb),'teams',coalesce((select jsonb_agg(t order by t.points desc,t.name) from team_scores t),'[]'::jsonb),'held',(select count(*) from opportunity_scores where campaign_id=p_campaign and held),'qualified',(select count(*) from opportunity_scores where campaign_id=p_campaign and qualified),'contracts',(select count(*) from opportunity_scores where campaign_id=p_campaign and contracted),'active_sdrs',(select count(*) from personal where active)) into result;
 return result; end $$;

create or replace function public.create_meeting(data jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare cp campaign_participants; ca campaigns; op opportunities; oid uuid; mid uuid; phone_value text; begin
 if not has_function('sdr') then raise exception 'Apenas SDRs podem cadastrar reuniões'; end if;
 select * into ca from campaigns where id=(data->>'campaign_id')::uuid for update;
 if ca.state<>'active' or now()<ca.starts_at or now()>=ca.ends_at then raise exception 'A campanha não está no período ativo'; end if;
 select * into cp from campaign_participants where campaign_id=ca.id and profile_id=auth.uid() and active;
 if cp.profile_id is null then raise exception 'Você não participa desta campanha'; end if;
 if not exists(select 1 from profiles where id=(data->>'closer_id')::uuid and has_user_function(id,'closer')) then raise exception 'Closer inválido'; end if;
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



create or replace function public.validate_meeting(data jsonb) returns void language plpgsql security definer set search_path=public as $$
declare m meetings; op opportunities; ca campaigns; target text; begin
 select o.* into op from opportunities o join meetings x on x.opportunity_id=o.id where x.id=(data->>'id')::uuid;
 select * into ca from campaigns where id=op.campaign_id for update;
 select * into m from meetings where id=(data->>'id')::uuid for update;
 if m.id is null or not (coalesce(actor_role()='admin',false) or has_function('closer') and m.closer_id=auth.uid() and op.sdr_id<>auth.uid()) then raise exception 'Sem permissão para validar esta reunião'; end if;
 if ca.state='finalized' then raise exception 'Campanha finalizada'; end if;
 if m.scheduled_at>now() then raise exception 'Aguarde o horário da reunião'; end if;
 if m.status not in ('scheduled','pending','held') then raise exception 'Resultado já validado. Solicite correção administrativa'; end if;
 target:=case when (data->>'attended')::boolean then case when (data->>'qualified')::boolean then 'qualified' else 'held' end else 'no_show' end;
 insert into meeting_validations(meeting_id,actor_id,previous_status,new_status,notes) values(m.id,auth.uid(),m.status,target,coalesce(data->>'notes',''));
 update meetings set status=target,notes=coalesce(data->>'notes','') where id=m.id;
 end $$;


create or replace function public.point_history() returns jsonb language plpgsql stable security definer set search_path=public as $$ begin
 if not can_commercial() then raise exception 'Conta inativa'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('date',a.created_at,'company',o.company,'action',case when a.entity='contracts' then case when a.new_state->>'active'='true' then 'Contrato confirmado' else 'Contrato anulado' end else 'Reunião: '||(a.new_state->>'status') end,'reason',a.reason) order by a.id desc) from audit_logs a join opportunities o on o.id=coalesce(a.new_state->>'opportunity_id',a.old_state->>'opportunity_id')::uuid where o.sdr_id=auth.uid() and a.entity in ('meetings','contracts')),'[]'::jsonb);
 end $$;

CREATE FUNCTION public.available_closers() RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT p.id,p.name FROM profiles p WHERE can_commercial() AND has_user_function(p.id,'closer') ORDER BY p.name $$;
REVOKE EXECUTE ON FUNCTION public.available_closers() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.available_closers() TO authenticated;
create or replace function public.admin_operation_v1(operation text,data jsonb) returns void language plpgsql security definer set search_path=public as $$
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
 if not exists(select 1 from profiles where id=(data->>'closer_id')::uuid and has_user_function(id,'closer')) then raise exception 'Closer inválido'; end if;
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


COMMIT;
