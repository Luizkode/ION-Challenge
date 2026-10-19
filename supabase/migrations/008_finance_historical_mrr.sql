-- Do not infer past MRR from currently configured contract terms. No data changes.
BEGIN;
SET LOCAL lock_timeout='8s';
CREATE OR REPLACE FUNCTION public.fin_report(filters jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE f date:=(filters->>'from')::date;t date:=(filters->>'to')::date;cid uuid:=nullif(filters->>'company_id','')::uuid;cat uuid:=nullif(filters->>'category_id','')::uuid;result jsonb;BEGIN
 PERFORM require_admin();
 IF f IS NULL OR t IS NULL OR t<f OR t>f+interval '10 years' OR coalesce(filters->>'basis','due') NOT IN ('due','competence') THEN RAISE EXCEPTION 'Período inválido (máximo 10 anos)';END IF;
 IF (SELECT count(*) FROM fin_entries WHERE (cid IS NULL OR company_id=cid) AND (cat IS NULL OR category_id=cat) AND ((due_at BETWEEN f AND t) OR (competence BETWEEN f AND t) OR id IN(SELECT entry_id FROM fin_settlements WHERE paid_at BETWEEN f AND t)))>10000 THEN RAISE EXCEPTION 'Mais de 10.000 registros. Reduza o período ou filtre o cliente';END IF;
 WITH all_entries AS (SELECT l.*,c.name category,a.name company,p.name beneficiary FROM fin_ledger l JOIN fin_categories c ON c.id=l.category_id LEFT JOIN access_companies a ON a.id=l.company_id LEFT JOIN profiles p ON p.id=l.beneficiary_id WHERE (cid IS NULL OR l.company_id=cid) AND (cat IS NULL OR l.category_id=cat)),
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
 'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'paid',e.paid::text,'balance',e.balance::text) ORDER BY due_at,id),'[]') FROM chosen e),
 'cash',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text,'signed_amount',c.signed_amount::text) ORDER BY paid_at,id),'[]') FROM cash c),
 'daily',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',point_date,'income',income::text,'expense',expense::text,'expected_income',expected_income::text,'expected_expense',expected_expense::text) ORDER BY point_date),'[]') FROM daily),
 'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',category,'kind',kind,'amount',amount::text)),'[]') FROM (SELECT category,kind,sum(amount) amount FROM live WHERE competence BETWEEN f AND t GROUP BY category,kind) x),
 'delinquency',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',coalesce(company,'Receita avulsa'),'amount',amount::text)),'[]') FROM (SELECT company,sum(balance) amount FROM live WHERE kind='income' AND balance>0 AND due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date AND due_at BETWEEN f AND t GROUP BY company) x),
 'commissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('beneficiary',beneficiary,'amount',amount::text,'paid',paid::text,'balance',balance::text)),'[]') FROM (SELECT beneficiary,sum(amount) amount,sum(paid) paid,sum(balance) balance FROM live WHERE rule_id IS NOT NULL AND due_at BETWEEN f AND t GROUP BY beneficiary) x)
 ) INTO result;RETURN result;END $$;
COMMIT;
