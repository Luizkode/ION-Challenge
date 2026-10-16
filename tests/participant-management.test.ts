import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const id = (n: number) =>
  `70000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const admin = id(1),
  sdr = id(2),
  closer = id(3),
  other = id(4);
test("participação, troca de cargo, auditoria e transações PostgreSQL", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_ion.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const [uid, role] of [
    [admin, "admin"],
    [sdr, "sdr"],
    [closer, "closer"],
    [other, "sdr"],
    [id(5), "sdr"],
  ] as const) {
    await db.query("insert into auth.users values($1)", [uid]);
    await db.query(
      "insert into profiles(id,name,role,active) values($1,$2,$3,true)",
      [uid, "Pessoa " + role, role],
    );
  }
  const team = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('Time original') returning id",
    )
  ).rows[0].id;
  const newTeam = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('Outro time') returning id",
    )
  ).rows[0].id;
  const ca = (
    await db.query<{ id: string }>(
      "update campaigns set state='active',starts_at=now()-interval '1 day',ends_at=now()+interval '55 days' returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3),($1,$4,$3)",
    [ca, sdr, team, other],
  );
  const oid = (
    await db.query<{ id: string }>(
      "insert into opportunities(campaign_id,sdr_id,team_id,company,contact,phone,city,niche) values($1,$2,$3,'Empresa teste','Maria','11999999999','São Paulo','Serviços') returning id",
      [ca, sdr, team],
    )
  ).rows[0].id;
  const mid = (
    await db.query<{ id: string }>(
      "insert into meetings(opportunity_id,closer_id,scheduled_at,status) values($1,$2,now()-interval '1 hour','qualified') returning id",
      [oid, closer],
    )
  ).rows[0].id;
  await db.query(
    "insert into contracts(opportunity_id,meeting_id,closed_at,amount,reference,confirmed_by) values($1,$2,current_date,100,'Contrato teste',$3)",
    [oid, mid, admin],
  );
  // Upgrade an existing V1 database with users, memberships, meetings and a contract.
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/002_participant_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/003_access_control.sql", import.meta.url),
      "utf8",
    ),
  );
  const actor = async (uid: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid,
    ]);
    await db.exec("set role authenticated");
  };
  const op = async (operation: string, data: unknown) =>
    db.query("select admin_operation($1,$2::jsonb)", [
      operation,
      JSON.stringify(data),
    ]);
  const membership = async () =>
    (
      await db.query<{
        active: boolean;
        team_id: string;
        removed_by: string | null;
      }>(
        "select * from campaign_participants where campaign_id=$1 and profile_id=$2",
        [ca, sdr],
      )
    ).rows[0];
  const profile = async () =>
    (
      await db.query<{ role: string; name: string }>(
        "select role,name from profiles where id=$1",
        [sdr],
      )
    ).rows[0];
  const board = async () =>
    (
      await db.query<{
        b: {
          individual: { id: string; points: number }[];
          teams: { points: number; participants: number }[];
          held: number;
        };
      }>("select dashboard($1) as b", [ca])
    ).rows[0].b;
  const removal = {
    campaign_id: ca,
    profile_id: sdr,
    remove: "true",
    confirm: "true",
    reason: "Remoção do colaborador de testes",
  };
  const promotion = {
    id: sdr,
    name: "Pessoa SDR",
    role: "admin",
    active: "true",
    confirm: "true",
    reason: "Promoção administrativa de teste",
  };
  await t.test(
    "somente admin pode remover; escrita direta e RPC antiga são proibidas",
    async () => {
      await actor(sdr);
      await assert.rejects(op("participant", removal), /Acesso restrito/);
      await assert.rejects(
        db.query("update campaign_participants set active=false"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select admin_operation_v1('participant',$1::jsonb)", [
          JSON.stringify(removal),
        ]),
        /permission denied/,
      );
    },
  );
  await t.test("remoção exige confirmação e justificativa", async () => {
    await actor(admin);
    await assert.rejects(
      op("participant", { ...removal, confirm: "false" }),
      /Confirme/,
    );
    await assert.rejects(
      op("participant", { ...removal, reason: "curta" }),
      /justificativa/,
    );
    assert.equal((await membership()).active, true);
  });
  await t.test(
    "remove SDR com contrato sem apagar histórico e tira pontos dos dois rankings",
    async () => {
      assert.equal(
        (await board()).individual.find((p) => p.id === sdr)?.points,
        7,
      );
      await op("participant", removal);
      assert.equal((await membership()).active, false);
      assert.equal((await membership()).removed_by, admin);
      const b = await board();
      assert(!b.individual.some((p) => p.id === sdr));
      assert.equal(b.teams[0].points, 0);
      assert.equal(b.teams[0].participants, 1);
      assert.equal(b.held, 1);
      assert.equal(
        (await db.query("select * from opportunities")).rows.length,
        1,
      );
      assert.equal((await db.query("select * from meetings")).rows.length, 1);
      assert.equal((await db.query("select * from contracts")).rows.length, 1);
    },
  );
  await t.test("removido não cadastra novas reuniões", async () => {
    await actor(sdr);
    await assert.rejects(
      db.query("select create_meeting($1::jsonb)", [
        JSON.stringify({
          campaign_id: ca,
          company: "Outra empresa",
          contact: "Maria",
          phone: "11888888888",
          city: "São Paulo",
          niche: "Serviços",
          closer_id: closer,
          scheduled_at: new Date().toISOString(),
        }),
      ]),
      /não participa/,
    );
  });
  await t.test(
    "promoção após remoção atualiza permissões sem perder histórico",
    async () => {
      await actor(admin);
      await op("profile", promotion);
      await actor(sdr);
      assert.equal(
        (await db.query<{ r: string }>("select actor_role() as r")).rows[0].r,
        "admin",
      );
      assert((await db.query("select * from audit_logs")).rows.length > 0);
      await assert.rejects(
        op("participant", { campaign_id: ca, profile_id: sdr, team_id: team }),
        /Apenas SDRs ativos/,
      );
    },
  );
  await t.test(
    "demover para SDR não adiciona automaticamente à campanha",
    async () => {
      await actor(admin);
      await op("profile", { ...promotion, role: "sdr" });
      assert.equal((await membership()).active, false);
      await actor(sdr);
      assert.equal(
        (await db.query<{ r: string }>("select actor_role() as r")).rows[0].r,
        "sdr",
      );
      assert.equal((await db.query("select * from audit_logs")).rows.length, 0);
    },
  );
  await t.test(
    "reinclusão mantém time original e restaura pontos",
    async () => {
      await actor(admin);
      await assert.rejects(
        op("participant", {
          campaign_id: ca,
          profile_id: sdr,
          team_id: newTeam,
        }),
        /time original/,
      );
      await op("participant", {
        campaign_id: ca,
        profile_id: sdr,
        team_id: team,
        reason: "Reinclusão administrativa",
      });
      assert.equal((await membership()).active, true);
      assert.equal((await membership()).removed_by, null);
      assert.equal(
        (await board()).individual.find((p) => p.id === sdr)?.points,
        7,
      );
    },
  );
  await t.test(
    "perfil de membro ativo exige optar pela remoção e confirmar",
    async () => {
      await assert.rejects(op("profile", promotion), /remover da campanha/);
      await assert.rejects(
        op("profile", {
          ...promotion,
          remove_from_campaign: "true",
          confirm: "false",
        }),
        /Confirme/,
      );
      assert.equal((await profile()).role, "sdr");
      assert.equal((await membership()).active, true);
    },
  );
  await t.test(
    "falha na mudança de perfil desfaz remoção e auditoria",
    async () => {
      const before = (await db.query("select * from audit_logs")).rows.length;
      await assert.rejects(
        op("profile", {
          ...promotion,
          name: "X",
          remove_from_campaign: "true",
        }),
        /check constraint/,
      );
      assert.equal((await membership()).active, true);
      assert.equal((await profile()).role, "sdr");
      assert.equal(
        (await db.query("select * from audit_logs")).rows.length,
        before,
      );
    },
  );
  await t.test(
    "remoção e promoção são atômicas, auditadas e notificam o feed",
    async () => {
      const before = (
        await db.query<{ updated_at: Date }>(
          "select updated_at from competition_updates where campaign_id=$1",
          [ca],
        )
      ).rows[0].updated_at;
      await op("profile", { ...promotion, remove_from_campaign: "true" });
      assert.equal((await membership()).active, false);
      assert.equal((await profile()).role, "admin");
      const logs = (
        await db.query<{
          entity: string;
          actor_id: string;
          reason: string;
          new_state: { active?: boolean; role?: string };
        }>("select * from audit_logs where reason=$1", [promotion.reason])
      ).rows;
      assert(
        logs.some(
          (l) =>
            l.entity === "campaign_participants" &&
            l.new_state.active === false &&
            l.actor_id === admin,
        ),
      );
      assert(
        logs.some(
          (l) =>
            l.entity === "profiles" &&
            l.new_state.role === "admin" &&
            l.actor_id === admin,
        ),
      );
      assert(
        (
          await db.query<{ updated_at: Date }>(
            "select updated_at from competition_updates where campaign_id=$1",
            [ca],
          )
        ).rows[0].updated_at > before,
      );
    },
  );
  await t.test("autorrebaixamento administrativo é bloqueado", async () => {
    await assert.rejects(
      op("profile", { ...promotion, id: admin, role: "sdr" }),
      /próprio acesso/,
    );
  });
  await t.test(
    "vínculo de campanha finalizada não impede trocar cargo nem altera ranking histórico",
    async () => {
      await db.exec("reset role");
      const historical = (
        await db.query<{ id: string }>(
          "insert into campaigns(name,state,starts_at,ends_at) values('Histórico','finalized',now()-interval '60 days',now()-interval '4 days') returning id",
        )
      ).rows[0].id;
      await db.query(
        "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
        [historical, id(5), team],
      );
      await actor(admin);
      await op("profile", {
        ...promotion,
        id: id(5),
        name: "Pessoa histórica",
      });
      const h = (
        await db.query<{ b: { individual: { id: string }[] } }>(
          "select dashboard($1) as b",
          [historical],
        )
      ).rows[0].b;
      assert(h.individual.some((p) => p.id === id(5)));
      await assert.rejects(
        op("participant", {
          ...removal,
          campaign_id: historical,
          profile_id: id(5),
        }),
        /finalizada/,
      );
    },
  );
  await t.test(
    "remoção libera vaga sem permitir mais de cinco membros ativos",
    async () => {
      await op("profile", { ...promotion, role: "sdr" });
      await op("participant", {
        campaign_id: ca,
        profile_id: sdr,
        team_id: team,
      });
      await db.exec("reset role");
      for (let n = 10; n <= 13; n++) {
        await db.query("insert into auth.users values($1)", [id(n)]);
        await db.query(
          "insert into profiles(id,name,role,active) values($1,'Novo participante','sdr',true)",
          [id(n)],
        );
      }
      await actor(admin);
      for (let n = 10; n <= 12; n++)
        await op("participant", {
          campaign_id: ca,
          profile_id: id(n),
          team_id: team,
        });
      await op("participant", removal);
      await op("participant", {
        campaign_id: ca,
        profile_id: id(13),
        team_id: team,
      });
      await assert.rejects(
        op("participant", { campaign_id: ca, profile_id: sdr, team_id: team }),
        /cinco integrantes/,
      );
      assert.equal((await membership()).active, false);
    },
  );
  await t.test(
    "é possível remover participante com conta desativada",
    async () => {
      await op("profile", {
        ...promotion,
        id: other,
        role: "sdr",
        active: "false",
      });
      await op("participant", { ...removal, profile_id: other });
      assert.equal(
        (
          await db.query<{ active: boolean }>(
            "select active from campaign_participants where campaign_id=$1 and profile_id=$2",
            [ca, other],
          )
        ).rows[0].active,
        false,
      );
    },
  );
  await t.test("anon não pode invocar operações administrativas", async () => {
    await db.exec("reset role;set role anon");
    await assert.rejects(op("participant", removal), /permission denied/);
  });
  await db.close();
});
