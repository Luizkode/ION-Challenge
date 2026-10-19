-- Phase 2: apply ONLY after the authenticated proxy download route is deployed.
-- Blocks minting new bearer signed URLs; downloads recheck current RLS on every request.
BEGIN;
SET LOCAL lock_timeout='8s';
DO $$ BEGIN IF to_regprocedure('storage.allow_any_operation(text[])') IS NULL THEN RAISE EXCEPTION 'Storage operation helpers are required';END IF;END $$;
ALTER POLICY ops_document_read ON storage.objects USING(bucket_id='ion-os-documents' AND public.ops_storage_read(name) AND storage.allow_any_operation(ARRAY['object.get_authenticated','object.get_authenticated_info']));
COMMIT;
