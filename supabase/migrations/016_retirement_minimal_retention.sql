-- Only retain an anonymous compatibility anchor when historical references require it.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
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
  IF jsonb_array_length(user_removal_dependencies(OLD.id))=0 THEN
   DELETE FROM profiles WHERE id=OLD.id;
  ELSE
  UPDATE profiles SET name='Colaborador removido '||left(id::text,8),active=false,auth_user_id=NULL,is_historical=true,category='employee' WHERE id=OLD.id;
  INSERT INTO historical_actors(id,operation_id) VALUES(OLD.id,op.id) ON CONFLICT(id) DO NOTHING;
  END IF;
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

COMMIT;
