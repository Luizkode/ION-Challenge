// Test-only Supabase HTTP double. Production never imports this fixture.
import { createServer } from "node:http";
const ids = {
  sdr: "10000000-0000-0000-0000-000000000001",
  closer: "10000000-0000-0000-0000-000000000002",
};
let state = { mode: "active", meetings: [], requests: [] };
const profiles = Object.fromEntries(
  Object.entries(ids).map(([role, id]) => [
    id,
    {
      id,
      name: role === "sdr" ? "SDR de teste" : "Closer de teste",
      role,
      active: true,
    },
  ]),
);
function user(id) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: (id === ids.sdr ? "sdr" : "closer") + "@ion.test",
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
        "authorization,apikey,content-type,x-client-info",
    });
    res.end(JSON.stringify(data));
  };
  if (req.method === "OPTIONS") return send({});
  if (url.pathname === "/__test/state") {
    if (req.method === "POST")
      state = { mode: body.mode ?? "active", meetings: [], requests: [] };
    return send(state);
  }
  if (url.pathname === "/auth/v1/token") {
    const id = body.email === "closer@ion.test" ? ids.closer : ids.sdr;
    return send({
      access_token: token(id),
      refresh_token: "test-only-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: user(id),
    });
  }
  const id = actor(req);
  if (!id) return send({ message: "Unauthorized" }, 401);
  if (url.pathname === "/auth/v1/user") return send(user(id));
  const table = url.pathname.split("/").at(-1);
  if (table === "dashboard")
    return send({
      individual: [],
      teams: [],
      held: 0,
      qualified: 0,
      contracts: 0,
      active_sdrs: 1,
    });
  const singular = req.headers.accept?.includes(
    "application/vnd.pgrst.object+json",
  );
  const rows = (data) => send(singular ? (data[0] ?? null) : data);
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
        : [profiles[id]],
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
  if (table === "campaign_participants")
    return rows(
      state.mode === "no_team"
        ? []
        : [{ team_id: "40000000-0000-0000-0000-000000000001" }],
    );
  if (table === "meetings")
    return rows(
      state.meetings.filter((m) => id === ids.sdr || m.closer_id === id),
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
