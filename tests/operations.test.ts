import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { clientSchema, fileSchema, overdue } from "../lib/operations";
const uid = (n: number) =>
  `94000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const today = new Date().toISOString().slice(0, 10);
const fields = {
  name: "Cliente Alpha",
  contact: "Maria Silva",
  phone: "11988887777",
  email: "cliente@example.com",
  niche: "Serviços",
  city: "São Paulo",
  state: "SP",
  joined_at: today,
  relationship: "active",
  admin_notes: "SEGREDO ADMINISTRATIVO",
  partner_visible: true,
  assignees: [],
};
test("validação operacional: URLs, datas, telefone, uploads e atraso", () => {
  assert(clientSchema.safeParse(fields).success);
  assert(
    !clientSchema.safeParse({ ...fields, website: "javascript:alert(1)" })
      .success,
  );
  assert(
    !clientSchema.safeParse({ ...fields, joined_at: "2026-02-30" }).success,
  );
  assert(
    !fileSchema.safeParse({
      company_id: uid(1),
      name: "x.html",
      mime: "text/html",
      size: 2,
    }).success,
  );
  assert(
    !fileSchema.safeParse({
      company_id: uid(1),
      name: "x.pdf",
      mime: "application/pdf",
      size: 10485761,
    }).success,
  );
  assert(overdue({ due_at: "2020-01-01", status: "running" }, today));
  assert(!overdue({ due_at: "2020-01-01", status: "completed" }, today));
});
test("PostgreSQL operações: clientes, contratos, serviços, Storage, RLS e CRM", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;",
  );
  for (const file of [
    "001_ion.sql",
    "002_participant_management.sql",
    "003_access_control.sql",
    "004_commercial_crm.sql",
    "005_clients_services.sql",
    "006_operational_conversion_matching.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  for (let n = 1; n <= 8; n++) {
    await db.query("insert into auth.users values($1,$2)", [
      uid(n),
      `ops${n}@example.com`,
    ]);
    await db.query("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Pessoa " + n,
      n === 1
        ? "admin"
        : n === 5
          ? "closer"
          : n === 8
            ? "sdr"
            : n === 6 || n === 7
              ? "partner"
              : "member",
    ]);
  }
  await db.query(
    "insert into user_functions values($1,'designer'),($2,'traffic'),($3,'designer')",
    [uid(2), uid(3), uid(4)],
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
      await db.query<{ r: T }>(`select ${fn}($1::jsonb) r`, [
        JSON.stringify(data),
      ])
    ).rows[0].r;
  const count = async (table: string) =>
    (await db.query<{ n: number }>(`select count(*)::int n from ${table}`))
      .rows[0].n;
  let a = "",
    b = "",
    contract = "",
    design = "",
    traffic = "",
    fileId = "",
    filePath = "",
    sourceDeal = "",
    operational = "";
  const contractData = (company: string, reference = "OPS-001") => ({
    company_id: company,
    reference,
    starts_at: today,
    min_months: 6,
    amount: 1000,
    periodicity: "monthly",
    services_text: "Design e tráfego",
    status: "active",
    responsible_id: uid(3),
    partner_visible: true,
  });
  const serviceData = (
    company: string,
    cid: string,
    catalog: string,
    profile: string,
  ) => ({
    company_id: company,
    contract_id: cid,
    catalog_id: catalog,
    description: "BRIEFING INTERNO CONFIDENCIAL",
    partner_description: "Entregas autorizadas",
    starts_at: "2020-01-01",
    due_at: "2020-01-10",
    status: "running",
    assignees: [profile],
    partner_visible: true,
  });
  await t.test(
    "ADM cria clientes e evita duplicidade; colaborador não cadastra",
    async () => {
      await actor(1);
      a = await rpc("ops_save_client", { ...fields, assignees: [uid(4)] });
      b = await rpc("ops_save_client", {
        ...fields,
        name: "Cliente Beta",
        phone: "11988886666",
        email: "beta@example.com",
        assignees: [uid(5)],
      });
      assert.equal(await count("ops_clients"), 2);
      await assert.rejects(
        rpc("ops_save_client", {
          ...fields,
          name: " cliente alpha ",
          phone: "11988885555",
          email: "",
        }),
        /já cadastrada/,
      );
      await actor(2);
      await assert.rejects(rpc("ops_save_client", fields), /restrito/);
    },
  );
  await t.test(
    "contratos e aditivos preservam histórico e integridade entre empresas",
    async () => {
      await actor(1);
      contract = await rpc("ops_save_contract", contractData(a));
      await rpc("ops_save_contract", {
        ...contractData(a, "OPS-ADITIVO"),
        parent_id: contract,
      });
      await assert.rejects(
        rpc("ops_save_contract", {
          ...contractData(b, "INVALIDO"),
          parent_id: contract,
        }),
        /foreign key/,
      );
      assert.equal(await count("ops_contracts"), 2);
    },
  );
  await t.test("serviços configuráveis e múltiplos responsáveis", async () => {
    const catalog = (
      await db.query<{ id: string; name: string }>("select * from ops_catalog")
    ).rows;
    assert.equal(catalog.length, 13);
    design = await rpc(
      "ops_save_service",
      serviceData(
        a,
        contract,
        catalog.find((c) => c.name === "Design")!.id,
        uid(2),
      ),
    );
    traffic = await rpc(
      "ops_save_service",
      serviceData(
        a,
        contract,
        catalog.find((c) => c.name === "Gestão de tráfego pago")!.id,
        uid(3),
      ),
    );
    assert.equal(await count("ops_services"), 2);
    await rpc("ops_save_catalog", { name: "Serviço customizado" });
    assert.equal(await count("ops_catalog"), 14);
  });
  await t.test(
    "atribuição de serviço dá cliente/menu, mas não contrato nem outros serviços",
    async () => {
      await actor(2);
      assert.equal(await count("ops_clients"), 1);
      assert.equal(await count("access_companies"), 1);
      assert.equal(await count("ops_services"), 1);
      assert.equal(await count("ops_contracts"), 0);
      assert.equal(await count("ops_admin_notes"), 0);
      const access = (
        await db.query<{ a: { clients: boolean } }>("select current_access() a")
      ).rows[0].a;
      assert.equal(access.clients, true);
      await actor(4);
      assert.equal(await count("ops_clients"), 1);
      assert.equal(await count("ops_services"), 0);
      await actor(5);
      assert.equal(await count("ops_clients"), 1);
      assert.equal(await count("ops_services"), 0);
    },
  );
  await t.test(
    "andamento exclusivo, versão, data de entrega e publicação somente ADM",
    async () => {
      await actor(2);
      await assert.rejects(
        rpc("ops_progress", {
          service_id: traffic,
          version: 1,
          status: "completed",
          delivered_at: today,
          body: "Ataque",
        }),
        /indisponível/,
      );
      await assert.rejects(
        rpc("ops_progress", {
          service_id: design,
          version: 1,
          status: "completed",
          body: "Sem data",
        }),
        /data de entrega/,
      );
      await rpc("ops_progress", {
        service_id: design,
        version: 1,
        status: "completed",
        delivered_at: today,
        body: "NOTA INTERNA",
        partner_body: "Entrega revisada",
        published: true,
      });
      await assert.rejects(
        rpc("ops_progress", {
          service_id: design,
          version: 1,
          status: "paused",
          body: "Antigo",
        }),
        /outra pessoa/,
      );
      const update = (
        await db.query<{ published: boolean }>(
          "select published from ops_updates where service_id=$1 order by created_at desc",
          [design],
        )
      ).rows[0];
      assert.equal(update.published, false);
    },
  );
  await t.test(
    "parceiro não lê base/internos; projeção só contém publicação da própria empresa",
    async () => {
      await db.exec("reset role");
      await db.query("insert into partner_companies values($1,$2),($3,$4)", [
        uid(6),
        a,
        uid(7),
        b,
      ]);
      await actor(6);
      for (const table of [
        "ops_clients",
        "ops_contracts",
        "ops_services",
        "ops_updates",
        "ops_admin_notes",
        "ops_files",
      ])
        assert.equal(await count(table), 0);
      const snapshot = (
        await db.query<{ s: any[] }>("select ops_partner_snapshot() s")
      ).rows[0].s;
      assert.equal(snapshot.length, 1);
      const text = JSON.stringify(snapshot);
      assert(!text.includes("CONFIDENCIAL"));
      assert(!text.includes("NOTA INTERNA"));
      assert(!text.includes("amount"));
      assert(!text.includes("SEGREDO"));
      assert.equal(snapshot[0].services.length, 2);
      await assert.rejects(
        rpc("ops_progress", {
          service_id: design,
          version: 2,
          status: "paused",
          body: "Parceiro",
        }),
        /indisponível/,
      );
    },
  );
  await t.test("ADM publica resumo sem expor anotação interna", async () => {
    await actor(1);
    const id = (
      await db.query<{ id: string }>(
        "select id from ops_updates where body='NOTA INTERNA'",
      )
    ).rows[0].id;
    await rpc("ops_publish_update", {
      id,
      partner_body: "Entrega publicada",
      published: true,
    });
    await actor(6);
    const text = JSON.stringify(
      (await db.query("select ops_partner_snapshot() s")).rows,
    );
    assert(text.includes("Entrega publicada"));
    assert(!text.includes("NOTA INTERNA"));
  });
  await t.test(
    "Storage exige reserva, autoria, tamanho, MIME e vínculo do serviço",
    async () => {
      await actor(2);
      const r = await rpc<{ id: string; path: string }>("ops_begin_file", {
        company_id: a,
        service_id: design,
        name: "design.txt",
        mime: "text/plain",
        size: 5,
      });
      fileId = r.id;
      filePath = r.path;
      await assert.rejects(
        db.query(
          "insert into storage.objects(bucket_id,name,owner_id,metadata) values('ion-os-documents','sem-reserva',$1,'{}')",
          [uid(2)],
        ),
        /row-level security/,
      );
      await db.query(
        "insert into storage.objects(bucket_id,name,owner_id,metadata) values('ion-os-documents',$1,$2,$3)",
        [filePath, uid(2), { size: 4, mimetype: "text/plain" }],
      );
      await assert.rejects(
        rpc("ops_finish_file", { id: fileId }),
        /divergentes/,
      );
      assert.equal(await count("storage.objects"), 0);
      await db.exec("reset role");
      await db.query(
        'update storage.objects set metadata=\'{"size":5,"mimetype":"text/plain"}\' where name=$1',
        [filePath],
      );
      await actor(2);
      await rpc("ops_finish_file", { id: fileId });
      assert.equal(await count("storage.objects"), 1);
      await actor(5);
      assert.equal(await count("storage.objects"), 0);
      await assert.rejects(
        db.query("select ops_download($1)", [fileId]),
        /indisponível/,
      );
    },
  );
  await t.test(
    "download do parceiro exige documento explicitamente publicado e pode ser revogado",
    async () => {
      await actor(6);
      assert.equal(await count("storage.objects"), 0);
      await actor(1);
      await rpc("ops_manage_file", {
        id: fileId,
        state: "ready",
        partner_visible: true,
      });
      await actor(6);
      assert.equal(await count("storage.objects"), 1);
      assert((await db.query("select ops_download($1)", [fileId])).rows.length);
      await actor(7);
      assert.equal(await count("storage.objects"), 0);
      await actor(1);
      await rpc("ops_manage_file", {
        id: fileId,
        state: "archived",
        partner_visible: true,
      });
      await actor(6);
      assert.equal(await count("storage.objects"), 0);
    },
  );
  await t.test(
    "indicadores respeitam RLS e prazos; escrita direta é negada",
    async () => {
      await actor(1);
      const metrics = await rpc<{
        active_clients: number;
        running: number;
        completed: number;
        overdue: number;
      }>("ops_summary", {});
      assert.equal(metrics.active_clients, 2);
      assert.equal(metrics.running, 1);
      assert.equal(metrics.completed, 1);
      assert.equal(metrics.overdue, 1);
      const filtered = await rpc<{ active_clients: number; completed: number }>(
        "ops_summary",
        { status: "completed" },
      );
      assert.equal(filtered.active_clients, 1);
      assert.equal(filtered.completed, 1);
      const listing = (
        await db.query<{ r: { count: number } }>(
          "select ops_list_clients($1::jsonb,1,'') r",
          [JSON.stringify({ status: "completed" })],
        )
      ).rows[0].r;
      assert.equal(listing.count, 1);
      await actor(2);
      const own = await rpc<{
        active_clients: number;
        running: number;
        completed: number;
      }>("ops_summary", {});
      assert.equal(own.active_clients, 1);
      assert.equal(own.running, 0);
      assert.equal(own.completed, 1);
      await assert.rejects(
        db.query("update ops_services set status='running'"),
        /permission denied/,
      );
    },
  );
  await t.test(
    "conversão exige fechamento confirmado e é idempotente",
    async () => {
      await actor(8);
      const lead = await rpc("crm_save_lead", {
        company: "Cliente convertido",
        contact: "Joana Silva",
        phone: "11977776666",
        email: "convertido@example.com",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        source: "Teste",
        closer_id: uid(5),
      });
      const meeting = await rpc("crm_schedule_meeting", {
        lead_id: lead,
        closer_id: uid(5),
        scheduled_at: new Date(Date.now() + 3600000).toISOString(),
      });
      await db.exec("reset role");
      await db.query(
        "update meetings set scheduled_at=now()-interval '1 hour' where id=$1",
        [meeting],
      );
      await actor(5);
      await rpc("validate_meeting", {
        id: meeting,
        attended: true,
        qualified: true,
      });
      sourceDeal = await rpc("crm_record_deal", {
        lead_id: lead,
        amount: 1500,
        services: "Marketing digital",
        term_months: 12,
        result: "won",
        reason: "Contrato aceito",
      });
      await actor(1);
      await assert.rejects(
        rpc("ops_from_crm", { deal_id: sourceDeal }),
        /confirmado/,
      );
      await rpc("crm_confirm_contract", {
        deal_id: sourceDeal,
        meeting_id: meeting,
        closed_at: today,
        reference: "CRM-ORIGEM",
      });
      await db.exec("reset role");
      const sourceLead = (
        await db.query<{ lead_id: string }>(
          "select lead_id from crm_deals where id=$1",
          [sourceDeal],
        )
      ).rows[0].lead_id;
      await db.query("update crm_leads set phone=$1,email=$2 where id=$3", [
        fields.phone,
        "beta@example.com",
        sourceLead,
      ]);
      await actor(1);
      await assert.rejects(
        rpc("ops_from_crm", { deal_id: sourceDeal, responsible_id: uid(3) }),
        /Correspondências conflitantes/,
      );
      await db.exec("reset role");
      await db.query(
        "update crm_leads set phone='11977776666',email='convertido@example.com' where id=$1",
        [sourceLead],
      );
      await db.query("update profiles set active=false where id=$1", [uid(8)]);
      await actor(1);
      await assert.rejects(
        rpc("ops_from_crm", { deal_id: sourceDeal }),
        /responsável interno/,
      );
      operational = await rpc("ops_from_crm", {
        deal_id: sourceDeal,
        responsible_id: uid(3),
      });
      assert.equal(
        await rpc("ops_from_crm", { deal_id: sourceDeal }),
        operational,
      );
      assert.equal(await count("ops_clients"), 3);
      assert.equal(await count("ops_contracts"), 3);
      assert.equal(await count("contracts"), 1);
    },
  );
  await t.test(
    "cancelamento comercial gera alerta sem excluir operação; revisão explícita auditada",
    async () => {
      const commercial = (
        await db.query<{ id: string }>("select id from contracts")
      ).rows[0].id;
      await db.query("select admin_operation('void_contract',$1::jsonb)", [
        JSON.stringify({
          id: commercial,
          reason: "Cancelamento comercial validado",
        }),
      ]);
      const alerts = (
        await db.query<{ a: { id: string }[] }>("select ops_source_alerts() a")
      ).rows[0].a;
      assert.equal(alerts.length, 1);
      assert.equal(await count("ops_clients"), 3);
      await assert.rejects(
        rpc("ops_reconcile", {
          id: alerts[0].id,
          decision: "paused",
          reason: "Sem confirmação",
        }),
        /Confirme/,
      );
      await rpc("ops_reconcile", {
        id: alerts[0].id,
        decision: "paused",
        confirm: "true",
        reason: "Pausa operacional confirmada",
      });
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from ops_contracts where id=$1",
            [alerts[0].id],
          )
        ).rows[0].status,
        "paused",
      );
      assert.equal(
        (await db.query<{ a: unknown[] }>("select ops_source_alerts() a"))
          .rows[0].a.length,
        0,
      );
    },
  );
  await t.test(
    "rollback em atribuição inválida não deixa empresa parcial; desativação bloqueia sessão",
    async () => {
      const before = await count("access_companies");
      await assert.rejects(
        rpc("ops_save_client", {
          ...fields,
          name: "Rollback",
          phone: "11900001111",
          email: "",
          assignees: [uid(6)],
        }),
        /Colaborador inválido/,
      );
      assert.equal(await count("access_companies"), before);
      await db.exec("reset role");
      await db.query("update profiles set active=false where id=$1", [uid(2)]);
      await actor(2);
      assert.equal(await count("ops_clients"), 0);
      assert.equal(await count("ops_services"), 0);
      assert.equal(await count("storage.objects"), 0);
      await actor(1);
      assert((await count("audit_logs")) > 20);
    },
  );
  await db.close();
});
