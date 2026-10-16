-- Catalog/data inspection only. Does NOT apply migrations, create users or change Auth.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT name AS expected_table,to_regclass('public.'||name) IS NOT NULL AS present,
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||name)),false) AS rls_enabled
FROM unnest(ARRAY['profiles','teams','campaigns','campaign_participants','opportunities','meetings','meeting_validations','contracts','audit_logs','competition_updates','user_functions','access_companies','client_assignments','partner_companies','access_invitations']) name;
SELECT table_name,column_name,data_type,is_nullable,column_default
FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('profiles','campaign_participants') ORDER BY table_name,ordinal_position;
SELECT p.oid::regprocedure::text AS function,p.prosecdef AS security_definer,p.proconfig AS settings,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('actor_role','dashboard','create_meeting','validate_meeting','admin_operation','admin_operation_v1','admin_operation_v2','current_access','manage_access','available_closers','begin_access_invite','complete_access_invite') ORDER BY p.proname;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT c.conrelid::regclass::text AS relation,c.conname,c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY relation,c.conname;
SELECT role,active,count(*) AS profiles FROM profiles GROUP BY role,active ORDER BY role,active;
SELECT state,count(*) AS campaigns FROM campaigns GROUP BY state ORDER BY state;
SELECT status,count(*) AS meetings FROM meetings GROUP BY status ORDER BY status;
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS cli_migration_registry_exists;
COMMIT;
