-- Etapa 4: incremental from 004. Existing commercial records and access bindings are preserved.
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(70013);
CREATE TABLE public.ops_clients(
 company_id uuid PRIMARY KEY REFERENCES access_companies(id),contact text NOT NULL CHECK(length(trim(contact)) BETWEEN 2 AND 120),
 phone text NOT NULL UNIQUE CHECK(phone ~ '^[0-9]{10,15}$'),email text NOT NULL DEFAULT '' CHECK(email='' OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 niche text NOT NULL CHECK(length(trim(niche)) BETWEEN 2 AND 100),city text NOT NULL CHECK(length(trim(city)) BETWEEN 2 AND 100),state text NOT NULL CHECK(state ~ '^[A-Z]{2}$'),
 instagram text NOT NULL DEFAULT '' CHECK(length(instagram)<=200),website text NOT NULL DEFAULT '' CHECK(website='' OR website ~ '^https?://[^[:space:]]+$'),
 joined_at date NOT NULL DEFAULT current_date,relationship text NOT NULL DEFAULT 'active' CHECK(relationship IN ('onboarding','active','paused','inactive','ended')),
 partner_visible boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX ops_client_email ON ops_clients(lower(email)) WHERE email<>'';
CREATE TABLE public.ops_admin_notes(company_id uuid PRIMARY KEY REFERENCES ops_clients(company_id),notes text NOT NULL DEFAULT '' CHECK(length(notes)<=10000));
CREATE TABLE public.ops_catalog(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 2 AND 150),active boolean NOT NULL DEFAULT true);
INSERT INTO ops_catalog(name) VALUES('Gestão de tráfego pago'),('Planejamento de marketing'),('Roteirização'),('Copywriting'),('Design'),('Edição de vídeos'),('Gestão de redes sociais'),('Google Meu Negócio'),('Desenvolvimento de sites'),('Implementação de CRM'),('Suporte comercial'),('Campanhas sazonais'),('Outros serviços personalizados');
CREATE TABLE public.ops_contracts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),reference text NOT NULL CHECK(length(trim(reference)) BETWEEN 3 AND 150),
 starts_at date NOT NULL,ends_at date,min_months integer NOT NULL CHECK(min_months BETWEEN 0 AND 120),amount numeric(14,2) NOT NULL CHECK(amount>0),periodicity text NOT NULL CHECK(periodicity IN ('monthly','quarterly','annual','one_off','custom')),
 services_text text NOT NULL CHECK(length(trim(services_text)) BETWEEN 2 AND 4000),status text NOT NULL DEFAULT 'preparation' CHECK(status IN ('preparation','active','paused','ended','cancelled')),
 responsible_id uuid NOT NULL REFERENCES profiles(id),parent_id uuid,source_deal_id uuid UNIQUE REFERENCES crm_deals(id),commercial_contract_id uuid UNIQUE REFERENCES contracts(id),
 source_reviewed_state text,source_reviewed_revision bigint,partner_visible boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,company_id),UNIQUE(company_id,reference),FOREIGN KEY(parent_id,company_id) REFERENCES ops_contracts(id,company_id),CHECK(ends_at IS NULL OR ends_at>=starts_at),CHECK(parent_id IS DISTINCT FROM id));
CREATE TABLE public.ops_services(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),contract_id uuid NOT NULL,catalog_id uuid NOT NULL REFERENCES ops_catalog(id),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 2 AND 4000),partner_description text NOT NULL DEFAULT '' CHECK(length(partner_description)<=4000),
 starts_at date NOT NULL,due_at date,delivered_at date,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','paused')),
 partner_visible boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(contract_id,company_id) REFERENCES ops_contracts(id,company_id),UNIQUE(id,company_id),CHECK(due_at IS NULL OR due_at>=starts_at),CHECK(delivered_at IS NULL OR delivered_at>=starts_at));
CREATE TABLE public.ops_service_assignments(service_id uuid REFERENCES ops_services(id),profile_id uuid REFERENCES profiles(id),PRIMARY KEY(service_id,profile_id));
CREATE INDEX ops_service_assignee ON ops_service_assignments(profile_id,service_id);
CREATE INDEX ops_services_due ON ops_services(due_at) WHERE status IN ('pending','running');
CREATE TABLE public.ops_updates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),service_id uuid,contract_id uuid,
 actor_id uuid NOT NULL REFERENCES profiles(id),body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 4000),partner_body text NOT NULL DEFAULT '' CHECK(length(partner_body)<=4000),published boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(service_id,company_id) REFERENCES ops_services(id,company_id),FOREIGN KEY(contract_id,company_id) REFERENCES ops_contracts(id,company_id));
CREATE INDEX ops_updates_timeline ON ops_updates(company_id,created_at DESC);
CREATE TABLE public.ops_files(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES ops_clients(company_id),service_id uuid,contract_id uuid,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),mime text NOT NULL,size bigint NOT NULL CHECK(size BETWEEN 1 AND 10485760),object_path text NOT NULL UNIQUE,
 uploaded_by uuid NOT NULL REFERENCES profiles(id),state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','archived')),partner_visible boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(service_id,company_id) REFERENCES ops_services(id,company_id),FOREIGN KEY(contract_id,company_id) REFERENCES ops_contracts(id,company_id),CHECK(service_id IS NULL OR contract_id IS NULL));

CREATE FUNCTION public.ops_employee() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND category='employee' AND active) $$;
CREATE FUNCTION public.ops_service_access(sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR ops_employee() AND EXISTS(SELECT 1 FROM ops_service_assignments WHERE service_id=sid AND profile_id=auth.uid()) $$;
CREATE FUNCTION public.ops_client_access(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR ops_employee() AND (EXISTS(SELECT 1 FROM client_assignments WHERE company_id=cid AND profile_id=auth.uid()) OR EXISTS(SELECT 1 FROM ops_contracts WHERE company_id=cid AND responsible_id=auth.uid()) OR EXISTS(SELECT 1 FROM ops_services s JOIN ops_service_assignments a ON a.service_id=s.id WHERE s.company_id=cid AND a.profile_id=auth.uid())) $$;
CREATE FUNCTION public.ops_contract_access(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(actor_role()='admin',false) OR ops_employee() AND EXISTS(SELECT 1 FROM ops_contracts WHERE id=cid AND responsible_id=auth.uid()) $$;
CREATE FUNCTION public.ops_scope_access(cid uuid,sid uuid,contract uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT CASE WHEN sid IS NOT NULL THEN EXISTS(SELECT 1 FROM ops_services WHERE id=sid AND company_id=cid) AND ops_service_access(sid) WHEN contract IS NOT NULL THEN EXISTS(SELECT 1 FROM ops_contracts WHERE id=contract AND company_id=cid) AND ops_contract_access(contract) ELSE ops_client_access(cid) END $$;
CREATE FUNCTION public.ops_partner_access(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT actor_role()='partner' AND EXISTS(SELECT 1 FROM partner_companies a JOIN ops_clients c ON c.company_id=a.company_id WHERE a.profile_id=auth.uid() AND a.company_id=cid AND c.partner_visible) $$;
-- Service assignment must also expose the company's name, without exposing other clients.
CREATE OR REPLACE FUNCTION public.can_read_company(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT ops_client_access(cid) OR EXISTS(SELECT 1 FROM partner_companies a JOIN profiles p ON p.id=a.profile_id WHERE a.profile_id=auth.uid() AND a.company_id=cid AND p.active AND p.category='partner') $$;
CREATE FUNCTION public.ops_directory() RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT p.id,p.name FROM profiles p WHERE actor_role()='admin' AND p.active AND p.category='employee' ORDER BY p.name $$;

CREATE FUNCTION public.ops_people(cid uuid) RETURNS TABLE(id uuid,name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p.id,p.name FROM profiles p WHERE ops_client_access(cid) AND p.active AND (EXISTS(SELECT 1 FROM client_assignments WHERE company_id=cid AND profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_services s JOIN ops_service_assignments a ON a.service_id=s.id WHERE s.company_id=cid AND a.profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_contracts WHERE company_id=cid AND responsible_id=p.id)) ORDER BY p.name $$;
CREATE FUNCTION public.ops_save_client(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cid uuid; old ops_clients; name_value text; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);name_value:=trim(data->>'name');cid:=nullif(data->>'company_id','')::uuid;
 IF cid IS NULL THEN
  SELECT id INTO cid FROM access_companies WHERE lower(trim(name))=lower(name_value);
  IF cid IS NOT NULL THEN RAISE EXCEPTION 'Empresa já cadastrada. Selecione o cadastro existente para completar os dados'; END IF;
  INSERT INTO access_companies(name) VALUES(name_value) RETURNING id INTO cid;
 ELSE
  SELECT * INTO old FROM ops_clients WHERE company_id=cid FOR UPDATE;
  IF old.company_id IS NOT NULL AND (data->>'version')::integer IS DISTINCT FROM old.version THEN RAISE EXCEPTION 'Cadastro atualizado por outra pessoa. Recarregue a página'; END IF;
  IF NOT EXISTS(SELECT 1 FROM access_companies WHERE id=cid) THEN RAISE EXCEPTION 'Empresa inválida'; END IF;
  IF EXISTS(SELECT 1 FROM access_companies WHERE id<>cid AND lower(trim(name))=lower(name_value)) THEN RAISE EXCEPTION 'Nome de empresa já utilizado'; END IF;
  UPDATE access_companies SET name=name_value,active=(data->>'relationship') NOT IN ('inactive','ended') WHERE id=cid;
 END IF;
 INSERT INTO ops_clients(company_id,contact,phone,email,niche,city,state,instagram,website,joined_at,relationship,partner_visible) VALUES(cid,trim(data->>'contact'),regexp_replace(data->>'phone','[^0-9]','','g'),lower(trim(coalesce(data->>'email',''))),trim(data->>'niche'),trim(data->>'city'),upper(trim(data->>'state')),coalesce(data->>'instagram',''),coalesce(data->>'website',''),(data->>'joined_at')::date,data->>'relationship',coalesce((data->>'partner_visible')::boolean,false))
 ON CONFLICT(company_id) DO UPDATE SET contact=excluded.contact,phone=excluded.phone,email=excluded.email,niche=excluded.niche,city=excluded.city,state=excluded.state,instagram=excluded.instagram,website=excluded.website,joined_at=excluded.joined_at,relationship=excluded.relationship,partner_visible=excluded.partner_visible,version=ops_clients.version+1,updated_at=now();
 UPDATE access_companies SET active=(data->>'relationship') NOT IN ('inactive','ended') WHERE id=cid;
 INSERT INTO ops_admin_notes VALUES(cid,coalesce(data->>'admin_notes','')) ON CONFLICT(company_id) DO UPDATE SET notes=excluded.notes;
 IF data ? 'assignees' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(data->'assignees') v WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=v::uuid AND active AND category='employee')) THEN RAISE EXCEPTION 'Colaborador inválido'; END IF;
  DELETE FROM client_assignments WHERE company_id=cid;
  INSERT INTO client_assignments SELECT v::uuid,cid FROM jsonb_array_elements_text(data->'assignees') v;
 END IF;
 INSERT INTO ops_updates(company_id,actor_id,body) VALUES(cid,auth.uid(),'Cadastro e vínculos operacionais atualizados');
 RETURN cid;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Possível duplicidade de WhatsApp ou email. Revise o cadastro existente';
END $$;
CREATE FUNCTION public.ops_save_catalog(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();
 IF nullif(data->>'id','') IS NULL THEN INSERT INTO ops_catalog(name) VALUES(trim(data->>'name'));
 ELSE UPDATE ops_catalog SET name=trim(data->>'name'),active=(data->>'active')::boolean WHERE id=(data->>'id')::uuid; END IF;
END $$;
CREATE FUNCTION public.ops_save_contract(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c ops_contracts; cid uuid; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);cid:=nullif(data->>'id','')::uuid;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=(data->>'responsible_id')::uuid AND active AND category='employee') THEN RAISE EXCEPTION 'Responsável interno inválido'; END IF;
 IF cid IS NOT NULL THEN SELECT * INTO c FROM ops_contracts WHERE id=cid FOR UPDATE;
 IF c.id IS NULL OR c.company_id<>(data->>'company_id')::uuid OR (data->>'version')::integer IS DISTINCT FROM c.version THEN RAISE EXCEPTION 'Contrato atualizado ou indisponível. Recarregue'; END IF;
 END IF;
 IF cid IS NULL THEN
 INSERT INTO ops_contracts(company_id,reference,starts_at,ends_at,min_months,amount,periodicity,services_text,status,responsible_id,parent_id,partner_visible) VALUES((data->>'company_id')::uuid,trim(data->>'reference'),(data->>'starts_at')::date,nullif(data->>'ends_at','')::date,(data->>'min_months')::int,(data->>'amount')::numeric,data->>'periodicity',trim(data->>'services_text'),data->>'status',(data->>'responsible_id')::uuid,nullif(data->>'parent_id','')::uuid,coalesce((data->>'partner_visible')::boolean,false)) RETURNING id INTO cid;
 ELSE UPDATE ops_contracts SET reference=trim(data->>'reference'),starts_at=(data->>'starts_at')::date,ends_at=nullif(data->>'ends_at','')::date,min_months=(data->>'min_months')::int,amount=(data->>'amount')::numeric,periodicity=data->>'periodicity',services_text=trim(data->>'services_text'),status=data->>'status',responsible_id=(data->>'responsible_id')::uuid,partner_visible=coalesce((data->>'partner_visible')::boolean,false),version=version+1 WHERE id=cid; END IF;
 INSERT INTO ops_updates(company_id,contract_id,actor_id,body) VALUES((data->>'company_id')::uuid,cid,auth.uid(),'Contrato registrado/atualizado: '||trim(data->>'reference'));
 RETURN cid;
END $$;
CREATE FUNCTION public.ops_from_crm(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE d crm_deals;l crm_leads;c contracts;cid uuid;result_id uuid;responsible uuid; BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);
 SELECT company_id INTO cid FROM ops_contracts WHERE source_deal_id=(data->>'deal_id')::uuid;IF cid IS NOT NULL THEN RETURN cid; END IF;
 SELECT * INTO d FROM crm_deals WHERE id=(data->>'deal_id')::uuid;SELECT * INTO c FROM contracts WHERE id=d.contract_id;
 IF d.result IS DISTINCT FROM 'won' OR c.id IS NULL OR NOT c.active OR NOT EXISTS(SELECT 1 FROM meetings WHERE id=c.meeting_id AND status IN ('held','qualified')) THEN RAISE EXCEPTION 'Utilize um fechamento confirmado com contrato e reunião válidos'; END IF;
 SELECT * INTO l FROM crm_leads WHERE id=d.lead_id;cid:=nullif(data->>'company_id','')::uuid;
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
CREATE FUNCTION public.ops_save_service(data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s ops_services;sid uuid;cid uuid;BEGIN
 PERFORM require_admin();sid:=nullif(data->>'id','')::uuid;cid:=(data->>'company_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM ops_catalog WHERE id=(data->>'catalog_id')::uuid AND active) THEN RAISE EXCEPTION 'Serviço de catálogo inválido/inativo'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(data->'assignees','[]')) v WHERE NOT EXISTS(SELECT 1 FROM profiles WHERE id=v::uuid AND active AND category='employee')) THEN RAISE EXCEPTION 'Colaborador inválido'; END IF;
 IF sid IS NOT NULL THEN SELECT * INTO s FROM ops_services WHERE id=sid FOR UPDATE;IF s.id IS NULL OR s.company_id<>cid OR (data->>'version')::int IS DISTINCT FROM s.version THEN RAISE EXCEPTION 'Serviço atualizado ou indisponível. Recarregue';END IF;END IF;
 IF data->>'status'='completed' AND nullif(data->>'delivered_at','') IS NULL THEN RAISE EXCEPTION 'Informe a data de entrega ao concluir'; END IF;
 IF nullif(data->>'delivered_at','')::date>current_date THEN RAISE EXCEPTION 'Entrega não pode ser futura'; END IF;
 IF sid IS NULL THEN
 INSERT INTO ops_services(company_id,contract_id,catalog_id,description,partner_description,starts_at,due_at,delivered_at,status,partner_visible) VALUES(cid,(data->>'contract_id')::uuid,(data->>'catalog_id')::uuid,trim(data->>'description'),coalesce(data->>'partner_description',''),(data->>'starts_at')::date,nullif(data->>'due_at','')::date,nullif(data->>'delivered_at','')::date,data->>'status',coalesce((data->>'partner_visible')::boolean,false)) RETURNING id INTO sid;
 ELSE UPDATE ops_services SET contract_id=(data->>'contract_id')::uuid,catalog_id=(data->>'catalog_id')::uuid,description=trim(data->>'description'),partner_description=coalesce(data->>'partner_description',''),starts_at=(data->>'starts_at')::date,due_at=nullif(data->>'due_at','')::date,delivered_at=nullif(data->>'delivered_at','')::date,status=data->>'status',partner_visible=coalesce((data->>'partner_visible')::boolean,false),version=version+1 WHERE id=sid;END IF;
 DELETE FROM ops_service_assignments WHERE service_id=sid;INSERT INTO ops_service_assignments SELECT sid,v::uuid FROM jsonb_array_elements_text(coalesce(data->'assignees','[]')) v;
 INSERT INTO ops_updates(company_id,service_id,actor_id,body) VALUES(cid,sid,auth.uid(),'Serviço e responsáveis atualizados');RETURN sid;
END $$;
CREATE FUNCTION public.ops_progress(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE s ops_services;BEGIN
 SELECT * INTO s FROM ops_services WHERE id=(data->>'service_id')::uuid FOR UPDATE;
 IF s.id IS NULL OR NOT ops_service_access(s.id) THEN RAISE EXCEPTION 'Serviço indisponível'; END IF;
 IF (data->>'version')::int IS DISTINCT FROM s.version THEN RAISE EXCEPTION 'Serviço atualizado por outra pessoa. Recarregue'; END IF;
 IF data->>'status'='completed' AND nullif(data->>'delivered_at','') IS NULL THEN RAISE EXCEPTION 'Informe a data de entrega ao concluir'; END IF;
 IF nullif(data->>'delivered_at','')::date>current_date THEN RAISE EXCEPTION 'Entrega não pode ser futura';END IF;
 UPDATE ops_services SET status=data->>'status',delivered_at=nullif(data->>'delivered_at','')::date,version=version+1 WHERE id=s.id;
 INSERT INTO ops_updates(company_id,service_id,actor_id,body,partner_body,published) VALUES(s.company_id,s.id,auth.uid(),trim(data->>'body'),coalesce(data->>'partner_body',''),actor_role()='admin' AND coalesce((data->>'published')::boolean,false));
END $$;
CREATE FUNCTION public.ops_publish_update(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();
 UPDATE ops_updates SET partner_body=trim(coalesce(data->>'partner_body','')),published=coalesce((data->>'published')::boolean,false) WHERE id=(data->>'id')::uuid;
END $$;
CREATE FUNCTION public.ops_source_state(contract uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT CASE WHEN c.source_deal_id IS NULL THEN 'manual' WHEN x.id IS NULL OR NOT x.active THEN 'cancelled' WHEN d.result<>'won' OR m.status NOT IN ('held','qualified') THEN 'invalid' ELSE 'valid' END FROM ops_contracts c LEFT JOIN crm_deals d ON d.id=c.source_deal_id LEFT JOIN contracts x ON x.id=c.commercial_contract_id LEFT JOIN meetings m ON m.id=x.meeting_id WHERE c.id=contract $$;
CREATE INDEX ops_source_audit_lookup ON audit_logs(entity,entity_id,id DESC);
CREATE FUNCTION public.ops_source_revision(contract uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(max(a.id),0) FROM ops_contracts c JOIN contracts x ON x.id=c.commercial_contract_id LEFT JOIN audit_logs a ON (a.entity='contracts' AND a.entity_id=x.id::text OR a.entity='meetings' AND a.entity_id=x.meeting_id::text) WHERE c.id=contract $$;
CREATE FUNCTION public.ops_source_alerts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company_id',company_id,'reference',reference,'source_state',ops_source_state(id))),'[]') FROM ops_contracts WHERE actor_role()='admin' AND source_deal_id IS NOT NULL AND ops_source_state(id)<>'valid' AND (source_reviewed_state IS DISTINCT FROM ops_source_state(id) OR source_reviewed_revision IS DISTINCT FROM ops_source_revision(id)) $$;
CREATE FUNCTION public.ops_reconcile(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE c ops_contracts;BEGIN
 PERFORM require_admin();PERFORM pg_advisory_xact_lock(70013);
 IF data->>'confirm' IS DISTINCT FROM 'true' OR length(trim(coalesce(data->>'reason','')))<8 OR data->>'decision' NOT IN ('keep','paused','cancelled') THEN RAISE EXCEPTION 'Confirme a decisão e justifique a revisão';END IF;
 SELECT * INTO c FROM ops_contracts WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF c.id IS NULL OR c.source_deal_id IS NULL THEN RAISE EXCEPTION 'Contrato de origem indisponível';END IF;
 PERFORM set_config('ion.reason',data->>'reason',true);
 UPDATE ops_contracts SET status=CASE WHEN data->>'decision'='keep' THEN status ELSE data->>'decision' END,source_reviewed_state=ops_source_state(id),source_reviewed_revision=ops_source_revision(id),version=version+1 WHERE id=c.id;
 INSERT INTO ops_updates(company_id,contract_id,actor_id,body) VALUES(c.company_id,c.id,auth.uid(),'Revisão explícita da origem comercial: '||(data->>'reason'));
END $$;

CREATE OR REPLACE FUNCTION public.audit_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,old_state,new_state,reason) VALUES(auth.uid(),TG_OP,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'profile_id',to_jsonb(NEW)->>'company_id',to_jsonb(NEW)->>'service_id',to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'profile_id',to_jsonb(OLD)->>'company_id',to_jsonb(OLD)->>'service_id'),CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END,nullif(current_setting('ion.reason',true),''));RETURN coalesce(NEW,OLD); END $$;
-- All binary objects remain private. Only a matching reservation can be uploaded.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('ion-os-documents','ion-os-documents',false,10485760,ARRAY['application/pdf','image/png','image/jpeg','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
CREATE FUNCTION public.ops_begin_file(data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE fid uuid:=gen_random_uuid();cid uuid;sid uuid;contract uuid;path text;BEGIN
 cid:=(data->>'company_id')::uuid;sid:=nullif(data->>'service_id','')::uuid;contract:=nullif(data->>'contract_id','')::uuid;
 IF NOT ops_scope_access(cid,sid,contract) THEN RAISE EXCEPTION 'Sem permissão para enviar este documento'; END IF;
 IF data->>'mime' NOT IN ('application/pdf','image/png','image/jpeg','image/webp','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR data->>'mime' IS NULL THEN RAISE EXCEPTION 'Tipo de arquivo não permitido';END IF;
 path:=cid::text||'/'||fid::text;
 INSERT INTO ops_files(id,company_id,service_id,contract_id,name,mime,size,object_path,uploaded_by) VALUES(fid,cid,sid,contract,trim(data->>'name'),data->>'mime',(data->>'size')::bigint,path,auth.uid());
 RETURN jsonb_build_object('id',fid,'path',path,'bucket','ion-os-documents');
END $$;
CREATE FUNCTION public.ops_upload_allowed(path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM ops_files f WHERE f.object_path=path AND f.uploaded_by=auth.uid() AND f.state='pending' AND f.created_at>now()-interval '1 hour' AND ops_scope_access(f.company_id,f.service_id,f.contract_id)) $$;
CREATE FUNCTION public.ops_finish_file(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE f ops_files;BEGIN
 SELECT * INTO f FROM ops_files WHERE id=(data->>'id')::uuid FOR UPDATE;
 IF f.id IS NULL OR f.uploaded_by<>auth.uid() OR f.state<>'pending' OR NOT ops_scope_access(f.company_id,f.service_id,f.contract_id) THEN RAISE EXCEPTION 'Envio indisponível'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='ion-os-documents' AND name=f.object_path AND owner_id=auth.uid()::text AND (metadata->>'size')::bigint=f.size AND metadata->>'mimetype'=f.mime) THEN RAISE EXCEPTION 'Arquivo não confirmado ou metadados divergentes'; END IF;
 UPDATE ops_files SET state='ready' WHERE id=f.id;
 INSERT INTO ops_updates(company_id,service_id,contract_id,actor_id,body) VALUES(f.company_id,f.service_id,f.contract_id,auth.uid(),'Documento enviado: '||f.name);
END $$;
CREATE FUNCTION public.ops_file_read(fid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM ops_files f WHERE f.id=fid AND f.state='ready' AND (ops_scope_access(f.company_id,f.service_id,f.contract_id) OR ops_partner_access(f.company_id) AND f.partner_visible AND (f.service_id IS NULL OR EXISTS(SELECT 1 FROM ops_services s WHERE s.id=f.service_id AND s.partner_visible)) AND (f.contract_id IS NULL OR EXISTS(SELECT 1 FROM ops_contracts c WHERE c.id=f.contract_id AND c.partner_visible)))) $$;
CREATE FUNCTION public.ops_storage_read(path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM ops_files WHERE object_path=path AND ops_file_read(id)) $$;
CREATE FUNCTION public.ops_download(fid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT ops_file_read(fid) THEN RAISE EXCEPTION 'Documento indisponível';END IF;
 RETURN (SELECT jsonb_build_object('path',object_path,'name',name) FROM ops_files WHERE id=fid);
END $$;
CREATE FUNCTION public.ops_manage_file(data jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 PERFORM require_admin();
 IF data->>'state' NOT IN ('ready','archived') THEN RAISE EXCEPTION 'Estado inválido';END IF;
 UPDATE ops_files SET state=data->>'state',partner_visible=coalesce((data->>'partner_visible')::boolean,false) WHERE id=(data->>'id')::uuid AND state<>'pending';
END $$;
CREATE POLICY ops_document_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='ion-os-documents' AND owner_id=auth.uid()::text AND public.ops_upload_allowed(name));
CREATE POLICY ops_document_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='ion-os-documents' AND public.ops_storage_read(name));

DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['ops_clients','ops_admin_notes','ops_catalog','ops_contracts','ops_services','ops_service_assignments','ops_updates','ops_files'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_change()',t,t);
END LOOP;END $$;
CREATE POLICY ops_clients_read ON ops_clients FOR SELECT TO authenticated USING(ops_client_access(company_id));
CREATE POLICY ops_admin_notes_read ON ops_admin_notes FOR SELECT TO authenticated USING(actor_role()='admin');
CREATE POLICY ops_catalog_read ON ops_catalog FOR SELECT TO authenticated USING(actor_role()='admin' OR ops_employee());
CREATE POLICY ops_contracts_read ON ops_contracts FOR SELECT TO authenticated USING(ops_contract_access(id));
CREATE POLICY ops_services_read ON ops_services FOR SELECT TO authenticated USING(ops_service_access(id));
CREATE POLICY ops_assignments_read ON ops_service_assignments FOR SELECT TO authenticated USING(ops_service_access(service_id));
CREATE POLICY ops_updates_read ON ops_updates FOR SELECT TO authenticated USING(ops_scope_access(company_id,service_id,contract_id));
CREATE POLICY ops_files_read ON ops_files FOR SELECT TO authenticated USING(ops_scope_access(company_id,service_id,contract_id));

-- Whitelist-only partner projection; base tables, internal notes, amounts and authors stay private.
CREATE FUNCTION public.ops_partner_snapshot() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.company_id,'services',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',k.name,'description',s.partner_description,'status',s.status,'due_at',s.due_at,'delivered_at',s.delivered_at)) FROM ops_services s JOIN ops_catalog k ON k.id=s.catalog_id WHERE s.company_id=c.company_id AND s.partner_visible),'[]'),
 'contracts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'reference',x.reference,'status',x.status,'starts_at',x.starts_at,'ends_at',x.ends_at)) FROM ops_contracts x WHERE x.company_id=c.company_id AND x.partner_visible),'[]'),
 'updates',coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'body',u.partner_body,'created_at',u.created_at) ORDER BY u.created_at DESC) FROM ops_updates u WHERE u.company_id=c.company_id AND u.published AND u.partner_body<>'' AND (u.service_id IS NULL OR EXISTS(SELECT 1 FROM ops_services WHERE id=u.service_id AND partner_visible)) AND (u.contract_id IS NULL OR EXISTS(SELECT 1 FROM ops_contracts WHERE id=u.contract_id AND partner_visible))),'[]'),
 'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.name)) FROM ops_files f WHERE f.company_id=c.company_id AND ops_file_read(f.id)),'[]'))),'[]') FROM ops_clients c WHERE ops_partner_access(c.company_id) $$;
CREATE FUNCTION public.ops_filter_client(cid uuid,filters jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT (nullif(filters->>'company_id','') IS NULL OR cid=nullif(filters->>'company_id','')::uuid) AND
 ((nullif(filters->>'owner','') IS NULL AND nullif(filters->>'catalog_id','') IS NULL AND nullif(filters->>'status','') IS NULL) OR EXISTS(SELECT 1 FROM ops_services s WHERE s.company_id=cid AND
 (nullif(filters->>'owner','') IS NULL OR EXISTS(SELECT 1 FROM ops_service_assignments a WHERE a.service_id=s.id AND a.profile_id=nullif(filters->>'owner','')::uuid)) AND (nullif(filters->>'catalog_id','') IS NULL OR s.catalog_id=nullif(filters->>'catalog_id','')::uuid) AND (nullif(filters->>'status','') IS NULL OR s.status=filters->>'status'))) $$;
CREATE FUNCTION public.ops_list_clients(filters jsonb DEFAULT '{}'::jsonb,page integer DEFAULT 1,query text DEFAULT '') RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH scoped AS(SELECT c.*,jsonb_build_object('name',a.name,'active',a.active) AS access_companies FROM ops_clients c JOIN access_companies a ON a.id=c.company_id WHERE ops_filter_client(c.company_id,filters) AND (nullif(filters->>'relationship','') IS NULL OR c.relationship=filters->>'relationship') AND (query='' OR a.name ILIKE '%'||query||'%' OR c.contact ILIKE '%'||query||'%' OR c.phone ILIKE '%'||query||'%')),
 paged AS(SELECT * FROM scoped ORDER BY created_at DESC,company_id LIMIT 30 OFFSET (greatest(1,least(page,100000))-1)*30)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(p) FROM paged p),'[]'),'count',(SELECT count(*) FROM scoped)) $$;
CREATE FUNCTION public.ops_summary(filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH clients AS(SELECT * FROM ops_clients c WHERE ops_filter_client(c.company_id,filters) AND (nullif(filters->>'relationship','') IS NULL OR c.relationship=filters->>'relationship')),
 services AS(SELECT s.* FROM ops_services s JOIN clients c ON c.company_id=s.company_id WHERE (nullif(filters->>'owner','') IS NULL OR EXISTS(SELECT 1 FROM ops_service_assignments a WHERE a.service_id=s.id AND a.profile_id=nullif(filters->>'owner','')::uuid)) AND (nullif(filters->>'catalog_id','') IS NULL OR s.catalog_id=nullif(filters->>'catalog_id','')::uuid) AND (nullif(filters->>'status','') IS NULL OR s.status=filters->>'status'))
 SELECT jsonb_build_object('active_clients',(SELECT count(*) FROM clients WHERE relationship IN ('active','onboarding')),'inactive_clients',(SELECT count(*) FROM clients WHERE relationship IN ('inactive','ended','paused')),
 'active_contracts',(SELECT count(*) FROM ops_contracts x JOIN clients c ON c.company_id=x.company_id WHERE x.status='active'),
 'running',(SELECT count(*) FROM services WHERE status='running'),'completed',(SELECT count(*) FROM services WHERE status='completed'),'paused',(SELECT count(*) FROM services WHERE status='paused'),'overdue',(SELECT count(*) FROM services WHERE due_at<(now() at time zone 'America/Sao_Paulo')::date AND status IN ('pending','running'))) $$;
CREATE OR REPLACE FUNCTION public.current_access() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('category',p.category,'functions',coalesce((SELECT jsonb_agg(function_code ORDER BY function_code) FROM user_functions WHERE profile_id=p.id),'[]'),'challenger',can_challenger(),'crm',can_crm(),'clients',ops_employee() AND (EXISTS(SELECT 1 FROM client_assignments WHERE profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_service_assignments WHERE profile_id=p.id) OR EXISTS(SELECT 1 FROM ops_contracts WHERE responsible_id=p.id))) FROM profiles p WHERE p.id=auth.uid() AND p.active $$;
-- Reject PUBLIC defaults for every new function (including helpers).
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'ops_%' LOOP
 EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
END LOOP;END $$;
REVOKE EXECUTE ON FUNCTION public.ops_source_state(uuid),public.ops_source_revision(uuid) FROM authenticated;
COMMIT;
