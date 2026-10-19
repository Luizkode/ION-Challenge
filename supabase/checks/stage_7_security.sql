DO $$ BEGIN
 IF has_function_privilege('authenticated','public.crm_can_manage(uuid)','EXECUTE') OR has_function_privilege('anon','public.crm_can_manage(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private CRM guard exposed';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='crm_master_data_guard' AND tgrelid='public.crm_leads'::regclass AND NOT tgisinternal) THEN RAISE EXCEPTION 'CRM guard missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND policyname='ops_document_read' AND qual LIKE '%allow_any_operation%') THEN RAISE EXCEPTION 'Authenticated document policy missing';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) THEN RAISE EXCEPTION 'Unvalidated public constraint';END IF;
END $$;
