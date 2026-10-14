import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

const sql = (path: string) => readFile(new URL("../supabase/" + path, import.meta.url), "utf8");
const id = (n: number) => `90000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("upgrade 001/002 → 003 preserva campanha finalizada, reunião validada, contrato, ranking e participante removido", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
    await db.exec(await sql("migrations/001_ion.sql"));
    await db.exec(await sql("migrations/002_participant_management.sql"));
    for (let n = 1; n <= 4; n++) await db.query("insert into auth.users values($1,$2)", [id(n), `user${n}@upgrade.test`]);
    await db.query("insert into profiles(id,name,role,active) values($1,'Admin legado','admin',true),($2,'SDR legado','sdr',true),($3,'Closer legado','closer',true),($4,'SDR removido','sdr',false)", [id(1), id(2), id(3), id(4)]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
    await db.query("insert into teams(id,name) values($1,'Time histórico')", [id(5)]);
    const campaign = (await db.query<{ id: string }>("select id from campaigns")).rows[0].id;
    await db.query("update campaigns set state='finalized', starts_at=now()-interval '57 days',ends_at=now()-interval '1 day',winner_id=$1 where id=$2", [id(2), campaign]);
    await db.query("insert into campaign_participants(campaign_id,profile_id,team_id) values($1,$2,$3)", [campaign, id(2), id(5)]);
    await db.query("insert into campaign_participants(campaign_id,profile_id,team_id,active,removed_at,removed_by) values($1,$2,$3,false,now(),$4)", [campaign, id(4), id(5), id(1)]);
    await db.query("insert into opportunities(id,campaign_id,sdr_id,team_id,company,contact,phone,city,niche) values($1,$2,$3,$4,'Empresa histórica','Contato legado','11999998888','São Paulo','Serviços')", [id(10), campaign, id(2), id(5)]);
    await db.query("insert into meetings(id,opportunity_id,closer_id,scheduled_at,status) values($1,$2,$3,now()-interval '2 days','qualified')", [id(11), id(10), id(3)]);
    await db.query("insert into meeting_validations(id,meeting_id,actor_id,previous_status,new_status,notes) values($1,$2,$3,'held','qualified','Validação histórica')", [id(12), id(11), id(3)]);
    await db.query("insert into contracts(id,opportunity_id,meeting_id,closed_at,amount,reference,confirmed_by) values($1,$2,$3,current_date-1,1000,'Contrato histórico',$4)", [id(13), id(10), id(11), id(1)]);
    const baselineSql = await sql("checks/stage_2_baseline.sql");
    const baseline = await db.exec(baselineSql);
    const board = await db.query("select dashboard($1) as value", [campaign]);
    const profiles = await db.query("select id,name,role,active from profiles order by id");
    assert.equal((await db.query<{ points: number }>("select points from opportunity_scores")).rows[0].points, 7);
    await db.exec(await sql("migrations/003_access_control.sql"));
    assert.deepEqual(await db.exec(baselineSql), baseline);
    assert.deepEqual(await db.query("select dashboard($1) as value", [campaign]), board);
    assert.deepEqual(await db.query("select id,name,role,active from profiles order by id"), profiles);
    await db.exec(await sql("checks/stage_2_security.sql"));
  } finally {
    await db.close();
  }
});
