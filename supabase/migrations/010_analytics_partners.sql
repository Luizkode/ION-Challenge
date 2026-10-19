-- Analytics and consultative Partners. Apply after 009 with verified recovery.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(70013);
CREATE TABLE public.ana_grants(company_id uuid REFERENCES ops_clients(company_id),profile_id uuid REFERENCES profiles(id),can_write boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,PRIMARY KEY(company_id,profile_id));
CREATE TABLE public.ana_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),platform text NOT NULL CHECK(platform IN ('meta','google','other')),name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 150),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 2 AND 150),currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),time_zone text NOT NULL,attribution text NOT NULL CHECK(length(trim(attribution)) BETWEEN 3 AND 200),active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,UNIQUE(id,company_id),UNIQUE(company_id,platform,reference));
CREATE TABLE public.ana_campaigns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),account_id uuid NOT NULL,contract_id uuid,name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 200),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 2 AND 150),active boolean NOT NULL DEFAULT true,published boolean NOT NULL DEFAULT false,published_metrics text[] NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,company_id),UNIQUE(account_id,reference),FOREIGN KEY(account_id,company_id) REFERENCES ana_accounts(id,company_id),FOREIGN KEY(contract_id,company_id) REFERENCES ops_contracts(id,company_id));
CREATE TABLE public.ana_metrics(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES ana_campaigns(id),period_from date NOT NULL,period_to date NOT NULL,spend numeric(18,2),reach bigint,impressions bigint,clicks bigint,leads bigint,conversions numeric(20,6),acquisitions bigint,revenue numeric(18,2),acquisition_evidence text NOT NULL DEFAULT '' CHECK(length(acquisition_evidence)<=2000),source_kind text NOT NULL CHECK(source_kind IN ('manual','csv','meta_api','google_api')),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 2000),revenue_evidence text NOT NULL DEFAULT '' CHECK(length(revenue_evidence)<=2000),published boolean NOT NULL DEFAULT false,voided boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES profiles(id),updated_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(campaign_id,period_from,period_to),CHECK(period_to>=period_from),CHECK(period_to-period_from<=366),CHECK(spend>=0 AND reach>=0 AND impressions>=0 AND clicks>=0 AND leads>=0 AND conversions>=0 AND acquisitions>=0 AND revenue>=0),CHECK(revenue IS NULL OR length(trim(revenue_evidence))>=3),CHECK(acquisitions IS NULL OR length(trim(acquisition_evidence))>=3),CHECK(num_nonnulls(spend,reach,impressions,clicks,leads,conversions,acquisitions,revenue)>0));
CREATE TABLE public.ana_reports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 200),period_from date NOT NULL,period_to date NOT NULL,internal_snapshot jsonb NOT NULL,public_snapshot jsonb,published boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES profiles(id),created_at timestamptz NOT NULL DEFAULT now(),CHECK(period_to>=period_from),CHECK(NOT published OR public_snapshot IS NOT NULL));
CREATE INDEX ana_metric_period ON ana_metrics(campaign_id,period_from,period_to);
CREATE INDEX ana_report_client ON ana_reports(company_id,created_at DESC);
CREATE INDEX ana_report_snapshot ON ana_reports USING gin(internal_snapshot jsonb_path_ops);
CREATE FUNCTION public.ana_assigned(pid uuid,cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=pid AND category='employee' AND active) AND (EXISTS(SELECT 1 FROM client_assignments WHERE profile_id=pid AND company_id=cid) OR EXISTS(SELECT 1 FROM ops_contracts WHERE company_id=cid AND responsible_id=pid) OR EXISTS(SELECT 1 FROM ops_services s JOIN ops_service_assignments a ON a.service_id=s.id WHERE s.company_id=cid AND a.profile_id=pid)) $$;
CREATE FUNCTION public.ana_client_access(cid uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR ana_assigned(auth.uid(),cid) AND (has_function('traffic') OR EXISTS(SELECT 1 FROM ana_grants WHERE company_id=cid AND profile_id=auth.uid() AND active AND (NOT writing OR can_write))) $$;
CREATE FUNCTION public.ana_any_access() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR has_function('traffic') OR EXISTS(SELECT 1 FROM ana_grants WHERE profile_id=auth.uid() AND active AND ana_assigned(auth.uid(),company_id)) $$;
CREATE FUNCTION public.ana_require(cid uuid,writing boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT ana_client_access(cid,writing) THEN RAISE EXCEPTION 'Sem permissão de Analytics para este cliente';END IF;END $$;
CREATE FUNCTION public.ana_metric_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT ARRAY['spend','reach','impressions','frequency','clicks','ctr','cpc','cpm','leads','cpl','conversions','acquisitions','cpa','revenue','roas'] $$;
CREATE FUNCTION public.ana_validate_publication(keys text[]) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ DECLARE key text;deps text[];BEGIN
 IF NOT keys<@ana_metric_keys() THEN RAISE EXCEPTION 'Indicador de publicação inválido';END IF;
 FOREACH key IN ARRAY keys LOOP
 deps:=CASE key WHEN 'frequency' THEN ARRAY['impressions','reach'] WHEN 'ctr' THEN ARRAY['clicks','impressions'] WHEN 'cpc' THEN ARRAY['spend','clicks'] WHEN 'cpm' THEN ARRAY['spend','impressions'] WHEN 'cpl' THEN ARRAY['spend','leads'] WHEN 'cpa' THEN ARRAY['spend','acquisitions'] WHEN 'roas' THEN ARRAY['revenue','spend'] ELSE ARRAY[]::text[] END;
 IF NOT deps<@keys THEN RAISE EXCEPTION 'Para publicar %, autorize também suas medidas de origem: %',key,array_to_string(deps,', ');END IF;
 END LOOP;END $$;
CREATE FUNCTION public.ana_save_grant(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF coalesce((data->>'active')::boolean,true) AND NOT ana_assigned((data->>'profile_id')::uuid,(data->>'company_id')::uuid) THEN RAISE EXCEPTION 'Vincule o colaborador ao cliente em Equipe ou Serviços antes de autorizar Analytics';END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 INSERT INTO ana_grants(company_id,profile_id,can_write,active) VALUES((data->>'company_id')::uuid,(data->>'profile_id')::uuid,coalesce((data->>'can_write')::boolean,false),coalesce((data->>'active')::boolean,true)) ON CONFLICT(company_id,profile_id) DO UPDATE SET can_write=excluded.can_write,active=excluded.active;
 END $$;
CREATE FUNCTION public.ana_save_account(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE aid uuid:=nullif(data->>'id','')::uuid;old ana_accounts;cid uuid:=(data->>'company_id')::uuid;BEGIN
 PERFORM pg_advisory_xact_lock(70013);PERFORM ana_require(cid,true);
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=data->>'time_zone') THEN RAISE EXCEPTION 'Fuso horário inválido';END IF;
 IF aid IS NULL THEN INSERT INTO ana_accounts(company_id,platform,name,reference,time_zone,attribution) VALUES(cid,data->>'platform',trim(data->>'name'),trim(data->>'reference'),data->>'time_zone',trim(data->>'attribution')) RETURNING id INTO aid;
 ELSE
 SELECT * INTO old FROM ana_accounts WHERE id=aid FOR UPDATE;
 IF old.id IS NULL OR old.company_id<>cid OR old.version IS DISTINCT FROM (data->>'version')::int THEN RAISE EXCEPTION 'Conta alterada ou não disponível';END IF;
 IF EXISTS(SELECT 1 FROM ana_metrics m JOIN ana_campaigns c ON c.id=m.campaign_id WHERE c.account_id=aid) AND (old.platform<>data->>'platform' OR old.time_zone<>data->>'time_zone' OR old.attribution<>trim(data->>'attribution') OR old.reference<>trim(data->>'reference')) THEN RAISE EXCEPTION 'Conta com resultados: fonte, fuso e atribuição são imutáveis. Cadastre outra conta';END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ana_accounts SET platform=data->>'platform',name=trim(data->>'name'),reference=trim(data->>'reference'),time_zone=data->>'time_zone',attribution=trim(data->>'attribution'),active=(data->>'active')::boolean,version=version+1 WHERE id=aid;
 END IF;RETURN aid;END $$;
CREATE FUNCTION public.ana_save_campaign(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE cid uuid:=nullif(data->>'id','')::uuid;old ana_campaigns;company uuid:=(data->>'company_id')::uuid;BEGIN
 PERFORM pg_advisory_xact_lock(70013);PERFORM ana_require(company,true);
 IF cid IS NULL THEN INSERT INTO ana_campaigns(company_id,account_id,contract_id,name,reference) VALUES(company,(data->>'account_id')::uuid,nullif(data->>'contract_id','')::uuid,trim(data->>'name'),trim(data->>'reference')) RETURNING id INTO cid;
 ELSE
 SELECT * INTO old FROM ana_campaigns WHERE id=cid FOR UPDATE;
 IF old.id IS NULL OR old.company_id<>company OR old.version IS DISTINCT FROM (data->>'version')::int THEN RAISE EXCEPTION 'Campanha alterada ou indisponível';END IF;
 IF old.account_id<>(data->>'account_id')::uuid THEN RAISE EXCEPTION 'Conta da campanha é imutável';END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ana_campaigns SET contract_id=nullif(data->>'contract_id','')::uuid,name=trim(data->>'name'),reference=trim(data->>'reference'),active=(data->>'active')::boolean,published=false,version=version+1 WHERE id=cid;
 END IF;RETURN cid;END $$;
-- Both UI and CSV use the same validations and transactional write path.
CREATE FUNCTION public.ana_metric_write(data jsonb,origin text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE mid uuid:=nullif(data->>'id','')::uuid;old ana_metrics;c ana_campaigns;f date:=(data->>'period_from')::date;t date:=(data->>'period_to')::date;v record;BEGIN
 PERFORM pg_advisory_xact_lock(70013);SELECT * INTO c FROM ana_campaigns WHERE id=(data->>'campaign_id')::uuid;PERFORM ana_require(c.company_id,true);
 IF f IS NULL OR t IS NULL OR t<f OR t-f>366 OR t>(now() AT TIME ZONE 'America/Sao_Paulo')::date THEN RAISE EXCEPTION 'Informe um período real, encerrado, de até 366 dias';END IF;
 IF mid IS NULL AND coalesce((data->>'voided')::boolean,false) THEN RAISE EXCEPTION 'Novo resultado não pode iniciar desconsiderado';END IF;
 IF origin NOT IN ('manual','csv') THEN RAISE EXCEPTION 'Integrações automáticas ainda não autorizadas';END IF;
 IF nullif(data->>'conversions','') IS NOT NULL AND (data->>'conversions')::numeric<>round((data->>'conversions')::numeric,6) THEN RAISE EXCEPTION 'Conversões exigem até seis casas decimais';END IF;
 FOR v IN SELECT key,value FROM jsonb_each_text(data) WHERE key IN ('spend','revenue') LOOP IF nullif(v.value,'') IS NOT NULL AND v.value::numeric<>round(v.value::numeric,2) THEN RAISE EXCEPTION 'Valores em reais exigem até duas casas decimais';END IF;END LOOP;
 IF mid IS NOT NULL THEN
 SELECT * INTO old FROM ana_metrics WHERE id=mid FOR UPDATE;
 IF old.id IS NULL OR old.campaign_id<>c.id OR old.version IS DISTINCT FROM (data->>'version')::int THEN RAISE EXCEPTION 'Registro alterado ou indisponível. Recarregue';END IF;
 IF length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Informe o motivo da correção';END IF;
 origin:=old.source_kind;
 END IF;
 IF EXISTS(SELECT 1 FROM ana_metrics WHERE campaign_id=c.id AND id IS DISTINCT FROM mid AND NOT voided AND daterange(period_from,period_to,'[]') && daterange(f,t,'[]')) AND NOT coalesce((data->>'voided')::boolean,false) THEN RAISE EXCEPTION 'Período já registrado ou sobreposto. Corrija o registro existente';END IF;
 PERFORM set_config('ion.reason',coalesce(data->>'reason','Cadastro de resultado real'),true);
 IF mid IS NULL THEN
 INSERT INTO ana_metrics(campaign_id,period_from,period_to,spend,reach,impressions,clicks,leads,conversions,acquisitions,revenue,source_kind,source_reference,revenue_evidence,acquisition_evidence,created_by,updated_by) VALUES(c.id,f,t,nullif(data->>'spend','')::numeric,nullif(data->>'reach','')::bigint,nullif(data->>'impressions','')::bigint,nullif(data->>'clicks','')::bigint,nullif(data->>'leads','')::bigint,nullif(data->>'conversions','')::numeric,nullif(data->>'acquisitions','')::bigint,nullif(data->>'revenue','')::numeric,origin,trim(data->>'source_reference'),coalesce(data->>'revenue_evidence',''),coalesce(data->>'acquisition_evidence',''),auth.uid(),auth.uid()) RETURNING id INTO mid;
 ELSE UPDATE ana_metrics SET period_from=f,period_to=t,spend=nullif(data->>'spend','')::numeric,reach=nullif(data->>'reach','')::bigint,impressions=nullif(data->>'impressions','')::bigint,clicks=nullif(data->>'clicks','')::bigint,leads=nullif(data->>'leads','')::bigint,conversions=nullif(data->>'conversions','')::numeric,acquisitions=nullif(data->>'acquisitions','')::bigint,revenue=nullif(data->>'revenue','')::numeric,source_reference=trim(data->>'source_reference'),revenue_evidence=coalesce(data->>'revenue_evidence',''),acquisition_evidence=coalesce(data->>'acquisition_evidence',''),voided=coalesce((data->>'voided')::boolean,false),published=false,updated_by=auth.uid(),updated_at=now(),version=version+1 WHERE id=mid;
 END IF;RETURN mid;END $$;
CREATE FUNCTION public.ana_save_metric(data jsonb) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT ana_metric_write(data,'manual') $$;
CREATE FUNCTION public.ana_import(rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb;old ana_metrics;mid uuid;added integer:=0;skipped integer:=0;BEGIN
 IF jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Importe de 1 a 500 linhas por arquivo';END IF;
 PERFORM pg_advisory_xact_lock(70013);
 FOR d IN SELECT * FROM jsonb_array_elements(rows) LOOP
 PERFORM ana_require((SELECT company_id FROM ana_campaigns WHERE id=(d->>'campaign_id')::uuid),true);
 SELECT * INTO old FROM ana_metrics WHERE campaign_id=(d->>'campaign_id')::uuid AND period_from=(d->>'period_from')::date AND period_to=(d->>'period_to')::date;
 IF FOUND THEN
 IF old.voided OR old.spend IS DISTINCT FROM nullif(d->>'spend','')::numeric OR old.reach IS DISTINCT FROM nullif(d->>'reach','')::bigint OR old.impressions IS DISTINCT FROM nullif(d->>'impressions','')::bigint OR old.clicks IS DISTINCT FROM nullif(d->>'clicks','')::bigint OR old.leads IS DISTINCT FROM nullif(d->>'leads','')::bigint OR old.conversions IS DISTINCT FROM nullif(d->>'conversions','')::numeric OR old.acquisitions IS DISTINCT FROM nullif(d->>'acquisitions','')::bigint OR old.revenue IS DISTINCT FROM nullif(d->>'revenue','')::numeric OR old.source_reference IS DISTINCT FROM trim(d->>'source_reference') OR old.revenue_evidence<>coalesce(d->>'revenue_evidence','') OR old.acquisition_evidence<>coalesce(d->>'acquisition_evidence','') THEN RAISE EXCEPTION 'CSV conflita com registro existente. Nenhuma linha foi importada; revise a correção individual';END IF;
 skipped:=skipped+1;
 ELSE mid:=ana_metric_write(d-'id'-'version'-'voided','csv');added:=added+1;END IF;
 END LOOP;RETURN jsonb_build_object('inserted',added,'unchanged',skipped);END $$;
-- Only this private collector sees internal provenance. Portal records are redacted here.
CREATE FUNCTION public.ana_collect(filters jsonb,portal boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE f date:=(filters->>'from')::date;t date:=(filters->>'to')::date;cid uuid:=nullif(filters->>'company_id','')::uuid;result jsonb;BEGIN
 IF f IS NULL OR t IS NULL OR t<f OR t-f>731 THEN RAISE EXCEPTION 'Informe um período válido de até dois anos';END IF;
 IF portal THEN IF cid IS NULL OR ops_partner_access(cid) IS NOT TRUE THEN RAISE EXCEPTION 'Empresa indisponível para este parceiro';END IF;
 ELSE IF NOT ana_any_access() THEN RAISE EXCEPTION 'Acesso ao Analytics não autorizado';END IF;END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'period_from',x->>'campaign_id'),'[]') INTO result FROM (
 SELECT jsonb_build_object('id',m.id,'version',m.version,'company_id',c.company_id,'company',co.name,'campaign_id',c.id,'campaign',c.name,'account_id',a.id,'account',a.name,'platform',a.platform,'time_zone',a.time_zone,'attribution',a.attribution,'contract_id',c.contract_id,'contract_reference',o.reference,'period_from',m.period_from,'period_to',m.period_to,'contained',m.period_from>=f AND m.period_to<=t,
 'spend',CASE WHEN NOT portal OR 'spend'=ANY(c.published_metrics) THEN m.spend::text END,'reach',CASE WHEN NOT portal OR 'reach'=ANY(c.published_metrics) THEN m.reach::text END,'impressions',CASE WHEN NOT portal OR 'impressions'=ANY(c.published_metrics) THEN m.impressions::text END,'clicks',CASE WHEN NOT portal OR 'clicks'=ANY(c.published_metrics) THEN m.clicks::text END,'leads',CASE WHEN NOT portal OR 'leads'=ANY(c.published_metrics) THEN m.leads::text END,'conversions',CASE WHEN NOT portal OR 'conversions'=ANY(c.published_metrics) THEN m.conversions::text END,'acquisitions',CASE WHEN NOT portal OR 'acquisitions'=ANY(c.published_metrics) THEN m.acquisitions::text END,'revenue',CASE WHEN NOT portal OR 'revenue'=ANY(c.published_metrics) THEN m.revenue::text END,
 'source_kind',m.source_kind,'updated_at',m.updated_at,'allowed',CASE WHEN portal THEN c.published_metrics ELSE ana_metric_keys() END,'published',m.published) || CASE WHEN portal THEN '{}'::jsonb ELSE jsonb_build_object('source_reference',m.source_reference,'revenue_evidence',m.revenue_evidence,'acquisition_evidence',m.acquisition_evidence,'author',p.name,'updated_by',m.updated_by) END x
 FROM ana_metrics m JOIN ana_campaigns c ON c.id=m.campaign_id JOIN ana_accounts a ON a.id=c.account_id JOIN access_companies co ON co.id=c.company_id LEFT JOIN ops_contracts o ON o.id=c.contract_id LEFT JOIN profiles p ON p.id=m.updated_by
 WHERE NOT m.voided AND m.period_from<=t AND m.period_to>=f AND (cid IS NULL OR c.company_id=cid)
 AND (CASE WHEN portal THEN c.published AND m.published ELSE ana_client_access(c.company_id) END)
 AND (NOT coalesce((filters->>'only_published')::boolean,false) OR c.published AND m.published)
 AND (nullif(filters->>'campaign_id','') IS NULL OR c.id=(filters->>'campaign_id')::uuid)
 AND (nullif(filters->>'account_id','') IS NULL OR a.id=(filters->>'account_id')::uuid)
 AND (nullif(filters->>'contract_id','') IS NULL OR c.contract_id=(filters->>'contract_id')::uuid)
 AND (nullif(filters->>'platform','') IS NULL OR a.platform=filters->>'platform')
 LIMIT 10001) q;
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION 'Mais de 10.000 registros. Reduza período ou selecione cliente/campanha';END IF;RETURN result;END $$;
CREATE FUNCTION public.ana_aggregate(rows jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 WITH r AS(SELECT * FROM jsonb_to_recordset(rows) AS x(account_id text,spend numeric,reach numeric,impressions numeric,clicks numeric,leads numeric,conversions numeric,acquisitions numeric,revenue numeric)),
 a AS(SELECT count(*) n,count(DISTINCT account_id)=1 compatible,
 CASE WHEN count(spend)=count(*) THEN sum(spend) END spend,CASE WHEN count(*)=1 THEN max(reach) END reach,
 CASE WHEN count(impressions)=count(*) THEN sum(impressions) END impressions,CASE WHEN count(clicks)=count(*) THEN sum(clicks) END clicks,
 CASE WHEN count(leads)=count(*) AND count(DISTINCT account_id)=1 THEN sum(leads) END leads,
 CASE WHEN count(conversions)=count(*) AND count(DISTINCT account_id)=1 THEN sum(conversions) END conversions,
 CASE WHEN count(acquisitions)=count(*) AND count(DISTINCT account_id)=1 THEN sum(acquisitions) END acquisitions,
 CASE WHEN count(revenue)=count(*) AND count(DISTINCT account_id)=1 THEN sum(revenue) END revenue FROM r),
 allowed AS(SELECT k FROM unnest(ana_metric_keys()) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(rows) v WHERE NOT (v->'allowed') ? k))
 SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM a CROSS JOIN LATERAL jsonb_each(jsonb_build_object('spend',spend::text,'reach',reach::text,'impressions',impressions::text,'clicks',clicks::text,'leads',leads::text,'conversions',conversions::text,'acquisitions',acquisitions::text,'revenue',revenue::text,
 'frequency',CASE WHEN reach>0 AND compatible THEN round(impressions/reach,2)::text END,'ctr',CASE WHEN impressions>0 AND compatible THEN round(clicks*100/impressions,2)::text END,'cpc',CASE WHEN clicks>0 AND compatible THEN round(spend/clicks,2)::text END,'cpm',CASE WHEN impressions>0 AND compatible THEN round(spend*1000/impressions,2)::text END,'cpl',CASE WHEN leads>0 AND compatible THEN round(spend/leads,2)::text END,'cpa',CASE WHEN acquisitions>0 AND compatible THEN round(spend/acquisitions,2)::text END,'roas',CASE WHEN spend>0 AND compatible THEN round(revenue/spend,2)::text END)) AS computed WHERE key IN(SELECT k FROM allowed) $$;
CREATE FUNCTION public.ana_snapshot(rows jsonb,filters jsonb) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 WITH included AS(SELECT v FROM jsonb_array_elements(rows) v WHERE coalesce((v->>'contained')::boolean,true)),
 datasets AS(SELECT coalesce(jsonb_agg(v),'[]') r FROM included),
 groups AS(SELECT v->>'account_id' account_id,max(v->>'account') account,max(v->>'platform') platform,max(v->>'time_zone') time_zone,max(v->>'attribution') attribution,jsonb_agg(v) r FROM included GROUP BY v->>'account_id'),
 points AS(SELECT v->>'account_id' account_id,max(v->>'account') account,max(v->>'platform') platform,v->>'period_from' f,v->>'period_to' t,jsonb_agg(v) r FROM included GROUP BY v->>'account_id',v->>'period_from',v->>'period_to')
 SELECT jsonb_build_object('from',filters->>'from','to',filters->>'to','generated_at',now(),'record_count',jsonb_array_length(r),'partial_count',jsonb_array_length(rows)-jsonb_array_length(r),'stats',ana_aggregate(r),'records',r,
 'groups',coalesce((SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'account',account,'platform',platform,'time_zone',time_zone,'attribution',attribution,'stats',ana_aggregate(r))) FROM groups),'[]'),
 'points',coalesce((SELECT jsonb_agg(jsonb_build_object('account_id',account_id,'account',account,'platform',platform,'from',f,'to',t,'stats',ana_aggregate(r)) ORDER BY f,t,account_id) FROM points),'[]'),
 'sources',coalesce((SELECT jsonb_agg(s) FROM (SELECT DISTINCT v-'spend'-'reach'-'impressions'-'clicks'-'leads'-'conversions'-'acquisitions'-'revenue'-'allowed'-'contained' s FROM included) q),'[]'),
 'methodology','Valores ausentes não são zero. Alcance único só é informado para uma observação; não é somado. Taxas usam medidas completas e compatíveis de uma mesma conta/metodologia. Conversões e receitas de contas distintas não são somadas nem deduplicadas. Períodos parcialmente sobrepostos ao filtro são excluídos, sem rateio. Investimento publicitário pertence ao cliente e não representa pagamento à ION.') FROM datasets $$;
CREATE FUNCTION public.ana_compare(current_data jsonb,previous_data jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 WITH sources AS(SELECT (SELECT array_agg(DISTINCT v->>'account_id' ORDER BY v->>'account_id') FROM jsonb_array_elements(current_data->'records') v) a,(SELECT array_agg(DISTINCT v->>'account_id' ORDER BY v->>'account_id') FROM jsonb_array_elements(previous_data->'records') v) b)
 SELECT jsonb_build_object('compatible',coalesce(a=b,false),'changes',coalesce((SELECT jsonb_object_agg(k,jsonb_build_object('difference',CASE WHEN a=b AND current_data->'stats'->>k IS NOT NULL AND previous_data->'stats'->>k IS NOT NULL THEN ((current_data->'stats'->>k)::numeric-(previous_data->'stats'->>k)::numeric)::text END,'percent',CASE WHEN a=b AND (previous_data->'stats'->>k)::numeric>0 AND current_data->'stats'->>k IS NOT NULL THEN round(((current_data->'stats'->>k)::numeric-(previous_data->'stats'->>k)::numeric)*100/(previous_data->'stats'->>k)::numeric,2)::text END)) FROM jsonb_object_keys(current_data->'stats') k WHERE (previous_data->'stats') ? k),'{}')) FROM sources $$;
CREATE FUNCTION public.ana_report(filters jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE portal boolean:=actor_role()='partner';current_data jsonb;previous_data jsonb;BEGIN
 current_data:=ana_snapshot(ana_collect(filters,coalesce(portal,false)),filters);
 IF nullif(filters->>'compare_from','') IS NOT NULL AND nullif(filters->>'compare_to','') IS NOT NULL THEN
 previous_data:=ana_snapshot(ana_collect(filters||jsonb_build_object('from',filters->>'compare_from','to',filters->>'compare_to'),coalesce(portal,false)),filters||jsonb_build_object('from',filters->>'compare_from','to',filters->>'compare_to'));
 END IF;
 RETURN current_data||jsonb_build_object('comparison',previous_data,'comparison_change',ana_compare(current_data,previous_data));END $$;
CREATE FUNCTION public.ana_portal_report(filters jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE current_data jsonb;previous_data jsonb;BEGIN
 current_data:=ana_snapshot(ana_collect(filters,true),filters);
 IF nullif(filters->>'compare_from','') IS NOT NULL AND nullif(filters->>'compare_to','') IS NOT NULL THEN previous_data:=ana_snapshot(ana_collect(filters||jsonb_build_object('from',filters->>'compare_from','to',filters->>'compare_to'),true),filters||jsonb_build_object('from',filters->>'compare_from','to',filters->>'compare_to'));END IF;
 RETURN current_data||jsonb_build_object('comparison',previous_data,'comparison_change',ana_compare(current_data,previous_data));END $$;
CREATE FUNCTION public.ana_create_report(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE rid uuid;cid uuid:=(data->>'company_id')::uuid;snapshot jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(70013);PERFORM ana_require(cid,true);
 snapshot:=ana_report(data-'id');
 IF (snapshot->>'record_count')::int=0 THEN RAISE EXCEPTION 'Nenhum resultado real neste período para gerar relatório';END IF;
 INSERT INTO ana_reports(company_id,title,period_from,period_to,internal_snapshot,created_by) VALUES(cid,trim(data->>'title'),(data->>'from')::date,(data->>'to')::date,snapshot,auth.uid()) RETURNING id INTO rid;RETURN rid;END $$;
-- Redact a captured result using current authorizations; never copy an internal snapshot to partners.
CREATE FUNCTION public.ana_public_rows(rows jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE v jsonb;c ana_campaigns;m ana_metrics;safe jsonb;result jsonb:='[]';key text;BEGIN
 FOR v IN SELECT * FROM jsonb_array_elements(rows) LOOP
 SELECT * INTO m FROM ana_metrics WHERE id=(v->>'id')::uuid;
 SELECT * INTO c FROM ana_campaigns WHERE id=m.campaign_id;
 IF m.id IS NULL OR m.voided OR NOT m.published OR NOT c.published OR m.version IS DISTINCT FROM (v->>'version')::int THEN RAISE EXCEPTION 'O relatório contém registros ocultos ou corrigidos. Publique os dados atuais e gere outro relatório';END IF;
 safe:=v-'source_reference'-'revenue_evidence'-'acquisition_evidence'-'author'-'updated_by';
 FOREACH key IN ARRAY ARRAY['spend','reach','impressions','clicks','leads','conversions','acquisitions','revenue'] LOOP IF NOT key=ANY(c.published_metrics) THEN safe:=safe||jsonb_build_object(key,NULL);END IF;END LOOP;
 safe:=safe||jsonb_build_object('allowed',c.published_metrics,'published',true);result:=result||jsonb_build_array(safe);
 END LOOP;RETURN result;END $$;
CREATE FUNCTION public.ana_publish_report(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r ana_reports;pub jsonb;comparison jsonb;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Confirme a publicação/revogação e informe o motivo';END IF;
 SELECT * INTO r FROM ana_reports WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Relatório inexistente';END IF;
 IF (data->>'published')::boolean THEN
 IF NOT EXISTS(SELECT 1 FROM ops_clients WHERE company_id=r.company_id AND partner_visible) THEN RAISE EXCEPTION 'Autorize o portal deste cliente em Clientes e Serviços';END IF;
 pub:=ana_snapshot(ana_public_rows(r.internal_snapshot->'records'),r.internal_snapshot)||jsonb_build_object('generated_at',r.created_at);
 IF r.internal_snapshot->'comparison' IS NOT NULL AND r.internal_snapshot->'comparison'<>'null'::jsonb THEN comparison:=ana_snapshot(ana_public_rows(r.internal_snapshot->'comparison'->'records'),r.internal_snapshot->'comparison')||jsonb_build_object('generated_at',r.created_at);END IF;
 pub:=pub||jsonb_build_object('comparison',comparison,'comparison_change',ana_compare(pub,comparison));
 END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ana_reports SET published=(data->>'published')::boolean,public_snapshot=pub WHERE id=r.id;
 END $$;
CREATE FUNCTION public.ana_publish_campaign(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE keys text[];BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<3 THEN RAISE EXCEPTION 'Confirme e justifique a alteração de publicação';END IF;
 SELECT coalesce(array_agg(v),'{}') INTO keys FROM jsonb_array_elements_text(coalesce(data->'metrics','[]')) v;PERFORM ana_validate_publication(keys);
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ana_campaigns SET published=(data->>'published')::boolean,published_metrics=keys,version=version+1 WHERE id=(data->>'id')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Campanha inexistente';END IF;END $$;
CREATE FUNCTION public.ana_publish_metrics(data jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE n integer;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);PERFORM require_admin();
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<3 OR (data->>'to')::date<(data->>'from')::date THEN RAISE EXCEPTION 'Confirme período e motivo';END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ana_metrics SET published=(data->>'published')::boolean WHERE campaign_id=(data->>'campaign_id')::uuid AND period_from>=(data->>'from')::date AND period_to<=(data->>'to')::date AND NOT voided;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;
CREATE FUNCTION public.ana_revoke_related() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW IS DISTINCT FROM OLD THEN
 UPDATE ana_reports SET published=false,public_snapshot=NULL WHERE published AND (CASE WHEN TG_TABLE_NAME='ana_campaigns' THEN internal_snapshot->'records' @> jsonb_build_array(jsonb_build_object('campaign_id',NEW.id)) OR internal_snapshot->'comparison'->'records' @> jsonb_build_array(jsonb_build_object('campaign_id',NEW.id)) ELSE internal_snapshot->'records' @> jsonb_build_array(jsonb_build_object('id',NEW.id)) OR internal_snapshot->'comparison'->'records' @> jsonb_build_array(jsonb_build_object('id',NEW.id)) END);
 END IF;RETURN NEW;END $$;
CREATE TRIGGER ana_metric_revoke AFTER UPDATE ON ana_metrics FOR EACH ROW EXECUTE FUNCTION ana_revoke_related();
CREATE TRIGGER ana_campaign_revoke AFTER UPDATE ON ana_campaigns FOR EACH ROW EXECUTE FUNCTION ana_revoke_related();
CREATE FUNCTION public.ana_account_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.name IS DISTINCT FROM OLD.name THEN UPDATE ana_campaigns SET published=false WHERE account_id=NEW.id AND published;END IF;RETURN NEW;END $$;
CREATE TRIGGER ana_account_revoke AFTER UPDATE ON ana_accounts FOR EACH ROW EXECUTE FUNCTION ana_account_revoke();
CREATE FUNCTION public.ana_report_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE old_json jsonb;new_json jsonb;BEGIN
 IF TG_OP='UPDATE' AND (NEW.internal_snapshot IS DISTINCT FROM OLD.internal_snapshot OR NEW.company_id<>OLD.company_id OR NEW.title<>OLD.title OR NEW.period_from<>OLD.period_from OR NEW.period_to<>OLD.period_to OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at) THEN RAISE EXCEPTION 'Relatório é imutável; gere uma nova versão';END IF;
 IF TG_OP<>'INSERT' THEN old_json:=(to_jsonb(OLD)-'internal_snapshot'-'public_snapshot')||jsonb_build_object('internal_hash',md5(OLD.internal_snapshot::text),'public_hash',md5(OLD.public_snapshot::text));END IF;
 IF TG_OP<>'DELETE' THEN new_json:=(to_jsonb(NEW)-'internal_snapshot'-'public_snapshot')||jsonb_build_object('internal_hash',md5(NEW.internal_snapshot::text),'public_hash',md5(NEW.public_snapshot::text));END IF;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,old_state,new_state,reason) VALUES(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(NEW.id,OLD.id)::text,old_json,new_json,nullif(current_setting('ion.reason',true),''));RETURN coalesce(NEW,OLD);END $$;
CREATE TRIGGER ana_reports_audit BEFORE INSERT OR UPDATE OR DELETE ON ana_reports FOR EACH ROW EXECUTE FUNCTION ana_report_audit();
CREATE FUNCTION public.ana_get_report(rid uuid,portal boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE r ana_reports;snapshot jsonb;BEGIN
 SELECT * INTO r FROM ana_reports WHERE id=rid;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Relatório indisponível';END IF;
 IF NOT portal AND ana_client_access(r.company_id) THEN snapshot:=r.internal_snapshot;
 ELSIF r.published AND ops_partner_access(r.company_id) THEN snapshot:=r.public_snapshot;
 ELSE RAISE EXCEPTION 'Relatório indisponível';END IF;
 RETURN jsonb_build_object('id',r.id,'title',r.title,'company_id',r.company_id,'company',(SELECT name FROM access_companies WHERE id=r.company_id),'created_at',r.created_at,'published',r.published,'view',CASE WHEN NOT portal AND ana_client_access(r.company_id) THEN 'internal' ELSE 'published' END,'snapshot',snapshot);END $$;
CREATE FUNCTION public.ana_metric_detail(mid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ DECLARE m ana_metrics;BEGIN
 SELECT * INTO m FROM ana_metrics WHERE id=mid;PERFORM ana_require((SELECT company_id FROM ana_campaigns WHERE id=m.campaign_id));
 IF m.id IS NULL THEN RAISE EXCEPTION 'Resultado inexistente';END IF;
 RETURN to_jsonb(m)||jsonb_build_object('spend',m.spend::text,'reach',m.reach::text,'impressions',m.impressions::text,'clicks',m.clicks::text,'leads',m.leads::text,'conversions',m.conversions::text,'acquisitions',m.acquisitions::text,'revenue',m.revenue::text);END $$;
CREATE FUNCTION public.ana_options() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT ana_any_access() THEN RAISE EXCEPTION 'Acesso ao Analytics não autorizado';END IF;
 RETURN jsonb_build_object(
 'companies',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.company_id,'name',a.name,'can_write',ana_client_access(c.company_id,true),'portal_visible',c.partner_visible) ORDER BY a.name),'[]') FROM ops_clients c JOIN access_companies a ON a.id=c.company_id WHERE ana_client_access(c.company_id)),
 'accounts',(SELECT coalesce(jsonb_agg(a ORDER BY name),'[]') FROM ana_accounts a WHERE ana_client_access(company_id)),
 'campaigns',(SELECT coalesce(jsonb_agg(c ORDER BY name),'[]') FROM ana_campaigns c WHERE ana_client_access(company_id)),
 'contracts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'reference',reference,'status',status,'source_deal_id',CASE WHEN actor_role()='admin' THEN source_deal_id END)),'[]') FROM ops_contracts WHERE ana_client_access(company_id)),
 'reports',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'company_id',company_id,'period_from',period_from,'period_to',period_to,'created_at',created_at,'published',published) ORDER BY created_at DESC),'[]') FROM ana_reports WHERE ana_client_access(company_id)),
 'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') FROM profiles WHERE actor_role()='admin' AND active AND category='employee'),
 'grants',(SELECT coalesce(jsonb_agg(g),'[]') FROM ana_grants g WHERE actor_role()='admin'));
 END $$;
CREATE FUNCTION public.ana_partner_options() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF actor_role() NOT IN ('admin','partner') OR actor_role() IS NULL THEN RAISE EXCEPTION 'Portal indisponível';END IF;
 RETURN jsonb_build_object(
 'companies',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',company_id,'name',a.name)),'[]') FROM ops_clients c JOIN access_companies a ON a.id=c.company_id WHERE ops_partner_access(c.company_id)),
 'campaigns',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'name',name,'contract_id',contract_id,'platform',(SELECT platform FROM ana_accounts WHERE id=c.account_id))),'[]') FROM ana_campaigns c WHERE published AND ops_partner_access(company_id)),
 'reports',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'title',title,'period_from',period_from,'period_to',period_to,'created_at',created_at) ORDER BY created_at DESC),'[]') FROM ana_reports WHERE published AND ops_partner_access(company_id)));
 END $$;
CREATE FUNCTION public.ana_history(cid uuid,page integer DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();RETURN coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (SELECT jsonb_build_object('id',a.id::text,'entity_id',a.entity_id,'at',created_at,'actor',(SELECT name FROM profiles WHERE id=a.actor_id),'action',action,'entity',entity,'reason',reason,'published_before',old_state->'published','published_after',new_state->'published','metrics_before',old_state->'published_metrics','metrics_after',new_state->'published_metrics') x FROM audit_logs a WHERE entity LIKE 'ana_%' AND (coalesce(new_state->>'company_id',old_state->>'company_id')=cid::text OR coalesce(new_state->>'campaign_id',old_state->>'campaign_id') IN(SELECT id::text FROM ana_campaigns WHERE company_id=cid)) ORDER BY id DESC LIMIT 50 OFFSET (greatest(1,least(page,10000))-1)*50) q),'[]');END $$;
CREATE FUNCTION public.ana_overview() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM require_admin();RETURN jsonb_build_object('clients',(SELECT count(DISTINCT c.company_id) FROM ana_metrics m JOIN ana_campaigns c ON c.id=m.campaign_id WHERE NOT m.voided),'records',(SELECT count(*) FROM ana_metrics WHERE NOT voided),'reports',(SELECT count(*) FROM ana_reports),'published_reports',(SELECT count(*) FROM ana_reports WHERE published),'updated_at',(SELECT max(updated_at) FROM ana_metrics));END $$;
-- Existing access and operational projection are extended, not duplicated.
CREATE OR REPLACE FUNCTION public.ops_partner_access(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM ops_clients WHERE company_id=cid AND partner_visible) AND (coalesce(actor_role()='admin',false) OR coalesce(actor_role()='partner',false) AND EXISTS(SELECT 1 FROM partner_companies WHERE company_id=cid AND profile_id=auth.uid())) $$;
CREATE OR REPLACE FUNCTION public.ops_partner_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.company_id,'services',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',k.name,'description',s.partner_description,'status',s.status,'starts_at',s.starts_at,'due_at',s.due_at,'delivered_at',s.delivered_at)) FROM ops_services s JOIN ops_catalog k ON k.id=s.catalog_id WHERE s.company_id=c.company_id AND s.partner_visible),'[]'),
 'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'reference',x.reference,'status',x.status,'starts_at',x.starts_at,'ends_at',x.ends_at)) FROM ops_contracts x WHERE x.company_id=c.company_id AND x.partner_visible),'[]'),
 'updates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'body',u.partner_body,'created_at',u.created_at) ORDER BY u.created_at DESC) FROM ops_updates u WHERE u.company_id=c.company_id AND u.published AND u.partner_body<>'' AND (u.service_id IS NULL OR EXISTS(SELECT 1 FROM ops_services WHERE id=u.service_id AND partner_visible)) AND (u.contract_id IS NULL OR EXISTS(SELECT 1 FROM ops_contracts WHERE id=u.contract_id AND partner_visible))),'[]'),
 'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name)) FROM ops_files f WHERE f.company_id=c.company_id AND f.partner_visible AND f.state='ready' AND (f.service_id IS NULL OR EXISTS(SELECT 1 FROM ops_services WHERE id=f.service_id AND partner_visible)) AND (f.contract_id IS NULL OR EXISTS(SELECT 1 FROM ops_contracts WHERE id=f.contract_id AND partner_visible)) AND ops_file_read(f.id)),'[]'))),'[]') FROM ops_clients c WHERE ops_partner_access(c.company_id) $$;
CREATE OR REPLACE FUNCTION public.current_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('category',p.category,'functions',coalesce((SELECT jsonb_agg(function_code ORDER BY function_code) FROM user_functions WHERE profile_id=p.id),'[]'),'challenger',can_challenger(),'crm',can_crm(),'clients',ops_employee() AND (EXISTS(SELECT 1 FROM client_assignments WHERE profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_service_assignments WHERE profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_contracts WHERE responsible_id=p.id)),'analytics',ana_any_access()) FROM profiles p WHERE p.id=auth.uid() AND p.active $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['ana_grants','ana_accounts','ana_campaigns','ana_metrics','ana_reports'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 IF t<>'ana_reports' THEN EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',t,t);END IF;
 END LOOP;END $$;
CREATE POLICY ana_grant_read ON ana_grants FOR SELECT TO authenticated USING(actor_role()='admin' OR profile_id=auth.uid() AND ana_client_access(company_id));
CREATE POLICY ana_account_read ON ana_accounts FOR SELECT TO authenticated USING(ana_client_access(company_id));
CREATE POLICY ana_campaign_read ON ana_campaigns FOR SELECT TO authenticated USING(ana_client_access(company_id));
CREATE POLICY ana_metric_read ON ana_metrics FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM ana_campaigns WHERE id=campaign_id AND ana_client_access(company_id)));
CREATE POLICY ana_report_read ON ana_reports FOR SELECT TO authenticated USING(ana_client_access(company_id));
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'ana_%' LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;END $$;
GRANT EXECUTE ON FUNCTION public.ana_client_access(uuid,boolean),public.ana_any_access(),public.ana_save_grant(jsonb),public.ana_save_account(jsonb),public.ana_save_campaign(jsonb),public.ana_save_metric(jsonb),public.ana_import(jsonb),public.ana_report(jsonb),public.ana_portal_report(jsonb),public.ana_create_report(jsonb),public.ana_publish_report(jsonb),public.ana_publish_campaign(jsonb),public.ana_publish_metrics(jsonb),public.ana_get_report(uuid,boolean),public.ana_metric_detail(uuid),public.ana_options(),public.ana_partner_options(),public.ana_history(uuid,integer),public.ana_overview() TO authenticated;
COMMIT;
