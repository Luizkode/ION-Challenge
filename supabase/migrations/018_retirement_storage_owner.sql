-- Respect authoritative owner_id while clearing a retiring legacy owner reference.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
CREATE OR REPLACE FUNCTION public.prepare_simple_removal(uid uuid,request_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op user_lifecycle_operations;p profiles;BEGIN
 IF NOT public.live_auth_session() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Sua sessão foi encerrada. Entre novamente.';END IF;
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
 UPDATE storage.objects SET owner=NULL,owner_id=NULL WHERE owner_id=uid::text OR (owner_id IS NULL AND owner=uid);
 -- A deprecated owner UUID must not erase a different current owner's metadata.
 UPDATE storage.objects SET owner=NULL WHERE owner=uid AND owner_id IS NOT NULL AND owner_id<>uid::text;
 RETURN to_jsonb(op);
END $$;
COMMIT;
