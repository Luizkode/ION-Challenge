DO $$ DECLARE t text;f text;BEGIN
 FOREACH t IN ARRAY ARRAY['fin_categories','fin_entries','fin_settlements','fin_schedules','fin_rules'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'Finance RLS absent: %',t;END IF;
 IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Direct financial access exposed: %',t;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND NOT tgisinternal AND tgfoid='public.audit_change()'::regprocedure) THEN RAISE EXCEPTION 'Financial audit absent: %',t;END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['fin_save_entry(jsonb)','fin_settle(jsonb)','fin_save_schedule(jsonb)','fin_generate(jsonb)','fin_save_rule(jsonb)','fin_commissions(jsonb)','fin_detail(uuid)','fin_options()','fin_report(jsonb)'] LOOP
 IF has_function_privilege('anon','public.'||f,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'Financial RPC privilege invalid: %',f;END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.fin_validate_link(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Private financial helper exposed';END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT convalidated) THEN RAISE EXCEPTION 'Unvalidated constraint';END IF;
END $$;
