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
  const body = raw ? JSON.parse(raw) : {};
  const send = (data, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
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
  if (['crm_leads','crm_activities','crm_deals','crm_grants'].includes(table)) {
    let items=state[table]??[];
    if(url.searchParams.has('id'))items=items.filter(l=>l.id===url.searchParams.get('id').replace('eq.',''));
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
