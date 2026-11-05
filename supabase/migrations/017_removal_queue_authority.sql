-- A queued action must stop if its author loses administrative authority.
BEGIN;
SET LOCAL lock_timeout='8s';
SELECT pg_advisory_xact_lock(70013);
CREATE OR REPLACE FUNCTION public.resume_simple_removal(operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$DECLARE op user_lifecycle_operations;BEGIN
 PERFORM pg_advisory_xact_lock(70013);SELECT * INTO op FROM user_lifecycle_operations WHERE id=operation_id FOR UPDATE;
 IF op.mode IS DISTINCT FROM 'remove' OR op.status IS DISTINCT FROM 'pending' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT FROM profiles WHERE id=op.actor_id AND role='admin' AND active AND NOT is_historical) THEN UPDATE user_lifecycle_operations SET status='failed',completed_at=now(),reason=reason||' [Encerrada automaticamente: administrador sem acesso ativo]' WHERE id=op.id; RETURN NULL;END IF;
 UPDATE user_lifecycle_operations SET attempts=attempts+1,last_attempt_at=now(),expires_at=now()+interval '15 minutes' WHERE id=op.id RETURNING * INTO op;
 RETURN to_jsonb(op);
END $$;
COMMIT;
