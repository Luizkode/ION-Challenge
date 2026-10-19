import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseLeadCsv, leadSchema } from "../lib/crm";
const uid = (n: number) =>
  `93000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const input = {
  company: "Empresa real",
  contact: "Maria Silva",
  phone: "11999998888",
  email: "maria@example.com",
  niche: "Serviços",
  city: "São Paulo",
  state: "SP",
  source: "Prospecção",
  notes: "",
};
test("CSV: BOM, delimitadores, aspas, duplicidade, limites e validação", () => {
  const header =
    "company;contact;phone;niche;city;state;source;email;notes\r\n";
  const row =
    '"Empresa; ION";Maria;11999998888;Serviços;São Paulo;SP;Evento;maria@example.com;"Linha 1\nLinha ""2"""';
  const p = parseLeadCsv("\uFEFF" + header + row);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].company, "Empresa; ION");
  assert.equal(p.rows[0].notes, 'Linha 1\nLinha "2"');
  assert(
    parseLeadCsv(header + row + "\r\n" + row).errors[0].includes("repetido"),
  );
  assert(parseLeadCsv("company,phone\nION,123").errors.length);
  assert(parseLeadCsv(header + '"não fechado').errors.length);
  assert(parseLeadCsv("x".repeat(2_000_001)).errors.length);
  assert(
    !leadSchema.safeParse({ ...input, phone: "123", email: "bad" }).success,
  );
});
test("PostgreSQL CRM: persistência, integração, RLS, concorrência e pontos", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of [
    "001_ion.sql",
    "002_participant_management.sql",
    "003_access_control.sql",
    "004_commercial_crm.sql",
    "012_crm_edit_scope.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (let n = 1; n <= 7; n++) {
    await db.query("insert into auth.users values($1,$2)", [
      uid(n),
      `test${n}@example.com`,
    ]);
    await db.query("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Usuário " + n,
      ["", "admin", "sdr", "closer", "sdr", "member", "partner", "closer"][n],
    ]);
  }
  await db.query("insert into user_functions values($1,'designer')", [uid(5)]);
  const ca = (
    await db.query<{ id: string }>(
      "update campaigns set state='active', starts_at=now()-interval '2 days',ends_at=now()+interval '20 days' returning id",
    )
  ).rows[0].id;
  const team = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('Equipe CRM') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
    [ca, uid(2), team],
  );
  const actor = async (n: number) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid(n),
    ]);
    await db.exec("set role authenticated");
  };
  const rpc = async <T = string>(fn: string, data: unknown) =>
    (
      await db.query<{ r: T }>(`select ${fn}($1::jsonb) as r`, [
        JSON.stringify(data),
      ])
    ).rows[0].r;
  const count = async (table: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from ${table}`))
      .rows[0].n;
  const board = async () =>
    (
      await db.query<{
        r: { held: number; individual: { id: string; points: number }[] };
      }>("select dashboard($1) r", [ca])
    ).rows[0].r;
  let lid = "";
  let mid = "";
  let did = "";
  let standalone = "";
  let standaloneMeeting = "";
  await t.test(
    "SDR autenticado é o responsável; escrita direta negada e campos persistem",
    async () => {
      await actor(2);
      lid = await rpc("crm_save_lead", {
        ...input,
        sdr_id: uid(4),
        closer_id: uid(3),
      });
      const row = (
        await db.query<{ sdr_id: string }>("select * from crm_leads")
      ).rows[0];
      assert.equal(row.sdr_id, uid(2));
      await assert.rejects(
        db.query("update crm_leads set stage='won'"),
        /permission denied/,
      );
      await assert.rejects(
        rpc("crm_save_lead", { ...input, phone: "11999990000" }),
        /duplicidade/,
      );
    },
  );
  await t.test(
    "SDR de outro time, parceiro, designer e closer não atribuído não acessam",
    async () => {
      for (const n of [4, 5, 6, 7]) {
        await actor(n);
        assert.equal(await count("crm_leads"), 0);
        await assert.rejects(
          rpc("crm_activity", {
            lead_id: lid,
            kind: "note",
            description: "Ataque",
          }),
          /indisponível/,
        );
        await assert.rejects(
          rpc("crm_set_grant", {
            profile_id: uid(5),
            enabled: "true",
            confirm: "true",
            reason: "Ataque de permissão",
          }),
          /restrito/,
        );
      }
    },
  );
  await t.test(
    "optimistic locking impede sobrescrita e alteração indevida de closer",
    async () => {
      await actor(2);
      await rpc("crm_save_lead", {
        ...input,
        id: lid,
        version: 1,
        closer_id: uid(3),
        company: "Empresa atualizada",
      });
      await assert.rejects(
        rpc("crm_save_lead", {
          ...input,
          id: lid,
          version: 1,
          closer_id: uid(3),
        }),
        /outra pessoa/,
      );
      await assert.rejects(
        rpc("crm_save_lead", {
          ...input,
          id: lid,
          version: 2,
          closer_id: uid(7),
        }),
        /Somente ADM/,
      );
    },
  );
  await t.test(
    "atividades, follow-ups, funil e histórico persistem",
    async () => {
      await rpc("crm_activity", {
        lead_id: lid,
        kind: "contact",
        channel: "WhatsApp",
        description: "Abordagem realizada",
        stage: "contacted",
        follow_up_at: new Date(Date.now() + 86400000).toISOString(),
      });
      await rpc("crm_activity", {
        lead_id: lid,
        kind: "response",
        description: "Interessado",
        stage: "replied",
      });
      assert.equal(await count("crm_activities"), 4);
      await assert.rejects(
        rpc("crm_activity", {
          lead_id: lid,
          kind: "stage",
          description: "Pular validação",
          stage: "held",
        }),
        /Utilize/,
      );
    },
  );
  await t.test(
    "agendamento usa reunião canônica; zero pontos; duplicidade bloqueada",
    async () => {
      mid = await rpc("crm_schedule_meeting", {
        lead_id: lid,
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        notes: "Agenda CRM",
      });
      assert.equal(await count("meetings"), 1);
      assert.equal(await count("opportunities"), 1);
      assert.equal(
        (await board()).individual.find((x) => x.id === uid(2))?.points,
        0,
      );
      const row = (
        await db.query<{ scheduled_at: string }>(
          "select scheduled_at from meetings",
        )
      ).rows[0];
      await assert.rejects(
        rpc("crm_schedule_meeting", {
          lead_id: lid,
          closer_id: uid(3),
          scheduled_at: row.scheduled_at,
        }),
        /já cadastrada/,
      );
      await assert.rejects(
        rpc("validate_meeting", { id: mid, attended: true, qualified: true }),
        /Sem permissão/,
      );
    },
  );
  await t.test(
    "validação apenas após horário e pelo closer atribuído; integra pontos e timeline",
    async () => {
      await actor(3);
      await assert.rejects(
        rpc("validate_meeting", { id: mid, attended: true, qualified: true }),
        /Aguarde/,
      );
      await db.exec("reset role");
      await db.query(
        "update meetings set scheduled_at=now()-interval '1 hour' where id=$1",
        [mid],
      );
      await actor(7);
      await assert.rejects(
        rpc("validate_meeting", { id: mid, attended: true, qualified: true }),
        /Sem permissão/,
      );
      await actor(3);
      await rpc("validate_meeting", {
        id: mid,
        attended: true,
        qualified: true,
        notes: "Qualificada",
      });
      assert.equal(
        (await db.query<{ stage: string }>("select stage from crm_leads"))
          .rows[0].stage,
        "held",
      );
      await actor(2);
      assert.equal(
        (await board()).individual.find((x) => x.id === uid(2))?.points,
        3,
      );
    },
  );
  await t.test(
    "closer registra proposta e fechamento mas não concede pontos de contrato",
    async () => {
      await actor(2);
      await assert.rejects(
        rpc("crm_record_deal", {
          lead_id: lid,
          amount: 1000,
          services: "Marketing",
          term_months: 12,
          result: "won",
          reason: "Aceitou proposta",
        }),
        /Somente ADM/,
      );
      await actor(3);
      await rpc("crm_record_deal", {
        lead_id: lid,
        amount: 1000,
        services: "Marketing",
        term_months: 12,
        result: "proposal",
      });
      did = await rpc("crm_record_deal", {
        lead_id: lid,
        amount: 1000,
        services: "Marketing",
        term_months: 12,
        result: "won",
        reason: "Aceitou proposta",
      });
      assert.equal(
        (await board()).individual.find((x) => x.id === uid(2))?.points,
        3,
      );
      await assert.rejects(
        rpc("crm_confirm_contract", {
          deal_id: did,
          meeting_id: mid,
          reference: "ABC",
          closed_at: new Date().toISOString().slice(0, 10),
        }),
        /restrito/,
      );
    },
  );
  await t.test(
    "ADM confirma pelo fluxo oficial; 7 pontos, sem duplicação",
    async () => {
      await actor(1);
      const data = {
        deal_id: did,
        meeting_id: mid,
        reference: "CRM-001",
        closed_at: new Date().toISOString().slice(0, 10),
      };
      await rpc("crm_confirm_contract", data);
      assert.equal(await count("contracts"), 1);
      assert.equal(
        (await board()).individual.find((x) => x.id === uid(2))?.points,
        7,
      );
      await assert.rejects(rpc("crm_confirm_contract", data), /já confirmado/);
      assert.equal(await count("contracts"), 1);
    },
  );
  await t.test(
    "CRM sem campanha funciona sem participação e não afeta Challenger",
    async () => {
      await actor(4);
      standalone = await rpc("crm_save_lead", {
        ...input,
        phone: "11999997777",
        email: "outro@example.com",
        closer_id: uid(3),
      });
      standaloneMeeting = await rpc("crm_schedule_meeting", {
        lead_id: standalone,
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      });
      const op = (
        await db.query<{ campaign_id: null; team_id: null }>(
          "select campaign_id,team_id from opportunities",
        )
      ).rows[0];
      assert.equal(op.campaign_id, null);
      assert.equal(op.team_id, null);
      await db.exec("reset role");
      await db.query(
        "update meetings set scheduled_at=now()-interval '30 minutes' where id=$1",
        [standaloneMeeting],
      );
      await actor(3);
      await rpc("validate_meeting", {
        id: standaloneMeeting,
        attended: true,
        qualified: false,
      });
      await actor(1);
      assert.equal((await board()).held, 1);
      assert.equal(await count("meetings"), 2);
    },
  );
  await t.test("CSV é atômico diante de conflito com banco", async () => {
    await actor(2);
    const before = await count("crm_leads");
    await assert.rejects(
      db.query("select crm_import_leads($1::jsonb)", [
        JSON.stringify([
          { ...input, phone: "11999996666", email: "novo@example.com" },
          { ...input },
        ]),
      ]),
      /duplicidade/,
    );
    assert.equal(await count("crm_leads"), before);
    await db.query("select crm_import_leads($1::jsonb)", [
      JSON.stringify([
        { ...input, phone: "11999996666", email: "novo@example.com" },
      ]),
    ]);
    assert.equal(await count("crm_leads"), before + 1);
  });
  await t.test(
    "permissão expressa é auditada, revogável, nunca para parceiro",
    async () => {
      await actor(1);
      await rpc("crm_set_grant", {
        profile_id: uid(5),
        enabled: "true",
        confirm: "true",
        reason: "Suporte comercial autorizado",
      });
      await assert.rejects(
        rpc("crm_set_grant", {
          profile_id: uid(6),
          enabled: "true",
          confirm: "true",
          reason: "Parceiro indevido",
        }),
        /inválido/,
      );
      await actor(5);
      assert.equal(await count("crm_leads"), 3);
      await rpc("crm_activity", {
        lead_id: lid,
        kind: "note",
        description: "Observação de suporte",
      });
      await assert.rejects(
        rpc("crm_schedule_meeting", {
          lead_id: lid,
          closer_id: uid(3),
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        }),
        /Somente ADM/,
      );
      // Consultation/activity grant must not change master data, archive or bypass RPC via table writes.
      const current = (
        await db.query<any>("select * from crm_leads where id=$1", [lid])
      ).rows[0];
      await assert.rejects(
        rpc("crm_save_lead", {
          ...current,
          company: "Alteração indevida",
          version: current.version,
        }),
        /Somente o administrador/,
      );
      await assert.rejects(
        rpc("crm_archive", { id: lid, archived: "true", confirm: "true" }),
        /Somente o administrador/,
      );
      await assert.rejects(
        db.query("update crm_leads set company='Invasão' where id=$1", [lid]),
      );
      await actor(1);
      await rpc("crm_set_grant", {
        profile_id: uid(5),
        enabled: "false",
        confirm: "true",
        reason: "Permissão de suporte encerrada",
      });
      await actor(5);
      assert.equal(await count("crm_leads"), 0);
    },
  );
  await t.test(
    "indicadores reais sem duplicar respostas e reuniões; RLS aplica isolamento",
    async () => {
      await actor(1);
      const r = await rpc<{
        leads: number;
        contacts: number;
        won: number;
        held: number;
        attendance: number;
        response: number;
        conversion: number;
      }>("crm_report", {});
      assert.equal(r.leads, 3);
      assert.equal(r.contacts, 1);
      assert.equal(r.response, 100);
      assert.equal(r.won, 1);
      assert.equal(r.held, 2);
      assert.equal(r.attendance, 100);
      assert.equal(r.conversion, 33.3);
      await actor(4);
      const own = await rpc<{ leads: number; held: number }>("crm_report", {});
      assert.equal(own.leads, 1);
      assert.equal(own.held, 1);
    },
  );
  await t.test(
    "desativação bloqueia JWT mantido; arquivar preserva reuniões e histórico",
    async () => {
      await actor(2);
      await rpc("crm_archive", { id: lid, archived: "true", confirm: "true" });
      assert.equal(await count("meetings"), 1);
      await assert.rejects(
        rpc("crm_activity", {
          lead_id: lid,
          kind: "note",
          description: "Novo",
        }),
        /arquivado/,
      );
      await rpc("crm_archive", { id: lid, archived: "false", confirm: "true" });
      await db.exec("reset role");
      await db.query("update profiles set active=false where id=$1", [uid(2)]);
      await actor(2);
      assert.equal(await count("crm_leads"), 0);
      await assert.rejects(rpc("crm_save_lead", input), /Sem acesso/);
      await actor(1);
      assert((await count("audit_logs")) > 20);
    },
  );
  await db.close();
});

test("upgrade 003 → 004 preserva reunião, contrato, participantes e ranking existentes", async () => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of [
    "001_ion.sql",
    "002_participant_management.sql",
    "003_access_control.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (const n of [1, 2, 3]) {
    await db.query("insert into auth.users values($1,$2)", [
      uid(n),
      `u${n}@example.com`,
    ]);
    await db.query("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Legado " + n,
      ["", "admin", "sdr", "closer"][n],
    ]);
  }
  const ca = (
    await db.query<{ id: string }>(
      "update campaigns set state='active',starts_at=now()-interval '2 days',ends_at=now()+interval '20 days' returning id",
    )
  ).rows[0].id;
  const team = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('Legado') returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
    [ca, uid(2), team],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid(2),
  ]);
  const mid = (
    await db.query<{ id: string }>("select create_meeting($1::jsonb) id", [
      JSON.stringify({
        ...input,
        campaign_id: ca,
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() - 3600000).toISOString(),
      }),
    ])
  ).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid(3),
  ]);
  await db.query("select validate_meeting($1::jsonb)", [
    JSON.stringify({ id: mid, attended: true, qualified: true }),
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid(1),
  ]);
  await db.query("select admin_operation('contract',$1::jsonb)", [
    JSON.stringify({
      meeting_id: mid,
      amount: 100,
      reference: "LEG-001",
      closed_at: new Date().toISOString().slice(0, 10),
    }),
  ]);
  const snapshot = async () => {
    const result: unknown[] = [];
    for (const table of [
      "profiles",
      "teams",
      "campaigns",
      "campaign_participants",
      "opportunities",
      "meetings",
      "meeting_validations",
      "contracts",
    ])
      result.push(
        (
          await db.query(
            `select to_jsonb(t)-'crm_lead_id' r from ${table} t order by to_jsonb(t)::text`,
          )
        ).rows,
      );
    result.push((await db.query("select dashboard($1) r", [ca])).rows);
    return result;
  };
  const before = await snapshot();
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/004_commercial_crm.sql", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(await snapshot(), before);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid(2),
  ]);
  const lid = (
    await db.query<{ id: string }>("select crm_save_lead($1::jsonb) id", [
      JSON.stringify({ ...input, closer_id: uid(3) }),
    ])
  ).rows[0].id;
  await db.query("select crm_schedule_meeting($1::jsonb)", [
    JSON.stringify({
      lead_id: lid,
      closer_id: uid(3),
      scheduled_at: new Date(Date.now() + 3600000).toISOString(),
    }),
  ]);
  assert.equal((await db.query("select * from opportunities")).rows.length, 1);
  assert.equal((await db.query("select * from meetings")).rows.length, 2);
  const board = (
    await db.query<{ r: { individual: { points: number }[] } }>(
      "select dashboard($1) r",
      [ca],
    )
  ).rows[0].r;
  assert.equal(board.individual[0].points, 7);
  await db.close();
});
