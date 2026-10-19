-- Preserve the CRM client and contract reference when no operational conversion exists.
BEGIN;
SET LOCAL lock_timeout='8s';
CREATE OR REPLACE FUNCTION public.fin_commissions(data jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r fin_rules;c contracts;o opportunities;m meetings;op ops_contracts;p record;n integer:=0;added integer;amt numeric;due date:=(data->>'due_at')::date;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);
 SELECT * INTO c FROM contracts WHERE id=(data->>'contract_id')::uuid FOR SHARE;
 SELECT * INTO o FROM opportunities WHERE id=c.opportunity_id;
 SELECT * INTO m FROM meetings WHERE id=c.meeting_id;
 SELECT * INTO op FROM ops_contracts WHERE commercial_contract_id=c.id;
 IF c.id IS NULL OR NOT c.active OR m.status NOT IN ('held','qualified') OR NOT EXISTS(SELECT 1 FROM crm_deals WHERE contract_id=c.id AND result='won') OR due IS NULL OR due<c.closed_at THEN RAISE EXCEPTION 'Exige fechamento CRM confirmado e contrato comercial válido';END IF;
 PERFORM set_config('ion.reason','Aprovação administrativa de comissões por fechamento CRM',true);
 FOR r IN SELECT * FROM fin_rules WHERE active AND starts_at<=c.closed_at AND (ends_at IS NULL OR ends_at>=c.closed_at) AND (nullif(data->>'rule_id','') IS NULL OR id=(data->>'rule_id')::uuid) LOOP
 FOR p IN SELECT id FROM profiles WHERE active AND category='employee' AND
 (r.profile_id=id OR r.function_code IS NOT NULL AND EXISTS(SELECT 1 FROM user_functions f WHERE f.profile_id=profiles.id AND f.function_code=r.function_code) AND CASE r.function_code WHEN 'sdr' THEN id=o.sdr_id WHEN 'closer' THEN id=m.closer_id ELSE EXISTS(SELECT 1 FROM client_assignments WHERE company_id=op.company_id AND profile_id=profiles.id) OR EXISTS(SELECT 1 FROM ops_service_assignments a JOIN ops_services s ON s.id=a.service_id WHERE s.company_id=op.company_id AND a.profile_id=profiles.id) END) LOOP
 amt:=CASE WHEN r.basis='fixed' THEN r.rate ELSE round(c.amount*r.rate/100,2) END;
 IF amt<=0 THEN CONTINUE;END IF;
 INSERT INTO fin_entries(kind,description,company_id,contract_id,category_id,amount,competence,due_at,expense_type,rule_id,beneficiary_id,commercial_contract_id,rule_snapshot,created_by) VALUES('expense','Comissão · '||r.name,op.company_id,op.id,(SELECT id FROM fin_categories WHERE name='Comissões'),amt,c.closed_at,due,'variable',r.id,p.id,c.id,to_jsonb(r)||jsonb_build_object('contract_amount',c.amount::text,'source_company',(SELECT l.company FROM crm_deals d JOIN crm_leads l ON l.id=d.lead_id WHERE d.contract_id=c.id AND d.result='won' LIMIT 1),'source_reference',c.reference),auth.uid()) ON CONFLICT(commercial_contract_id,beneficiary_id,rule_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;n:=n+added;
 END LOOP;END LOOP;RETURN n;END $$;
CREATE OR REPLACE FUNCTION public.fin_report(filters jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE f date:=(filters->>'from')::date;t date:=(filters->>'to')::date;cid uuid:=nullif(filters->>'company_id','')::uuid;cat uuid:=nullif(filters->>'category_id','')::uuid;result jsonb;BEGIN
 PERFORM require_admin();
 IF f IS NULL OR t IS NULL OR t<f OR t>f+interval '10 years' OR coalesce(filters->>'basis','due') NOT IN ('due','competence') THEN RAISE EXCEPTION 'Período inválido (máximo 10 anos)';END IF;
 IF (SELECT count(*) FROM fin_entries WHERE (cid IS NULL OR company_id=cid) AND (cat IS NULL OR category_id=cat) AND ((due_at BETWEEN f AND t) OR (competence BETWEEN f AND t) OR id IN(SELECT entry_id FROM fin_settlements WHERE paid_at BETWEEN f AND t)))>10000 THEN RAISE EXCEPTION 'Mais de 10.000 registros. Reduza o período ou filtre o cliente';END IF;
 WITH all_entries AS (SELECT l.*,c.name category,coalesce(a.name,l.rule_snapshot->>'source_company') company,p.name beneficiary FROM fin_ledger l JOIN fin_categories c ON c.id=l.category_id LEFT JOIN access_companies a ON a.id=l.company_id LEFT JOIN profiles p ON p.id=l.beneficiary_id WHERE (cid IS NULL OR l.company_id=cid) AND (cat IS NULL OR l.category_id=cat)),
 live AS (SELECT * FROM all_entries WHERE state<>'cancelled'),
 cash AS (SELECT s.*,CASE WHEN s.reversal_of IS NULL THEN s.amount ELSE -s.amount END signed_amount,l.kind,l.company_id,l.category_id,l.description,l.rule_id FROM fin_settlements s JOIN all_entries l ON l.id=s.entry_id WHERE s.paid_at BETWEEN f AND t),
 chosen AS (SELECT * FROM all_entries WHERE (CASE WHEN filters->>'basis'='competence' THEN competence ELSE due_at END) BETWEEN f AND t AND (coalesce(filters->>'kind','')='' OR kind=filters->>'kind') AND (coalesce(filters->>'status','')='' OR status=filters->>'status' OR filters->>'status'='overdue' AND state<>'cancelled' AND balance>0 AND due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date)),
 stats AS (SELECT
 coalesce((SELECT sum(signed_amount) FROM cash WHERE kind='income'),0) received,
 coalesce((SELECT sum(signed_amount) FROM cash WHERE kind='expense'),0) spent,
 coalesce((SELECT sum(signed_amount) FROM cash WHERE rule_id IS NOT NULL),0) commission_paid,
 coalesce(sum(amount) FILTER(WHERE kind='income' AND due_at BETWEEN f AND t),0) income_due,
 coalesce(sum(amount) FILTER(WHERE kind='expense' AND due_at BETWEEN f AND t),0) expense_due,
 coalesce(sum(balance) FILTER(WHERE kind='income' AND due_at BETWEEN f AND t),0) receivable,
 coalesce(sum(balance) FILTER(WHERE kind='expense' AND due_at BETWEEN f AND t),0) payable,
 coalesce(sum(balance) FILTER(WHERE rule_id IS NOT NULL AND due_at BETWEEN f AND t),0) commission_pending,
 coalesce(sum(balance) FILTER(WHERE kind='income' AND due_at BETWEEN f AND t AND due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date),0) overdue,
 coalesce(sum(CASE WHEN kind='income' THEN amount ELSE -amount END) FILTER(WHERE competence BETWEEN f AND t),0) operating,
 coalesce((SELECT sum(s.amount/s.months) FROM fin_schedules s JOIN ops_contracts c ON c.id=s.contract_id WHERE s.kind='income' AND s.active AND c.status='active' AND s.starts_at<=t AND c.starts_at<=t AND (s.ends_at IS NULL OR s.ends_at>=t) AND (c.ends_at IS NULL OR c.ends_at>=t) AND (cid IS NULL OR s.company_id=cid) AND (cat IS NULL OR s.category_id=cat)),0) mrr FROM live),
 dates AS (SELECT d::date AS point_date FROM generate_series(f::timestamp,t::timestamp,interval '1 day') d),
 daily AS (SELECT point_date,coalesce((SELECT sum(signed_amount) FROM cash WHERE paid_at=point_date AND kind='income'),0) income,coalesce((SELECT sum(signed_amount) FROM cash WHERE paid_at=point_date AND kind='expense'),0) expense,coalesce((SELECT sum(balance) FROM live WHERE due_at=point_date AND kind='income'),0) expected_income,coalesce((SELECT sum(balance) FROM live WHERE due_at=point_date AND kind='expense'),0) expected_expense FROM dates)
 SELECT jsonb_build_object(
 'stats',(SELECT jsonb_build_object('received',received::text,'spent',spent::text,'commission_paid',commission_paid::text,'income_due',income_due::text,'expense_due',expense_due::text,'receivable',receivable::text,'payable',payable::text,'commission_pending',commission_pending::text,'overdue',overdue::text,'operating',operating::text,'cash_net',(received-spent)::text,'mrr',CASE WHEN t<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN NULL ELSE round(mrr,2)::text END) FROM stats),
 'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'paid',e.paid::text,'balance',e.balance::text,'commercial_reference',e.rule_snapshot->>'source_reference') ORDER BY due_at,id),'[]') FROM chosen e),
 'cash',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text,'signed_amount',c.signed_amount::text) ORDER BY paid_at,id),'[]') FROM cash c),
 'daily',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',point_date,'income',income::text,'expense',expense::text,'expected_income',expected_income::text,'expected_expense',expected_expense::text) ORDER BY point_date),'[]') FROM daily),
 'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',category,'kind',kind,'amount',amount::text)),'[]') FROM (SELECT category,kind,sum(amount) amount FROM live WHERE competence BETWEEN f AND t GROUP BY category,kind) x),
 'delinquency',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',coalesce(company,'Receita avulsa'),'amount',amount::text)),'[]') FROM (SELECT company,sum(balance) amount FROM live WHERE kind='income' AND balance>0 AND due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date AND due_at BETWEEN f AND t GROUP BY company) x),
 'commissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('beneficiary',beneficiary,'amount',amount::text,'paid',paid::text,'balance',balance::text)),'[]') FROM (SELECT beneficiary,sum(amount) amount,sum(paid) paid,sum(balance) balance FROM live WHERE rule_id IS NOT NULL AND due_at BETWEEN f AND t GROUP BY beneficiary) x)
 ) INTO result;RETURN result;END $$;
CREATE OR REPLACE FUNCTION public.fin_detail(eid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE e fin_ledger;BEGIN
 PERFORM require_admin();SELECT * INTO e FROM fin_ledger WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado';END IF;
 RETURN jsonb_build_object('entry',to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'paid',e.paid::text,'balance',e.balance::text,'company',coalesce((SELECT name FROM access_companies WHERE id=e.company_id),e.rule_snapshot->>'source_company'),'commercial_reference',e.rule_snapshot->>'source_reference'),
 'settlements',(SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('amount',s.amount::text) ORDER BY created_at),'[]') FROM fin_settlements s WHERE entry_id=eid),
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',a.created_at,'actor',p.name,'action',a.action,'reason',a.reason,'before',a.old_state::text,'after',a.new_state::text) ORDER BY a.id DESC),'[]') FROM audit_logs a LEFT JOIN profiles p ON p.id=a.actor_id WHERE (a.entity='fin_entries' AND a.entity_id=eid::text) OR (a.entity='fin_settlements' AND a.new_state->>'entry_id'=eid::text))
 );END $$;
COMMIT;
