-- Etapa 3. Apply once after 003, only with verified recovery. No historical rows rewritten.
BEGIN;
SET LOCAL lock_timeout = '8s';
CREATE TABLE public.crm_grants(profile_id uuid PRIMARY KEY REFERENCES profiles(id), granted_by uuid NOT NULL REFERENCES profiles(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.crm_leads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company text NOT NULL CHECK(length(trim(company)) BETWEEN 2 AND 150),
 contact text NOT NULL CHECK(length(trim(contact)) BETWEEN 2 AND 120), phone text NOT NULL UNIQUE CHECK(phone ~ '^[0-9]{10,15}$'),
 email text NOT NULL DEFAULT '' CHECK(email='' OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 niche text NOT NULL CHECK(length(trim(niche)) BETWEEN 2 AND 100), city text NOT NULL CHECK(length(trim(city)) BETWEEN 2 AND 100),
 state text NOT NULL CHECK(state ~ '^[A-Z]{2}$'), source text NOT NULL CHECK(length(trim(source)) BETWEEN 2 AND 100),
 sdr_id uuid NOT NULL REFERENCES profiles(id), closer_id uuid REFERENCES profiles(id),
 stage text NOT NULL DEFAULT 'new' CHECK(stage IN ('new','contacted','replied','interested','scheduled','held','proposed','negotiation','won','lost')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=10000), last_contact_at timestamptz, follow_up_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 archived boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES profiles(id));
CREATE UNIQUE INDEX crm_email_unique ON crm_leads(lower(email)) WHERE email<>'';
CREATE INDEX crm_sdr_follow_up ON crm_leads(sdr_id,follow_up_at) WHERE NOT archived;
CREATE INDEX crm_closer_stage ON crm_leads(closer_id,stage) WHERE NOT archived;
CREATE TABLE public.crm_activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid NOT NULL REFERENCES crm_leads(id),actor_id uuid NOT NULL REFERENCES profiles(id),kind text NOT NULL CHECK(kind IN ('contact','response','note','stage','meeting','deal','assignment')),channel text NOT NULL DEFAULT '' CHECK(length(channel)<=80),description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX crm_activity_timeline ON crm_activities(lead_id,created_at DESC);
CREATE TABLE public.crm_deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid NOT NULL REFERENCES crm_leads(id),amount numeric(14,2) NOT NULL CHECK(amount>0),services text NOT NULL CHECK(length(trim(services)) BETWEEN 2 AND 2000),term_months integer NOT NULL CHECK(term_months BETWEEN 1 AND 120),result text NOT NULL CHECK(result IN ('proposal','negotiation','won','lost')),reason text NOT NULL DEFAULT '' CHECK(length(reason)<=2000),actor_id uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),contract_id uuid UNIQUE REFERENCES contracts(id));
CREATE UNIQUE INDEX crm_one_closure ON crm_deals(lead_id) WHERE result='won';
ALTER TABLE opportunities ADD COLUMN crm_lead_id uuid REFERENCES crm_leads(id);
-- A CRM operation may exist independently of a campaign; only campaign-bound rows enter scores.
ALTER TABLE opportunities ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE opportunities ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE opportunities ADD CONSTRAINT opportunity_campaign_integrity CHECK((campaign_id IS NOT NULL AND team_id IS NOT NULL) OR (campaign_id IS NULL AND team_id IS NULL AND crm_lead_id IS NOT NULL));
CREATE UNIQUE INDEX crm_opportunity_link ON opportunities(crm_lead_id,coalesce(campaign_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE crm_lead_id IS NOT NULL;

CREATE FUNCTION public.can_crm() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT can_commercial() OR EXISTS(SELECT 1 FROM crm_grants g JOIN profiles p ON p.id=g.profile_id WHERE p.id=auth.uid() AND p.active AND p.category='employee') $$;
CREATE FUNCTION public.crm_can_read(lid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT can_crm() AND EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=lid AND (actor_role()='admin' OR l.sdr_id=auth.uid() OR l.closer_id=auth.uid() OR EXISTS(SELECT 1 FROM crm_grants WHERE profile_id=auth.uid()))) $$;
CREATE FUNCTION public.crm_directory() RETURNS TABLE(id uuid,name text,is_sdr boolean,is_closer boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.id,p.name,has_user_function(p.id,'sdr'),has_user_function(p.id,'closer') FROM profiles p WHERE can_crm() AND p.active AND p.category='employee' AND (has_user_function(p.id,'sdr') OR has_user_function(p.id,'closer')) ORDER BY p.name $$;
CREATE FUNCTION public.crm_set_grant(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN RAISE EXCEPTION 'Confirme a permissão e informe justificativa'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=(data->>'profile_id')::uuid AND active AND category='employee') THEN RAISE EXCEPTION 'Colaborador inválido'; END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 IF data->>'enabled'='true' THEN INSERT INTO crm_grants(profile_id,granted_by) VALUES((data->>'profile_id')::uuid,auth.uid()) ON CONFLICT DO NOTHING;
 ELSE DELETE FROM crm_grants WHERE profile_id=(data->>'profile_id')::uuid; END IF;
 END $$;
CREATE FUNCTION public.crm_save_lead(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l crm_leads; lid uuid; sid uuid; cid uuid; BEGIN
 IF NOT can_crm() THEN RAISE EXCEPTION 'Sem acesso ao CRM'; END IF;
 lid:=nullif(data->>'id','')::uuid;
 IF lid IS NOT NULL THEN
  SELECT * INTO l FROM crm_leads WHERE id=lid FOR UPDATE;
  IF NOT crm_can_read(lid) THEN RAISE EXCEPTION 'Lead indisponível'; END IF;
  IF (data->>'version')::integer IS DISTINCT FROM l.version THEN RAISE EXCEPTION 'Lead atualizado por outra pessoa. Recarregue a página'; END IF;
 END IF;
 sid:=CASE WHEN actor_role()='admin' THEN nullif(data->>'sdr_id','')::uuid WHEN lid IS NOT NULL THEN l.sdr_id ELSE auth.uid() END;
 IF lid IS NULL AND actor_role() IS DISTINCT FROM 'admin' AND NOT has_function('sdr') THEN RAISE EXCEPTION 'Somente ADM ou SDR cadastra leads'; END IF;
 cid:=nullif(data->>'closer_id','')::uuid;
 IF NOT has_user_function(sid,'sdr') OR (cid IS NOT NULL AND NOT has_user_function(cid,'closer')) THEN RAISE EXCEPTION 'Selecione responsáveis ativos e elegíveis'; END IF;
 IF lid IS NOT NULL AND actor_role() IS DISTINCT FROM 'admin' AND cid IS DISTINCT FROM l.closer_id THEN RAISE EXCEPTION 'Somente ADM altera o closer após o cadastro'; END IF;
 IF lid IS NOT NULL AND sid IS DISTINCT FROM l.sdr_id AND EXISTS(SELECT 1 FROM opportunities WHERE crm_lead_id=lid) THEN RAISE EXCEPTION 'SDR congelado após agendamento para preservar histórico'; END IF;
 IF lid IS NULL THEN
 INSERT INTO crm_leads(company,contact,phone,email,niche,city,state,source,sdr_id,closer_id,notes,follow_up_at,created_by) VALUES(trim(data->>'company'),trim(data->>'contact'),regexp_replace(data->>'phone','[^0-9]','','g'),lower(trim(coalesce(data->>'email',''))),trim(data->>'niche'),trim(data->>'city'),upper(trim(data->>'state')),trim(data->>'source'),sid,cid,coalesce(data->>'notes',''),nullif(data->>'follow_up_at','')::timestamptz,auth.uid()) RETURNING id INTO lid;
 ELSE
 UPDATE crm_leads SET company=trim(data->>'company'),contact=trim(data->>'contact'),phone=regexp_replace(data->>'phone','[^0-9]','','g'),email=lower(trim(coalesce(data->>'email',''))),niche=trim(data->>'niche'),city=trim(data->>'city'),state=upper(trim(data->>'state')),source=trim(data->>'source'),sdr_id=sid,closer_id=cid,notes=coalesce(data->>'notes',''),follow_up_at=nullif(data->>'follow_up_at','')::timestamptz,updated_at=now(),version=version+1 WHERE id=lid;
 END IF;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description) VALUES(lid,auth.uid(),'assignment',CASE WHEN l.id IS NULL THEN 'Lead cadastrado' ELSE 'Cadastro e responsáveis atualizados' END);
 RETURN lid;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Possível duplicidade de WhatsApp ou email. Consulte o cadastro existente';
END $$;
CREATE FUNCTION public.crm_import_leads(rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE row jsonb; total integer:=0; BEGIN
 IF jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Importe de 1 a 500 leads por arquivo'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(rows) LOOP PERFORM crm_save_lead(row-'id'-'version'); total:=total+1; END LOOP;
 RETURN total; END $$;
CREATE FUNCTION public.crm_activity(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE l crm_leads; target text; BEGIN
 SELECT * INTO l FROM crm_leads WHERE id=(data->>'lead_id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) THEN RAISE EXCEPTION 'Lead indisponível'; END IF;
 IF l.archived THEN RAISE EXCEPTION 'Lead arquivado'; END IF;
 IF data ? 'version' AND (data->>'version')::integer IS DISTINCT FROM l.version THEN RAISE EXCEPTION 'Lead atualizado por outra pessoa. Recarregue a página'; END IF;
 IF data->>'kind' NOT IN ('contact','response','note','stage') OR data->>'kind' IS NULL THEN RAISE EXCEPTION 'Atividade inválida'; END IF;
 target:=coalesce(nullif(data->>'stage',''),l.stage);
 IF l.stage='won' AND target<>'won' THEN RAISE EXCEPTION 'Contrato fechado. Solicite revisão administrativa antes de alterar a etapa'; END IF;
 -- Winning is recorded by a deal; meeting completion is only set by canonical validation.
 IF target IS DISTINCT FROM l.stage AND target IN ('won','held','scheduled','proposed','negotiation') THEN RAISE EXCEPTION 'Utilize agendamento, validação ou negociação para esta etapa'; END IF;
 INSERT INTO crm_activities(lead_id,actor_id,kind,channel,description) VALUES(l.id,auth.uid(),data->>'kind',coalesce(data->>'channel',''),CASE WHEN target IS DISTINCT FROM l.stage THEN l.stage||' → '||target||': ' ELSE '' END||trim(data->>'description'));
 UPDATE crm_leads SET stage=target,last_contact_at=CASE WHEN data->>'kind' IN ('contact','response') THEN now() ELSE last_contact_at END,follow_up_at=CASE WHEN data ? 'follow_up_at' THEN nullif(data->>'follow_up_at','')::timestamptz ELSE follow_up_at END,updated_at=now(),version=version+1 WHERE id=l.id;
END $$;
CREATE FUNCTION public.crm_archive(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT crm_can_read((data->>'id')::uuid) OR data->>'confirm' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirme a alteração de arquivamento'; END IF;
 UPDATE crm_leads SET archived=(data->>'archived')::boolean,version=version+1,updated_at=now() WHERE id=(data->>'id')::uuid;
END $$;
CREATE FUNCTION public.crm_schedule_meeting(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l crm_leads; ca campaigns; cp campaign_participants; op opportunities; cid uuid; at_time timestamptz; oid uuid; mid uuid; BEGIN
 -- Serialize with legacy campaign writes; campaign lock is taken before lead lock.
 SELECT * INTO ca FROM campaigns WHERE state='active' AND now()>=starts_at AND now()<ends_at FOR UPDATE;
 SELECT * INTO l FROM crm_leads WHERE id=(data->>'lead_id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) OR NOT(coalesce(actor_role()='admin',false) OR has_function('sdr') AND l.sdr_id=auth.uid()) THEN RAISE EXCEPTION 'Somente ADM ou SDR responsável agenda reuniões'; END IF;
 IF l.archived THEN RAISE EXCEPTION 'Lead arquivado'; END IF;
 cid:=coalesce(nullif(data->>'closer_id','')::uuid,l.closer_id);at_time:=(data->>'scheduled_at')::timestamptz;
 IF NOT has_user_function(cid,'closer') OR at_time IS NULL THEN RAISE EXCEPTION 'Informe data e closer ativo'; END IF;
 IF at_time < now()-interval '1 minute' THEN RAISE EXCEPTION 'Agende uma data futura'; END IF;
 IF NOT has_user_function(l.sdr_id,'sdr') THEN RAISE EXCEPTION 'SDR responsável inativo ou inelegível'; END IF;
 SELECT * INTO cp FROM campaign_participants WHERE campaign_id=ca.id AND profile_id=l.sdr_id AND active;
 IF cp.profile_id IS NULL OR at_time<ca.starts_at OR at_time>=ca.ends_at THEN ca.id:=NULL;cp.team_id:=NULL; END IF;
 SELECT * INTO op FROM opportunities WHERE crm_lead_id=l.id AND campaign_id IS NOT DISTINCT FROM ca.id;
 IF op.id IS NULL AND ca.id IS NOT NULL THEN
  SELECT * INTO op FROM opportunities WHERE campaign_id=ca.id AND phone=l.phone ORDER BY created_at LIMIT 1;
  IF op.id IS NOT NULL THEN
   IF op.sdr_id<>l.sdr_id OR (op.crm_lead_id IS NOT NULL AND op.crm_lead_id<>l.id) THEN RAISE EXCEPTION 'Oportunidade existente exige revisão administrativa'; END IF;
   UPDATE opportunities SET crm_lead_id=l.id WHERE id=op.id;
  END IF;
 END IF;
 IF op.id IS NULL THEN
 INSERT INTO opportunities(campaign_id,team_id,sdr_id,company,contact,phone,city,niche,crm_lead_id) VALUES(ca.id,cp.team_id,l.sdr_id,l.company,l.contact,l.phone,l.city,l.niche,l.id) RETURNING id INTO oid;
 ELSE oid:=op.id; END IF;
 IF EXISTS(SELECT 1 FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id WHERE o.crm_lead_id=l.id AND m.scheduled_at=at_time AND m.status<>'cancelled') THEN RAISE EXCEPTION 'Reunião já cadastrada neste horário'; END IF;
 INSERT INTO meetings(opportunity_id,closer_id,scheduled_at,notes) VALUES(oid,cid,at_time,coalesce(data->>'notes','')) RETURNING id INTO mid;
 UPDATE crm_leads SET closer_id=cid,stage='scheduled',updated_at=now(),version=version+1 WHERE id=l.id;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description) VALUES(l.id,auth.uid(),'meeting',CASE WHEN ca.id IS NULL THEN 'Reunião agendada sem campanha elegível; não pontua no Challenger' ELSE 'Reunião agendada e vinculada à campanha; aguarda validação do closer' END);
 RETURN mid;
END $$;
CREATE FUNCTION public.crm_record_deal(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE l crm_leads; did uuid; BEGIN
 SELECT * INTO l FROM crm_leads WHERE id=(data->>'lead_id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) OR NOT(coalesce(actor_role()='admin',false) OR has_function('closer') AND l.closer_id=auth.uid()) THEN RAISE EXCEPTION 'Somente ADM ou closer responsável registra negociações'; END IF;
 IF l.archived THEN RAISE EXCEPTION 'Lead arquivado'; END IF;
 IF l.stage='won' THEN RAISE EXCEPTION 'Lead já possui fechamento. Consulte o contrato e o histórico'; END IF;
 IF data->>'result' IN ('won','lost') AND length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Informe o resultado da negociação'; END IF;
 INSERT INTO crm_deals(lead_id,amount,services,term_months,result,reason,actor_id) VALUES(l.id,(data->>'amount')::numeric,trim(data->>'services'),(data->>'term_months')::integer,data->>'result',coalesce(data->>'reason',''),auth.uid()) RETURNING id INTO did;
 UPDATE crm_leads SET stage=CASE data->>'result' WHEN 'proposal' THEN 'proposed' WHEN 'negotiation' THEN 'negotiation' ELSE data->>'result' END,version=version+1,updated_at=now() WHERE id=l.id;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description) VALUES(l.id,auth.uid(),'deal','Negociação registrada: '||(data->>'result')||'. Pontos dependem de validação e confirmação administrativa do contrato.');
 RETURN did;
END $$;
CREATE FUNCTION public.crm_confirm_contract(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d crm_deals; mid uuid; oid uuid; cid uuid; BEGIN
 PERFORM require_admin();
 SELECT * INTO d FROM crm_deals WHERE id=(data->>'deal_id')::uuid FOR UPDATE;
 IF d.id IS NULL OR d.result<>'won' OR d.contract_id IS NOT NULL THEN RAISE EXCEPTION 'Fechamento indisponível ou já confirmado'; END IF;
 SELECT m.id,m.opportunity_id INTO mid,oid FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id WHERE m.id=(data->>'meeting_id')::uuid AND o.crm_lead_id=d.lead_id;
 IF mid IS NULL THEN RAISE EXCEPTION 'Selecione uma reunião deste lead'; END IF;
 -- Original authoritative validation/confirmation path: no direct score writes.
 PERFORM admin_operation('contract',data||jsonb_build_object('meeting_id',mid,'amount',d.amount));
 SELECT id INTO cid FROM contracts WHERE opportunity_id=oid;
 UPDATE crm_deals SET contract_id=cid WHERE id=d.id;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description) VALUES(d.lead_id,auth.uid(),'deal','Contrato confirmado pela administração');
END $$;
CREATE FUNCTION public.crm_sync_validation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE lid uuid; BEGIN
 SELECT crm_lead_id INTO lid FROM opportunities WHERE id=NEW.opportunity_id;
 IF lid IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
 INSERT INTO crm_activities(lead_id,actor_id,kind,description) VALUES(lid,auth.uid(),'meeting','Situação validada: '||OLD.status||' → '||NEW.status);
 UPDATE crm_leads SET stage=CASE WHEN NEW.status IN ('held','qualified') AND stage IN ('new','contacted','replied','interested','scheduled') THEN 'held' ELSE stage END,updated_at=now(),version=version+1 WHERE id=lid;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER crm_validation_sync AFTER UPDATE OF status ON meetings FOR EACH ROW EXECUTE FUNCTION crm_sync_validation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_grants','crm_leads','crm_activities','crm_deals'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',t,t);
 END LOOP; END $$;
CREATE POLICY crm_grants_read ON crm_grants FOR SELECT TO authenticated USING(actor_role()='admin' OR profile_id=auth.uid() AND can_crm());
CREATE POLICY crm_leads_read ON crm_leads FOR SELECT TO authenticated USING(crm_can_read(id));
CREATE POLICY crm_activities_read ON crm_activities FOR SELECT TO authenticated USING(crm_can_read(lead_id));
CREATE POLICY crm_deals_read ON crm_deals FOR SELECT TO authenticated USING(crm_can_read(lead_id));
-- Access granted explicitly by ADM applies to linked CRM records only, never legacy unassigned data.
CREATE POLICY crm_opportunities_read ON opportunities FOR SELECT TO authenticated USING(crm_lead_id IS NOT NULL AND crm_can_read(crm_lead_id));
CREATE POLICY crm_meetings_read ON meetings FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM opportunities o WHERE o.id=meetings.opportunity_id AND o.crm_lead_id IS NOT NULL AND crm_can_read(o.crm_lead_id)));
-- Avoid nested policy recursion through opportunities -> meetings -> opportunities.
DROP POLICY crm_meetings_read ON meetings;
CREATE FUNCTION public.crm_reads_opportunity(oid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM opportunities WHERE id=oid AND crm_lead_id IS NOT NULL AND crm_can_read(crm_lead_id)) $$;
CREATE POLICY crm_meetings_read ON meetings FOR SELECT TO authenticated USING(crm_reads_opportunity(opportunity_id));
REVOKE EXECUTE ON FUNCTION can_crm(),crm_can_read(uuid),crm_directory(),crm_set_grant(jsonb),crm_save_lead(jsonb),crm_import_leads(jsonb),crm_activity(jsonb),crm_archive(jsonb),crm_schedule_meeting(jsonb),crm_record_deal(jsonb),crm_confirm_contract(jsonb),crm_sync_validation(),crm_reads_opportunity(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION can_crm(),crm_can_read(uuid),crm_directory(),crm_set_grant(jsonb),crm_save_lead(jsonb),crm_import_leads(jsonb),crm_activity(jsonb),crm_archive(jsonb),crm_schedule_meeting(jsonb),crm_record_deal(jsonb),crm_confirm_contract(jsonb),crm_reads_opportunity(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.notify_competition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE cid uuid; BEGIN
 SELECT campaign_id INTO cid FROM opportunities WHERE id=NEW.opportunity_id;
 IF cid IS NOT NULL THEN INSERT INTO competition_updates(campaign_id,updated_at) VALUES(cid,clock_timestamp()) ON CONFLICT(campaign_id) DO UPDATE SET updated_at=excluded.updated_at; END IF; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.current_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('category',p.category,'functions',coalesce((SELECT jsonb_agg(function_code ORDER BY function_code) FROM user_functions WHERE profile_id=p.id),'[]'::jsonb),'challenger',can_challenger(),'crm',can_crm()) FROM profiles p WHERE p.id=auth.uid() AND p.active $$;
-- Invoker report always observes the caller's RLS. No dashboard bypass.
CREATE FUNCTION public.crm_report(filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH scope AS (SELECT l.* FROM crm_leads l WHERE NOT l.archived AND
 (nullif(filters->>'owner','') IS NULL OR l.sdr_id=nullif(filters->>'owner','')::uuid OR l.closer_id=nullif(filters->>'owner','')::uuid) AND
 (nullif(filters->>'stage','') IS NULL OR l.stage=filters->>'stage')),
 leads AS (SELECT * FROM scope WHERE created_at>=coalesce(nullif(filters->>'from','')::timestamptz,'-infinity') AND created_at<coalesce(nullif(filters->>'to','')::timestamptz,'infinity')),
 activities AS (SELECT a.* FROM crm_activities a JOIN scope l ON l.id=a.lead_id WHERE a.created_at>=coalesce(nullif(filters->>'from','')::timestamptz,'-infinity') AND a.created_at<coalesce(nullif(filters->>'to','')::timestamptz,'infinity')),
 appointments AS (SELECT m.*,l.id AS lead_id FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id JOIN scope l ON l.id=o.crm_lead_id WHERE m.scheduled_at>=coalesce(nullif(filters->>'from','')::timestamptz,'-infinity') AND m.scheduled_at<coalesce(nullif(filters->>'to','')::timestamptz,'infinity')),
 deals AS (SELECT d.* FROM crm_deals d JOIN scope l ON l.id=d.lead_id WHERE d.created_at>=coalesce(nullif(filters->>'from','')::timestamptz,'-infinity') AND d.created_at<coalesce(nullif(filters->>'to','')::timestamptz,'infinity'))
 SELECT jsonb_build_object('leads',(SELECT count(*) FROM leads),'contacts',(SELECT count(*) FROM activities WHERE kind='contact'),
 'response',coalesce((SELECT round(100.0*count(DISTINCT a.lead_id)/nullif((SELECT count(DISTINCT lead_id) FROM activities WHERE kind='contact'),0),1) FROM activities a WHERE a.kind='response' AND EXISTS(SELECT 1 FROM activities c WHERE c.kind='contact' AND c.lead_id=a.lead_id)),0),
 'scheduled',(SELECT count(*) FROM appointments),'held',(SELECT count(*) FROM appointments WHERE status IN ('held','qualified')),
 'attendance',coalesce((SELECT round(100.0*count(*) FILTER(WHERE status IN ('held','qualified'))/nullif(count(*) FILTER(WHERE status IN ('held','qualified','no_show')),0),1) FROM appointments),0),
 'proposals',(SELECT count(DISTINCT lead_id) FROM deals WHERE result='proposal'),'won',(SELECT count(DISTINCT lead_id) FROM deals WHERE result='won'),
 'conversion',coalesce((SELECT round(100.0*count(*) FILTER(WHERE EXISTS(SELECT 1 FROM deals d WHERE d.lead_id=l.id AND d.result='won'))/nullif(count(*),0),1) FROM leads l),0),
 'performance',coalesce((SELECT jsonb_agg(x) FROM (SELECT p.id,p.name,f.function_code AS function,count(DISTINCT l.id) AS leads,count(DISTINCT d.lead_id) FILTER(WHERE d.result='won') AS won FROM profiles p JOIN user_functions f ON f.profile_id=p.id JOIN leads l ON (f.function_code='sdr' AND l.sdr_id=p.id OR f.function_code='closer' AND l.closer_id=p.id) LEFT JOIN deals d ON d.lead_id=l.id GROUP BY p.id,p.name,f.function_code) x),'[]'::jsonb)) $$;
REVOKE EXECUTE ON FUNCTION crm_report(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_report(jsonb) TO authenticated;
COMMIT;
