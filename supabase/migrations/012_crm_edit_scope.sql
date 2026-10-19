-- A global consultation/activity grant must not become a master-data/archive permission.
-- Reuses the existing responsible SDR/closer roles; no data or scoring changes.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
CREATE FUNCTION public.crm_can_manage(lid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(actor_role()='admin',false) OR EXISTS(SELECT 1 FROM crm_leads l WHERE l.id=lid AND (has_function('sdr') AND l.sdr_id=auth.uid() OR has_function('closer') AND l.closer_id=auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.crm_can_manage(uuid) FROM PUBLIC,anon,authenticated;
-- Private, fully validated guard on the actual tables also protects existing RPC entrypoints.
CREATE FUNCTION public.crm_protect_master_data() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.company,NEW.contact,NEW.phone,NEW.email,NEW.niche,NEW.city,NEW.state,NEW.source,NEW.sdr_id,NEW.closer_id,NEW.notes,NEW.archived) IS DISTINCT FROM (OLD.company,OLD.contact,OLD.phone,OLD.email,OLD.niche,OLD.city,OLD.state,OLD.source,OLD.sdr_id,OLD.closer_id,OLD.notes,OLD.archived)
 AND NOT crm_can_manage(OLD.id) THEN RAISE EXCEPTION 'Somente o administrador ou responsável comercial pode editar o cadastro ou arquivar o lead';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.crm_protect_master_data() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_master_data_guard BEFORE UPDATE ON public.crm_leads FOR EACH ROW EXECUTE FUNCTION public.crm_protect_master_data();
COMMIT;
