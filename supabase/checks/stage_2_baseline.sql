-- Read-only. Run before AND after the pending migrations in the existing project.
-- Save results privately and compare: these business records must not change.
BEGIN READ ONLY;
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.opportunity_scores') IS NULL THEN
    RAISE EXCEPTION '001 ausente: este check exige a estrutura original do Challenger';
  END IF;
END $$;
SELECT 'profiles' AS entity,count(*) AS records FROM profiles
UNION ALL SELECT 'campaigns',count(*) FROM campaigns
UNION ALL SELECT 'participants',count(*) FROM campaign_participants
UNION ALL SELECT 'opportunities',count(*) FROM opportunities
UNION ALL SELECT 'meetings',count(*) FROM meetings
UNION ALL SELECT 'validations',count(*) FROM meeting_validations
UNION ALL SELECT 'contracts',count(*) FROM contracts;
-- IDs and business fields/points are included in the digest, without exposing them.
SELECT 'campaigns' AS entity,md5(coalesce(string_agg(to_jsonb(c)::text,'' ORDER BY id),'')) AS digest FROM campaigns c
-- 001 memberships implicitly are active; normalize the additive 002 defaults.
UNION ALL SELECT 'participants',md5(coalesce(string_agg(jsonb_build_object('campaign_id',campaign_id,'profile_id',profile_id,'team_id',team_id,'active',coalesce((to_jsonb(p)->>'active')::boolean,true),'removed_at',to_jsonb(p)->'removed_at','removed_by',to_jsonb(p)->'removed_by')::text,'' ORDER BY campaign_id,profile_id),'')) FROM campaign_participants p
UNION ALL SELECT 'opportunities',md5(coalesce(string_agg(to_jsonb(o)::text,'' ORDER BY id),'')) FROM opportunities o
UNION ALL SELECT 'meetings',md5(coalesce(string_agg(to_jsonb(m)::text,'' ORDER BY id),'')) FROM meetings m
UNION ALL SELECT 'validations',md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),'')) FROM meeting_validations v
UNION ALL SELECT 'contracts',md5(coalesce(string_agg(to_jsonb(c)::text,'' ORDER BY id),'')) FROM contracts c
UNION ALL SELECT 'scores',md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM opportunity_scores s;
COMMIT;
