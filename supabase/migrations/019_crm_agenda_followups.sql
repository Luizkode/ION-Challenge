-- Commercial agenda: reuse leads, canonical meetings/deals/validation; no score changes.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
ALTER TABLE meetings ADD COLUMN meeting_url text NOT NULL DEFAULT '' CHECK(meeting_url='' OR meeting_url ~ '^https?://[^[:space:]]+$');
ALTER TABLE meetings ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN rescheduled_from_id uuid UNIQUE REFERENCES meetings(id);
CREATE FUNCTION crm_meeting_version() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$BEGIN NEW.version:=OLD.version+1;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION crm_meeting_version() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_meeting_version BEFORE UPDATE ON meetings FOR EACH ROW EXECUTE FUNCTION crm_meeting_version();
CREATE TABLE crm_commands(id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES profiles(id),kind text NOT NULL,payload jsonb NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE crm_meeting_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),meeting_id uuid NOT NULL REFERENCES meetings(id),lead_id uuid NOT NULL REFERENCES crm_leads(id),actor_id uuid NOT NULL REFERENCES profiles(id),outcome text NOT NULL CHECK(outcome IN ('negotiation','proposal','won','no_show','lost','rescheduled')),details jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX crm_meeting_one_result ON crm_meeting_results(meeting_id);
CREATE TABLE crm_followups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid NOT NULL REFERENCES crm_leads(id),meeting_id uuid REFERENCES meetings(id),previous_id uuid UNIQUE REFERENCES crm_followups(id),assigned_to uuid NOT NULL REFERENCES profiles(id),due_at timestamptz NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 2000),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),origin text NOT NULL DEFAULT 'commercial' CHECK(origin IN ('commercial','legacy')),result text NOT NULL DEFAULT '' CHECK(length(result)<=4000),created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,version integer NOT NULL DEFAULT 1,CHECK((status='pending' AND completed_at IS NULL) OR (status<>'pending' AND completed_at IS NOT NULL)));
CREATE INDEX crm_followup_agenda ON crm_followups(assigned_to,status,due_at);
CREATE INDEX crm_followup_lead ON crm_followups(lead_id,status);
CREATE UNIQUE INDEX crm_followup_legacy_pending ON crm_followups(lead_id) WHERE origin='legacy' AND status='pending';
ALTER TABLE crm_activities ADD COLUMN meeting_id uuid REFERENCES meetings(id);
ALTER TABLE crm_activities ADD COLUMN followup_id uuid REFERENCES crm_followups(id);
-- Preserve all previous dates, including archived leads and overdue dates.
INSERT INTO crm_followups(lead_id,assigned_to,due_at,reason,created_by,origin) SELECT id,coalesce(closer_id,sdr_id),follow_up_at,'Retorno programado no CRM',created_by,'legacy' FROM crm_leads WHERE follow_up_at IS NOT NULL;
CREATE OR REPLACE FUNCTION crm_can_read(lid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT can_crm() AND EXISTS(SELECT FROM crm_leads l WHERE l.id=lid AND (actor_role()='admin' OR l.sdr_id=auth.uid() OR l.closer_id=auth.uid() OR EXISTS(SELECT FROM crm_grants WHERE profile_id=auth.uid()) OR EXISTS(SELECT FROM crm_followups f WHERE f.lead_id=lid AND f.assigned_to=auth.uid() AND (has_function('sdr') OR has_function('closer'))) OR EXISTS(SELECT FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id WHERE o.crm_lead_id=lid AND m.closer_id=auth.uid() AND has_function('closer')))) $$;

-- An omitted legacy date must not clear the authoritative pending queue on edits.
DO $upgrade$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('public.crm_save_lead(jsonb)'::regprocedure) INTO def;
 def:=replace(def,$find$follow_up_at=nullif(data->>'follow_up_at','')::timestamptz$find$,$replacement$follow_up_at=CASE WHEN data ? 'follow_up_at' THEN nullif(data->>'follow_up_at','')::timestamptz ELSE follow_up_at END$replacement$);
 EXECUTE def;
END $upgrade$;

CREATE FUNCTION crm_command_begin(data jsonb,operation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE c crm_commands;BEGIN
 IF NOT live_auth_session() OR NOT can_crm() THEN RAISE EXCEPTION 'Sem acesso ao CRM';END IF;
 PERFORM pg_advisory_xact_lock(70013);
 IF nullif(data->>'request_id','') IS NULL THEN RAISE EXCEPTION 'Solicitação sem identificador. Recarregue o formulário';END IF;
 SELECT * INTO c FROM crm_commands WHERE id=(data->>'request_id')::uuid;
 IF FOUND THEN IF c.actor_id<>auth.uid() OR c.kind<>operation OR c.payload<>data THEN RAISE EXCEPTION 'Identificador de solicitação já utilizado';END IF;RETURN c.result;END IF;
 INSERT INTO crm_commands(id,actor_id,kind,payload) VALUES((data->>'request_id')::uuid,auth.uid(),operation,data);RETURN NULL;
END $$;
CREATE FUNCTION crm_command_finish(data jsonb,value jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN UPDATE crm_commands SET result=value WHERE id=(data->>'request_id')::uuid AND actor_id=auth.uid();RETURN value;END $$;
-- Copy the installed, already guarded scheduling algorithm. Core remains private.
DO $code$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('public.crm_schedule_meeting(jsonb)'::regprocedure) INTO def;
 def:=replace(def,'public.crm_schedule_meeting(', 'public.crm_schedule_core(');
 def:=replace(def,$find$has_function('sdr') AND l.sdr_id=auth.uid()$find$, $replace$(has_function('sdr') AND l.sdr_id=auth.uid() OR has_function('closer') AND l.closer_id=auth.uid())$replace$);
 EXECUTE def;
END $code$;
CREATE OR REPLACE FUNCTION crm_schedule_meeting(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE l crm_leads;r jsonb;mid uuid;d jsonb;BEGIN
 -- Older clients keep their API; new clients supply a stable request id.
 d:=CASE WHEN nullif(data->>'request_id','') IS NULL THEN data||jsonb_build_object('request_id',gen_random_uuid()) ELSE data END;
 r:=crm_command_begin(d,'schedule');IF r IS NOT NULL THEN RETURN (r->>'id')::uuid;END IF;
 SELECT * INTO l FROM crm_leads WHERE id=(d->>'lead_id')::uuid;
 IF NOT crm_can_read(l.id) OR NOT(coalesce(actor_role()='admin',false) OR has_function('sdr') AND l.sdr_id=auth.uid()) THEN RAISE EXCEPTION 'Somente ADM ou SDR responsável agenda reuniões';END IF;
 IF l.stage='won' THEN RAISE EXCEPTION 'Lead já fechado; consulte o contrato ou programe um retorno';END IF;
 mid:=crm_schedule_core(d);
 UPDATE meetings SET meeting_url=coalesce(d->>'meeting_url','') WHERE id=mid;
 PERFORM crm_command_finish(d,jsonb_build_object('id',mid));RETURN mid;
END $$;
CREATE FUNCTION crm_refresh_followup_date(lid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE prev text:=coalesce(current_setting('ion.crm_followup_sync',true),'');BEGIN
 PERFORM set_config('ion.crm_followup_sync','on',true);
 UPDATE crm_leads SET follow_up_at=(SELECT min(due_at) FROM crm_followups WHERE lead_id=lid AND status='pending'),updated_at=now(),version=version+1 WHERE id=lid;
 PERFORM set_config('ion.crm_followup_sync',prev,true);
END $$;
CREATE FUNCTION crm_sync_legacy_followup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 IF current_setting('ion.crm_followup_sync',true)='on' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.follow_up_at IS NOT DISTINCT FROM OLD.follow_up_at THEN RETURN NEW;END IF;
 IF NEW.follow_up_at IS NOT NULL THEN
 INSERT INTO crm_followups(lead_id,assigned_to,due_at,reason,created_by,origin) VALUES(NEW.id,coalesce(NEW.closer_id,NEW.sdr_id),NEW.follow_up_at,'Retorno programado no CRM',auth.uid(),'legacy') ON CONFLICT(lead_id) WHERE origin='legacy' AND status='pending' DO UPDATE SET due_at=excluded.due_at,assigned_to=excluded.assigned_to,version=crm_followups.version+1,updated_at=now();
 ELSE
 -- Never silently delete or complete scheduled follow-ups through the legacy date.
 IF EXISTS(SELECT FROM crm_followups WHERE lead_id=NEW.id AND status='pending') THEN RAISE EXCEPTION 'Conclua, cancele ou reagende os retornos na central de follow-ups';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER crm_legacy_followup_sync AFTER INSERT OR UPDATE OF follow_up_at ON crm_leads FOR EACH ROW EXECUTE FUNCTION crm_sync_legacy_followup();
CREATE FUNCTION crm_followup_action(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l crm_leads;f crm_followups;r jsonb;fid uuid;nid uuid;sid uuid;at_time timestamptz;op text:=data->>'operation';description text:=trim(coalesce(data->>'result',''));BEGIN
 r:=crm_command_begin(data,'followup');IF r IS NOT NULL THEN RETURN r;END IF;
 SELECT * INTO l FROM crm_leads WHERE id=(data->>'lead_id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) THEN RAISE EXCEPTION 'Lead indisponível';END IF;
 IF op='create' THEN
 IF l.archived OR NOT crm_can_manage(l.id) THEN RAISE EXCEPTION 'Somente responsável comercial ou ADM programa retornos para este lead';END IF;
 ELSE
 SELECT * INTO f FROM crm_followups WHERE id=(data->>'id')::uuid AND lead_id=l.id FOR UPDATE;
 IF f.id IS NULL OR NOT(coalesce(actor_role()='admin',false) OR f.assigned_to=auth.uid() AND (has_function('sdr') OR has_function('closer'))) THEN RAISE EXCEPTION 'Sem permissão para este follow-up';END IF;
 IF (data->>'version')::integer IS DISTINCT FROM f.version THEN RAISE EXCEPTION 'Follow-up atualizado por outra pessoa. Recarregue a página';END IF;
 IF f.status<>'pending' THEN RAISE EXCEPTION 'Follow-up já concluído ou cancelado';END IF;
 END IF;
 IF op IN ('create','reschedule') OR nullif(data->>'next_due_at','') IS NOT NULL THEN
 at_time:=coalesce(nullif(data->>'next_due_at',''),nullif(data->>'due_at',''))::timestamptz;
 sid:=coalesce(nullif(data->>'assigned_to','')::uuid,f.assigned_to,l.closer_id,l.sdr_id);
 IF at_time IS NULL OR at_time<now()-interval '1 minute' THEN RAISE EXCEPTION 'Informe data e horário futuros para o retorno';END IF;
 IF NOT(has_user_function(sid,'closer') OR has_user_function(sid,'sdr')) THEN RAISE EXCEPTION 'Selecione um responsável comercial ativo';END IF;
 END IF;
 IF op='create' THEN
 INSERT INTO crm_followups(lead_id,meeting_id,assigned_to,due_at,reason,created_by) VALUES(l.id,nullif(data->>'meeting_id','')::uuid,sid,at_time,trim(data->>'reason'),auth.uid()) RETURNING id INTO fid;
 IF nullif(data->>'meeting_id','') IS NOT NULL AND NOT EXISTS(SELECT FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id WHERE m.id=(data->>'meeting_id')::uuid AND o.crm_lead_id=l.id) THEN RAISE EXCEPTION 'Reunião não pertence ao lead';END IF;
 ELSIF op='reschedule' THEN
 IF length(description)<1 THEN description:='Follow-up reagendado';END IF;
 UPDATE crm_followups SET due_at=at_time,assigned_to=sid,updated_at=now(),version=version+1 WHERE id=f.id;fid:=f.id;
 ELSIF op IN ('complete','cancel','contact') THEN
 IF length(description) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'Informe o resultado do contato ou motivo do cancelamento';END IF;
 fid:=f.id;
 UPDATE crm_followups SET result=description,status=CASE op WHEN 'complete' THEN 'completed' WHEN 'cancel' THEN 'cancelled' ELSE 'pending' END,completed_at=CASE WHEN op='contact' THEN NULL ELSE now() END,updated_at=now(),version=version+1 WHERE id=f.id;
 IF nullif(data->>'next_due_at','') IS NOT NULL THEN
 IF op<>'complete' THEN RAISE EXCEPTION 'Conclua este contato para programar outro retorno';END IF;
 INSERT INTO crm_followups(lead_id,meeting_id,previous_id,assigned_to,due_at,reason,created_by) VALUES(l.id,f.meeting_id,f.id,sid,at_time,coalesce(nullif(trim(data->>'reason'),''),f.reason),auth.uid()) RETURNING id INTO nid;
 END IF;
 ELSE RAISE EXCEPTION 'Ação de follow-up inválida';END IF;
 INSERT INTO crm_activities(lead_id,actor_id,kind,channel,description,followup_id) VALUES(l.id,auth.uid(),CASE WHEN op IN ('contact','complete') THEN 'contact' ELSE 'note' END,'CRM','Follow-up · '||op||': '||coalesce(nullif(description,''),trim(data->>'reason'))||CASE WHEN at_time IS NOT NULL THEN ' · retorno: '||to_char(at_time AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') ELSE '' END,fid);
 IF op IN ('contact','complete') THEN UPDATE crm_leads SET last_contact_at=now() WHERE id=l.id;END IF;
 PERFORM crm_refresh_followup_date(l.id);
 RETURN crm_command_finish(data,jsonb_build_object('id',fid,'next_id',nid));
END $$;
CREATE FUNCTION crm_reschedule_meeting(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE m meetings;l crm_leads;r jsonb;mid uuid;cid uuid;frozen boolean;BEGIN
 r:=crm_command_begin(data,'reschedule');IF r IS NOT NULL THEN RETURN r;END IF;
 -- Canonical campaign -> lead -> meeting lock order, shared with validation.
 PERFORM 1 FROM campaigns WHERE state='active' OR id=(SELECT o.campaign_id FROM opportunities o JOIN meetings x ON x.opportunity_id=o.id WHERE x.id=(data->>'id')::uuid) ORDER BY id FOR UPDATE;
 SELECT l0.* INTO l FROM crm_leads l0 JOIN opportunities o ON o.crm_lead_id=l0.id JOIN meetings x ON x.opportunity_id=o.id WHERE x.id=(data->>'id')::uuid FOR UPDATE OF l0;
 SELECT * INTO m FROM meetings WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) OR NOT(coalesce(actor_role()='admin',false) OR has_function('closer') AND m.closer_id=auth.uid() OR has_function('sdr') AND l.sdr_id=auth.uid()) THEN RAISE EXCEPTION 'Sem permissão para reagendar';END IF;
 IF m.version IS DISTINCT FROM (data->>'version')::integer THEN RAISE EXCEPTION 'Reunião atualizada por outra pessoa. Recarregue a página';END IF;
 IF m.status NOT IN ('scheduled','pending','no_show') OR EXISTS(SELECT FROM contracts WHERE meeting_id=m.id) THEN RAISE EXCEPTION 'Reunião validada ou contratada exige revisão administrativa';END IF;
 IF EXISTS(SELECT FROM meetings WHERE rescheduled_from_id=m.id) THEN RAISE EXCEPTION 'Esta reunião já foi reagendada';END IF;
 IF l.archived OR l.stage='won' THEN RAISE EXCEPTION 'Lead arquivado ou fechado';END IF;
 -- A changed lead owner cannot grant an old closer permission over a new meeting.
 cid:=coalesce(nullif(data->>'closer_id','')::uuid,m.closer_id);
 IF actor_role() IS DISTINCT FROM 'admin' AND cid<>m.closer_id THEN RAISE EXCEPTION 'Somente ADM pode transferir o closer ao reagendar';END IF;
 SELECT c.state='finalized' INTO frozen FROM campaigns c JOIN opportunities o ON o.campaign_id=c.id WHERE o.id=m.opportunity_id;
 IF NOT coalesce(frozen,false) THEN UPDATE meetings SET status='cancelled',version=version+1 WHERE id=m.id;END IF;
 INSERT INTO crm_meeting_results(meeting_id,lead_id,actor_id,outcome,details) VALUES(m.id,l.id,auth.uid(),'rescheduled',jsonb_build_object('notes','Reagendada; validações e agendamento anterior preservados')) ON CONFLICT(meeting_id) DO NOTHING;
 -- Core allows responsible SDR/closer; historical assigned closer can only act while still responsible for lead.
 mid:=crm_schedule_core(data||jsonb_build_object('lead_id',l.id,'closer_id',cid,'notes',m.notes));
 UPDATE meetings SET rescheduled_from_id=m.id,meeting_url=coalesce(nullif(data->>'meeting_url',''),m.meeting_url) WHERE id=mid;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description,meeting_id) VALUES(l.id,auth.uid(),'meeting','Reunião reagendada; agendamento anterior preservado no histórico',mid);
 RETURN crm_command_finish(data,jsonb_build_object('id',mid));
END $$;
CREATE FUNCTION crm_record_meeting_result(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE l crm_leads;m meetings;r jsonb;finalized boolean;outcome text:=data->>'outcome';did uuid;fid jsonb;details jsonb;BEGIN
 r:=crm_command_begin(data,'meeting_result');IF r IS NOT NULL THEN RETURN r;END IF;
 PERFORM 1 FROM campaigns WHERE id=(SELECT o.campaign_id FROM opportunities o JOIN meetings x ON x.opportunity_id=o.id WHERE x.id=(data->>'id')::uuid) FOR UPDATE;
 SELECT l0.* INTO l FROM crm_leads l0 JOIN opportunities o ON o.crm_lead_id=l0.id JOIN meetings x ON x.opportunity_id=o.id WHERE x.id=(data->>'id')::uuid FOR UPDATE OF l0;
 SELECT * INTO m FROM meetings WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF NOT crm_can_read(l.id) OR NOT(coalesce(actor_role()='admin',false) OR has_function('closer') AND m.closer_id=auth.uid() AND l.sdr_id<>auth.uid()) THEN RAISE EXCEPTION 'Somente ADM ou closer da reunião registra o resultado';END IF;
 IF m.version IS DISTINCT FROM (data->>'version')::integer THEN RAISE EXCEPTION 'Reunião atualizada por outra pessoa. Recarregue a página';END IF;
 IF l.archived OR l.stage='won' THEN RAISE EXCEPTION 'Lead arquivado ou fechado';END IF;
 IF outcome NOT IN ('negotiation','proposal','won','no_show','lost') OR outcome IS NULL THEN RAISE EXCEPTION 'Selecione o resultado da reunião';END IF;
 IF length(trim(coalesce(data->>'notes',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Informe as observações comerciais (até 2000 caracteres)';END IF;
 IF EXISTS(SELECT FROM crm_meeting_results WHERE meeting_id=m.id) THEN RAISE EXCEPTION 'Resultado já registrado. Consulte o histórico';END IF;
 IF m.scheduled_at>now() THEN RAISE EXCEPTION 'Aguarde o horário da reunião';END IF;
 SELECT c.state='finalized' INTO finalized FROM campaigns c JOIN opportunities o ON o.campaign_id=c.id WHERE o.id=m.opportunity_id;
 -- Finalized scores are immutable; record commercial outcome without touching validation.
 IF m.status NOT IN ('scheduled','pending','held','qualified','no_show') THEN RAISE EXCEPTION 'Reunião indisponível para resultado';END IF;
 IF m.status='no_show' AND outcome<>'no_show' OR m.status='qualified' AND outcome='no_show' THEN RAISE EXCEPTION 'Resultado incompatível com a validação existente; solicite revisão administrativa';END IF;
 IF NOT coalesce(finalized,false) AND m.status NOT IN ('qualified','no_show') THEN PERFORM validate_meeting(jsonb_build_object('id',m.id,'attended',outcome<>'no_show','qualified',outcome<>'no_show' AND coalesce((data->>'qualified')::boolean,false),'notes',m.notes||E'\nResultado comercial: '||(data->>'notes')));END IF;
 IF outcome IN ('proposal','won') OR outcome='negotiation' AND nullif(data->>'amount','') IS NOT NULL THEN
 IF l.closer_id IS DISTINCT FROM m.closer_id AND actor_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'A negociação exige o closer atual do lead. Solicite revisão ao ADM';END IF;
 did:=crm_record_deal(jsonb_build_object('lead_id',l.id,'result',outcome,'amount',data->>'amount','services',data->>'services','term_months',data->>'term_months','reason',data->>'notes'));
 ELSE
 UPDATE crm_leads SET stage=CASE outcome WHEN 'negotiation' THEN 'negotiation' WHEN 'lost' THEN 'lost' WHEN 'no_show' THEN CASE WHEN stage='scheduled' THEN 'contacted' ELSE stage END ELSE stage END,updated_at=now(),version=version+1 WHERE id=l.id;
 END IF;
 details:=jsonb_build_object('notes',data->>'notes','needs',left(coalesce(data->>'needs',''),4000),'objections',left(coalesce(data->>'objections',''),4000),'services',left(coalesce(data->>'services',''),2000),'amount',nullif(data->>'amount',''),'next_action',left(coalesce(data->>'next_action',''),2000));
 INSERT INTO crm_meeting_results(meeting_id,lead_id,actor_id,outcome,details) VALUES(m.id,l.id,auth.uid(),outcome,details);
 UPDATE meetings SET version=version+1 WHERE id=m.id;
 INSERT INTO crm_activities(lead_id,actor_id,kind,description,meeting_id) VALUES(l.id,auth.uid(),'meeting','Resultado: '||outcome||' · '||(data->>'notes'),m.id);
 IF nullif(data->>'follow_up_at','') IS NOT NULL THEN
 IF outcome IN ('lost','won') THEN RAISE EXCEPTION 'Não programe retorno em negociação encerrada';END IF;
 -- Private call remains under the same transaction and idempotency key family.
 fid:=crm_followup_action(jsonb_build_object('request_id',gen_random_uuid(),'operation','create','lead_id',l.id,'meeting_id',m.id,'assigned_to',coalesce(nullif(data->>'assigned_to',''),m.closer_id::text),'due_at',data->>'follow_up_at','reason',coalesce(nullif(trim(data->>'next_action'),''),'Acompanhar negociação')));
 END IF;
 RETURN crm_command_finish(data,jsonb_build_object('id',m.id,'deal_id',did,'followup',fid));
END $$;
-- Security: all new entities are read-only to clients. Mutations go through guarded RPCs.
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['crm_commands','crm_meeting_results','crm_followups'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON %I TO authenticated',t);
 EXECUTE format('CREATE POLICY live_session ON %I AS RESTRICTIVE TO authenticated USING(live_auth_session()) WITH CHECK(live_auth_session())',t);
 EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_change()',t,t);
 END LOOP;END $$;
CREATE POLICY crm_command_read ON crm_commands FOR SELECT TO authenticated USING(actor_id=auth.uid() AND can_crm() OR actor_role()='admin');
CREATE POLICY crm_result_read ON crm_meeting_results FOR SELECT TO authenticated USING(crm_can_read(lead_id));
CREATE POLICY crm_followup_read ON crm_followups FOR SELECT TO authenticated USING(crm_can_read(lead_id));
REVOKE ALL ON FUNCTION crm_command_begin(jsonb,text),crm_command_finish(jsonb,jsonb),crm_schedule_core(jsonb),crm_refresh_followup_date(uuid),crm_sync_legacy_followup(),crm_followup_action(jsonb),crm_reschedule_meeting(jsonb),crm_record_meeting_result(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_followup_action(jsonb),crm_reschedule_meeting(jsonb),crm_record_meeting_result(jsonb) TO authenticated;

CREATE FUNCTION crm_agenda_report(filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH a AS (SELECT m.*,o.sdr_id FROM meetings m JOIN opportunities o ON o.id=m.opportunity_id WHERE o.crm_lead_id IS NOT NULL AND m.scheduled_at>=coalesce(nullif(filters->>'from','')::timestamptz,'-infinity') AND m.scheduled_at<coalesce(nullif(filters->>'to','')::timestamptz,'infinity') AND (nullif(filters->>'owner','') IS NULL OR m.closer_id=(filters->>'owner')::uuid OR o.sdr_id=(filters->>'owner')::uuid)),
 grouped AS (SELECT p.id,p.name,'sdr'::text AS function,count(*) AS meetings,count(*) FILTER(WHERE a.status IN ('held','qualified')) AS held FROM a JOIN profiles p ON p.id=a.sdr_id GROUP BY p.id,p.name UNION ALL SELECT p.id,p.name,'closer',count(*),count(*) FILTER(WHERE a.status IN ('held','qualified')) FROM a JOIN profiles p ON p.id=a.closer_id GROUP BY p.id,p.name)
 SELECT jsonb_build_object('performance',coalesce((SELECT jsonb_agg(g ORDER BY g.name,g.function) FROM grouped g),'[]'::jsonb)) $$;
REVOKE ALL ON FUNCTION crm_agenda_report(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_agenda_report(jsonb) TO authenticated;
COMMIT;
