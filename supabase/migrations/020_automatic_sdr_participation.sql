-- All SDR campaigns include all active SDR functions. No meeting/contract/score rewrites.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
ALTER TABLE campaigns ADD COLUMN audience text NOT NULL DEFAULT 'sdr' CHECK(audience IN ('sdr','other'));
DROP INDEX one_open_campaign;
ALTER TABLE campaign_participants ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE campaign_participants ADD COLUMN removal_source text NOT NULL DEFAULT 'admin' CHECK(removal_source IN ('admin','eligibility'));
ALTER TABLE campaign_participants DROP CONSTRAINT participant_removal_consistent;
ALTER TABLE campaign_participants ADD CONSTRAINT participant_removal_consistent CHECK((active AND removed_at IS NULL AND removed_by IS NULL) OR (NOT active AND removed_at IS NOT NULL AND (removed_by IS NOT NULL OR removal_source='eligibility')));
ALTER TABLE opportunities DROP CONSTRAINT opportunity_campaign_integrity;
ALTER TABLE opportunities ADD CONSTRAINT opportunity_campaign_integrity CHECK(campaign_id IS NOT NULL OR (team_id IS NULL AND crm_lead_id IS NOT NULL));
-- Serialize identity/campaign writes before row locks, including service-side provisioning.
CREATE FUNCTION participation_write_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN PERFORM pg_advisory_xact_lock(70013);RETURN NULL;END $$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['profiles','user_functions','campaigns','campaign_participants'] LOOP
 EXECUTE format('CREATE TRIGGER participation_write_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION participation_write_lock()',t);
END LOOP;END $$;
CREATE FUNCTION sync_sdr_participation(pid uuid DEFAULT NULL,cid uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c campaigns;p profiles;eligible boolean;historical_team uuid;old_reason text:=coalesce(current_setting('ion.reason',true),'');BEGIN
 PERFORM pg_advisory_xact_lock(70013);
 PERFORM set_config('ion.reason','Sincronização automática de participação por função SDR e situação ativa'||CASE WHEN old_reason<>'' THEN ' · '||old_reason ELSE '' END,true);
 FOR c IN SELECT * FROM campaigns WHERE audience='sdr' AND state IN ('draft','active') AND (cid IS NULL OR id=cid) ORDER BY id FOR UPDATE LOOP
  FOR p IN SELECT * FROM profiles WHERE (pid IS NULL OR id=pid) AND (has_user_function(id,'sdr') OR EXISTS(SELECT FROM campaign_participants WHERE campaign_id=c.id AND profile_id=profiles.id)) ORDER BY id LOOP
   eligible:=has_user_function(p.id,'sdr') AND NOT p.is_historical;
   IF eligible THEN
    -- Only recover a uniquely evidenced team in this same campaign, never choose another team.
    SELECT CASE WHEN count(DISTINCT team_id)=1 THEN (array_agg(DISTINCT team_id) FILTER(WHERE team_id IS NOT NULL))[1] ELSE NULL END INTO historical_team FROM opportunities WHERE campaign_id=c.id AND sdr_id=p.id;
    INSERT INTO campaign_participants(campaign_id,profile_id,team_id,active) VALUES(c.id,p.id,historical_team,true)
    ON CONFLICT(campaign_id,profile_id) DO UPDATE SET active=true,removed_at=NULL,removed_by=NULL
    WHERE NOT campaign_participants.active;
   ELSE
    UPDATE campaign_participants SET active=false,removed_at=clock_timestamp(),removed_by=auth.uid(),removal_source='eligibility' WHERE campaign_id=c.id AND profile_id=p.id AND active;
   END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('ion.reason',old_reason,true);
END $$;
CREATE FUNCTION sync_sdr_identity_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 IF TG_TABLE_NAME='profiles' THEN PERFORM sync_sdr_participation(coalesce(NEW.id,OLD.id),NULL);
 ELSE PERFORM sync_sdr_participation(coalesce(NEW.profile_id,OLD.profile_id),NULL);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sync_sdr_profile AFTER INSERT OR UPDATE ON profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sync_sdr_identity_event();
CREATE CONSTRAINT TRIGGER sync_sdr_functions AFTER INSERT OR UPDATE OR DELETE ON user_functions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sync_sdr_identity_event();
CREATE FUNCTION sync_sdr_campaign_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN PERFORM sync_sdr_participation(NULL,NEW.id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER sync_sdr_campaign AFTER INSERT OR UPDATE ON campaigns DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sync_sdr_campaign_event();
CREATE FUNCTION sync_sdr_membership_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN PERFORM sync_sdr_participation(NEW.profile_id,NEW.campaign_id);RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER sync_sdr_membership AFTER INSERT OR UPDATE ON campaign_participants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sync_sdr_membership_event();
CREATE FUNCTION protect_sdr_membership_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 IF EXISTS(SELECT FROM campaigns WHERE id=OLD.campaign_id AND audience='sdr' AND state IN ('draft','active')) AND has_user_function(OLD.profile_id,'sdr') THEN RAISE EXCEPTION 'Participação automática: desative o acesso ou retire a função SDR para encerrar a participação';END IF;RETURN OLD;
END $$;
CREATE TRIGGER protect_sdr_membership_delete BEFORE DELETE ON campaign_participants FOR EACH ROW EXECUTE FUNCTION protect_sdr_membership_delete();
-- Function changes are applied atomically even when the legacy caller did not request manual removal.
ALTER FUNCTION manage_access(jsonb) RENAME TO manage_access_before_auto;
REVOKE ALL ON FUNCTION manage_access_before_auto(jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION manage_access(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF data->>'category'<>'employee' OR NOT coalesce(data->'functions','[]') ? 'sdr' OR data->>'active'='false' THEN
  PERFORM id FROM campaigns WHERE audience='sdr' AND state IN ('draft','active') ORDER BY id FOR UPDATE;
  UPDATE campaign_participants cp SET active=false,removed_at=clock_timestamp(),removed_by=auth.uid(),removal_source='eligibility' FROM campaigns c WHERE c.id=cp.campaign_id AND c.audience='sdr' AND c.state IN ('draft','active') AND cp.profile_id=(data->>'id')::uuid AND cp.active;
 END IF;
 PERFORM manage_access_before_auto(data);
END $$;
REVOKE ALL ON FUNCTION manage_access(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION manage_access(jsonb) TO authenticated;
ALTER FUNCTION admin_operation(text,jsonb) RENAME TO admin_operation_before_auto;
REVOKE ALL ON FUNCTION admin_operation_before_auto(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION admin_operation(operation text,data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c campaigns;pid uuid;tid uuid;cp campaign_participants;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF operation='participant' THEN
  SELECT * INTO c FROM campaigns WHERE id=(data->>'campaign_id')::uuid FOR UPDATE;
  IF c.audience='sdr' THEN
   IF c.state NOT IN ('draft','active') THEN RAISE EXCEPTION 'Campanha encerrada: participação histórica preservada';END IF;
   pid:=(data->>'profile_id')::uuid;
   IF data->>'remove'='true' THEN RAISE EXCEPTION 'Participação automática: desative o acesso ou retire a função SDR na Equipe';END IF;
   IF NOT has_user_function(pid,'sdr') THEN RAISE EXCEPTION 'Somente SDR ativo pode receber equipe nesta campanha';END IF;
   IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 THEN RAISE EXCEPTION 'Confirme a equipe e informe a justificativa';END IF;
   SELECT * INTO cp FROM campaign_participants WHERE campaign_id=c.id AND profile_id=pid;
   tid:=nullif(data->>'team_id','')::uuid;
   IF tid IS NULL OR NOT EXISTS(SELECT FROM teams WHERE id=tid) THEN RAISE EXCEPTION 'Selecione um time válido';END IF;
   IF EXISTS(SELECT FROM opportunities WHERE campaign_id=c.id AND sdr_id=pid AND team_id IS NOT NULL AND team_id IS DISTINCT FROM tid) THEN RAISE EXCEPTION 'Preserve o time original deste SDR: há histórico nesta campanha';END IF;
   IF tid IS DISTINCT FROM cp.team_id AND (SELECT count(*) FROM campaign_participants WHERE campaign_id=c.id AND team_id=tid AND active AND profile_id<>pid)>=5 THEN RAISE EXCEPTION 'O time já possui cinco integrantes';END IF;
   PERFORM set_config('ion.reason',data->>'reason',true);
   INSERT INTO campaign_participants(campaign_id,profile_id,team_id) VALUES(c.id,pid,tid) ON CONFLICT(campaign_id,profile_id) DO UPDATE SET team_id=tid;
   RETURN;
  END IF;
 END IF;
 PERFORM admin_operation_before_auto(operation,data);
END $$;
REVOKE ALL ON FUNCTION admin_operation(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION admin_operation(text,jsonb) TO authenticated;
-- Keep each historical score formula intact. A missing team cannot hide an individual SDR.
DO $upgrade$DECLARE def text;BEGIN
 SELECT pg_get_functiondef('manage_access_before_auto(jsonb)'::regprocedure) INTO def;
 def:=replace(def,$find$c.state<>'finalized'$find$,$replace$c.state<>'finalized' AND NOT(c.audience='sdr' AND c.state='ended')$replace$);EXECUTE def;
 SELECT pg_get_functiondef('guard_auth_user_removal()'::regprocedure) INTO def;
 def:=replace(def,$find$c.state<>'finalized'$find$,$replace$c.state<>'finalized' AND NOT(c.audience='sdr' AND c.state='ended')$replace$);EXECUTE def;
 SELECT pg_get_functiondef('dashboard(uuid)'::regprocedure) INTO def;
 def:=replace(def,'p.name,t.name as team','p.name,coalesce(t.name,''Sem equipe definida'') as team');
 def:=replace(def,'join profiles p on p.id=cp.profile_id join teams t on t.id=cp.team_id','join profiles p on p.id=cp.profile_id left join teams t on t.id=cp.team_id');
 EXECUTE def;
 -- Serialize canonical meeting writers before campaign/profile row locks.
 SELECT pg_get_functiondef('create_meeting(jsonb)'::regprocedure) INTO def;
 def:=regexp_replace(def,'\mBEGIN\M','BEGIN PERFORM pg_advisory_xact_lock(70013);','i');EXECUTE def;
 SELECT pg_get_functiondef('validate_meeting(jsonb)'::regprocedure) INTO def;
 def:=regexp_replace(def,'\mBEGIN\M','BEGIN PERFORM pg_advisory_xact_lock(70013);','i');EXECUTE def;
 -- Multiple campaigns: commercial meetings still have ONE explicit/deterministic campaign.
 SELECT pg_get_functiondef('crm_schedule_core(jsonb)'::regprocedure) INTO def;
 def:=replace(def,$find$SELECT * INTO ca FROM campaigns WHERE state='active' AND now()>=starts_at AND now()<ends_at FOR UPDATE;$find$,
 $replace$SELECT c.* INTO ca FROM campaigns c WHERE c.state='active' AND now()>=c.starts_at AND now()<c.ends_at AND (data->>'scheduled_at')::timestamptz>=c.starts_at AND (data->>'scheduled_at')::timestamptz<c.ends_at AND (nullif(data->>'campaign_id','') IS NULL OR c.id=(data->>'campaign_id')::uuid) AND EXISTS(SELECT FROM campaign_participants enrollment JOIN crm_leads candidate_lead ON candidate_lead.sdr_id=enrollment.profile_id WHERE candidate_lead.id=(data->>'lead_id')::uuid AND enrollment.campaign_id=c.id AND enrollment.active) ORDER BY c.starts_at,c.id LIMIT 1 FOR UPDATE;$replace$);
 EXECUTE def;
END $upgrade$;
REVOKE ALL ON FUNCTION participation_write_lock(),sync_sdr_participation(uuid,uuid),sync_sdr_identity_event(),sync_sdr_campaign_event(),sync_sdr_membership_event(),protect_sdr_membership_delete() FROM PUBLIC,anon,authenticated;
-- One-time repair: current draft/active SDR campaigns only; ended/finalized rows untouched.
SELECT sync_sdr_participation();
COMMIT;
