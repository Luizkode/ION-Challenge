import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { canAccessModule } from "../lib/os-modules";
import type { Access } from "../lib/access";
const id = (n: number) =>
  `80000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("perfis múltiplos: união de permissões sem financeiro; parceiro só Partners", () => {
  const worker: Access = {
    role: "member",
    category: "employee",
    functions: ["traffic", "designer"],
    challenger: false,
  };
  assert(canAccessModule("clients", worker));
  assert(canAccessModule("analytics", worker));
  for (const m of ["crm", "challenger", "finance", "team", "settings"])
    assert(!canAccessModule(m, worker));
  const mixed = {
    ...worker,
    role: "sdr" as const,
    functions: ["traffic", "sdr"] as Access["functions"],
    challenger: true,
  };
  assert(canAccessModule("crm", mixed));
  assert(canAccessModule("clients", mixed));
  assert(canAccessModule("challenger", mixed));
  const partner: Access = {
    role: "partner",
    category: "partner",
    functions: [],
    challenger: false,
  };
  for (const m of [
    "dashboard",
    "crm",
    "challenger",
    "clients",
    "analytics",
    "finance",
    "team",
    "settings",
  ])
    assert(!canAccessModule(m, partner));
  assert(canAccessModule("partners", partner));
});
test("PostgreSQL Etapa 2: upgrade, RLS, convites e permissões reais", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  for (const file of ["001_ion.sql", "002_participant_management.sql"])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (let n = 1; n <= 9; n++)
    await db.query("insert into auth.users values($1,$2)", [
      id(n),
      `user${n}@ion.test`,
    ]);
  await db.query(
    "insert into profiles(id,name,role) values($1,'Administrador','admin'),($2,'SDR antigo','sdr'),($3,'Closer antigo','closer')",
    [id(1), id(2), id(3)],
  );
  const team = (
    await db.query<{ id: string }>(
      "insert into teams(name) values('Time preservado') returning id",
    )
  ).rows[0].id;
  const ca = (
    await db.query<{ id: string }>(
      "update campaigns set state='active',starts_at=now()-interval '1 day',ends_at=now()+interval '55 days' returning id",
    )
  ).rows[0].id;
  await db.query(
    "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
    [ca, id(2), team],
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/003_access_control.sql", import.meta.url),
      "utf8",
    ),
  );
  const actor = async (n: number) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      id(n),
    ]);
    await db.exec("set role authenticated");
  };
  const manage = async (
    n: number,
    category: string,
    functions: string[],
    extra: Record<string, unknown> = {},
  ) =>
    db.query("select manage_access($1::jsonb)", [
      JSON.stringify({
        id: id(n),
        name: "Usuário " + n,
        category,
        functions,
        company_ids: [],
        active: "true",
        confirm: "true",
        reason: "Ajuste de acesso autorizado",
        ...extra,
      }),
    ]);
  const company = async (name: string) =>
    (
      await db.query<{ id: string }>(
        "select manage_access_company($1::jsonb) as id",
        [JSON.stringify({ name })],
      )
    ).rows[0].id;
  await actor(1);
  const a = await company("Empresa A"),
    b = await company("Empresa B");
  await t.test(
    "upgrade conserva IDs, participação e funções legadas",
    async () => {
      const f = (
        await db.query<{ profile_id: string; function_code: string }>(
          "select * from user_functions",
        )
      ).rows;
      assert(
        f.some((v) => v.profile_id === id(2) && v.function_code === "sdr"),
      );
      assert(
        f.some((v) => v.profile_id === id(3) && v.function_code === "closer"),
      );
      assert.equal(
        (await db.query("select * from campaign_participants")).rows.length,
        1,
      );
      assert.equal(
        (
          await db.query<{ category: string }>(
            "select category from profiles where id=$1",
            [id(1)],
          )
        ).rows[0].category,
        "admin",
      );
    },
  );
  await t.test(
    "gestor só lê seus clientes e não acessa dados comerciais ou financeiros",
    async () => {
      await manage(4, "employee", ["traffic"], { company_ids: [a] });
      await actor(4);
      assert.equal(
        (await db.query("select * from access_companies")).rows.length,
        1,
      );
      assert.equal((await db.query("select * from profiles")).rows.length, 1);
      assert.equal((await db.query("select * from campaigns")).rows.length, 0);
      assert.equal((await db.query("select * from contracts")).rows.length, 0);
      await assert.rejects(
        db.query("select dashboard($1)", [ca]),
        /Sem acesso/,
      );
      await assert.rejects(
        db.query("select create_meeting($1::jsonb)", [
          JSON.stringify({ campaign_id: ca }),
        ]),
        /Apenas SDRs/,
      );
      await assert.rejects(manage(4, "admin", []), /Acesso restrito/);
    },
  );
  await t.test(
    "parceiro só vê empresa vinculada; não edita nem lê outro cliente",
    async () => {
      await actor(1);
      await manage(5, "partner", [], { company_ids: [a] });
      await actor(5);
      assert.equal(
        (await db.query<{ name: string }>("select name from access_companies"))
          .rows[0].name,
        "Empresa A",
      );
      assert.equal(
        (await db.query("select * from access_companies where id=$1", [b])).rows
          .length,
        0,
      );
      for (const table of [
        "meetings",
        "opportunities",
        "contracts",
        "audit_logs",
        "campaigns",
        "access_invitations",
      ])
        assert.equal((await db.query("select * from " + table)).rows.length, 0);
      await assert.rejects(
        db.query("update access_companies set name='Fraude'"),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select admin_operation($1,$2::jsonb)", [
          "team",
          JSON.stringify({ name: "Fraude" }),
        ]),
        /Acesso restrito/,
      );
      assert.equal(
        (await db.query("select * from available_closers()")).rows.length,
        0,
      );
    },
  );
  await t.test(
    "múltiplas funções combinam permissões; SDR+closer pode validar atribuições de outro SDR",
    async () => {
      await actor(1);
      await manage(3, "employee", ["sdr", "closer", "traffic"], {
        company_ids: [b],
      });
      await actor(2);
      const mid = (
        await db.query<{ id: string }>(
          "select create_meeting($1::jsonb) as id",
          [
            JSON.stringify({
              campaign_id: ca,
              company: "Empresa real de teste",
              contact: "Maria",
              phone: "11999999999",
              city: "São Paulo",
              niche: "Serviços",
              closer_id: id(3),
              scheduled_at: new Date(Date.now() - 3600000).toISOString(),
            }),
          ],
        )
      ).rows[0].id;
      assert.equal(
        (await db.query("select * from available_closers()")).rows.length,
        1,
      );
      await actor(3);
      assert.equal(
        (
          await db.query<{ b: boolean }>("select has_function($1) as b", [
            "sdr",
          ])
        ).rows[0].b,
        true,
      );
      assert.equal(
        (
          await db.query<{ b: boolean }>("select has_function($1) as b", [
            "closer",
          ])
        ).rows[0].b,
        true,
      );
      await db.query("select validate_meeting($1::jsonb)", [
        JSON.stringify({ id: mid, attended: true, qualified: true }),
      ]);
      await actor(2);
      const board = (
        await db.query<{ b: { individual: { id: string; points: number }[] } }>(
          "select dashboard($1) as b",
          [ca],
        )
      ).rows[0].b;
      assert.equal(board.individual.find((p) => p.id === id(2))?.points, 3);
    },
  );
  await t.test(
    "desativação bloqueia imediatamente dados e RPCs mesmo com sessão antiga",
    async () => {
      await actor(1);
      await manage(4, "employee", ["traffic"], {
        company_ids: [a],
        active: "false",
      });
      await actor(4);
      assert.equal(
        (await db.query("select * from access_companies")).rows.length,
        0,
      );
      assert.equal((await db.query("select * from profiles")).rows.length, 0);
      assert.equal(
        (await db.query<{ a: unknown }>("select current_access() as a")).rows[0]
          .a,
        null,
      );
    },
  );
  await t.test("último administrador não pode ser desativado", async () => {
    await actor(1);
    await assert.rejects(
      manage(1, "employee", ["traffic"]),
      /último administrador/,
    );
  });
  await t.test(
    "retirar SDR exige remoção explícita e mantém histórico comercial",
    async () => {
      await assert.rejects(
        manage(2, "employee", ["designer"]),
        /remover da campanha/,
      );
      await manage(2, "employee", ["designer"], {
        remove_from_campaign: "true",
      });
      assert.equal(
        (
          await db.query<{ active: boolean }>(
            "select active from campaign_participants where profile_id=$1",
            [id(2)],
          )
        ).rows[0].active,
        false,
      );
      assert.equal((await db.query("select * from meetings")).rows.length, 1);
      await actor(2);
      assert.equal((await db.query("select * from meetings")).rows.length, 0);
    },
  );
  await t.test(
    "convite só é concluído para email correto e sem reaproveitar perfil existente",
    async () => {
      await actor(1);
      const data = {
        email: "user6@ion.test",
        name: "Parceiro convidado",
        category: "partner",
        functions: [],
        company_ids: [b],
        confirm: "true",
        reason: "Convite de parceiro autorizado",
      };
      const iid = (
        await db.query<{ id: string }>(
          "select begin_access_invite($1::jsonb) as id",
          [JSON.stringify(data)],
        )
      ).rows[0].id;
      await assert.rejects(
        db.query("select complete_access_invite($1,$2)", [iid, id(7)]),
        /não corresponde/,
      );
      assert.equal(
        (await db.query("select * from profiles where id=$1", [id(6)])).rows
          .length,
        0,
      );
      await db.query("select complete_access_invite($1,$2)", [iid, id(6)]);
      await actor(6);
      assert.equal(
        (await db.query<{ name: string }>("select name from access_companies"))
          .rows[0].name,
        "Empresa B",
      );
      assert.equal(
        (await db.query("select * from access_companies where id=$1", [a])).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    "rollback preserva funções e vínculos em atualização inválida; auditoria contém antes/depois",
    async () => {
      await actor(1);
      await assert.rejects(
        manage(5, "employee", ["invalid"], { company_ids: [b] }),
        /Função inválida/,
      );
      assert.equal(
        (
          await db.query<{ category: string }>(
            "select category from profiles where id=$1",
            [id(5)],
          )
        ).rows[0].category,
        "partner",
      );
      assert.equal(
        (
          await db.query<{ company_id: string }>(
            "select company_id from partner_companies where profile_id=$1",
            [id(5)],
          )
        ).rows[0].company_id,
        a,
      );
      const logs = (
        await db.query<{
          entity: string;
          old_state: unknown;
          new_state: unknown;
        }>("select * from audit_logs")
      ).rows;
      assert(
        logs.some((l) => l.entity === "profiles" && l.old_state && l.new_state),
      );
      assert(logs.some((l) => l.entity === "user_functions" && l.old_state));
      await assert.rejects(
        db.query("select admin_operation_v2($1,$2::jsonb)", ["profile", "{}"]),
        /permission denied/,
      );
    },
  );
  await t.test(
    "closer desativado não valida por UUID conhecido; nova sessão não é necessária",
    async () => {
      await actor(1);
      const mid = (
        await db.query<{ id: string }>("select id from meetings limit 1")
      ).rows[0].id;
      await db.query("select admin_operation('correct_meeting',$1::jsonb)", [
        JSON.stringify({
          id: mid,
          status: "held",
          reason: "Revisão controlada para teste",
        }),
      ]);
      await manage(3, "employee", ["sdr", "closer"], { active: "false" });
      await actor(3);
      await assert.rejects(
        db.query("select validate_meeting($1::jsonb)", [
          JSON.stringify({ id: mid, attended: false, qualified: false }),
        ]),
        /Sem permissão/,
      );
      await actor(1);
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from meetings where id=$1",
            [mid],
          )
        ).rows[0].status,
        "held",
      );
    },
  );
  await t.test(
    "convite existente não substitui perfil e tentativas falhas são auditadas",
    async () => {
      const data = {
        email: "user3@ion.test",
        name: "Tentativa de convite",
        category: "admin",
        functions: [],
        company_ids: [],
        confirm: "true",
        reason: "Teste de convite a conta existente",
      };
      const iid = (
        await db.query<{ id: string }>(
          "select begin_access_invite($1::jsonb) as id",
          [JSON.stringify(data)],
        )
      ).rows[0].id;
      await assert.rejects(
        db.query("select complete_access_invite($1,$2)", [iid, id(3)]),
        /já possui perfil/,
      );
      await db.query("select fail_access_invite($1)", [iid]);
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from access_invitations where id=$1",
            [iid],
          )
        ).rows[0].status,
        "failed",
      );
    },
  );
  await db.close();
});
