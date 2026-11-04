-- User lifecycle: Auth identity may end without deleting the business actor.
-- Apply only after verified recovery. No existing account is removed or deactivated.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
ALTER TABLE public.profiles ADD COLUMN auth_user_id uuid;
UPDATE public.profiles SET auth_user_id=id;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_identity_unique UNIQUE(auth_user_id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_identity_matches CHECK(auth_user_id IS NULL OR auth_user_id=id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY(auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

-- Immutable UUID references outlive the account; JSON audit snapshots remain intact.
ALTER TABLE public.audit_logs ADD COLUMN actor_reference uuid;
UPDATE public.audit_logs SET actor_reference=actor_id;
ALTER TABLE public.audit_logs DROP CONSTRAINT audit_logs_actor_id_fkey;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY(actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.access_invitations ADD COLUMN auth_user_reference uuid;
UPDATE public.access_invitations SET auth_user_reference=auth_user_id;
ALTER TABLE public.access_invitations DROP CONSTRAINT access_invitations_auth_user_id_fkey;
ALTER TABLE public.access_invitations ADD CONSTRAINT access_invitations_auth_user_id_fkey FOREIGN KEY(auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE FUNCTION public.retain_user_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_TABLE_NAME='audit_logs' THEN
  NEW.actor_reference:=coalesce(CASE WHEN TG_OP='UPDATE' THEN OLD.actor_reference END,NEW.actor_id);
 ELSE NEW.auth_user_reference:=coalesce(CASE WHEN TG_OP='UPDATE' THEN OLD.auth_user_reference END,NEW.auth_user_id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_actor_reference BEFORE INSERT OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.retain_user_reference();
CREATE TRIGGER invitation_auth_reference BEFORE INSERT OR UPDATE ON public.access_invitations FOR EACH ROW EXECUTE FUNCTION public.retain_user_reference();

CREATE TABLE public.user_lifecycle_operations(
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL, -- Deliberately durable UUID, not a deletable identity FK.
 target_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('deactivate','anonymize','delete_test')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 2000),
 status text NOT NULL CHECK(status IN ('pending','completed','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 resolved_by uuid,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes'
);
CREATE UNIQUE INDEX one_pending_user_removal ON public.user_lifecycle_operations(target_id) WHERE status='pending';
ALTER TABLE public.user_lifecycle_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_admin_read ON public.user_lifecycle_operations FOR SELECT TO authenticated USING(actor_role()='admin');
REVOKE ALL ON public.user_lifecycle_operations FROM anon,authenticated;
GRANT SELECT ON public.user_lifecycle_operations TO authenticated;

CREATE FUNCTION public.guard_profile_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF TG_OP='INSERT' THEN NEW.auth_user_id:=NEW.id; END IF;
 IF TG_OP<>'INSERT' AND OLD.role='admin' AND OLD.active AND (TG_OP='DELETE' OR NEW.role<>'admin' OR NOT NEW.active) THEN
  PERFORM pg_advisory_xact_lock(70013);
  IF (SELECT count(*) FROM profiles WHERE role='admin' AND active AND id<>OLD.id)=0 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.auth_user_id IS NULL AND NEW.active THEN RAISE EXCEPTION 'Identidade removida: este perfil histórico não pode ser reativado'; END IF;
 IF TG_OP='UPDATE' AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id AND NOT(NEW.auth_user_id IS NULL AND NOT NEW.active) THEN RAISE EXCEPTION 'A identidade de um perfil histórico é imutável'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER profile_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();

-- Enumerate every real profile FK, fail closed for future tables. Access bindings
-- can be removed; business attribution/participation is never silently reassigned.
CREATE FUNCTION public.user_removal_dependencies(uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r record;n bigint;items jsonb:='[]'; BEGIN
 FOR r IN SELECT c.conrelid::regclass as tbl,a.attname as col,c.conname
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  WHERE c.contype='f' AND c.confrelid='public.profiles'::regclass LOOP
  IF r.conname IN ('audit_logs_actor_id_fkey','user_functions_profile_id_fkey','client_assignments_profile_id_fkey','partner_companies_profile_id_fkey','ana_grants_profile_id_fkey','crm_grants_profile_id_fkey') THEN CONTINUE; END IF;
  EXECUTE format('SELECT count(*) FROM %s WHERE %I=$1',r.tbl,r.col) INTO n USING uid;
  IF n>0 THEN items:=items||jsonb_build_array(jsonb_build_object('relationship',r.conname,'records',n)); END IF;
 END LOOP;
 RETURN items;
END $$;
CREATE FUNCTION public.inspect_user_lifecycle(uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE owned bigint;deps jsonb; BEGIN
 PERFORM require_admin();
 SELECT count(*) INTO owned FROM storage.objects WHERE owner_id=uid::text OR owner=uid;
 deps:=user_removal_dependencies(uid);
 RETURN jsonb_build_object('dependencies',deps,'owned_files',owned,'can_delete_test',jsonb_array_length(deps)=0 AND owned=0,'auth_exists',EXISTS(SELECT FROM auth.users WHERE id=uid),'profile_retained',EXISTS(SELECT FROM profiles WHERE id=uid AND auth_user_id IS NULL));
END $$;

CREATE FUNCTION public.prepare_user_lifecycle(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pid uuid:=(data->>'target_id')::uuid;rid uuid:=(data->>'request_id')::uuid;action text:=data->>'mode';op user_lifecycle_operations;p profiles;deps jsonb; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR data->>'confirmation' IS DISTINCT FROM pid::text THEN RAISE EXCEPTION 'Confirme a operação e digite o UUID completo do usuário'; END IF;
 IF length(trim(coalesce(data->>'reason','')))<8 OR length(data->>'reason')>2000 THEN RAISE EXCEPTION 'Informe justificativa entre 8 e 2000 caracteres'; END IF;
 IF action='delete_test' AND data->>'test_account' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Confirme que esta é uma conta de teste sem dados legítimos'; END IF;
 IF action NOT IN ('deactivate','anonymize','delete_test') OR action IS NULL THEN RAISE EXCEPTION 'Operação inválida'; END IF;
 IF pid=auth.uid() THEN RAISE EXCEPTION 'Você não pode remover seu próprio acesso administrativo'; END IF;
 SELECT * INTO op FROM user_lifecycle_operations WHERE id=rid FOR UPDATE;
 IF FOUND THEN
  IF op.actor_id<>auth.uid() OR op.target_id<>pid OR op.mode<>action OR op.reason<>trim(data->>'reason') THEN RAISE EXCEPTION 'Identificador de operação reutilizado com outros dados'; END IF;
  IF op.status='failed' THEN RAISE EXCEPTION 'Operação anterior encerrada; confira o estado e solicite uma nova confirmação'; END IF;
  IF op.status='pending' AND op.expires_at<now() THEN RAISE EXCEPTION 'Confirmação expirada; confira o estado e encerre a operação pendente'; END IF;
  RETURN to_jsonb(op);
 END IF;
 SELECT * INTO p FROM profiles WHERE id=pid FOR UPDATE;
 IF p.role='admin' AND p.active AND (SELECT count(*) FROM profiles WHERE role='admin' AND active)<=1 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo'; END IF;
 IF NOT EXISTS(SELECT FROM auth.users WHERE id=pid) THEN RAISE EXCEPTION 'Conta Auth inexistente; consulte o perfil histórico'; END IF;
 IF action<>'deactivate' AND EXISTS(SELECT FROM storage.objects WHERE owner_id=pid::text OR owner=pid) THEN RAISE EXCEPTION 'A conta possui arquivos no Storage. Desative o acesso e revise a propriedade dos arquivos antes de remover a identidade'; END IF;
 deps:=user_removal_dependencies(pid);
 IF action='delete_test' AND jsonb_array_length(deps)>0 THEN RAISE EXCEPTION 'Exclusão definitiva bloqueada: há histórico ou atribuições. Use desativação ou anonimização e consulte as dependências'; END IF;
 IF action='deactivate' AND p.id IS NULL THEN RAISE EXCEPTION 'Conta sem perfil; somente remoção de conta de teste sem vínculos é permitida'; END IF;
 -- Expired pending work is never executed silently. Explicit cancellation is needed.
 INSERT INTO user_lifecycle_operations(id,actor_id,target_id,mode,reason,status,completed_at)
 VALUES(rid,auth.uid(),pid,action,trim(data->>'reason'),CASE WHEN action='deactivate' THEN 'completed' ELSE 'pending' END,CASE WHEN action='deactivate' THEN now() END) RETURNING * INTO op;
 PERFORM set_config('ion.reason',op.reason,true);
 UPDATE profiles SET active=false WHERE id=pid;
 RETURN to_jsonb(op);
END $$;

CREATE FUNCTION public.cancel_user_lifecycle(request_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 UPDATE user_lifecycle_operations SET status='failed',completed_at=now(),resolved_by=auth.uid() WHERE id=request_id AND status='pending';
 -- Remains inactive on failure; never silently restores permissions.
END $$;

-- Auth API runs the guarded removal in its own transaction. If any dependency
-- or provider step fails, profile cleanup and ledger completion roll back too.
CREATE FUNCTION public.guard_auth_user_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op user_lifecycle_operations;p profiles; BEGIN
 PERFORM pg_advisory_xact_lock(70013);
 SELECT * INTO op FROM user_lifecycle_operations WHERE target_id=OLD.id AND status='pending' AND expires_at>=now() FOR UPDATE;
 IF op.id IS NULL THEN RAISE EXCEPTION 'Remoção não autorizada. Use Equipe no ION OS para conferir dependências e confirmar a operação'; END IF;
 IF NOT EXISTS(SELECT FROM profiles WHERE id=op.actor_id AND role='admin' AND active) THEN RAISE EXCEPTION 'O administrador que autorizou a operação não possui mais acesso ativo'; END IF;
 SELECT * INTO p FROM profiles WHERE id=OLD.id FOR UPDATE;
 IF p.id=op.actor_id THEN RAISE EXCEPTION 'Não é permitido remover o próprio administrador'; END IF;
 IF p.role='admin' AND p.active AND (SELECT count(*) FROM profiles WHERE role='admin' AND active)<=1 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo'; END IF;
 IF EXISTS(SELECT FROM storage.objects WHERE owner_id=OLD.id::text OR owner=OLD.id) THEN RAISE EXCEPTION 'Remoção bloqueada por propriedade de arquivos no Storage'; END IF;
 PERFORM set_config('ion.reason',op.reason,true);
 IF op.mode='delete_test' THEN
  IF jsonb_array_length(user_removal_dependencies(OLD.id))>0 THEN RAISE EXCEPTION 'Novas dependências impedem a exclusão definitiva; histórico preservado'; END IF;
  DELETE FROM user_functions WHERE profile_id=OLD.id;
  DELETE FROM client_assignments WHERE profile_id=OLD.id;
  DELETE FROM partner_companies WHERE profile_id=OLD.id;
  DELETE FROM ana_grants WHERE profile_id=OLD.id;
  DELETE FROM crm_grants WHERE profile_id=OLD.id;
  DELETE FROM profiles WHERE id=OLD.id;
 ELSIF op.mode='anonymize' THEN
  UPDATE profiles SET active=false,auth_user_id=NULL,name='Usuário anonimizado '||left(id::text,8) WHERE id=OLD.id;
 ELSE RAISE EXCEPTION 'Operação não permite excluir identidade Auth'; END IF;
 UPDATE user_lifecycle_operations SET status='completed',completed_at=now(),resolved_by=op.actor_id WHERE id=op.id;
 RETURN OLD;
END $$;
CREATE TRIGGER ion_guard_auth_user_removal BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.guard_auth_user_removal();
CREATE FUNCTION public.guard_auth_soft_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF to_jsonb(OLD)->>'deleted_at' IS NULL AND to_jsonb(NEW)->>'deleted_at' IS NOT NULL THEN
  RAISE EXCEPTION 'Use o ciclo de vida no ION OS: exclusão lógica direta no Auth não gerencia os vínculos históricos';
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER ion_guard_auth_soft_removal BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.guard_auth_soft_removal();
REVOKE EXECUTE ON FUNCTION public.guard_auth_soft_removal() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.retain_user_reference(),public.guard_profile_identity(),public.user_removal_dependencies(uuid),public.inspect_user_lifecycle(uuid),public.prepare_user_lifecycle(jsonb),public.cancel_user_lifecycle(uuid),public.guard_auth_user_removal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_user_lifecycle(uuid),public.prepare_user_lifecycle(jsonb),public.cancel_user_lifecycle(uuid) TO authenticated;
COMMIT;
