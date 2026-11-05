-- Administrative simplification. Incremental; does not remove existing accounts.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
ALTER TABLE public.profiles ADD COLUMN is_historical boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD CONSTRAINT historical_profile_no_login CHECK(NOT is_historical OR (NOT active AND auth_user_id IS NULL));
CREATE TABLE public.historical_actors(id uuid PRIMARY KEY REFERENCES profiles(id),retired_at timestamptz NOT NULL DEFAULT now(),operation_id uuid REFERENCES user_lifecycle_operations(id));
ALTER TABLE public.historical_actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY historical_actor_read ON public.historical_actors FOR SELECT TO authenticated USING(visible_profile(id));
REVOKE ALL ON public.historical_actors FROM anon,authenticated;
GRANT SELECT ON public.historical_actors TO authenticated;
-- Existing retired identities are classified only; no Auth account is changed.
UPDATE profiles SET is_historical=true WHERE auth_user_id IS NULL AND NOT active;
INSERT INTO historical_actors(id) SELECT id FROM profiles WHERE is_historical;
ALTER TABLE public.user_lifecycle_operations DROP CONSTRAINT user_lifecycle_operations_mode_check;
ALTER TABLE public.user_lifecycle_operations ADD CONSTRAINT user_lifecycle_operations_mode_check CHECK(mode IN ('deactivate','anonymize','delete_test','remove'));

CREATE FUNCTION public.live_auth_session() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE claims text:=nullif(current_setting('request.jwt.claims',true),'');sid uuid;BEGIN
 IF auth.uid() IS NULL THEN RETURN false;END IF;
 -- Direct owner maintenance has no JWT envelope. PostgREST always supplies it.
 IF claims IS NULL THEN RETURN true;END IF;
 BEGIN sid:=nullif(claims::jsonb->>'session_id','')::uuid;EXCEPTION WHEN invalid_text_representation THEN RETURN false;END;
 RETURN sid IS NOT NULL AND EXISTS(SELECT FROM auth.sessions WHERE id=sid AND user_id=auth.uid());
END $$;
CREATE OR REPLACE FUNCTION public.actor_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT role FROM profiles WHERE id=auth.uid() AND active AND NOT is_historical AND live_auth_session()$$;
CREATE OR REPLACE FUNCTION public.has_function(code text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT live_auth_session() AND has_user_function(auth.uid(),code)$$;
CREATE FUNCTION public.revoke_user_sessions(uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 DELETE FROM auth.refresh_tokens WHERE user_id=uid::text;
 DELETE FROM auth.sessions WHERE user_id=uid;
END $$;
CREATE FUNCTION public.team_save_access(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF EXISTS(SELECT FROM profiles WHERE id=(data->>'id')::uuid AND is_historical) THEN RAISE EXCEPTION 'Este identificador é histórico e não pode receber acesso';END IF;
 PERFORM manage_access(data||jsonb_build_object('confirm','true','reason','Alteração administrativa de acesso pelo painel Equipe','remove_from_campaign',CASE WHEN data->>'category'<>'employee' OR NOT coalesce(data->'functions','[]') ? 'sdr' THEN 'true' ELSE 'false' END));
 UPDATE auth.users SET banned_until=CASE WHEN (data->>'active')::boolean THEN NULL ELSE now()+interval '100 years' END WHERE id=(data->>'id')::uuid;
 IF NOT (data->>'active')::boolean THEN PERFORM revoke_user_sessions((data->>'id')::uuid);END IF;
END $$;
CREATE FUNCTION public.prepare_simple_removal(uid uuid,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op user_lifecycle_operations;p profiles;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF uid=auth.uid() THEN RAISE EXCEPTION 'Você não pode remover sua própria conta administrativa';END IF;
 SELECT * INTO op FROM user_lifecycle_operations WHERE id=request_id FOR UPDATE;
 IF FOUND THEN
  IF op.target_id<>uid OR op.mode<>'remove' THEN RAISE EXCEPTION 'Solicitação inválida';END IF;
  IF op.status='completed' THEN RETURN to_jsonb(op);END IF;
  IF op.status='failed' THEN RAISE EXCEPTION 'Esta solicitação foi encerrada. Confirme novamente a remoção';END IF;
  UPDATE user_lifecycle_operations SET expires_at=now()+interval '15 minutes' WHERE id=op.id RETURNING * INTO op;
  RETURN to_jsonb(op);
 END IF;
 SELECT * INTO p FROM profiles WHERE id=uid FOR UPDATE;
 IF p.is_historical OR NOT EXISTS(SELECT FROM auth.users WHERE id=uid) THEN
  SELECT * INTO op FROM user_lifecycle_operations WHERE target_id=uid AND mode='remove' AND status='completed' ORDER BY completed_at DESC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(op);END IF;
  RAISE EXCEPTION 'A conta já não está disponível para remoção';
 END IF;
 IF p.role='admin' AND p.active AND (SELECT count(*) FROM profiles WHERE role='admin' AND active)<=1 THEN RAISE EXCEPTION 'Não é permitido remover o último administrador ativo';END IF;
 UPDATE user_lifecycle_operations SET status='failed',completed_at=now(),resolved_by=auth.uid() WHERE target_id=uid AND status='pending';
 INSERT INTO user_lifecycle_operations(id,actor_id,target_id,mode,reason,status) VALUES(request_id,auth.uid(),uid,'remove','Remoção definitiva confirmada pelo administrador no painel Equipe','pending') RETURNING * INTO op;
 PERFORM set_config('ion.reason',op.reason,true);
 UPDATE profiles SET active=false WHERE id=uid;
 -- Stop password login and refresh immediately, before contacting the Auth API.
 UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id=uid;
 PERFORM revoke_user_sessions(uid);
 -- Retain every binary and object path; remove only personal ownership metadata.
 UPDATE storage.objects SET owner=NULL,owner_id=NULL WHERE owner=uid OR owner_id=uid::text;
 RETURN to_jsonb(op);
END $$;
CREATE OR REPLACE FUNCTION public.guard_auth_user_removal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 IF op.mode='remove' THEN
  -- Remove personal operational access; business references keep the same stable
  -- actor UUID through an anonymous compatibility anchor, never a live profile.
  DELETE FROM user_functions WHERE profile_id=OLD.id;
  DELETE FROM client_assignments WHERE profile_id=OLD.id;
  DELETE FROM partner_companies WHERE profile_id=OLD.id;
  DELETE FROM crm_grants WHERE profile_id=OLD.id;
  DELETE FROM ana_grants WHERE profile_id=OLD.id;
  DELETE FROM ops_service_assignments WHERE profile_id=OLD.id;
  UPDATE fin_rules SET active=false,version=version+1 WHERE profile_id=OLD.id AND active;
  UPDATE campaign_participants cp SET active=false,removed_at=now(),removed_by=op.actor_id FROM campaigns c WHERE cp.profile_id=OLD.id AND cp.campaign_id=c.id AND cp.active AND c.state<>'finalized';
  UPDATE profiles SET name='Colaborador removido '||left(id::text,8),active=false,auth_user_id=NULL,is_historical=true,category='employee' WHERE id=OLD.id;
  INSERT INTO historical_actors(id,operation_id) VALUES(OLD.id,op.id) ON CONFLICT(id) DO NOTHING;
 ELSIF op.mode='delete_test' THEN
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

ALTER TABLE public.user_lifecycle_operations ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.user_lifecycle_operations ADD COLUMN last_attempt_at timestamptz;
CREATE FUNCTION public.resume_simple_removal(operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE op user_lifecycle_operations;BEGIN
 PERFORM pg_advisory_xact_lock(70013);SELECT * INTO op FROM user_lifecycle_operations WHERE id=operation_id FOR UPDATE;
 IF op.mode IS DISTINCT FROM 'remove' OR op.status IS DISTINCT FROM 'pending' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT FROM profiles WHERE id=op.actor_id AND role='admin' AND active AND NOT is_historical) THEN RETURN NULL;END IF;
 UPDATE user_lifecycle_operations SET attempts=attempts+1,last_attempt_at=now(),expires_at=now()+interval '15 minutes' WHERE id=op.id RETURNING * INTO op;
 RETURN to_jsonb(op);
END $$;
REVOKE EXECUTE ON FUNCTION public.resume_simple_removal(uuid) FROM PUBLIC,anon,authenticated;
DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN GRANT EXECUTE ON FUNCTION public.resume_simple_removal(uuid) TO service_role;END IF;END $$;
CREATE FUNCTION public.team_auth_directory(ids uuid[]) RETURNS TABLE(id uuid,email text,last_access timestamptz,confirmed boolean,invitation_pending boolean,blocked_until timestamptz) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$BEGIN
 PERFORM require_admin();IF cardinality(ids)>100 THEN RAISE EXCEPTION 'Consulta limitada a 100 usuários';END IF;
 RETURN QUERY SELECT p.id,u.email::text,u.last_sign_in_at,u.email_confirmed_at IS NOT NULL,u.invited_at IS NOT NULL AND u.email_confirmed_at IS NULL,u.banned_until FROM profiles p JOIN auth.users u ON u.id=p.auth_user_id WHERE p.id=ANY(ids) AND NOT p.is_historical;
END $$;
CREATE TABLE public.team_auth_events(id uuid PRIMARY KEY,actor_id uuid NOT NULL,target_id uuid NOT NULL,action text NOT NULL CHECK(action IN ('reset_password','resend_invite','revoke_sessions')),status text NOT NULL CHECK(status IN ('pending','completed','failed')),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.team_auth_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_auth_event_admin ON public.team_auth_events FOR SELECT TO authenticated USING(actor_role()='admin');
REVOKE ALL ON public.team_auth_events FROM anon,authenticated;
GRANT SELECT ON public.team_auth_events TO authenticated;
CREATE FUNCTION public.begin_team_auth_action(uid uuid,action text,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$#variable_conflict use_variable
DECLARE e team_auth_events;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 SELECT * INTO e FROM team_auth_events WHERE id=request_id;
 IF FOUND THEN
  IF e.actor_id<>auth.uid() OR e.target_id<>uid OR e.action<>action THEN RAISE EXCEPTION 'Solicitação inválida';END IF;
  RETURN to_jsonb(e);
 END IF;
 IF NOT EXISTS(SELECT FROM profiles WHERE id=uid AND NOT is_historical AND auth_user_id IS NOT NULL) THEN RAISE EXCEPTION 'Conta indisponível';END IF;
 IF EXISTS(SELECT FROM team_auth_events x WHERE x.target_id=uid AND x.action=begin_team_auth_action.action AND x.created_at>now()-interval '60 seconds') THEN RAISE EXCEPTION 'Aguarde um minuto antes de repetir esta ação';END IF;
 INSERT INTO team_auth_events VALUES(request_id,auth.uid(),uid,action,CASE WHEN action='revoke_sessions' THEN 'completed' ELSE 'pending' END,now()) RETURNING * INTO e;
 IF action='revoke_sessions' THEN PERFORM revoke_user_sessions(uid);END IF;
 RETURN to_jsonb(e);
END $$;
CREATE FUNCTION public.finish_team_auth_action(request_id uuid,succeeded boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN
 PERFORM require_admin();UPDATE team_auth_events SET status=CASE WHEN succeeded THEN 'completed' ELSE 'failed' END WHERE id=request_id AND actor_id=auth.uid() AND status='pending';
END $$;
CREATE OR REPLACE FUNCTION public.can_read_company(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$SELECT live_auth_session() AND (ops_client_access(cid) OR EXISTS(SELECT 1 FROM partner_companies a JOIN profiles p ON p.id=a.profile_id WHERE a.profile_id=auth.uid() AND a.company_id=cid AND p.active AND p.category='partner'))$$;
-- Central session checks also protect direct RPCs, not just Next navigation.
DO $upgrade$ DECLARE r record;src text;BEGIN
 FOR r IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('ops_employee','can_read_company','ana_assigned','current_access') LOOP
  src:=pg_get_functiondef(r.oid);
  IF r.proname='current_access' THEN src:=replace(src,'WHERE p.id=auth.uid() AND p.active','WHERE p.id=auth.uid() AND p.active AND live_auth_session()');
  ELSIF r.proname='ops_employee' THEN src:=replace(src,'SELECT EXISTS','SELECT live_auth_session() AND EXISTS');
  ELSIF r.proname='can_read_company' THEN CONTINUE;
  ELSE src:=replace(src,'SELECT EXISTS','SELECT live_auth_session() AND EXISTS');END IF;
  EXECUTE src;
 END LOOP;
 -- Guard every authenticated PL/pgSQL RPC before its business logic. This also
 -- closes nullable-boolean authorization paths when a signed JWT was revoked.
 FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.prosecdef AND l.lanname='plpgsql' AND p.prorettype<>'trigger'::regtype AND p.proname NOT IN ('live_auth_session','revoke_user_sessions','resume_simple_removal') AND has_function_privilege('authenticated',p.oid,'EXECUTE') LOOP
  src:=pg_get_functiondef(r.oid);
  src:=regexp_replace(src,'\mBEGIN\M','BEGIN IF NOT public.live_auth_session() THEN RAISE EXCEPTION USING ERRCODE=''42501'',MESSAGE=''Sua sessão foi encerrada. Entre novamente.''; END IF;','i');
  EXECUTE src;
 END LOOP;
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('CREATE POLICY authenticated_live_session ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.live_auth_session()) WITH CHECK(public.live_auth_session())',r.tablename);
 END LOOP;
END $upgrade$;
REVOKE EXECUTE ON FUNCTION public.live_auth_session(),public.revoke_user_sessions(uuid),public.team_save_access(jsonb),public.prepare_simple_removal(uuid,uuid),public.team_auth_directory(uuid[]),public.begin_team_auth_action(uuid,text,uuid),public.finish_team_auth_action(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.live_auth_session(),public.team_save_access(jsonb),public.prepare_simple_removal(uuid,uuid),public.team_auth_directory(uuid[]),public.begin_team_auth_action(uuid,text,uuid),public.finish_team_auth_action(uuid,boolean) TO authenticated;
COMMIT;
