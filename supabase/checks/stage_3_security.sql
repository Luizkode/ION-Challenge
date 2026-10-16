-- Read-only fail-closed catalog checks after 004. No prospect data is returned.
DO $$ DECLARE t text; f text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_grants','crm_leads','crm_activities','crm_deals'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'CRM RLS missing: %',t; END IF;
 IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'CRM direct access exposed: %',t; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['crm_save_lead(jsonb)','crm_import_leads(jsonb)','crm_activity(jsonb)','crm_archive(jsonb)','crm_schedule_meeting(jsonb)','crm_record_deal(jsonb)','crm_confirm_contract(jsonb)','crm_set_grant(jsonb)','crm_report(jsonb)'] LOOP
 IF has_function_privilege('anon','public.'||f,'EXECUTE') OR NOT has_function_privilege('authenticated','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'CRM RPC privileges invalid: %',f; END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.crm_sync_validation()','EXECUTE') THEN RAISE EXCEPTION 'Private trigger exposed'; END IF;
 IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated) THEN RAISE EXCEPTION 'Unvalidated constraint'; END IF;
 IF EXISTS(SELECT 1 FROM opportunities WHERE (campaign_id IS NULL OR team_id IS NULL) AND NOT(campaign_id IS NULL AND team_id IS NULL AND crm_lead_id IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid standalone opportunity'; END IF;
END $$;
