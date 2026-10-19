// Test-only Supabase HTTP double. Production never imports this fixture.
import { createServer } from "node:http";
const ids = {
  sdr: "10000000-0000-0000-0000-000000000001",
  closer: "10000000-0000-0000-0000-000000000002",
  admin: "10000000-0000-0000-0000-000000000003",
  traffic: "10000000-0000-0000-0000-000000000004",
  partner: "10000000-0000-0000-0000-000000000005",
  multi: "10000000-0000-0000-0000-000000000006",
  inactive: "10000000-0000-0000-0000-000000000007",
};
const campaignId = "30000000-0000-0000-0000-000000000001";
const teamId = "40000000-0000-0000-0000-000000000001";
function initialState(mode = "active") {
  return {
    mode,
    meetings: [],
    ana_accounts:[{id:'97000000-0000-0000-0000-000000000001',company_id:'90000000-0000-0000-0000-000000000001',name:'Conta Meta de teste',reference:'act-test',platform:'meta',time_zone:'America/Sao_Paulo',attribution:'7 dias clique / 1 dia visualização',active:true,version:1}],
    ana_campaigns:[{id:'97000000-0000-0000-0000-000000000002',company_id:'90000000-0000-0000-0000-000000000001',account_id:'97000000-0000-0000-0000-000000000001',name:'Campanha de teste',reference:'campaign-test',contract_id:null,active:true,version:1,published:mode==='analytics_published',published_metrics:['spend','impressions','clicks','ctr']}],
    ana_metrics:mode==='analytics_published'?[{id:'97000000-0000-0000-0000-000000000003',campaign_id:'97000000-0000-0000-0000-000000000002',period_from:'2020-01-01',period_to:'2020-01-01',spend:'10.25',impressions:'1000',clicks:'10',source_reference:'ORIGEM INTERNA PRIVADA',revenue_evidence:'EVIDÊNCIA PRIVADA',revenue:'999.99',source_kind:'csv',published:true,version:1,updated_at:new Date().toISOString()}]:[],
    ana_reports:[],ana_grants:[],
    ops_clients: [{company_id:'90000000-0000-0000-0000-000000000001',contact:'Contato A',phone:'11900000001',email:'a@example.com',niche:'Serviços',city:'São Paulo',state:'SP',instagram:'',website:'',joined_at:'2026-01-01',relationship:'active',partner_visible:mode==='analytics_published',version:1,created_at:new Date().toISOString(),access_companies:{name:'Empresa A',active:true}}],
    ops_contracts: [],ops_services: [],ops_updates: [],ops_files: [],ops_service_assignments: [],
    crm_leads: [],
    crm_activities: [],
    crm_deals: [],
    requests: [],
    invitations: [],
    participants: [
      {
        campaign_id: campaignId,
        profile_id: ids.sdr,
        team_id: teamId,
        active: true,
        profiles: { name: "SDR de teste" },
        teams: { name: "Time original" },
      },
    ],
  };
}
let state = initialState();
const profiles = Object.fromEntries(
  Object.entries(ids).map(([role, id]) => [
    id,
    {
      id,
      name:
        role === "sdr"
          ? "SDR de teste"
          : role === "admin"
            ? "Administrador de teste"
            : "Closer de teste",
      role: ["traffic", "inactive"].includes(role)
        ? "member"
        : role === "multi"
          ? "sdr"
          : role,
      category:
        role === "admin"
          ? "admin"
          : role === "partner"
            ? "partner"
            : "employee",
      functions:
        role === "multi"
          ? ["sdr", "closer", "traffic"]
          : role === "inactive"
            ? ["traffic"]
            : ["sdr", "closer", "traffic"].includes(role)
              ? [role]
              : [],
      active: role !== "inactive",
    },
  ]),
);
function user(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: Object.keys(ids).find((role) => ids[role] === id) + "@ion.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
}
function token(id) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "test-only-signature",
  ].join(".");
}
function actor(req) {
  try {
    return JSON.parse(
      Buffer.from(
        req.headers.authorization.split(" ")[1].split(".")[1],
        "base64url",
      ).toString(),
    ).sub;
  } catch {
    return null;
  }
}
const initialProfiles = structuredClone(profiles);
createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:3101");
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw && req.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {};
  const send = (data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info,x-supabase-api-version,x-upsert,cache-control",
    });
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") return send({});
  if (url.pathname === "/__test/state") {
    if (req.method === "POST") {
      state = initialState(body.mode ?? "active");
      for (const key of Object.keys(profiles)) delete profiles[key];
      Object.assign(profiles, structuredClone(initialProfiles));
    }
    return send(state);
  }
  if (url.pathname === "/auth/v1/token") {
    const id = ids[body.email.split("@")[0]] ?? ids.sdr;
    return send({
      access_token: token(id),
      refresh_token: "test-only-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: user(id),
    });
  }
  if (url.pathname === "/auth/v1/invite") {
    if (req.headers.authorization !== "Bearer test-only-service-role")
      return send({ message: "Unauthorized" }, 401);
    if (state.mode === "invite_error")
      return send({ message: "Test email delivery failure" }, 500);
    return send({
      ...user("10000000-0000-0000-0000-000000000008"),
      email: body.email,
    });
  }
  const id = actor(req);
  if (!id) return send({ message: "Unauthorized" }, 401);
  if (url.pathname === "/auth/v1/user") return send(user(id));
  const table = url.pathname.split("/").at(-1);
  if (table === "current_access")
    return send(
      profiles[id].active
        ? {
            category: profiles[id].category,
            functions: profiles[id].functions,
            challenger:
              profiles[id].category === "admin" ||
              profiles[id].functions.includes("closer") ||
              (profiles[id].functions.includes("sdr") &&
                state.participants.some(
                  (p) => p.profile_id === id && p.active,
                )),
          }
        : null,
    );
  if (url.pathname.startsWith('/storage/v1/')) {
    if(url.pathname.includes('/sign/'))return send({signedURL:url.pathname.replace('/storage/v1','')+'?token=test-only'});
    return send({Key:url.pathname.split('/object/')[1],Id:crypto.randomUUID()});
  }
  if(table?.startsWith('ana_')) {
    const admin=profiles[id].category==='admin',partner=profiles[id].category==='partner';
    const cols=['spend','reach','impressions','frequency','clicks','ctr','cpc','cpm','leads','cpl','conversions','acquisitions','cpa','revenue','roas'];
    const company=state.ops_clients[0]?.company_id;
    const data=body.data;
    function snapshot(filters={},portal=false) {
      const rows=state.ana_metrics.filter(m=>!m.voided&&m.period_from>=(filters.from||'0000')&&m.period_to<=(filters.to||'9999')).filter(m=>!filters.campaign_id||m.campaign_id===filters.campaign_id).filter(m=>!portal||m.published&&state.ana_campaigns.find(c=>c.id===m.campaign_id)?.published).map(m=>{const c=state.ana_campaigns.find(c=>c.id===m.campaign_id);const a=state.ana_accounts.find(a=>a.id===c.account_id);const row={...m,company_id:c.company_id,company:'Empresa A',campaign:c.name,account_id:a.id,account:a.name,platform:a.platform,time_zone:a.time_zone,attribution:a.attribution,allowed:portal?c.published_metrics:cols,contract_id:null,contract_reference:null};if(portal){delete row.source_reference;delete row.revenue_evidence;for(const k of ['spend','reach','impressions','clicks','leads','conversions','acquisitions','revenue'])if(!c.published_metrics.includes(k))row[k]=null;}return row;});
      // UI double only: financial/ratio aggregation is verified in PostgreSQL, not here.
      const keys=portal?state.ana_campaigns[0].published_metrics:cols;const stats=Object.fromEntries(keys.map(k=>[k,rows.length===1?(rows[0][k]??null):null]));
      return {from:filters.from||'2020-01-01',to:filters.to||'2020-01-01',generated_at:new Date().toISOString(),record_count:rows.length,partial_count:0,stats,records:rows,groups:[],points:rows.map(r=>({...r,from:r.period_from,to:r.period_to,stats:Object.fromEntries(keys.map(k=>[k,r[k]??null]))})),sources:rows,methodology:'Resultados reais da fixture de interface; cálculos verificados no PostgreSQL.',comparison:null};
    }
    if(table==='ana_overview')return send({clients:state.ana_metrics.length?1:0,records:state.ana_metrics.length,reports:state.ana_reports.length,published_reports:state.ana_reports.filter(r=>r.published).length});
    if(table==='ana_partner_options')return send({companies:state.ops_clients.filter(c=>c.partner_visible).map(c=>({id:c.company_id,name:c.access_companies.name})),campaigns:state.ana_campaigns.filter(c=>c.published),reports:state.ana_reports.filter(r=>r.published)});
    if(table==='ana_report'||table==='ana_portal_report')return send(snapshot(body.filters,partner||table==='ana_portal_report'));
    if(table==='ana_get_report'){const r=state.ana_reports.find(r=>r.id===body.rid);if(!r||(partner||body.portal)&&!r.published)return send({code:'P0001',message:'Relatório indisponível'},400);return send({...r,company:'Empresa A',snapshot:partner||body.portal?snapshot(r.filters,true):r.snapshot});}
    if(partner)return send({code:'P0001',message:'Somente consulta'},403);
    if(table==='ana_options')return send({companies:state.ops_clients.map(c=>({id:c.company_id,name:c.access_companies.name,can_write:true,portal_visible:c.partner_visible})),accounts:state.ana_accounts,campaigns:state.ana_campaigns,contracts:state.ops_contracts,reports:state.ana_reports,people:Object.values(profiles).filter(p=>p.category==='employee'),grants:state.ana_grants});
    if(table==='ana_history')return send([]);
    if(table==='ana_metric_detail')return send(state.ana_metrics.find(r=>r.id===body.mid));
    if(table==='ana_save_account'||table==='ana_save_campaign'){const list=table==='ana_save_account'?state.ana_accounts:state.ana_campaigns;const old=list.find(r=>r.id===data.id);const item={...data,id:old?.id||crypto.randomUUID(),version:(old?.version||0)+1,published:false,published_metrics:[]};if(old)Object.assign(old,item);else list.push(item);return send(item.id);}
    if(table==='ana_save_metric'){const old=state.ana_metrics.find(r=>r.id===data.id);const item={...data,id:old?.id||crypto.randomUUID(),version:(old?.version||0)+1,published:false,source_kind:old?.source_kind||'manual',updated_at:new Date().toISOString()};if(old)Object.assign(old,item);else state.ana_metrics.push(item);return send(item.id);}
    if(table==='ana_import'){for(const d of body.rows)state.ana_metrics.push({...d,id:crypto.randomUUID(),version:1,published:false,source_kind:'csv',updated_at:new Date().toISOString()});return send({inserted:body.rows.length,unchanged:0});}
    if(table==='ana_create_report'){const r={id:crypto.randomUUID(),company_id:data.company_id,title:data.title,period_from:data.from,period_to:data.to,created_at:new Date().toISOString(),published:false,filters:data,snapshot:snapshot(data)};state.ana_reports.push(r);return send(r.id);}
    if(!admin)return send({code:'P0001',message:'Somente administrador'},403);
    if(table==='ana_publish_campaign'){const c=state.ana_campaigns.find(c=>c.id===data.id);c.published=data.published;c.published_metrics=data.metrics;return send(null);}
    if(table==='ana_publish_metrics'){const rows=state.ana_metrics.filter(r=>r.campaign_id===data.campaign_id);for(const r of rows)r.published=data.published;return send(rows.length);}
    if(table==='ana_publish_report'){const r=state.ana_reports.find(r=>r.id===data.id);r.published=data.published;return send(null);}
    if(table==='ana_save_grant'){state.ana_grants.push(data);return send(null);}
  }
  if (table === 'fin_report') {
    if(profiles[id].category!=='admin')return send({code:'P0001',message:'Acesso restrito ao administrador'},403);
    return send({stats:Object.fromEntries(['received','spent','commission_paid','income_due','expense_due','receivable','payable','commission_pending','overdue','operating','cash_net','mrr'].map(k=>[k,'0.00'])),entries:[],daily:[],cash:[],categories:[],delinquency:[],commissions:[]});
  }
  if (table === 'fin_options')return send({categories:[{id:'96000000-0000-0000-0000-000000000001',name:'Outras receitas',kind:'income'},{id:'96000000-0000-0000-0000-000000000002',name:'Outras despesas',kind:'expense'}],companies:[],contracts:[],people:[],schedules:[],rules:[],closures:[]});
  if (table === 'ops_summary')return send({active_clients:state.ops_clients.length,inactive_clients:0,active_contracts:state.ops_contracts.filter(c=>c.status==='active').length,running:state.ops_services.filter(c=>c.status==='running').length,completed:state.ops_services.filter(c=>c.status==='completed').length,paused:0,overdue:0});
  if(table==='ops_list_clients')return send({rows:state.ops_clients,count:state.ops_clients.length});
  if(table==='ops_partner_snapshot'||table==='ops_source_alerts')return send([]);
  if(table==='ops_directory'||table==='ops_people')return send(Object.values(profiles).filter(p=>p.category==='employee'&&p.active).map(p=>({id:p.id,name:p.name})));
  if(table==='ops_catalog')return send([{id:'91000000-0000-0000-0000-000000000001',name:'Design',active:true},{id:'91000000-0000-0000-0000-000000000002',name:'Gestão de tráfego pago',active:true}]);
  if(table==='ops_save_client'){const d=body.data;const existing=state.ops_clients.find(c=>c.company_id===d.company_id);const id=existing?.company_id??crypto.randomUUID();const c={...d,company_id:id,version:(existing?.version??0)+1,created_at:new Date().toISOString(),access_companies:{name:d.name,active:true}};if(existing)Object.assign(existing,c);else state.ops_clients.push(c);return send(id);}
  if(table==='ops_save_contract'){const d=body.data;const c={...d,id:d.id||crypto.randomUUID(),version:1,created_at:new Date().toISOString(),source_deal_id:null,commercial_contract_id:null};state.ops_contracts.push(c);return send(c.id);}
  if(table==='ops_save_service'){const d=body.data;const s={...d,id:d.id||crypto.randomUUID(),version:1,created_at:new Date().toISOString(),ops_catalog:{name:d.catalog_id.endsWith('1')?'Design':'Gestão de tráfego pago'}};state.ops_services.push(s);for(const profile_id of d.assignees)state.ops_service_assignments.push({service_id:s.id,profile_id});return send(s.id);}
  if(table==='ops_progress'){const d=body.data;const service=state.ops_services.find(s=>s.id===d.service_id);Object.assign(service,{status:d.status,version:service.version+1,delivered_at:d.delivered_at});state.ops_updates.push({...d,id:crypto.randomUUID(),actor_id:id,company_id:service.company_id,created_at:new Date().toISOString()});return send(null);}
  if(table==='ops_begin_file'){const d=body.data;const fid=crypto.randomUUID();const path=d.company_id+'/'+fid;state.ops_files.push({...d,id:fid,state:'pending',object_path:path,uploaded_by:id,created_at:new Date().toISOString(),partner_visible:false});return send({id:fid,path,bucket:'ion-os-documents'});}
  if(table==='ops_finish_file'){const f=state.ops_files.find(f=>f.id===body.data.id);f.state='ready';return send(null);}
  if(table==='ops_download'){const f=state.ops_files.find(f=>f.id===body.fid);return send({path:f.object_path,name:f.name});}
  if (table === "crm_directory") return send(Object.values(profiles).filter(p=>p.active && p.functions.some(f=>['sdr','closer'].includes(f))).map(p=>({...p,is_sdr:p.functions.includes('sdr'),is_closer:p.functions.includes('closer')})));
  if (table === "crm_report") return send({leads:state.crm_leads.length,contacts:state.crm_activities.filter(a=>a.kind==='contact').length,scheduled:state.meetings.length,held:0,won:state.crm_deals.filter(d=>d.result==='won').length,proposals:state.crm_deals.filter(d=>d.result==='proposal').length,response:0,attendance:0,conversion:0,performance:[]});
  if (table === "crm_save_lead") {
    const data=body.data;const existing=state.crm_leads.find(l=>l.id===data.id);
    if(state.crm_leads.some(l=>l.phone===data.phone && l.id!==data.id))return send({code:'P0001',message:'Possível duplicidade de WhatsApp ou email'},400);
    const lead={...(existing??{id:crypto.randomUUID(),version:0,stage:'new',created_at:new Date().toISOString(),archived:false,last_contact_at:null}),...data,sdr_id:profiles[id].role==='admin'?data.sdr_id:id,updated_at:new Date().toISOString()};lead.version++;
    if(existing)Object.assign(existing,lead);else state.crm_leads.push(lead);return send(lead.id);
  }
  if (table === "crm_activity") {const data=body.data;const l=state.crm_leads.find(l=>l.id===data.lead_id);state.crm_activities.push({...data,id:crypto.randomUUID(),actor_id:id,created_at:new Date().toISOString()});if(l && data.stage)l.stage=data.stage;return send(null);}
  if (table === "crm_record_deal") {const data=body.data;state.crm_deals.push({...data,id:crypto.randomUUID(),created_at:new Date().toISOString(),contract_id:null});const l=state.crm_leads.find(l=>l.id===data.lead_id);if(l)l.stage=data.result==='proposal'?'proposed':data.result;return send(state.crm_deals.at(-1).id);}
  if (table === "crm_schedule_meeting") {const data=body.data;const l=state.crm_leads.find(l=>l.id===data.lead_id);state.meetings.push({...data,id:crypto.randomUUID(),opportunity_id:crypto.randomUUID(),closer_id:data.closer_id,status:'scheduled',opportunities:{company:l.company,crm_lead_id:l.id,sdr_id:l.sdr_id,campaign_id:campaignId}});l.stage='scheduled';return send(state.meetings.at(-1).id);}
  if (table === "crm_import_leads") {state.requests.push(body);if(body.rows.some(r=>state.crm_leads.some(l=>l.phone===r.phone)))return send({code:'P0001',message:'Possível duplicidade de WhatsApp ou email'},400);for(const row of body.rows)state.crm_leads.push({...row,id:crypto.randomUUID(),sdr_id:profiles[id].role==='admin'?row.sdr_id:id,version:1,stage:'new',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),archived:false});return send(body.rows.length);}
  if (table === "available_closers")
    return state.mode === "query_error"
      ? send({ message: "Test failure" }, 400)
      : send(
          state.mode === "no_closer"
            ? []
            : [profiles[ids.closer], profiles[ids.multi]],
        );
  if (table === "user_functions")
    return send(
      Object.values(profiles).flatMap((p) =>
        p.functions.map((function_code) => ({
          profile_id: p.id,
          function_code,
        })),
      ),
    );
  if (table === "access_companies")
    return send([
      ...state.ops_clients.filter(c=>!c.company_id.startsWith("90000000")).map(c=>({id:c.company_id,name:c.access_companies.name,active:true})),
      {
        id: "90000000-0000-0000-0000-000000000001",
        name: "Empresa A",
        active: true,
      },
      ...(profiles[id].category === "admin"
        ? [
            {
              id: "90000000-0000-0000-0000-000000000002",
              name: "Empresa B",
              active: true,
            },
          ]
        : []),
    ]);
  if (table === "client_assignments")
    return send([
      {
        profile_id: ids.traffic,
        company_id: "90000000-0000-0000-0000-000000000001",
      },
    ]);
  if (table === "partner_companies")
    return send([
      {
        profile_id: ids.partner,
        company_id: "90000000-0000-0000-0000-000000000001",
      },
    ]);
  if (table === "access_invitations") return send(state.invitations);
  if (table === "manage_access") {
    state.requests.push(body);
    const data = body.data;
    if (profiles[id].category !== "admin")
      return send({ message: "Acesso restrito" }, 400);
    const target = profiles[data.id];
    profiles[data.id] = {
      ...target,
      id: data.id,
      name: data.name,
      category: data.category,
      functions: data.functions,
      active: data.active === "true",
      role:
        data.category === "admin"
          ? "admin"
          : data.category === "partner"
            ? "partner"
            : data.functions.includes("sdr")
              ? "sdr"
              : data.functions.includes("closer")
                ? "closer"
                : "member",
    };
    return send(null);
  }
  if (table === "begin_access_invite") {
    const iid = "a0000000-0000-0000-0000-000000000001";
    state.invitations.push({
      id: iid,
      ...body.data,
      status: "pending",
      created_at: new Date().toISOString(),
    });
    return send(iid);
  }
  if (table === "complete_access_invite") {
    state.invitations[0].status = "completed";
    return send(null);
  }
  if (table === "fail_access_invite") {
    state.invitations[0].status = "failed";
    return send(null);
  }
  if (table === "dashboard")
    return send({
      individual: state.participants
        .filter((p) => p.active)
        .map((p) => ({
          id: p.profile_id,
          name: profiles[p.profile_id].name,
          team: "Time original",
          points: state.mode.startsWith("admin") ? 7 : 0,
          held: 1,
          qualified: 1,
          contracts: 1,
          position: 1,
          active: true,
        })),
      teams: [],
      held: state.mode.startsWith("admin") ? 1 : 0,
      qualified: 0,
      contracts: 0,
      active_sdrs: 1,
    });
  const singular = req.headers.accept?.includes(
    "application/vnd.pgrst.object+json",
  );
  const rows = (data) => send(singular ? (data[0] ?? null) : data);
  if (['crm_leads','crm_activities','crm_deals','crm_grants','ops_clients','ops_contracts','ops_services','ops_updates','ops_files','ops_admin_notes','ops_service_assignments'].includes(table)) {
    let items=state[table]??[];
    if(url.searchParams.has('id'))items=items.filter(l=>l.id===url.searchParams.get('id').replace('eq.',''));
    if(url.searchParams.has('company_id'))items=items.filter(l=>l.company_id===url.searchParams.get('company_id').replace('eq.',''));
    if(url.searchParams.has('lead_id'))items=items.filter(l=>l.lead_id===url.searchParams.get('lead_id').replace('eq.',''));
    res.setHeader('Content-Range',`0-${Math.max(0,items.length-1)}/${items.length}`);
    return rows(items);
  }
  if (table === "profiles") {
    if (state.mode === "query_error" && url.searchParams.has("role"))
      return send(
        { message: "Test-only connection failure", code: "TEST" },
        400,
      );
    return rows(
      url.searchParams.has("role")
        ? state.mode === "no_closer"
          ? []
          : [profiles[ids.closer]]
        : url.searchParams.has("id")
          ? [profiles[url.searchParams.get("id").replace("eq.", "")]]
          : Object.values(profiles),
    );
  }
  const campaign = {
    id: "30000000-0000-0000-0000-000000000001",
    state: "active",
    goal: 700,
    prize: "iPhone 13",
    starts_at: new Date(
      Date.now() + (state.mode === "future" ? 86400000 : -86400000),
    ).toISOString(),
    ends_at: new Date(
      Date.now() + (state.mode === "ended" ? -1000 : 86400000 * 55),
    ).toISOString(),
  };
  if (table === "campaigns")
    return rows(state.mode === "draft" ? [] : [campaign]);
  if (table === "teams") return rows([{ id: teamId, name: "Time original" }]);
  if (table === "campaign_participants")
    return rows(
      state.mode === "no_team"
        ? []
        : state.participants.filter(
            (p) =>
              (!url.searchParams.has("profile_id") ||
                p.profile_id ===
                  url.searchParams.get("profile_id").replace("eq.", "")) &&
              (!url.searchParams.has("active") || p.active),
          ),
    );
  if (table === "admin_operation") {
    state.requests.push(body);
    if (profiles[id].role !== "admin")
      return send(
        { message: "Acesso restrito ao administrador", code: "P0001" },
        400,
      );
    if (state.mode === "admin_error")
      return send(
        {
          message: "Falha administrativa de teste; nenhuma alteração aplicada",
          code: "P0001",
        },
        400,
      );
    const data = body.data;
    if (body.operation === "participant") {
      const p = state.participants.find(
        (p) => p.profile_id === data.profile_id,
      );
      if (data.remove === "true") p.active = false;
      else if (p) p.active = true;
    }
    if (body.operation === "profile") {
      if (data.remove_from_campaign === "true")
        state.participants
          .filter((p) => p.profile_id === data.id)
          .forEach((p) => (p.active = false));
      profiles[data.id] = {
        ...profiles[data.id],
        role: data.role,
        category: data.role === "admin" ? "admin" : "employee",
        functions: ["sdr", "closer"].includes(data.role) ? [data.role] : [],
        name: data.name,
        active: data.active === "true",
      };
    }
    return send(null);
  }
  if (table === "meetings")
    return rows(
      state.meetings.filter((m) => (profiles[id].role === "admin" || id === ids.sdr || m.closer_id === id) && (!url.searchParams.has("opportunities.crm_lead_id") || (url.searchParams.get("opportunities.crm_lead_id").startsWith("eq.") ? m.opportunities.crm_lead_id===url.searchParams.get("opportunities.crm_lead_id").slice(3) : !!m.opportunities.crm_lead_id))),
    );
  if (table === "opportunities")
    return rows(state.meetings.map((m) => m.opportunities));
  if (table === "create_meeting") {
    state.requests.push(body.data);
    if (state.mode === "rpc_error")
      return send(
        {
          message: "Possível duplicidade: selecione a oportunidade existente",
          code: "P0001",
        },
        400,
      );
    const data = body.data;
    const oid = "50000000-0000-0000-0000-000000000001";
    const mid = "60000000-0000-0000-0000-000000000001";
    state.meetings.push({
      id: mid,
      opportunity_id: oid,
      closer_id: data.closer_id,
      scheduled_at: data.scheduled_at,
      status: "scheduled",
      notes: data.notes,
      opportunities: {
        id: oid,
        sdr_id: id,
        company: data.company,
        contact: data.contact,
        phone: data.phone,
        city: data.city,
        niche: data.niche,
      },
    });
    return send(mid);
  }
  return rows([]);
}).listen(3101, "127.0.0.1");
