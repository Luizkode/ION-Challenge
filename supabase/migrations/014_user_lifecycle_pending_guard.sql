-- Keep access inactive until a pending irreversible operation is explicitly resolved.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
CREATE OR REPLACE FUNCTION public.guard_profile_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.auth_user_id:=NEW.id; END IF;
 IF TG_OP<>'INSERT' AND OLD.role='admin' AND OLD.active AND (TG_OP='DELETE' OR NEW.role<>'admin' OR NOT NEW.active) THEN
  PERFORM pg_advisory_xact_lock(70013);
  IF (SELECT count(*) FROM profiles WHERE role='admin' AND active AND id<>OLD.id)=0 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.auth_user_id IS NULL AND NEW.active THEN RAISE EXCEPTION 'Identidade removida: este perfil histórico não pode ser reativado'; END IF;
 IF NEW.active AND EXISTS(SELECT FROM user_lifecycle_operations WHERE target_id=NEW.id AND status='pending') THEN RAISE EXCEPTION 'Encerre a solicitação de remoção pendente antes de reativar o acesso'; END IF;
 IF TG_OP='UPDATE' AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id AND NOT(NEW.auth_user_id IS NULL AND NOT NEW.active) THEN RAISE EXCEPTION 'A identidade de um perfil histórico é imutável'; END IF;
 RETURN NEW;
END $$;
COMMIT;
