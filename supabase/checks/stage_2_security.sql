-- Read-only acceptance check AFTER 003; run as SQL Editor operator in the existing project.
BEGIN READ ONLY;
DO $$ DECLARE t text; f text; BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','teams','campaigns','campaign_participants','opportunities','meetings','meeting_validations','contracts','audit_logs','competition_updates','user_functions','access_companies','client_assignments','partner_companies','access_invitations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'RLS ausente: %',t;
    END IF;
    IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.'||t,'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Escrita direta indevida: %',t;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated','public.opportunity_scores','SELECT') OR has_table_privilege('anon','public.opportunity_scores','SELECT') THEN
    RAISE EXCEPTION 'View de pontuação exposta';
  END IF;
  FOREACH f IN ARRAY ARRAY['admin_operation_v1(text,jsonb)','admin_operation_v2(text,jsonb)','has_user_function(uuid,text)','validate_invite_spec(jsonb)','require_admin()'] LOOP
    IF has_function_privilege('authenticated','public.'||f,'EXECUTE') OR has_function_privilege('anon','public.'||f,'EXECUTE') THEN
      RAISE EXCEPTION 'Função privada exposta: %',f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['manage_access(jsonb)','manage_access_company(jsonb)','begin_access_invite(jsonb)','complete_access_invite(uuid,uuid)','fail_access_invite(uuid)','admin_operation(text,jsonb)'] LOOP
    IF has_function_privilege('anon','public.'||f,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN
      RAISE EXCEPTION 'ACL de RPC inválida: %',f;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM profiles WHERE (role='admin')<>(category='admin') OR (role='partner')<>(category='partner')) THEN
    RAISE EXCEPTION 'Categoria e perfil incompatíveis';
  END IF;
  IF EXISTS(SELECT 1 FROM profiles p WHERE role IN ('sdr','closer') AND NOT EXISTS(SELECT 1 FROM user_functions f WHERE f.profile_id=p.id AND f.function_code=p.role))
    OR EXISTS(SELECT 1 FROM user_functions f JOIN profiles p ON p.id=f.profile_id WHERE p.category<>'employee') THEN
    RAISE EXCEPTION 'Funções incompatíveis com o perfil';
  END IF;
  IF EXISTS(SELECT 1 FROM client_assignments a JOIN profiles p ON p.id=a.profile_id WHERE p.category<>'employee')
    OR EXISTS(SELECT 1 FROM partner_companies a JOIN profiles p ON p.id=a.profile_id WHERE p.category<>'partner') THEN
    RAISE EXCEPTION 'Vínculos incompatíveis com a categoria';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND NOT c.convalidated) THEN
    RAISE EXCEPTION 'Há chaves estrangeiras não validadas';
  END IF;
END $$;
SELECT 'RLS, ACLs, categorias, funções, vínculos e FKs: checks aprovados' AS result;
SELECT count(*) AS active_administrators FROM profiles WHERE category='admin' AND active;
COMMIT;
