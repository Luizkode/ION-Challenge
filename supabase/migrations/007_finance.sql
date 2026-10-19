-- ION Finance: additive ledger, immutable settlements, explicit administrative generation.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(70013);
CREATE TABLE public.fin_categories(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 2 AND 120),kind text NOT NULL CHECK(kind IN ('income','expense','both')));
INSERT INTO fin_categories(name,kind) VALUES ('Serviços e mensalidades','income'),('Outras receitas','income'),('Softwares e ferramentas','expense'),('Hospedagem e infraestrutura','expense'),('Equipe e prestadores','expense'),('Comissões','expense'),('Marketing','expense'),('Impostos e taxas','expense'),('Equipamentos','expense'),('Despesas administrativas','expense'),('Outras despesas','expense');
CREATE TABLE public.fin_schedules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('income','expense')),contract_id uuid UNIQUE REFERENCES ops_contracts(id),company_id uuid REFERENCES ops_clients(company_id),category_id uuid NOT NULL REFERENCES fin_categories(id),description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 250),amount numeric(14,2) NOT NULL CHECK(amount>0),starts_at date NOT NULL,ends_at date,due_day integer NOT NULL CHECK(due_day BETWEEN 1 AND 31),months integer NOT NULL CHECK(months IN (1,3,12)),active boolean NOT NULL DEFAULT true,notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at IS NULL OR ends_at>=starts_at),CHECK(contract_id IS NULL OR kind='income'));
CREATE TABLE public.fin_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 120),profile_id uuid REFERENCES profiles(id),function_code text CHECK(function_code IN ('sdr','closer','traffic','designer','video_editor','copywriter')),basis text NOT NULL CHECK(basis IN ('fixed','percent')),rate numeric(14,2) NOT NULL CHECK(rate>0 AND (basis<>'percent' OR rate<=100)),starts_at date NOT NULL,ends_at date,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK((profile_id IS NOT NULL) <> (function_code IS NOT NULL)),CHECK(ends_at IS NULL OR ends_at>=starts_at));
CREATE TABLE public.fin_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),kind text NOT NULL CHECK(kind IN ('income','expense')),description text NOT NULL CHECK(length(trim(description)) BETWEEN 3 AND 250),company_id uuid REFERENCES ops_clients(company_id),contract_id uuid REFERENCES ops_contracts(id),category_id uuid NOT NULL REFERENCES fin_categories(id),amount numeric(14,2) NOT NULL CHECK(amount>0),competence date NOT NULL,due_at date NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('planned','pending','cancelled')),expense_type text NOT NULL DEFAULT 'one_off' CHECK(expense_type IN ('fixed','variable','recurring','one_off')),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),schedule_id uuid REFERENCES fin_schedules(id),cycle date,rule_id uuid REFERENCES fin_rules(id),beneficiary_id uuid REFERENCES profiles(id),commercial_contract_id uuid REFERENCES contracts(id),rule_snapshot jsonb,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,cycle),UNIQUE(commercial_contract_id,beneficiary_id,rule_id),CHECK((schedule_id IS NULL)=(cycle IS NULL)),CHECK((rule_id IS NULL AND beneficiary_id IS NULL AND commercial_contract_id IS NULL) OR (rule_id IS NOT NULL AND beneficiary_id IS NOT NULL AND commercial_contract_id IS NOT NULL AND kind='expense')));
CREATE TABLE public.fin_settlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entry_id uuid NOT NULL REFERENCES fin_entries(id),amount numeric(14,2) NOT NULL CHECK(amount>0),paid_at date NOT NULL,method text NOT NULL CHECK(length(trim(method)) BETWEEN 2 AND 80),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),reversal_of uuid UNIQUE REFERENCES fin_settlements(id),request_id uuid NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX fin_due ON fin_entries(due_at,kind) WHERE state<>'cancelled';
CREATE INDEX fin_competence ON fin_entries(competence);
CREATE INDEX fin_paid ON fin_settlements(paid_at,entry_id);
CREATE INDEX fin_company ON fin_entries(company_id,contract_id);
CREATE FUNCTION public.fin_balance(eid uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(sum(CASE WHEN reversal_of IS NULL THEN amount ELSE -amount END),0) FROM fin_settlements WHERE entry_id=eid AND actor_role()='admin' $$;
CREATE VIEW public.fin_ledger WITH (security_invoker=true) AS
 SELECT e.*,fin_balance(e.id) paid,e.amount-fin_balance(e.id) balance,
 CASE WHEN state='cancelled' THEN 'cancelled' WHEN fin_balance(e.id)>=e.amount THEN CASE WHEN kind='income' THEN 'received' ELSE 'paid' END WHEN fin_balance(e.id)>0 THEN 'partial' WHEN due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue' ELSE state END status
 FROM fin_entries e;
CREATE FUNCTION public.fin_validate_link(cid uuid,contract uuid,cat uuid,k text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM fin_categories WHERE id=cat AND kind IN (k,'both')) THEN RAISE EXCEPTION 'Categoria incompatível'; END IF;
 IF contract IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ops_contracts WHERE id=contract AND company_id=cid) THEN RAISE EXCEPTION 'Contrato não pertence ao cliente';END IF;
 END $$;
CREATE FUNCTION public.fin_save_entry(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eid uuid:=nullif(data->>'id','')::uuid; old fin_entries; cid uuid:=nullif(data->>'company_id','')::uuid; contract uuid:=nullif(data->>'contract_id','')::uuid;cat uuid:=(data->>'category_id')::uuid; k text:=data->>'kind';v numeric:=(data->>'amount')::numeric; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);PERFORM set_config('ion.reason',coalesce(nullif(trim(data->>'reason'),''),'Cadastro financeiro'),true);
 IF v IS NULL OR v<>round(v,2) OR v<=0 THEN RAISE EXCEPTION 'Valor deve ser positivo, com até duas casas decimais';END IF;
 PERFORM fin_validate_link(cid,contract,cat,k);
 IF eid IS NULL THEN
 IF nullif(data->>'request_id','') IS NULL THEN RAISE EXCEPTION 'Identificador de criação ausente. Recarregue';END IF;
 SELECT * INTO old FROM fin_entries WHERE request_id=(data->>'request_id')::uuid;
 IF FOUND THEN
 IF old.amount IS DISTINCT FROM v OR old.kind IS DISTINCT FROM k OR old.company_id IS DISTINCT FROM cid OR old.contract_id IS DISTINCT FROM contract OR old.description IS DISTINCT FROM trim(data->>'description') OR old.category_id IS DISTINCT FROM cat OR old.competence IS DISTINCT FROM (data->>'competence')::date OR old.due_at IS DISTINCT FROM (data->>'due_at')::date THEN RAISE EXCEPTION 'Identificador reutilizado com outros dados';END IF;
 RETURN old.id;END IF;
 INSERT INTO fin_entries(request_id,kind,description,company_id,contract_id,category_id,amount,competence,due_at,state,expense_type,notes,created_by) VALUES((data->>'request_id')::uuid,k,trim(data->>'description'),cid,contract,cat,v,(data->>'competence')::date,(data->>'due_at')::date,coalesce(data->>'state','pending'),coalesce(data->>'expense_type','one_off'),coalesce(data->>'notes',''),auth.uid()) RETURNING id INTO eid;
 ELSE
 SELECT * INTO old FROM fin_entries WHERE id=eid FOR UPDATE;
 IF old.id IS NULL OR old.version<>(data->>'version')::int OR data->>'version' IS NULL THEN RAISE EXCEPTION 'Registro alterado ou inexistente. Recarregue';END IF;
 IF length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Informe o motivo da alteração';END IF;
 IF old.kind<>k OR old.company_id IS DISTINCT FROM cid OR old.contract_id IS DISTINCT FROM contract THEN RAISE EXCEPTION 'Origem e tipo do lançamento são imutáveis';END IF;
 IF old.state='cancelled' THEN RAISE EXCEPTION 'Lançamento cancelado não pode ser editado';END IF;
 IF v<fin_balance(eid) THEN RAISE EXCEPTION 'Valor inferior ao já liquidado. Estorne antes de reduzir';END IF;
 IF data->>'state'='cancelled' AND fin_balance(eid)<>0 THEN RAISE EXCEPTION 'Estorne as liquidações antes de cancelar';END IF;
 IF old.rule_id IS NOT NULL AND cat<>old.category_id THEN RAISE EXCEPTION 'Categoria de comissão é fixa';END IF;
 UPDATE fin_entries SET description=trim(data->>'description'),category_id=cat,amount=v,competence=(data->>'competence')::date,due_at=(data->>'due_at')::date,state=data->>'state',expense_type=data->>'expense_type',notes=coalesce(data->>'notes',''),version=version+1 WHERE id=eid;
 END IF;RETURN eid;END $$;
CREATE FUNCTION public.fin_settle(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e fin_entries;s fin_settlements;rid uuid:=(data->>'request_id')::uuid;eid uuid:=(data->>'entry_id')::uuid;sid uuid;v numeric:=(data->>'amount')::numeric; rev uuid:=nullif(data->>'reversal_of','')::uuid;paydate date:=(data->>'paid_at')::date; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);
 SELECT * INTO s FROM fin_settlements WHERE request_id=rid;
 IF FOUND THEN
 IF s.entry_id<>eid OR s.reversal_of IS DISTINCT FROM rev OR s.amount<>v OR s.paid_at<>paydate OR s.method<>trim(data->>'method') THEN RAISE EXCEPTION 'Identificador de pagamento reutilizado com outros dados';END IF; RETURN s.id;END IF;
 SELECT * INTO e FROM fin_entries WHERE id=eid FOR UPDATE;
 IF e.id IS NULL OR e.state='cancelled' THEN RAISE EXCEPTION 'Lançamento inexistente ou cancelado';END IF;
 IF v IS NULL OR v<=0 OR v<>round(v,2) OR paydate IS NULL OR paydate>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Revise o valor e a data da liquidação';END IF;
 IF rev IS NOT NULL THEN
 SELECT * INTO s FROM fin_settlements WHERE id=rev AND entry_id=eid AND reversal_of IS NULL FOR UPDATE;
 IF s.id IS NULL OR EXISTS(SELECT 1 FROM fin_settlements WHERE reversal_of=rev) OR s.amount<>v OR paydate<s.paid_at OR length(trim(coalesce(data->>'notes','')))<3 THEN RAISE EXCEPTION 'Estorno integral exige liquidação válida, data e justificativa';END IF;
 ELSE IF v>e.amount-fin_balance(eid) THEN RAISE EXCEPTION 'Valor excede o saldo restante';END IF;END IF;
 PERFORM set_config('ion.reason',coalesce(nullif(data->>'notes',''),'Liquidação financeira'),true);
 INSERT INTO fin_settlements(entry_id,amount,paid_at,method,notes,reversal_of,request_id,created_by) VALUES(eid,v,paydate,trim(data->>'method'),coalesce(data->>'notes',''),rev,rid,auth.uid()) RETURNING id INTO sid;
 UPDATE fin_entries SET version=version+1 WHERE id=eid;RETURN sid;END $$;
CREATE FUNCTION public.fin_save_schedule(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE sid uuid:=nullif(data->>'id','')::uuid;old fin_schedules;ct ops_contracts; cid uuid:=nullif(data->>'company_id','')::uuid;contract uuid:=nullif(data->>'contract_id','')::uuid;cat uuid:=(data->>'category_id')::uuid;v numeric:=(data->>'amount')::numeric; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);
 PERFORM fin_validate_link(cid,contract,cat,data->>'kind');
 IF v IS NULL OR v<=0 OR v<>round(v,2) THEN RAISE EXCEPTION 'Valor inválido';END IF;
 IF data->>'kind'='income' AND contract IS NULL THEN RAISE EXCEPTION 'Mensalidade exige contrato operacional';END IF;
 IF contract IS NOT NULL THEN
 SELECT * INTO ct FROM ops_contracts WHERE id=contract FOR SHARE;
 IF (data->>'starts_at')::date<ct.starts_at OR ct.ends_at IS NOT NULL AND (nullif(data->>'ends_at','') IS NULL OR (data->>'ends_at')::date>ct.ends_at) THEN RAISE EXCEPTION 'Vigência deve respeitar o contrato';END IF;END IF;
 PERFORM set_config('ion.reason',coalesce(data->>'reason','Configuração de recorrência'),true);
 IF sid IS NULL THEN
 INSERT INTO fin_schedules(kind,contract_id,company_id,category_id,description,amount,starts_at,ends_at,due_day,months,active,notes,created_by) VALUES(data->>'kind',contract,cid,cat,trim(data->>'description'),v,(data->>'starts_at')::date,nullif(data->>'ends_at','')::date,(data->>'due_day')::int,(data->>'months')::int,coalesce((data->>'active')::boolean,true),coalesce(data->>'notes',''),auth.uid()) RETURNING id INTO sid;
 ELSE
 SELECT * INTO old FROM fin_schedules WHERE id=sid FOR UPDATE;
 IF old.id IS NULL OR data->>'version' IS NULL OR old.version<>(data->>'version')::int THEN RAISE EXCEPTION 'Recorrência alterada. Recarregue';END IF;
 IF old.contract_id IS DISTINCT FROM contract OR old.company_id IS DISTINCT FROM cid OR old.kind<>data->>'kind' OR old.starts_at<>(data->>'starts_at')::date OR old.months<>(data->>'months')::int THEN RAISE EXCEPTION 'Origem, início e periodicidade são imutáveis. Pause e crie outra recorrência';END IF;
 IF length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Informe o motivo da alteração';END IF;
 UPDATE fin_schedules SET category_id=cat,description=trim(data->>'description'),amount=v,ends_at=nullif(data->>'ends_at','')::date,due_day=(data->>'due_day')::int,active=(data->>'active')::boolean,notes=coalesce(data->>'notes',''),version=version+1 WHERE id=sid;
 END IF;RETURN sid;END $$;
CREATE FUNCTION public.fin_generate(data jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s fin_schedules;ct ops_contracts;first_month date:=(data->>'from')::date;last_month date:=(data->>'to')::date;cycle_value date;due date;n integer:=0;added integer; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);
 IF first_month IS NULL OR last_month IS NULL OR last_month<first_month OR last_month>first_month+interval '12 months' THEN RAISE EXCEPTION 'Escolha um intervalo de até 12 meses';END IF;
 SELECT * INTO s FROM fin_schedules WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF s.id IS NULL OR NOT s.active THEN RAISE EXCEPTION 'Recorrência inexistente ou pausada';END IF;
 IF s.contract_id IS NOT NULL THEN
 SELECT * INTO ct FROM ops_contracts WHERE id=s.contract_id FOR SHARE;
 IF ct.status<>'active' THEN RAISE EXCEPTION 'Contrato não está ativo';END IF;
 END IF;
 PERFORM set_config('ion.reason','Geração explícita de recorrência',true);
 FOR cycle_value IN SELECT d::date FROM generate_series(date_trunc('month',first_month),date_trunc('month',last_month),interval '1 month') d LOOP
 IF mod((extract(year FROM cycle_value)::int-extract(year FROM s.starts_at)::int)*12+extract(month FROM cycle_value)::int-extract(month FROM s.starts_at)::int,s.months)<>0 THEN CONTINUE;END IF;
 due:=cycle_value+(least(s.due_day,extract(day FROM cycle_value+interval '1 month - 1 day')::int)-1);
 IF due<s.starts_at OR due<first_month OR due>last_month OR s.ends_at IS NOT NULL AND due>s.ends_at OR ct.id IS NOT NULL AND (due<ct.starts_at OR ct.ends_at IS NOT NULL AND due>ct.ends_at) THEN CONTINUE;END IF;
 INSERT INTO fin_entries(kind,description,company_id,contract_id,category_id,amount,competence,due_at,state,expense_type,schedule_id,cycle,notes,created_by) VALUES(s.kind,s.description,s.company_id,s.contract_id,s.category_id,s.amount,cycle_value,due,'planned','recurring',s.id,cycle_value,s.notes,auth.uid()) ON CONFLICT(schedule_id,cycle) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;n:=n+added;
 END LOOP;RETURN n;END $$;
CREATE FUNCTION public.fin_save_rule(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid:=nullif(data->>'id','')::uuid;old fin_rules;pid uuid:=nullif(data->>'profile_id','')::uuid;fc text:=nullif(data->>'function_code','');v numeric:=(data->>'rate')::numeric;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70015);
 IF pid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=pid AND active AND category='employee') THEN RAISE EXCEPTION 'Colaborador deve estar ativo';END IF;
 IF v IS NULL OR v<>round(v,2) THEN RAISE EXCEPTION 'Valor inválido';END IF;
 PERFORM set_config('ion.reason',coalesce(data->>'reason','Configuração de comissão'),true);
 IF rid IS NULL THEN INSERT INTO fin_rules(name,profile_id,function_code,basis,rate,starts_at,ends_at,active,created_by) VALUES(trim(data->>'name'),pid,fc,data->>'basis',v,(data->>'starts_at')::date,nullif(data->>'ends_at','')::date,coalesce((data->>'active')::boolean,true),auth.uid()) RETURNING id INTO rid;
 ELSE
 SELECT * INTO old FROM fin_rules WHERE id=rid FOR UPDATE;
 IF old.id IS NULL OR data->>'version' IS NULL OR old.version<>(data->>'version')::int OR length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Recarregue a regra e informe motivo';END IF;
 IF old.profile_id IS DISTINCT FROM pid OR old.function_code IS DISTINCT FROM fc THEN RAISE EXCEPTION 'Beneficiário da regra é imutável';END IF;
 UPDATE fin_rules SET name=trim(data->>'name'),basis=data->>'basis',rate=v,starts_at=(data->>'starts_at')::date,ends_at=nullif(data->>'ends_at','')::date,active=(data->>'active')::boolean,version=version+1 WHERE id=rid;
 END IF;RETURN rid;END $$;
-- An earned commission is one expense entry, never a second parallel expense.
CREATE FUNCTION public.fin_commissions(data jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
 INSERT INTO fin_entries(kind,description,company_id,contract_id,category_id,amount,competence,due_at,expense_type,rule_id,beneficiary_id,commercial_contract_id,rule_snapshot,created_by) VALUES('expense','Comissão · '||r.name,op.company_id,op.id,(SELECT id FROM fin_categories WHERE name='Comissões'),amt,c.closed_at,due,'variable',r.id,p.id,c.id,to_jsonb(r)||jsonb_build_object('contract_amount',c.amount::text),auth.uid()) ON CONFLICT(commercial_contract_id,beneficiary_id,rule_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;n:=n+added;
 END LOOP;END LOOP;RETURN n;END $$;
-- Every function uses the user's session; no service credential in application financial flows.
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['fin_categories','fin_schedules','fin_rules','fin_entries','fin_settlements'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE POLICY finance_admin ON public.%I FOR SELECT TO authenticated USING(actor_role()=''admin'')',t);
 EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',t,t);
 END LOOP;END $$;
REVOKE ALL ON public.fin_ledger FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.fin_ledger TO authenticated;
CREATE FUNCTION public.fin_options() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();RETURN jsonb_build_object(
 'categories',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY name),'[]') FROM fin_categories c),
 'companies',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.company_id,'name',a.name) ORDER BY a.name),'[]') FROM ops_clients c JOIN access_companies a ON a.id=c.company_id),
 'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text,'company',a.name) ORDER BY c.created_at DESC),'[]') FROM ops_contracts c JOIN access_companies a ON a.id=c.company_id),
 'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM profiles WHERE category='employee' AND active),
 'schedules',(SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('amount',s.amount::text) ORDER BY created_at DESC),'[]') FROM fin_schedules s),
 'rules',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('rate',r.rate::text) ORDER BY created_at DESC),'[]') FROM fin_rules r),
 'closures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'reference',c.reference,'amount',c.amount::text,'company',l.company) ORDER BY c.closed_at DESC),'[]') FROM contracts c JOIN crm_deals d ON d.contract_id=c.id AND d.result='won' JOIN crm_leads l ON l.id=d.lead_id WHERE c.active)
 );END $$;
CREATE FUNCTION public.fin_detail(eid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE e fin_ledger;BEGIN
 PERFORM require_admin();SELECT * INTO e FROM fin_ledger WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado';END IF;
 RETURN jsonb_build_object('entry',to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'paid',e.paid::text,'balance',e.balance::text),
 'settlements',(SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('amount',s.amount::text) ORDER BY created_at),'[]') FROM fin_settlements s WHERE entry_id=eid),
 'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('at',a.created_at,'actor',p.name,'action',a.action,'reason',a.reason,'before',a.old_state::text,'after',a.new_state::text) ORDER BY a.id DESC),'[]') FROM audit_logs a LEFT JOIN profiles p ON p.id=a.actor_id WHERE (a.entity='fin_entries' AND a.entity_id=eid::text) OR (a.entity='fin_settlements' AND a.new_state->>'entry_id'=eid::text))
 );END $$;
CREATE FUNCTION public.fin_report(filters jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
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
 'stats',(SELECT jsonb_build_object('received',received::text,'spent',spent::text,'commission_paid',commission_paid::text,'income_due',income_due::text,'expense_due',expense_due::text,'receivable',receivable::text,'payable',payable::text,'commission_pending',commission_pending::text,'overdue',overdue::text,'operating',operating::text,'cash_net',(received-spent)::text,'mrr',round(mrr,2)::text) FROM stats),
 'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('amount',e.amount::text,'paid',e.paid::text,'balance',e.balance::text) ORDER BY due_at,id),'[]') FROM chosen e),
 'cash',(SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('amount',c.amount::text,'signed_amount',c.signed_amount::text) ORDER BY paid_at,id),'[]') FROM cash c),
 'daily',(SELECT coalesce(jsonb_agg(jsonb_build_object('day',point_date,'income',income::text,'expense',expense::text,'expected_income',expected_income::text,'expected_expense',expected_expense::text) ORDER BY point_date),'[]') FROM daily),
 'categories',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',category,'kind',kind,'amount',amount::text)),'[]') FROM (SELECT category,kind,sum(amount) amount FROM live WHERE competence BETWEEN f AND t GROUP BY category,kind) x),
 'delinquency',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',coalesce(company,'Receita avulsa'),'amount',amount::text)),'[]') FROM (SELECT company,sum(balance) amount FROM live WHERE kind='income' AND balance>0 AND due_at<(now() AT TIME ZONE 'America/Sao_Paulo')::date AND due_at BETWEEN f AND t GROUP BY company) x),
 'commissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('beneficiary',beneficiary,'amount',amount::text,'paid',paid::text,'balance',balance::text)),'[]') FROM (SELECT beneficiary,sum(amount) amount,sum(paid) paid,sum(balance) balance FROM live WHERE rule_id IS NOT NULL AND due_at BETWEEN f AND t GROUP BY beneficiary) x)
 ) INTO result;RETURN result;END $$;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'fin\_%' ESCAPE '\' LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;END $$;
REVOKE EXECUTE ON FUNCTION public.fin_validate_link(uuid,uuid,uuid,text) FROM authenticated;
COMMIT;
