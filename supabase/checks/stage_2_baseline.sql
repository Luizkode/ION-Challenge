-- Read-only. Run before AND after 003 in the verified staging project.
-- Save results privately and compare: these business records must not change.
BEGIN READ ONLY;
DO $$ BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.opportunity_scores') IS NULL THEN
    RAISE EXCEPTION '001 ausente: este check exige um banco com 001 e 002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_participants' AND column_name='removed_at') THEN
    RAISE EXCEPTION '002 ausente: aplique-a antes da 003';
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
UNION ALL SELECT 'participants',md5(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY campaign_id,profile_id),'')) FROM campaign_participants p
UNION ALL SELECT 'opportunities',md5(coalesce(string_agg(to_jsonb(o)::text,'' ORDER BY id),'')) FROM opportunities o
UNION ALL SELECT 'meetings',md5(coalesce(string_agg(to_jsonb(m)::text,'' ORDER BY id),'')) FROM meetings m
UNION ALL SELECT 'validations',md5(coalesce(string_agg(to_jsonb(v)::text,'' ORDER BY id),'')) FROM meeting_validations v
UNION ALL SELECT 'contracts',md5(coalesce(string_agg(to_jsonb(c)::text,'' ORDER BY id),'')) FROM contracts c
UNION ALL SELECT 'scores',md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM opportunity_scores s;
COMMIT;
