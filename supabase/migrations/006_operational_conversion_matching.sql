-- Explicitly reject ambiguous automatic linking. No existing data is changed.
BEGIN;
SET LOCAL lock_timeout='8s';
CREATE OR REPLACE FUNCTION public.ops_from_crm(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d crm_deals;l crm_leads;c contracts;cid uuid;result_id uuid;responsible uuid; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);
 SELECT company_id INTO cid FROM ops_contracts WHERE source_deal_id=(data->>'deal_id')::uuid;IF cid IS NOT NULL THEN RETURN cid; END IF;
 SELECT * INTO d FROM crm_deals WHERE id=(data->>'deal_id')::uuid;SELECT * INTO c FROM contracts WHERE id=d.contract_id;
 IF d.result IS DISTINCT FROM 'won' OR c.id IS NULL OR NOT c.active OR NOT EXISTS(SELECT 1 FROM meetings WHERE id=c.meeting_id AND status IN ('held','qualified')) THEN RAISE EXCEPTION 'Utilize um fechamento confirmado com contrato e reunião válidos'; END IF;
 SELECT * INTO l FROM crm_leads WHERE id=d.lead_id;cid:=nullif(data->>'company_id','')::uuid;
 IF cid IS NULL AND (SELECT count(*) FROM ops_clients WHERE phone=l.phone OR (l.email<>'' AND lower(email)=lower(l.email)))>1 THEN RAISE EXCEPTION 'Correspondências conflitantes de WhatsApp e email. Selecione o cliente existente explicitamente';END IF;
 IF cid IS NULL THEN SELECT company_id INTO cid FROM ops_clients WHERE phone=l.phone OR (l.email<>'' AND lower(email)=lower(l.email));END IF;
 IF cid IS NULL THEN SELECT id INTO cid FROM access_companies WHERE lower(trim(name))=lower(trim(l.company));END IF;
 IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM ops_clients WHERE company_id=cid) THEN
  cid:=ops_save_client(jsonb_build_object('company_id',cid,'name',coalesce((SELECT name FROM access_companies WHERE id=cid),l.company),'contact',l.contact,'phone',l.phone,'email',l.email,'niche',l.niche,'city',l.city,'state',l.state,'joined_at',c.closed_at,'relationship','onboarding','admin_notes','Originado de fechamento comercial confirmado'));
 END IF;
 responsible:=coalesce(nullif(data->>'responsible_id','')::uuid,l.sdr_id);
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=responsible AND active AND category='employee') THEN RAISE EXCEPTION 'Selecione um responsável interno ativo para importar o fechamento'; END IF;
 result_id:=ops_save_contract(jsonb_build_object('company_id',cid,'reference',c.reference,'starts_at',c.closed_at,'min_months',d.term_months,'amount',c.amount,'periodicity','monthly','services_text',d.services,'status','preparation','responsible_id',responsible));
 UPDATE ops_contracts SET source_deal_id=d.id,commercial_contract_id=c.id,source_reviewed_state='valid' WHERE id=result_id;
 UPDATE ops_contracts SET source_reviewed_revision=ops_source_revision(id) WHERE id=result_id;
 RETURN cid;
END $$;
COMMIT;
