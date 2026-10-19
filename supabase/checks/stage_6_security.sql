DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ana_grants','ana_accounts','ana_campaigns','ana_metrics','ana_reports'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Missing Analytics RLS: %',t;END IF;
 IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Unsafe direct privileges: %',t;END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.ana_collect(jsonb,boolean)','EXECUTE') OR has_function_privilege('anon','public.ana_report(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe helper privileges';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated) THEN RAISE EXCEPTION 'Unvalidated constraint';END IF;
END $$;
