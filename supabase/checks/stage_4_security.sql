-- Acceptance checks; no client data returned.
DO $$ DECLARE t text;f text;BEGIN
 FOREACH t IN ARRAY ARRAY['ops_clients','ops_admin_notes','ops_catalog','ops_contracts','ops_services','ops_service_assignments','ops_updates','ops_files'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Operational RLS absent: %',t;END IF;
 IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Direct operational access exposed: %',t;END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['ops_save_client(jsonb)','ops_save_contract(jsonb)','ops_save_service(jsonb)','ops_progress(jsonb)','ops_from_crm(jsonb)','ops_begin_file(jsonb)','ops_finish_file(jsonb)','ops_download(uuid)','ops_partner_snapshot()'] LOOP
 IF has_function_privilege('anon','public.'||f,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'Invalid operational RPC privileges: %',f;END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.ops_source_state(uuid)','EXECUTE') OR has_function_privilege('authenticated','public.ops_source_revision(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private source helper exposed';END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='ion-os-documents' AND NOT public AND file_size_limit=10485760) THEN RAISE EXCEPTION 'Private document bucket not configured';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity) THEN RAISE EXCEPTION 'Storage RLS missing';END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname IN ('ops_document_upload','ops_document_read'))<>2 THEN RAISE EXCEPTION 'Storage policies absent';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT convalidated) THEN RAISE EXCEPTION 'Unvalidated public constraint';END IF;
END $$;
