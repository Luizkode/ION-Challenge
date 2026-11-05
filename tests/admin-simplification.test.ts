import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const uid = (n: number) =>
  `99000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Admin simplificado: histórico, sessões, acesso e auditoria", async (t) => {
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
  const q = async (s: string, p: unknown[] = []) =>
    (await db.query<any>(s, p)).rows;
  const scalar = async (s: string, p: unknown[] = []) => (await q(s, p))[0]?.r;
  const actor = async (n: number, sid?: number) => {
    await db.exec("reset role");
    await q(
      "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [
        uid(n),
        sid ? JSON.stringify({ sub: uid(n), session_id: uid(sid) }) : "",
      ],
    );
    await db.exec("set role authenticated");
  };
  const owner = async () => {
    await db.exec("reset role");
    await q(
      "select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)",
    );
  };
  for (const n of [1, 2, 3]) {
    await q("insert into auth.users(id,email) values($1,$2)", [
      uid(n),
      `technical${n}@example.invalid`,
    ]);
    await q("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Technical " + n,
      n === 1 ? "admin" : "sdr",
    ]);
    await q("insert into auth.sessions values($1,$2)", [uid(n + 20), uid(n)]);
  }
  const ca = await scalar("select id r from campaigns limit 1");
  const team = await scalar(
    "insert into teams(name) values('Fixture') returning id r",
  );
  await q(
    "insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)",
    [ca, uid(2), team],
  );
  await q(
    "insert into storage.objects(bucket_id,name,owner_id) values('ion-os-documents','retained-fixture',$1)",
    [uid(2)],
  );
  await q(
    "insert into storage.objects(bucket_id,name,owner,owner_id) values('ion-os-documents','different-current-owner',$1,$2)",
    [uid(2), uid(3)],
  );
  let lead = "";
  await t.test(
    "diretório Auth retorna somente campos seguros e é exclusivo do ADM",
    async () => {
      await actor(2, 22);
      await assert.rejects(
        scalar("select team_auth_directory($1) r", [[uid(1)]]),
        /administrador/,
      );
      await actor(1, 21);
      const r = await q("select * from team_auth_directory($1)", [[uid(2)]]);
      assert.equal(r[0].email, "technical2@example.invalid");
      assert(!JSON.stringify(r).includes("password"));
      assert(!JSON.stringify(r).includes("token"));
    },
  );
  await t.test(
    "funções e categoria usam auditoria automática e removem vínculo incompatível atomicamente",
    async () => {
      await actor(1, 21);
      await scalar("select team_save_access($1::jsonb) r", [
        JSON.stringify({
          id: uid(3),
          name: "Technical 3",
          category: "employee",
          functions: ["sdr", "closer"],
          company_ids: [],
          active: "true",
        }),
      ]);
      assert.equal(
        await scalar(
          "select count(*)::int r from user_functions where profile_id=$1",
          [uid(3)],
        ),
        2,
      );
    },
  );
  await t.test(
    "revogar sessões bloqueia JWT ainda assinado no RLS e nos RPCs",
    async () => {
      await actor(1, 21);
      await scalar("select begin_team_auth_action($1,$2,$3) r", [
        uid(3),
        "revoke_sessions",
        uid(40),
      ]);
      await actor(3, 23);
      assert.equal(await scalar("select current_access() r"), null);
      assert.equal(await scalar("select can_crm() r"), false);
      assert.equal((await q("select * from profiles")).length, 0);
      await assert.rejects(
        scalar("select crm_save_lead($1::jsonb) r", [
          JSON.stringify({ company: "Blocked" }),
        ]),
        /sessão/,
      );
    },
  );
  await t.test(
    "remoção automática aceita histórico CRM/campanha/Storage e bloqueia acesso imediatamente",
    async () => {
      await actor(2, 22);
      lead = await scalar("select crm_save_lead($1::jsonb) r", [
        JSON.stringify({
          company: "Technical historical lead",
          contact: "Technical",
          phone: "11999998888",
          city: "São Paulo",
          state: "SP",
          niche: "Test",
          source: "Test",
          email: "",
        }),
      ]);
      await actor(1, 21);
      await scalar("select prepare_simple_removal($1,$2) r", [uid(2), uid(41)]);
      await owner();
      assert.equal(
        await scalar(
          "select count(*)::int r from auth.sessions where user_id=$1",
          [uid(2)],
        ),
        0,
      );
      assert(
        await scalar(
          "select banned_until>now() r from auth.users where id=$1",
          [uid(2)],
        ),
      );
      assert.equal(
        await scalar("select owner_id r from storage.objects where name=$1", [
          "retained-fixture",
        ]),
        null,
      );
      await q("delete from auth.users where id=$1", [uid(2)]);
      const p = (
        await q(
          "select name,active,auth_user_id,is_historical from profiles where id=$1",
          [uid(2)],
        )
      )[0];
      assert.equal(p.is_historical, true);
      assert.equal(p.active, false);
      assert.equal(p.auth_user_id, null);
      assert.match(p.name, /Colaborador removido/);
      assert.equal(
        await scalar("select sdr_id r from crm_leads where id=$1", [lead]),
        uid(2),
      );
      assert.equal(
        await scalar(
          "select active r from campaign_participants where profile_id=$1",
          [uid(2)],
        ),
        false,
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from user_functions where profile_id=$1",
          [uid(2)],
        ),
        0,
      );
      assert.equal(
        await scalar("select count(*)::int r from storage.objects"),
        2,
      );
      assert.equal(
        await scalar(
          "select owner_id r from storage.objects where name='different-current-owner'",
        ),
        uid(3),
      );
      await actor(1, 21);
      assert.equal(
        (
          await scalar("select prepare_simple_removal($1,$2) r", [
            uid(2),
            uid(41),
          ])
        ).status,
        "completed",
      );
    },
  );
  await t.test(
    "conta sem registros retidos não deixa perfil operacional ou marcador desnecessário",
    async () => {
      await actor(1, 21);
      await scalar("select prepare_simple_removal($1,$2) r", [uid(3), uid(43)]);
      await owner();
      await q("delete from auth.users where id=$1", [uid(3)]);
      assert.equal(
        await scalar("select count(*)::int r from profiles where id=$1", [
          uid(3),
        ]),
        0,
      );
      assert.equal(
        await scalar(
          "select count(*)::int r from historical_actors where id=$1",
          [uid(3)],
        ),
        0,
      );
    },
  );
  await t.test(
    "último ADM, autoexclusão e reativação de marcador histórico continuam bloqueados",
    async () => {
      await actor(1, 21);
      await assert.rejects(
        scalar("select prepare_simple_removal($1,$2) r", [uid(1), uid(42)]),
        /própria/,
      );
      await assert.rejects(
        scalar("select team_save_access($1::jsonb) r", [
          JSON.stringify({
            id: uid(2),
            name: "Technical",
            category: "employee",
            functions: ["sdr"],
            company_ids: [],
            active: "true",
          }),
        ]),
        /histórico/,
      );
      await owner();
      await assert.rejects(
        q("update profiles set active=false where id=$1", [uid(1)]),
        /último administrador/,
      );
    },
  );
  await t.test(
    "fila encerra a execução quando o administrador original perde autorização",
    async () => {
      await owner();
      for (const n of [4, 5]) {
        await q("insert into auth.users(id,email) values($1,$2)", [
          uid(n),
          "queue" + n + "@example.invalid",
        ]);
        await q("insert into profiles(id,name,role) values($1,$2,$3)", [
          uid(n),
          "Queue " + n,
          n === 4 ? "admin" : "sdr",
        ]);
      }
      await actor(1, 21);
      await scalar("select prepare_simple_removal($1,$2) r", [uid(5), uid(44)]);
      await owner();
      await q("update profiles set active=false where id=$1", [uid(1)]);
      assert.equal(
        await scalar("select resume_simple_removal($1) r", [uid(44)]),
        null,
      );
      assert.equal(
        await scalar(
          "select status r from user_lifecycle_operations where id=$1",
          [uid(44)],
        ),
        "failed",
      );
      assert.equal(
        await scalar("select count(*)::int r from auth.users where id=$1", [
          uid(5),
        ]),
        1,
      );
    },
  );
  await db.close();
});
