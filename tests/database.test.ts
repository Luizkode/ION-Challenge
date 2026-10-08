import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const ids = {
  sdr: "10000000-0000-0000-0000-000000000001",
  closer: "10000000-0000-0000-0000-000000000002",
  admin: "10000000-0000-0000-0000-000000000003",
  other: "10000000-0000-0000-0000-000000000004",
  sdr2: "10000000-0000-0000-0000-000000000005",
};
test("PostgreSQL: workflow, pontuação, RLS e antifraude", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_ion.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const [role, id] of Object.entries(ids)) {
    await db.query("insert into auth.users values($1)", [id]);
    await db.query("insert into profiles values($1,$2,$3,true)", [
      id,
      role,
      role === "other" ? "closer" : role === "sdr2" ? "sdr" : role,
    ]);
  }
  const team = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('ION Alpha') returning id",
    )
  ).rows[0].id;
  const ca = (
    await db.query<{ id: string }>(
      "update campaigns set state='active',starts_at=now()-interval '1 day',ends_at=now()+interval '55 days',goal=1 returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into campaign_participants values($1,$2,$3),($1,$4,$3)",
    [ca, ids.sdr, team, ids.sdr2],
  );
  const actor = async (id: string) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec("set role authenticated");
  };
  const rpc = async (fn: string, data: unknown) =>
    db.query<{ result: string }>(`select ${fn}($1::jsonb) as result`, [
      JSON.stringify(data),
    ]);
  const admin = async (operation: string, data: unknown) =>
    db.query("select admin_operation($1,$2::jsonb)", [
      operation,
      JSON.stringify(data),
    ]);
  const board = async () =>
    (
      await db.query<{
        result: {
          held: number;
          individual: { id: string; points: number; position: number }[];
        };
      }>("select dashboard($1) as result", [ca])
    ).rows[0].result;
  const points = async () =>
    (await board()).individual.find((x) => x.id === ids.sdr)!.points;
  await actor(ids.sdr);
  const data = {
    campaign_id: ca,
    company: "Empresa ION",
    contact: "Maria",
    phone: "11999999999",
    city: "São Paulo",
    niche: "Serviços",
    closer_id: ids.closer,
    scheduled_at: new Date(Date.now() - 3600000).toISOString(),
    notes: "",
  };
  let mid = "";
  let oid = "";
  await t.test("1. reunião agendada concede zero pontos", async () => {
    mid = (
      await rpc("create_meeting", { ...data, sdr_id: ids.sdr2, points: 7 })
    ).rows[0].result as string;
    const record = (
      await db.query<{
        status: string;
        closer_id: string;
        sdr_id: string;
        team_id: string;
      }>(
        "select m.status,m.closer_id,o.sdr_id,o.team_id from meetings m join opportunities o on o.id=m.opportunity_id where m.id=$1",
        [mid],
      )
    ).rows[0];
    assert.equal(record.status, "scheduled");
    assert.equal(record.sdr_id, ids.sdr);
    assert.equal(record.team_id, team);
    assert.equal(record.closer_id, ids.closer);
    await actor(ids.closer);
    assert.equal(
      (await db.query("select id from meetings where id=$1", [mid])).rows
        .length,
      1,
    );
    await actor(ids.sdr);
    oid = (
      await db.query<{ opportunity_id: string }>(
        "select opportunity_id from meetings where id=$1",
        [mid],
      )
    ).rows[0].opportunity_id;
    assert.equal(await points(), 0);
    assert.equal((await board()).held, 0);
  });
  await t.test("9. SDR não valida a própria reunião", async () => {
    await assert.rejects(
      rpc("validate_meeting", { id: mid, attended: true, qualified: false }),
      /Sem permissão/,
    );
  });
  await t.test(
    "10. escrita direta / tabelas de pontuação são protegidas",
    async () => {
      await assert.rejects(
        db.query("update meetings set status='qualified' where id=$1", [mid]),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select * from opportunity_scores"),
        /permission denied/,
      );
      await assert.rejects(
        db.query(
          "insert into audit_logs(action,entity,entity_id) values('fake','fake','fake')",
        ),
        /permission denied/,
      );
    },
  );
  await t.test("11. outro closer não valida reunião atribuída", async () => {
    await actor(ids.other);
    await assert.rejects(
      rpc("validate_meeting", { id: mid, attended: true, qualified: true }),
      /Sem permissão/,
    );
    assert.equal((await db.query("select * from meetings")).rows.length, 0);
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      0,
    );
  });
  await t.test("2. closer valida realizada = 1", async () => {
    await actor(ids.closer);
    await rpc("validate_meeting", {
      id: mid,
      attended: true,
      qualified: false,
    });
    assert.equal(await points(), 1);
  });
  await t.test("3. qualificação substitui total por 3", async () => {
    await rpc("validate_meeting", { id: mid, attended: true, qualified: true });
    assert.equal(await points(), 3);
  });
  await t.test("12. closer não confirma contrato", async () => {
    await assert.rejects(
      admin("contract", {
        meeting_id: mid,
        closed_at: new Date().toISOString().slice(0, 10),
        amount: 100,
        reference: "ABC",
      }),
      /Acesso restrito/,
    );
  });
  await t.test("4 e 5. contrato = 7 e nunca 11", async () => {
    await actor(ids.admin);
    await admin("contract", {
      meeting_id: mid,
      closed_at: new Date().toISOString().slice(0, 10),
      amount: 100,
      reference: "ABC",
    });
    assert.equal(await points(), 7);
  });
  await t.test("6 e 13. repetição não infla pontos nem meta", async () => {
    await assert.rejects(
      admin("contract", {
        meeting_id: mid,
        closed_at: new Date().toISOString().slice(0, 10),
        amount: 100,
        reference: "ABC",
      }),
      /duplicate key/,
    );
    await actor(ids.sdr);
    await assert.rejects(rpc("create_meeting", data), /duplicidade/);
    const repeat = (
      await rpc("create_meeting", {
        ...data,
        opportunity_id: oid,
        scheduled_at: new Date(Date.now() - 1800000).toISOString(),
      })
    ).rows[0].result;
    await actor(ids.closer);
    await rpc("validate_meeting", {
      id: repeat,
      attended: true,
      qualified: true,
    });
    assert.equal(await points(), 7);
    assert.equal((await board()).held, 1);
    await actor(ids.admin);
    await admin("correct_meeting", {
      id: repeat,
      status: "cancelled",
      reason: "Reunião duplicada verificada",
    });
  });
  await t.test("14. prêmio desbloqueado apenas com meta validada", async () => {
    const b = await board();
    assert.equal(b.held >= 1, true);
    const c = await db.query<{ state: string }>(
      "select state from campaigns where id=$1",
      [ca],
    );
    assert.equal(c.rows[0].state, "active");
  });
  await t.test(
    "8. invalidada remove pontos e meta, inclusive contrato",
    async () => {
      await admin("correct_meeting", {
        id: mid,
        status: "invalidated",
        reason: "Confirmação incorreta revisada",
      });
      assert.equal(await points(), 0);
      assert.equal((await board()).held, 0);
    },
  );
  await t.test("7. cancelada não pontua", async () => {
    await admin("correct_meeting", {
      id: mid,
      status: "cancelled",
      reason: "Cancelamento confirmado",
    });
    assert.equal(await points(), 0);
  });
  await t.test("15. empate mantém mesma posição", async () => {
    const b = await board();
    assert.equal(b.individual[0].position, b.individual[1].position);
    await admin("correct_meeting", {
      id: mid,
      status: "qualified",
      reason: "Comparecimento comprovado",
    });
    const changed = await board();
    assert.equal(changed.individual.find((x) => x.id === ids.sdr)?.position, 1);
    assert.equal(
      changed.individual.find((x) => x.id === ids.sdr2)?.position,
      2,
    );
  });
  await t.test(
    "anulação de contrato restaura pontuação qualificada",
    async () => {
      const cid = (await db.query<{ id: string }>("select id from contracts"))
        .rows[0].id;
      await admin("void_contract", {
        id: cid,
        reason: "Contrato anulado após conferência",
      });
      assert.equal(await points(), 3);
    },
  );
  await t.test("SDR não lê prospects de outros SDRs", async () => {
    await actor(ids.sdr2);
    assert.equal(
      (await db.query("select * from opportunities")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from meetings")).rows.length, 0);
    await assert.rejects(
      db.query("select require_admin()"),
      /permission denied/,
    );
  });
  await t.test("sem perfil e inativo não consultam rankings", async () => {
    await db.exec("reset role");
    await db.query("update profiles set active=false where id=$1", [ids.sdr2]);
    await actor(ids.sdr2);
    await assert.rejects(board(), /Conta inativa/);
    assert.equal((await db.query("select * from profiles")).rows.length, 0);
  });
  await t.test(
    "auditoria registra autor e estados e não pode ser editada",
    async () => {
      await actor(ids.admin);
      const logs = (
        await db.query<{
          actor_id: string;
          old_state: unknown;
          reason: string;
        }>("select * from audit_logs")
      ).rows;
      assert(logs.some((l) => l.actor_id === ids.closer && l.old_state));
      assert(
        logs.some((l) => l.reason === "Contrato anulado após conferência"),
      );
      await assert.rejects(
        db.query("delete from audit_logs"),
        /permission denied/,
      );
    },
  );

  await t.test(
    "campanha ativa exige confirmação de mudança de regra",
    async () => {
      await assert.rejects(
        admin("campaign", { id: ca, name: "Nova regra" }),
        /confirmação explícita/,
      );
    },
  );
  await t.test("finalização precoce é negada", async () => {
    await assert.rejects(
      admin("finalize", {
        id: ca,
        winner_id: ids.sdr,
        reason: "Conferência administrativa",
      }),
      /fim do período/,
    );
  });
  await t.test(
    "histórico privado inclui contratos sem expor outro SDR",
    async () => {
      await actor(ids.sdr);
      const h = (
        await db.query<{ h: { action: string }[] }>(
          "select point_history() as h",
        )
      ).rows[0].h;
      assert(h.some((e) => e.action === "Contrato confirmado"));
      await actor(ids.sdr2);
      await assert.rejects(db.query("select point_history()"), /Conta inativa/);
    },
  );
  await t.test(
    "limite de cinco participantes é aplicado pelo backend",
    async () => {
      await db.exec("reset role");
      for (let i = 10; i < 14; i++) {
        const id = "20000000-0000-0000-0000-" + String(i).padStart(12, "0");
        await db.query("insert into auth.users values($1)", [id]);
        await db.query(
          "insert into profiles values($1,'Participante','sdr',true)",
          [id],
        );
      }
      await actor(ids.admin);
      for (let i = 10; i < 13; i++) {
        await admin("participant", {
          campaign_id: ca,
          profile_id: "20000000-0000-0000-0000-" + String(i).padStart(12, "0"),
          team_id: team,
        });
      }
      await assert.rejects(
        admin("participant", {
          campaign_id: ca,
          profile_id: "20000000-0000-0000-0000-000000000013",
          team_id: team,
        }),
        /cinco integrantes/,
      );
    },
  );
  await db.close();
});
