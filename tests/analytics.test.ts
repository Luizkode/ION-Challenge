import { analyticsPDF } from "../lib/analytics-pdf";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  analyticsPeriod,
  metricSchema,
  parsePerformanceCSV,
  formatMetric,
} from "../lib/analytics";
const uid = (n: number) =>
  `96000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Analytics: CSV real, precision, dates and missing is not zero", () => {
  assert.equal(
    formatMetric("spend", "10000000000000.01"),
    "R$ 10.000.000.000.000,01",
  );
  assert.equal(formatMetric("conversions", "1.500000"), "1,5");
  assert.equal(formatMetric("reach", null), "Não disponível");
  assert.equal(formatMetric("spend", "0"), "R$ 0,00");
  assert.equal(formatMetric("cpc", "0.166667"), "R$ 0,17");
  assert.throws(() =>
    parsePerformanceCSV(
      'period_from,period_to,spend\n2020-01-01,2020-01-01,"1"2',
      uid(1),
      "arquivo",
    ),
  );
  const p = analyticsPeriod({}, new Date("2026-03-31T12:00:00-03:00"));
  assert.equal(p.from, "2026-03-01");
  assert.equal(p.compare_to, "2026-02-28");
  assert.throws(() => analyticsPeriod({ from: "2026-02-30" }));
  const rows = parsePerformanceCSV(
    'period_from;period_to;spend;source_reference\r\n2020-01-01;2020-01-01;0;"Fonte; real"',
    uid(1),
    "arquivo.csv",
  );
  assert.equal(rows[0].spend, "0");
  assert.equal(rows[0].reach, "");
  assert.equal(rows[0].source_reference, "Fonte; real");
  assert.throws(() =>
    parsePerformanceCSV(
      "period_from,period_to,ctr\n2020-01-01,2020-01-01,10",
      uid(1),
      "arquivo",
    ),
  );
  assert.throws(() =>
    parsePerformanceCSV(
      'period_from,period_to,spend\n2020-01-01,2020-01-01,"1',
      uid(1),
      "arquivo",
    ),
  );
  assert(
    !metricSchema.safeParse({ ...rows[0], revenue: "10", revenue_evidence: "" })
      .success,
  );
  assert(
    !metricSchema.safeParse({
      ...rows[0],
      acquisitions: "1",
      acquisition_evidence: "",
    }).success,
  );
  assert(
    !metricSchema.safeParse({ ...rows[0], conversions: "0.0000001" }).success,
  );
});
test("Analytics PostgreSQL: metrics, provenance, publications and Partners isolation", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await db.exec(
    await readFile(new URL("./fixtures/storage.sql", import.meta.url), "utf8"),
  );
  await db.exec(
    await readFile(
      new URL("./fixtures/storage-operations.sql", import.meta.url),
      "utf8",
    ),
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
  for (let n = 1; n <= 7; n++) {
    await db.query("insert into auth.users values($1,$2)", [
      uid(n),
      `analytics${n}@example.com`,
    ]);
    await db.query("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Pessoa " + n,
      n === 1 ? "admin" : n === 5 || n === 6 ? "partner" : "member",
    ]);
  }
  await db.query(
    "insert into user_functions values($1,'traffic'),($2,'traffic'),($3,'designer'),($4,'traffic')",
    [uid(2), uid(3), uid(4), uid(7)],
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
  const scalar = async <T = any>(q: string) =>
    (await db.query<{ r: T }>(q)).rows[0].r;
  await actor(1);
  let company = "",
    other = "",
    account = "",
    campaign = "",
    alternative = "",
    m1 = "",
    m2 = "",
    report = "";
  const data = {
    period_from: "2020-01-01",
    period_to: "2020-01-01",
    spend: "100.10",
    reach: "800",
    impressions: "1000",
    clicks: "10",
    leads: "2",
    conversions: "1.5",
    acquisitions: "1",
    revenue: "300.30",
    source_reference: "FONTE INTERNA PRIVADA",
    revenue_evidence: "COMPROVAÇÃO PRIVADA DE VENDAS",
    acquisition_evidence: "COMPROVAÇÃO PRIVADA DE AQUISIÇÃO",
  };
  await t.test(
    "reuse clients/contracts and assign traffic without global access",
    async () => {
      const base = {
        contact: "Maria Silva",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        joined_at: "2020-01-01",
        relationship: "active",
        partner_visible: true,
      };
      company = await rpc("ops_save_client", {
        ...base,
        name: "Cliente Analytics A",
        phone: "11999990001",
        email: "ana-a@example.com",
        assignees: [uid(2), uid(4)],
      });
      other = await rpc("ops_save_client", {
        ...base,
        name: "Cliente Analytics B",
        phone: "11999990002",
        email: "ana-b@example.com",
        assignees: [uid(3)],
      });
      await db.exec("reset role");
      await db.query("insert into partner_companies values($1,$2),($3,$4)", [
        uid(5),
        company,
        uid(6),
        other,
      ]);
      await actor(1);
      account = await rpc("ana_save_account", {
        company_id: company,
        name: "Conta Meta A",
        reference: "meta-001",
        platform: "meta",
        time_zone: "America/Sao_Paulo",
        attribution: "7 dias clique, 1 dia visualização",
      });
      campaign = await rpc("ana_save_campaign", {
        company_id: company,
        account_id: account,
        name: "Campanha A",
        reference: "camp-001",
      });
      const a = await rpc("ana_save_account", {
        company_id: company,
        name: "Conta Google A",
        reference: "google-001",
        platform: "google",
        time_zone: "America/Sao_Paulo",
        attribution: "Último clique",
      });
      alternative = await rpc("ana_save_campaign", {
        company_id: company,
        account_id: a,
        name: "Campanha Google",
        reference: "camp-002",
      });
      await actor(2);
      assert.equal((await scalar("select current_access() r")).analytics, true);
      await assert.rejects(
        rpc("ana_save_account", {
          company_id: other,
          name: "Ataque",
          reference: "attack",
          platform: "meta",
          time_zone: "UTC",
          attribution: "7 dias clique",
        }),
      );
      await actor(1);
    },
  );
  await t.test(
    "decimal conversions, exact sums and non-additive reach / weighted ratios",
    async () => {
      m1 = await rpc("ana_save_metric", { ...data, campaign_id: campaign });
      m2 = await rpc("ana_save_metric", {
        ...data,
        campaign_id: campaign,
        period_from: "2020-01-02",
        period_to: "2020-01-02",
        spend: "200.20",
        reach: "1400",
        impressions: "2000",
        clicks: "20",
        leads: "3",
        conversions: "2.5",
        revenue: "600.60",
      });
      const r = await rpc<any>("ana_report", {
        from: "2020-01-01",
        to: "2020-01-02",
        campaign_id: campaign,
      });
      assert.equal(r.stats.spend, "300.30");
      assert.equal(r.stats.reach, null);
      assert.equal(r.stats.frequency, null);
      assert.equal(r.stats.ctr, "1.00");
      assert.equal(r.stats.cpc, "10.01");
      assert.equal(r.stats.cpl, "60.06");
      assert.equal(r.stats.cpa, "150.15");
      assert.equal(Number(r.stats.conversions), 4);
      assert.equal(r.stats.roas, "3.00");
      const single = await rpc<any>("ana_report", {
        from: "2020-01-01",
        to: "2020-01-01",
        campaign_id: campaign,
      });
      assert.equal(single.stats.reach, "800");
      assert.equal(single.stats.frequency, "1.25");
      await assert.rejects(
        rpc("ana_save_metric", { ...data, campaign_id: campaign }),
      );
      await assert.rejects(
        rpc("ana_save_metric", {
          ...data,
          campaign_id: campaign,
          period_to: "2020-01-31",
        }),
      );
      await assert.rejects(
        rpc("ana_save_metric", {
          ...data,
          campaign_id: campaign,
          period_from: "2999-01-01",
          period_to: "2999-01-01",
        }),
      );
    },
  );
  await t.test(
    "unknown differs from zero; incompatible accounts never imply blended ROAS/CPA",
    async () => {
      await rpc("ana_save_metric", {
        campaign_id: alternative,
        period_from: "2020-01-01",
        period_to: "2020-01-01",
        spend: "0",
        source_reference: "Exportação Google real",
      });
      const r = await rpc<any>("ana_report", {
        from: "2020-01-01",
        to: "2020-01-02",
        company_id: company,
      });
      assert.equal(r.stats.spend, "300.30");
      assert.equal(r.stats.impressions, null);
      assert.equal(r.stats.roas, null);
      assert.equal(r.stats.leads, null);
      assert.equal(r.groups.length, 2);
      const zero = await rpc<any>("ana_report", {
        from: "2020-01-01",
        to: "2020-01-01",
        campaign_id: alternative,
      });
      assert.equal(zero.stats.spend, "0.00");
      assert.equal(zero.stats.cpa, null);
    },
  );
  await t.test(
    "period boundaries excluded without proration and comparisons from real complete measures",
    async () => {
      await rpc("ana_save_metric", {
        ...data,
        campaign_id: campaign,
        period_from: "2020-02-01",
        period_to: "2020-02-29",
      });
      const r = await rpc<any>("ana_report", {
        from: "2020-02-15",
        to: "2020-02-28",
        campaign_id: campaign,
      });
      assert.equal(r.record_count, 0);
      assert.equal(r.partial_count, 1);
      assert.equal(r.stats.spend, null);
      await rpc("ana_save_metric", {
        ...data,
        campaign_id: campaign,
        period_from: "2019-12-30",
        period_to: "2019-12-30",
        spend: "50.05",
      });
      const comp = await rpc<any>("ana_report", {
        from: "2020-01-01",
        to: "2020-01-02",
        campaign_id: campaign,
        compare_from: "2019-12-30",
        compare_to: "2019-12-31",
      });
      assert.equal(comp.comparison_change.compatible, true);
      assert.equal(comp.comparison_change.changes.spend.difference, "250.25");
      assert.equal(comp.comparison_change.changes.spend.percent, "500.00");
    },
  );
  await t.test(
    "CSV transaction, exact duplicate replay and conflicting batch rollback",
    async () => {
      const rows = [
        {
          campaign_id: alternative,
          period_from: "2020-01-03",
          period_to: "2020-01-03",
          spend: "1.10",
          source_reference: "Exportação CSV real",
        },
      ];
      const a = await rpc<any>("ana_import", rows);
      assert.equal(a.inserted, 1);
      assert.equal((await rpc<any>("ana_import", rows)).unchanged, 1);
      const before = Number(await scalar("select count(*) r from ana_metrics"));
      await assert.rejects(
        rpc("ana_import", [
          { ...rows[0], period_from: "2020-01-05", period_to: "2020-01-05" },
          { ...rows[0], spend: "2.20" },
        ]),
      );
      assert.equal(
        Number(await scalar("select count(*) r from ana_metrics")),
        before,
      );
    },
  );
  await t.test(
    "read-only grant, per-client scope, no self-publication and private helpers inaccessible",
    async () => {
      await rpc("ana_save_grant", {
        company_id: company,
        profile_id: uid(4),
        can_write: false,
        active: true,
        reason: "Consulta autorizada",
      });
      await actor(4);
      assert.equal((await scalar("select current_access() r")).analytics, true);
      assert.equal(
        (
          await rpc<any>("ana_report", {
            from: "2020-01-01",
            to: "2020-01-02",
            company_id: company,
          })
        ).record_count,
        3,
      );
      await assert.rejects(
        rpc("ana_save_metric", { ...data, campaign_id: alternative }),
      );
      await assert.rejects(db.query("select ana_collect($1,false)", ["{}"]));
      await actor(2);
      await assert.rejects(
        rpc("ana_publish_campaign", {
          id: campaign,
          published: true,
          metrics: ["spend"],
          confirm: "true",
          reason: "Ataque",
        }),
      );
      await assert.rejects(db.query("select ana_public_rows($1)", ["[]"]));
      await actor(3);
      assert.equal(
        (
          await rpc<any>("ana_report", {
            from: "2020-01-01",
            to: "2020-01-02",
            company_id: company,
          })
        ).record_count,
        0,
      );
      await actor(1);
    },
  );
  await t.test(
    "immutable report history, explicit publication and sanitized partner payload",
    async () => {
      report = await rpc("ana_create_report", {
        company_id: company,
        campaign_id: campaign,
        from: "2020-01-01",
        to: "2020-01-02",
        title: "Relatório mensal A",
      });
      await assert.rejects(
        rpc("ana_publish_report", {
          id: report,
          published: true,
          reason: "Publicar",
          confirm: "true",
        }),
      );
      await assert.rejects(
        rpc("ana_publish_campaign", {
          id: campaign,
          published: true,
          metrics: ["roas"],
          reason: "Publicar",
          confirm: "true",
        }),
      );
      await rpc("ana_publish_campaign", {
        id: campaign,
        published: true,
        metrics: [
          "spend",
          "impressions",
          "clicks",
          "ctr",
          "cpc",
          "cpm",
          "leads",
          "cpl",
          "conversions",
        ],
        reason: "Publicação aprovada",
        confirm: "true",
      });
      await rpc("ana_publish_metrics", {
        campaign_id: campaign,
        from: "2020-01-01",
        to: "2020-01-02",
        published: true,
        reason: "Dados conferidos",
        confirm: "true",
      });
      await rpc("ana_publish_report", {
        id: report,
        published: true,
        reason: "Relatório conferido",
        confirm: "true",
      });
      await actor(5);
      const r = await scalar<any>(`select ana_get_report('${report}',false) r`);
      assert.equal(r.snapshot.stats.spend, "300.30");
      assert.equal(r.snapshot.stats.revenue, undefined);
      assert.equal(r.snapshot.stats.roas, undefined);
      assert(!JSON.stringify(r).includes("PRIVADA"));
      assert(!JSON.stringify(r).includes("source_reference"));
      assert(!JSON.stringify(r).includes("author"));
      assert(!JSON.stringify(r).includes("fin_"));
      const live = await rpc<any>("ana_portal_report", {
        company_id: company,
        from: "2020-01-01",
        to: "2020-01-02",
      });
      assert.equal(live.record_count, 2);
      assert.equal(live.stats.revenue, undefined);
      for (const table of [
        "ana_accounts",
        "ana_campaigns",
        "ana_metrics",
        "ana_reports",
        "fin_entries",
      ])
        assert.equal(
          Number(await scalar(`select count(*) r from ${table}`)),
          0,
        );
      await assert.rejects(
        rpc("ana_save_metric", { ...data, campaign_id: campaign }),
      );
      await assert.rejects(
        rpc("ana_save_grant", {
          company_id: company,
          profile_id: uid(5),
          can_write: true,
        }),
      );
      await actor(6);
      await assert.rejects(
        db.query("select ana_get_report($1,false)", [report]),
      );
      await assert.rejects(
        rpc("ana_portal_report", {
          company_id: company,
          from: "2020-01-01",
          to: "2020-01-02",
        }),
      );
      await actor(1);
    },
  );
  await t.test(
    "PDF uses persisted published projection with Unicode, real values and no private metrics",
    async () => {
      await actor(5);
      const r = await scalar<any>(`select ana_get_report('${report}',true) r`);
      const bytes = await analyticsPDF(r);
      const parsed = await PDFDocument.load(bytes);
      assert(parsed.getPageCount() >= 1);
      const dir = await mkdtemp(join(tmpdir(), "ion-pdf-"));
      try {
        const path = join(dir, "report.pdf");
        await writeFile(path, bytes);
        const text = execFileSync("pdftotext", ["-layout", path, "-"], {
          encoding: "utf8",
        });
        assert(text.includes("Relatório mensal A"));
        assert(text.includes("300,30"));
        assert(text.includes("VERSÃO PUBLICADA"));
        assert(!text.includes("COMPROVAÇÃO PRIVADA"));
        assert(!text.includes("Receita atribuída comprovada"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      await actor(1);
    },
  );
  await t.test(
    "published services reuse operational rows, authenticated downloads reject signing and revocation",
    async () => {
      const contract = await rpc("ops_save_contract", {
        company_id: company,
        reference: "ANA-OPS",
        starts_at: "2020-01-01",
        min_months: 0,
        amount: "9898.76",
        periodicity: "monthly",
        services_text: "BRIEFING_PRIVADO",
        status: "active",
        responsible_id: uid(2),
        partner_visible: true,
      });
      const catalog = await scalar<any>("select id r from ops_catalog limit 1");
      const service = await rpc("ops_save_service", {
        company_id: company,
        contract_id: contract,
        catalog_id: catalog,
        description: "BRIEFING_PRIVADO",
        partner_description: "Serviço autorizado",
        starts_at: "2020-01-01",
        due_at: "2020-01-31",
        status: "running",
        partner_visible: true,
        assignees: [uid(2)],
      });
      await rpc("ops_progress", {
        service_id: service,
        version: 1,
        status: "running",
        body: "NOTA_INTERNA_PRIVADA",
        partner_body: "Atualização autorizada",
        published: true,
      });
      const reserved = await rpc<any>("ops_begin_file", {
        company_id: company,
        name: "documento.txt",
        mime: "text/plain",
        size: 3,
      });
      await db.exec("reset role");
      await db.query(
        "insert into storage.objects(bucket_id,name,owner_id,metadata) values('ion-os-documents',$1,$2,$3)",
        [
          reserved.path,
          uid(1),
          JSON.stringify({ size: 3, mimetype: "text/plain" }),
        ],
      );
      await actor(1);
      await rpc("ops_finish_file", { id: reserved.id });
      await rpc("ops_manage_file", {
        id: reserved.id,
        state: "ready",
        partner_visible: true,
      });
      await actor(5);
      await db.query(
        "select set_config('storage.operation','storage.object.get_authenticated',false)",
      );
      assert.equal(
        Number(await scalar("select count(*) r from storage.objects")),
        1,
      );
      const projected = await scalar<any>("select ops_partner_snapshot() r");
      assert.equal(projected[0].services[0].starts_at, "2020-01-01");
      assert.equal(projected[0].contracts[0].amount, undefined);
      assert(!JSON.stringify(projected).includes("PRIVADO"));
      assert.equal(projected[0].files.length, 1);
      await db.query(
        "select set_config('storage.operation','storage.object.sign',false)",
      );
      assert.equal(
        Number(await scalar("select count(*) r from storage.objects")),
        0,
      );
      await actor(1);
      await rpc("ops_manage_file", {
        id: reserved.id,
        state: "ready",
        partner_visible: false,
      });
      await actor(5);
      await assert.rejects(db.query("select ops_download($1)", [reserved.id]));
      await db.query(
        "select set_config('storage.operation','storage.object.get_authenticated',false)",
      );
      assert.equal(
        Number(await scalar("select count(*) r from storage.objects")),
        0,
      );
      await actor(1);
    },
  );
  await t.test(
    "revocation immediate for live data / reports; correction auto-hides and cannot republish stale snapshot",
    async () => {
      await rpc("ana_publish_metrics", {
        campaign_id: campaign,
        from: "2020-01-01",
        to: "2020-01-01",
        published: false,
        reason: "Revogação",
        confirm: "true",
      });
      await actor(5);
      await assert.rejects(
        db.query("select ana_get_report($1,false)", [report]),
      );
      assert.equal(
        (
          await rpc<any>("ana_portal_report", {
            company_id: company,
            from: "2020-01-01",
            to: "2020-01-02",
          })
        ).record_count,
        1,
      );
      await actor(1);
      await rpc("ana_publish_metrics", {
        campaign_id: campaign,
        from: "2020-01-01",
        to: "2020-01-02",
        published: true,
        reason: "Revisado",
        confirm: "true",
      });
      await rpc("ana_publish_report", {
        id: report,
        published: true,
        reason: "Revisado",
        confirm: "true",
      });
      await actor(2);
      await rpc("ana_save_metric", {
        ...data,
        campaign_id: campaign,
        id: m1,
        version: 1,
        spend: "150.10",
        reason: "Correção conferida",
      });
      await actor(5);
      await assert.rejects(
        db.query("select ana_get_report($1,false)", [report]),
      );
      await actor(1);
      await assert.rejects(
        rpc("ana_publish_report", {
          id: report,
          published: true,
          reason: "Revisado",
          confirm: "true",
        }),
      );
      const history = await db.query<{ r: any }>("select ana_history($1) r", [
        company,
      ]);
      assert(history.rows[0].r.some((x: any) => x.published_after === false));
    },
  );
  await t.test(
    "inactive / unbound users cannot exploit NULL guards; operational and financial scopes preserved",
    async () => {
      await db.exec("reset role");
      await db.query("update profiles set active=false where id=$1", [uid(5)]);
      await actor(5);
      await assert.rejects(
        rpc("ana_portal_report", {
          company_id: company,
          from: "2020-01-01",
          to: "2020-01-02",
        }),
      );
      assert.equal((await scalar("select ops_partner_snapshot() r")).length, 0);
      await assert.rejects(
        rpc("fin_report", { from: "2020-01-01", to: "2020-01-02" }),
      );
      await db.exec("reset role");
      await db.query("delete from client_assignments where profile_id=$1", [
        uid(2),
      ]);
      await db.query(
        "update ops_contracts set responsible_id='96000000-0000-0000-0000-000000000003' where responsible_id=$1",
        [uid(2)],
      );
      await db.query(
        "delete from ops_service_assignments where profile_id=$1",
        [uid(2)],
      );
      await actor(2);
      assert.equal(
        Number(await scalar("select count(*) r from ana_metrics")),
        0,
      );
      await db.exec("reset role;set role anon");
      await assert.rejects(rpc("ana_report", {}));
      await db.close();
    },
  );
});
