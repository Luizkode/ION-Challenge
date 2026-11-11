import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { lifecycleSchema } from "../lib/user-lifecycle";
const uid = (n: number) =>
  `98000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Confirmação de ciclo de vida exige UUID exato, motivo e conta de teste explícita", () => {
  const d = {
    target_id: uid(2),
    request_id: uid(10),
    mode: "delete_test",
    confirmation: uid(2),
    reason: "Remover conta de teste",
    confirm: "true",
    test_account: "true",
  };
  assert(lifecycleSchema.safeParse(d).success);
  for (const patch of [
    { confirmation: uid(1) },
    { reason: "x" },
    { confirm: "false" },
    { test_account: "false" },
  ])
    assert(!lifecycleSchema.safeParse({ ...d, ...patch }).success);
});
test("Ciclo de vida PostgreSQL: preservação, permissões, falhas e idempotência", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,deleted_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
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
  const q = async <T = any>(sql: string, params: any[] = []) =>
    (await db.query<T>(sql, params)).rows;
  const scalar = async (sql: string, params: any[] = []) =>
    (await q(sql, params))[0]?.r;
  const actor = async (n: number) => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
    await db.exec("set role authenticated");
  };
  const owner = async () => {
    await db.exec("reset role");
    await q("select set_config('request.jwt.claim.sub','',false)");
  };
  const create = async (n: number, role = "sdr") => {
    await owner();
    await q("insert into auth.users(id,email) values($1,$2)", [
      uid(n),
      `fixture${n}@example.invalid`,
    ]);
    await q("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Technical " + n,
      role,
    ]);
  };
  const data = (n: number, id: number, mode = "delete_test") => ({
    target_id: uid(n),
    request_id: uid(id),
    mode,
    reason: "Controlled technical account removal",
    confirmation: uid(n),
    confirm: "true",
    test_account: "true",
  });
  const prepare = async (d: any) =>
    scalar("select prepare_user_lifecycle($1::jsonb) r", [JSON.stringify(d)]);
  await create(1, "admin");
  await create(2);
  await create(3);
  await t.test(
    "último administrador protegido no banco; não depende do formulário",
    async () => {
      await owner();
      await assert.rejects(
        q("update profiles set active=false where id=$1", [uid(1)]),
        /último administrador/,
      );
      await actor(1);
      await assert.rejects(prepare(data(1, 11)), /próprio acesso/);
    },
  );
  await t.test(
    "SDR não inspeciona nem prepara remoção e não consulta o ledger",
    async () => {
      await actor(2);
      await assert.rejects(prepare(data(3, 12)), /administrador/);
      await assert.rejects(
        scalar("select inspect_user_lifecycle($1) r", [uid(3)]),
        /administrador/,
      );
      assert.equal(
        (await q("select * from user_lifecycle_operations")).length,
        0,
      );
    },
  );
  await t.test(
    "exclusão direta e soft-delete do Auth são bloqueados",
    async () => {
      await owner();
      await assert.rejects(
        q("delete from auth.users where id=$1", [uid(3)]),
        /Use Equipe/,
      );
      await assert.rejects(
        q("update auth.users set deleted_at=now() where id=$1", [uid(3)]),
        /exclusão lógica/,
      );
    },
  );
  await t.test(
    "conta sem histórico: Auth/perfil removidos, auditoria e convite preservados",
    async () => {
      await owner();
      await q(
        "insert into audit_logs(actor_id,action,entity,entity_id) values($1::uuid,'TEST','technical',$1::text)",
        [uid(3)],
      );
      await q(
        "insert into access_invitations(email,name,category,functions,company_ids,actor_id,auth_user_id,status) values('fixture@example.invalid','Technical','employee','[]','[]',$1,$2,'completed')",
        [uid(1), uid(3)],
      );
      await actor(1);
      const d = data(3, 13);
      assert.equal((await prepare(d)).status, "pending");
      assert.equal((await prepare(d)).id, uid(13));
      await owner();
      await q("delete from auth.users where id=$1", [uid(3)]);
      assert.equal(
        await scalar("select count(*)::int r from profiles where id=$1", [
          uid(3),
        ]),
        0,
      );
      const a = (
        await q(
          "select actor_id,actor_reference from audit_logs where entity='technical'",
        )
      )[0];
      assert.equal(a.actor_id, null);
      assert.equal(a.actor_reference, uid(3));
      const inv = (
        await q(
          "select auth_user_id,auth_user_reference from access_invitations",
        )
      )[0];
      assert.equal(inv.auth_user_id, null);
      assert.equal(inv.auth_user_reference, uid(3));
      await actor(1);
      assert.equal((await prepare(d)).status, "completed");
      await assert.rejects(
        prepare({ ...d, reason: "Another reason for same operation" }),
        /reutilizado/,
      );
    },
  );
  await t.test(
    "participação bloqueia exclusão definitiva; anonimização conserva vínculos e resultados",
    async () => {
      await owner();
      const ca = await scalar("select id r from campaigns limit 1");
      const team = await scalar(
        "insert into teams(name) values('Technical team') returning id r",
      );
      await q(
        "insert into campaign_participants(campaign_id,team_id,profile_id) values($1,$2,$3)",
        [ca, team, uid(2)],
      );
      const before = await q("select * from campaign_participants");
      await actor(1);
      const inspect = await scalar("select inspect_user_lifecycle($1) r", [
        uid(2),
      ]);
      assert.equal(inspect.can_delete_test, false);
      await assert.rejects(prepare(data(2, 14)), /histórico/);
      await prepare(data(2, 15, "anonymize"));
      await owner();
      await q("delete from auth.users where id=$1", [uid(2)]);
      assert.deepEqual(await q("select * from campaign_participants"), before);
      const p = (await q("select * from profiles where id=$1", [uid(2)]))[0];
      assert.equal(p.auth_user_id, null);
      assert.equal(p.active, false);
      assert.match(p.name, /anonimizado/);
      await assert.rejects(
        q("update profiles set active=true where id=$1", [uid(2)]),
        /não pode ser reativado/,
      );
    },
  );
  await t.test(
    "nova dependência entre confirmação e exclusão é revalidada",
    async () => {
      await create(4);
      await actor(1);
      await prepare(data(4, 16));
      await assert.rejects(
        scalar("select manage_access($1::jsonb) r", [
          JSON.stringify({
            id: uid(4),
            name: "Technical 4",
            category: "employee",
            functions: ["sdr"],
            company_ids: [],
            active: "true",
            confirm: "true",
            remove_from_campaign: "false",
            reason: "Verify pending removal cannot be reactivated",
          }),
        ]),
        /remoção pendente/,
      );
      await owner();
      await db.exec(
        "create table public.future_business(id uuid references public.profiles(id))",
      );
      await q("insert into future_business values($1)", [uid(4)]);
      await assert.rejects(
        q("delete from auth.users where id=$1", [uid(4)]),
        /Novas dependências/,
      );
      assert.equal(
        await scalar(
          "select status r from user_lifecycle_operations where id=$1",
          [uid(16)],
        ),
        "pending",
      );
      await actor(1);
      await scalar("select cancel_user_lifecycle($1) r", [uid(16)]);
      assert.equal(
        await scalar("select active r from profiles where id=$1", [uid(4)]),
        false,
      );
    },
  );
  await t.test(
    "falha posterior do Auth reverte cleanup e conclusão do ledger",
    async () => {
      await create(5);
      await owner();
      await db.exec(
        "create table public.auth_restrictor(id uuid references auth.users(id))",
      );
      await q("insert into auth_restrictor values($1)", [uid(5)]);
      await actor(1);
      await prepare(data(5, 17));
      await owner();
      await assert.rejects(
        q("delete from auth.users where id=$1", [uid(5)]),
        /foreign key/,
      );
      assert.equal(
        await scalar("select count(*)::int r from profiles where id=$1", [
          uid(5),
        ]),
        1,
      );
      assert.equal(
        await scalar(
          "select status r from user_lifecycle_operations where id=$1",
          [uid(17)],
        ),
        "pending",
      );
    },
  );
  await t.test(
    "propriedade de arquivos bloqueia remoção sem apagar Storage",
    async () => {
      await create(6);
      await owner();
      await q(
        "insert into storage.objects(bucket_id,name,owner_id) values('ion-os-documents','technical',$1)",
        [uid(6)],
      );
      await actor(1);
      await assert.rejects(prepare(data(6, 18, "anonymize")), /arquivos/);
      assert.equal(
        await scalar("select active r from profiles where id=$1", [uid(6)]),
        true,
      );
    },
  );
  await t.test(
    "confirmação expirada e perda de permissão do autor impedem execução",
    async () => {
      await create(7);
      await actor(1);
      await prepare(data(7, 19));
      await owner();
      await q(
        "update user_lifecycle_operations set expires_at=now()-interval '1 minute' where id=$1",
        [uid(19)],
      );
      await assert.rejects(
        q("delete from auth.users where id=$1", [uid(7)]),
        /não autorizada/,
      );
      await actor(1);
      await scalar("select cancel_user_lifecycle($1) r", [uid(19)]);
      await prepare(data(7, 20));
      await owner();
      await create(8, "admin");
      await q("update profiles set active=false where id=$1", [uid(1)]);
      await assert.rejects(
        q("delete from auth.users where id=$1", [uid(7)]),
        /não possui mais acesso/,
      );
    },
  );
  await db.close();
});
