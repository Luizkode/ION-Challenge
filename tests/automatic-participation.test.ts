import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { chooseCampaign } from "../lib/campaign-selection";
const uid = (n: number) =>
  `92000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Seleção de campanha é explícita e estável com várias campanhas abertas", () => {
  const list = [
    { id: "draft", state: "draft", starts_at: null },
    { id: "later", state: "active", starts_at: "2026-11-02" },
    { id: "live", state: "active", starts_at: "2026-11-01" },
  ];
  assert.equal(chooseCampaign(list)?.id, "live");
  assert.equal(chooseCampaign(list, "later")?.id, "later");
  assert.equal(chooseCampaign(list, "invalid"), undefined);
});
test("Participação automática PostgreSQL: funções, equipes, simultaneidade e histórico", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,last_sign_in_at timestamptz,email_confirmed_at timestamptz,invited_at timestamptz,banned_until timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);create table auth.refresh_tokens(id int,user_id text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const f of ["storage.sql", "storage-operations.sql"])
    await db.exec(
      await readFile(new URL("./fixtures/" + f, import.meta.url), "utf8"),
    );
  for (const f of (
    await readdir(new URL("../supabase/migrations", import.meta.url))
  )
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + f, import.meta.url),
        "utf8",
      ),
    );
  const q = async (s: string, p: unknown[] = []) =>
    (await db.query<any>(s, p)).rows;
  const scalar = async (s: string, p: unknown[] = []) => (await q(s, p))[0]?.r;
  const owner = () =>
    db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)",
    );
  const actor = async (n: number) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
    await db.exec("set role authenticated");
  };
  const rpc = (fn: string, d: unknown) =>
    scalar(`select ${fn}($1::jsonb) r`, [JSON.stringify(d)]);
  const add = async (n: number, role: string) => {
    await owner();
    await q("insert into auth.users(id,email) values($1,$2)", [
      uid(n),
      `auto${n}@example.invalid`,
    ]);
    await q("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Auto " + n,
      role,
    ]);
  };
  for (const [n, r] of [
    [1, "admin"],
    [2, "sdr"],
    [3, "closer"],
    [4, "sdr"],
    [5, "member"],
    [6, "partner"],
  ] as const)
    await add(n, r);
  const ca = await scalar(
    "update campaigns set state='active',starts_at=now()-interval '2 days',ends_at=now()+interval '20 days' returning id r",
  );
  const team = await scalar(
    "insert into teams(name) values('Original team') returning id r",
  );
  let ca2: string, mid: string, lead: string;
  await t.test(
    "Todos os SDRs ativos entram sem equipe arbitrária; demais funções não entram",
    async () => {
      const rows = await q(
        "select * from campaign_participants where campaign_id=$1",
        [ca],
      );
      assert.equal(rows.length, 2);
      assert(rows.every((r) => r.active && r.team_id === null));
      await actor(2);
      const b = await scalar("select dashboard($1) r", [ca]);
      assert.equal(b.individual.length, 2);
      assert.equal(b.individual[0].team, "Sem equipe definida");
      assert.equal(b.teams.length, 0);
    },
  );
  await t.test(
    "Novo SDR e múltiplas funções são incluídos em todas as campanhas simultâneas",
    async () => {
      await owner();
      ca2 = await scalar(
        "insert into campaigns(name,state,starts_at,ends_at) values('Concurrent','active',now()-interval '1 day',now()+interval '20 days') returning id r",
      );
      await q("insert into user_functions values($1,'sdr')", [uid(5)]);
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(5)],
        ),
        2,
      );
      await add(7, "sdr");
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(7)],
        ),
        2,
      );
    },
  );
  await t.test(
    "ADM define equipe explicitamente, função perdida e reativação preservam a mesma linha/equipe",
    async () => {
      await actor(1);
      await scalar("select admin_operation('participant',$1::jsonb) r", [
        JSON.stringify({
          campaign_id: ca,
          profile_id: uid(2),
          team_id: team,
          confirm: "true",
          reason: "Equipe explicitamente escolhida",
        }),
      ]);
      await owner();
      await q("update profiles set active=false where id=$1", [uid(2)]);
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(2)],
        ),
        0,
      );
      assert.equal(
        await scalar(
          "select team_id r from campaign_participants where campaign_id=$1 and profile_id=$2",
          [ca, uid(2)],
        ),
        team,
      );
      await q("update profiles set active=true where id=$1", [uid(2)]);
      await q(
        "delete from user_functions where profile_id=$1 and function_code='sdr'",
        [uid(2)],
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(2)],
        ),
        0,
      );
      await q("insert into user_functions values($1,'sdr')", [uid(2)]);
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(2)],
        ),
        2,
      );
      assert.equal(
        await scalar(
          "select team_id r from campaign_participants where campaign_id=$1 and profile_id=$2",
          [ca, uid(2)],
        ),
        team,
      );
    },
  );
  await t.test(
    "Permissões são atômicas, promoção a ADM não requer remoção manual e não duplica vínculos",
    async () => {
      await actor(1);
      const d = {
        id: uid(4),
        name: "Auto 4",
        category: "admin",
        functions: [],
        company_ids: [],
        active: "true",
        confirm: "true",
        reason: "Promoção administrativa autorizada",
      };
      await rpc("manage_access", d);
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(4)],
        ),
        0,
      );
      await rpc("manage_access", {
        ...d,
        category: "employee",
        functions: ["sdr", "closer"],
      });
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1",
          [uid(4)],
        ),
        2,
      );
      await assert.rejects(
        scalar("select admin_operation('participant',$1::jsonb) r", [
          JSON.stringify({
            campaign_id: ca,
            profile_id: uid(4),
            remove: "true",
            confirm: "true",
            reason: "Não pode excluir individualmente",
          }),
        ]),
        /automática/,
      );
      await actor(2);
      await assert.rejects(
        scalar("select sync_sdr_participation() r"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "Cadastro sem equipe, CRM e validação continuam únicos; múltiplas campanhas não duplicam pontos",
    async () => {
      await actor(2);
      lead = await rpc("crm_save_lead", {
        company: "Auto CRM",
        contact: "Contato",
        phone: "11999990001",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        source: "Teste",
        closer_id: uid(3),
      });
      mid = await rpc("crm_schedule_meeting", {
        lead_id: lead,
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      });
      assert.equal(
        await scalar(
          "select campaign_id r from opportunities where crm_lead_id=$1",
          [lead],
        ),
        ca,
      );
      await actor(7);
      const m = await rpc("create_meeting", {
        campaign_id: ca2,
        company: "Sem equipe",
        contact: "Contato",
        phone: "11999990002",
        city: "São Paulo",
        niche: "Serviços",
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      });
      await owner();
      assert.equal(
        await scalar(
          "select team_id r from opportunities o join meetings m on m.opportunity_id=o.id where m.id=$1",
          [m],
        ),
        null,
      );
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores",
        ),
        0,
      );
      await q(
        "update meetings set scheduled_at=now()-interval '1 hour' where id=$1",
        [mid],
      );
      await actor(3);
      await rpc("validate_meeting", {
        id: mid,
        attended: true,
        qualified: false,
        notes: "Validação oficial",
      });
      await owner();
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores where campaign_id=$1",
          [ca],
        ),
        1,
      );
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores where campaign_id=$1",
          [ca2],
        ),
        0,
      );
    },
  );
  await t.test(
    "Desativação, perda de função e reativação preservam pontos, equipe e atomicidade",
    async () => {
      await actor(1);
      const access = {
        id: uid(2),
        name: "Auto 2",
        category: "employee",
        functions: ["sdr"],
        company_ids: [],
        active: "false",
        confirm: "true",
        reason: "Situação administrativa de teste",
      };
      await rpc("manage_access", access);
      const inactive = await scalar("select dashboard($1) r", [ca]);
      assert(!inactive.individual.some((r: any) => r.id === uid(2)));
      await rpc("manage_access", { ...access, active: "true" });
      const restored = await scalar("select dashboard($1) r", [ca]);
      assert.equal(
        restored.individual.find((r: any) => r.id === uid(2)).points,
        1,
      );
      assert.equal(
        await scalar(
          "select team_id r from campaign_participants where campaign_id=$1 and profile_id=$2",
          [ca, uid(2)],
        ),
        team,
      );
      await assert.rejects(
        rpc("manage_access", {
          ...access,
          active: "true",
          functions: ["invalid"],
        }),
        /inválida/,
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(2)],
        ),
        2,
      );
      await rpc("manage_access", {
        ...access,
        active: "true",
        functions: ["closer"],
      });
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and active",
          [uid(2)],
        ),
        0,
      );
      await rpc("manage_access", { ...access, active: "true" });
      assert.equal(
        (await scalar("select dashboard($1) r", [ca])).individual.find(
          (r: any) => r.id === uid(2),
        ).points,
        1,
      );
    },
  );
  await t.test(
    "Campanhas encerradas/finalizadas não recebem participantes nem alterações retroativas",
    async () => {
      await owner();
      await q("update campaigns set state='finalized' where id=$1", [ca]);
      await q("update campaigns set state='ended' where id=$1", [ca2]);
      const before = await q(
        "select * from campaign_participants order by campaign_id,profile_id",
      );
      await add(8, "sdr");
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1",
          [uid(8)],
        ),
        0,
      );
      await q("update profiles set active=false where id=$1", [uid(2)]);
      assert.deepEqual(
        await q(
          "select * from campaign_participants order by campaign_id,profile_id",
        ),
        before,
      );
      await actor(1);
      await rpc("manage_access", {
        id: uid(4),
        name: "Auto 4",
        category: "admin",
        functions: [],
        company_ids: [],
        active: "true",
        confirm: "true",
        reason: "Promoção após encerramento",
      });
      await owner();
      assert.deepEqual(
        await q(
          "select * from campaign_participants order by campaign_id,profile_id",
        ),
        before,
      );
      const draft = await scalar(
        "insert into campaigns(name) values('Future') returning id r",
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from campaign_participants where profile_id=$1 and campaign_id=$2",
          [uid(8), draft],
        ),
        1,
      );
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores where campaign_id=$1",
          [ca],
        ),
        1,
      );
    },
  );
  await db.close();
});
