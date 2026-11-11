import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  dayBounds,
  commercialDay,
  resultInput,
  agendaMeetingInput,
  whatsapp,
} from "../lib/crm-agenda";
const uid = (n: number) =>
  `91000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Agenda: São Paulo, virada do dia, links e validação comercial", () => {
  assert.equal(commercialDay(new Date("2026-11-06T01:30:00Z")), "2026-11-05");
  assert.deepEqual(dayBounds("2026-11-05"), {
    start: "2026-11-05T03:00:00.000Z",
    end: "2026-11-06T03:00:00.000Z",
  });
  assert.throws(() => dayBounds("2026-02-30"));
  assert.equal(whatsapp("(11) 99999-8888"), "https://wa.me/5511999998888");
  assert(
    !agendaMeetingInput.safeParse({
      request_id: uid(1),
      lead_id: uid(2),
      closer_id: uid(3),
      scheduled_at: new Date().toISOString(),
      meeting_url: "javascript:alert(1)",
    }).success,
  );
  const base = {
    request_id: uid(1),
    id: uid(2),
    lead_id: uid(3),
    version: 1,
    notes: "Resumo comercial",
    outcome: "proposal",
  };
  assert(!resultInput.safeParse(base).success);
  assert(
    resultInput.safeParse({
      ...base,
      amount: "100",
      services: "Marketing",
      term_months: "12",
    }).success,
  );
  assert(
    !resultInput.safeParse({
      ...base,
      outcome: "won",
      amount: "100",
      services: "Marketing",
      term_months: "12",
      follow_up_at: new Date().toISOString(),
    }).success,
  );
});
test("CRM agenda PostgreSQL: fluxo conectado, RLS, histórico e idempotência", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,last_sign_in_at timestamptz,email_confirmed_at timestamptz,invited_at timestamptz,banned_until timestamptz);create table auth.sessions(id uuid primary key,user_id uuid);create table auth.refresh_tokens(id int,user_id text);create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
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
  // These legacy lifecycle/CRM scenarios deliberately exercise a non-SDR campaign.
  // Automatic SDR enrollment is covered by automatic-participation.test.ts.
  await db.exec("alter table campaigns alter column audience set default 'other';update campaigns set audience='other'");
  const q = async (s: string, p: unknown[] = []) =>
    (await db.query<any>(s, p)).rows;
  const scalar = async (s: string, p: unknown[] = []) => (await q(s, p))[0]?.r;
  const owner = () =>
    db.exec(
      "reset role;select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)",
    );
  const actor = async (n: number) => {
    await db.exec("reset role");
    await q(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','',false)",
      [uid(n)],
    );
    await db.exec("set role authenticated");
  };
  const rpc = (fn: string, d: unknown) =>
    scalar(`select ${fn}($1::jsonb) r`, [JSON.stringify(d)]);
  for (const [n, role] of [
    [1, "admin"],
    [2, "sdr"],
    [3, "closer"],
    [4, "sdr"],
    [5, "member"],
    [6, "partner"],
    [7, "closer"],
  ] as const) {
    await q("insert into auth.users(id,email) values($1,$2)", [
      uid(n),
      `agenda${n}@example.invalid`,
    ]);
    await q("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Agenda " + n,
      role,
    ]);
  }
  await q("insert into user_functions values($1,'designer')", [uid(5)]);
  let lead: string, meeting: string, followup: string;
  const schedule = {
    request_id: randomUUID(),
    closer_id: uid(3),
    scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    meeting_url: "https://meet.example.test/agenda",
    notes: "Observação prévia preservada",
  };
  await t.test(
    "SDR agenda sem campanha, idempotência não duplica reunião nem histórico",
    async () => {
      await actor(2);
      lead = await rpc("crm_save_lead", {
        company: "Agenda company",
        contact: "Contato",
        phone: "11987650001",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        source: "Teste",
        closer_id: uid(3),
      });
      meeting = await rpc("crm_schedule_meeting", {
        ...schedule,
        lead_id: lead,
      });
      assert.equal(
        await rpc("crm_schedule_meeting", { ...schedule, lead_id: lead }),
        meeting,
      );
      assert.equal(await scalar("select count(*)::int r from meetings"), 1);
      assert.equal(
        await scalar("select campaign_id r from opportunities"),
        null,
      );
      await assert.rejects(
        rpc("crm_schedule_meeting", {
          ...schedule,
          lead_id: lead,
          notes: "Outro payload",
        }),
        /já utilizado/,
      );
      await assert.rejects(
        rpc("crm_schedule_meeting", {
          ...schedule,
          lead_id: lead,
          request_id: randomUUID(),
        }),
        /já cadastrada/,
      );
    },
  );
  await t.test(
    "Produção, parceiro e outro SDR não leem nem alteram os registros",
    async () => {
      for (const n of [4, 5, 6, 7]) {
        await actor(n);
        assert.equal(await scalar("select count(*)::int r from crm_leads"), 0);
        assert.equal(await scalar("select count(*)::int r from meetings"), 0);
        await assert.rejects(
          rpc("crm_record_meeting_result", {
            request_id: randomUUID(),
            id: meeting,
            version: 1,
            outcome: "negotiation",
            notes: "Tentativa",
          }),
          /CRM|Somente|indisponível/,
        );
      }
      await actor(2);
      await assert.rejects(
        rpc("crm_record_meeting_result", {
          request_id: randomUUID(),
          id: meeting,
          version: 1,
          outcome: "negotiation",
          notes: "Tentativa SDR",
        }),
        /Somente/,
      );
    },
  );
  await t.test(
    "Closer vê agenda, registra proposta e follow-up em uma transação sem perder notas",
    async () => {
      await actor(3);
      assert.equal(await scalar("select count(*)::int r from meetings"), 1);
      await assert.rejects(
        rpc("crm_record_meeting_result", {
          request_id: randomUUID(),
          id: meeting,
          version: await scalar("select version r from meetings where id=$1", [
            meeting,
          ]),
          outcome: "negotiation",
          notes: "Futura",
        }),
        /horário/,
      );
      await owner();
      await q(
        "update meetings set scheduled_at=now()-interval '1 hour' where id=$1",
        [meeting],
      );
      await actor(3);
      const d = {
        request_id: randomUUID(),
        id: meeting,
        version: await scalar("select version r from meetings where id=$1", [
          meeting,
        ]),
        outcome: "proposal",
        notes: "Interesse no plano",
        needs: "Mais leads",
        objections: "Prazo",
        services: "Marketing",
        amount: 1000,
        term_months: 12,
        next_action: "Retomar proposta",
        follow_up_at: new Date(Date.now() + 86400000).toISOString(),
        assigned_to: uid(3),
      };
      const r = await rpc("crm_record_meeting_result", d);
      assert.deepEqual(await rpc("crm_record_meeting_result", d), r);
      followup = r.followup.id;
      assert.equal(
        await scalar("select stage r from crm_leads where id=$1", [lead]),
        "proposed",
      );
      assert.equal(
        await scalar("select count(*)::int r from crm_followups"),
        1,
      );
      assert.equal(await scalar("select count(*)::int r from crm_deals"), 1);
      assert(
        (
          await scalar("select notes r from meetings where id=$1", [meeting])
        ).includes("Observação prévia preservada"),
      );
      assert.equal(await scalar("select count(*)::int r from contracts"), 0);
      assert.equal(
        await scalar("select count(*)::int r from crm_meeting_results"),
        1,
      );
    },
  );
  await t.test(
    "Contato mantém pendência, reagendamento preserva histórico, versão obsoleta bloqueia",
    async () => {
      await actor(3);
      await rpc("crm_followup_action", {
        request_id: randomUUID(),
        id: followup,
        lead_id: lead,
        version: 1,
        operation: "contact",
        result: "Falamos, aguarda decisão",
      });
      assert.equal(
        await scalar("select status r from crm_followups where id=$1", [
          followup,
        ]),
        "pending",
      );
      await assert.rejects(
        rpc("crm_followup_action", {
          request_id: randomUUID(),
          id: followup,
          lead_id: lead,
          version: 1,
          operation: "complete",
          result: "Stale",
        }),
        /outra pessoa/,
      );
      await rpc("crm_followup_action", {
        request_id: randomUUID(),
        id: followup,
        lead_id: lead,
        version: 2,
        operation: "reschedule",
        due_at: new Date(Date.now() + 172800000).toISOString(),
        assigned_to: uid(3),
      });
      assert.equal(
        await scalar("select version r from crm_followups where id=$1", [
          followup,
        ]),
        3,
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from crm_activities where followup_id=$1",
          [followup],
        ),
        3,
      );
    },
  );
  await t.test(
    "Concluir e programar novo retorno é atômico, idempotente e preserva a cadeia",
    async () => {
      await actor(3);
      const d = {
        request_id: randomUUID(),
        id: followup,
        lead_id: lead,
        version: 3,
        operation: "complete",
        result: "Aguardando sócio",
        next_due_at: new Date(Date.now() + 259200000).toISOString(),
        assigned_to: uid(3),
        reason: "Decisão do sócio",
      };
      const r = await rpc("crm_followup_action", d);
      assert.deepEqual(await rpc("crm_followup_action", d), r);
      assert.equal(
        await scalar("select status r from crm_followups where id=$1", [
          followup,
        ]),
        "completed",
      );
      assert.equal(
        await scalar("select previous_id r from crm_followups where id=$1", [
          r.next_id,
        ]),
        followup,
      );
      assert.equal(
        await scalar("select count(*)::int r from crm_followups"),
        2,
      );
      assert.deepEqual(
        await scalar("select follow_up_at r from crm_leads where id=$1", [
          lead,
        ]),
        await scalar("select due_at r from crm_followups where id=$1", [
          r.next_id,
        ]),
      );
    },
  );
  await t.test(
    "Retornos não desaparecem pelo formulário legado ou pelo arquivamento",
    async () => {
      await actor(3);
      await assert.rejects(
        rpc("crm_activity", {
          lead_id: lead,
          kind: "note",
          description: "Apagar data",
          follow_up_at: "",
        }),
        /central de follow-ups/,
      );
      await actor(1);
      await rpc("crm_archive", { id: lead, archived: "true", confirm: "true" });
      assert.equal(
        await scalar(
          "select count(*)::int r from crm_followups where status='pending'",
        ),
        1,
      );
      await rpc("crm_archive", {
        id: lead,
        archived: "false",
        confirm: "true",
      });
    },
  );
  await t.test(
    "Reagendamento de reunião cria sucessora e conserva anterior; nenhuma pontuação antecipada",
    async () => {
      await actor(2);
      const mid = await rpc("crm_schedule_meeting", {
        ...schedule,
        lead_id: lead,
        request_id: randomUUID(),
        scheduled_at: new Date(Date.now() + 345600000).toISOString(),
      });
      await actor(3);
      const d = {
        request_id: randomUUID(),
        id: mid,
        version: await scalar("select version r from meetings where id=$1", [
          mid,
        ]),
        scheduled_at: new Date(Date.now() + 432000000).toISOString(),
        closer_id: uid(3),
      };
      const r = await rpc("crm_reschedule_meeting", d);
      assert.deepEqual(await rpc("crm_reschedule_meeting", d), r);
      assert.equal(
        await scalar("select status r from meetings where id=$1", [mid]),
        "cancelled",
      );
      assert.equal(
        await scalar("select rescheduled_from_id r from meetings where id=$1", [
          r.id,
        ]),
        mid,
      );
      assert.equal(
        await scalar("select meeting_url r from meetings where id=$1", [r.id]),
        schedule.meeting_url,
      );
      assert.equal(await scalar("select count(*)::int r from contracts"), 0);
    },
  );
  await t.test(
    "Campanha elegível: validação oficial pontua uma vez; campanha finalizada conserva pontuação",
    async () => {
      await owner();
      const ca = await scalar(
        "update campaigns set state='active',starts_at=now()-interval '2 days',ends_at=now()+interval '20 days' returning id r",
      );
      const team = await scalar(
        "insert into teams(name) values('Agenda campaign team') returning id r",
      );
      await q(
        "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
        [ca, uid(2), team],
      );
      await actor(2);
      const lid = await rpc("crm_save_lead", {
        company: "Eligible company",
        contact: "Contato",
        phone: "11987650002",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        source: "Teste",
        closer_id: uid(3),
      });
      const mid = await rpc("crm_schedule_meeting", {
        request_id: randomUUID(),
        lead_id: lid,
        closer_id: uid(3),
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      });
      await owner();
      assert.equal(
        await scalar(
          "select campaign_id r from opportunities where crm_lead_id=$1",
          [lid],
        ),
        ca,
      );
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores where campaign_id=$1",
          [ca],
        ),
        0,
      );
      await q(
        "update meetings set scheduled_at=now()-interval '1 hour' where id=$1",
        [mid],
      );
      await actor(3);
      const d = {
        request_id: randomUUID(),
        id: mid,
        version: await scalar("select version r from meetings where id=$1", [
          mid,
        ]),
        outcome: "negotiation",
        notes: "Reunião realizada",
      };
      await rpc("crm_record_meeting_result", d);
      await rpc("crm_record_meeting_result", d);
      await owner();
      assert.equal(
        await scalar(
          "select coalesce(sum(points),0)::int r from opportunity_scores where campaign_id=$1",
          [ca],
        ),
        1,
      );
      // Finalized validation is never rewritten by later commercial work.
      await q("delete from crm_meeting_results where meeting_id=$1", [mid]);
      await q("update campaigns set state='finalized' where id=$1", [ca]);
      const before = await scalar(
        "select row_to_json(m) r from meetings m where id=$1",
        [mid],
      );
      await actor(3);
      await rpc("crm_record_meeting_result", {
        request_id: randomUUID(),
        id: mid,
        version: before.version,
        outcome: "proposal",
        notes: "Proposta posterior à campanha",
        services: "Marketing",
        amount: 100,
        term_months: 12,
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
        await scalar("select status r from meetings where id=$1", [mid]),
        before.status,
      );
    },
  );
  await t.test(
    "RPCs privados e DML direto são proibidos; JWT sem sessão perde acesso",
    async () => {
      await actor(3);
      await assert.rejects(
        rpc("crm_schedule_core", { lead_id: lead }),
        /permission denied/,
      );
      await assert.rejects(q("delete from crm_followups"), /permission denied/);
      await db.exec("reset role");
      await q("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: uid(3), session_id: uid(90) }),
      ]);
      await db.exec("set role authenticated");
      assert.equal(
        await scalar("select count(*)::int r from crm_followups"),
        0,
      );
      await assert.rejects(
        rpc("crm_followup_action", {
          request_id: randomUUID(),
          lead_id: lead,
          operation: "create",
        }),
        /Sem acesso/,
      );
    },
  );
  await db.close();
});
