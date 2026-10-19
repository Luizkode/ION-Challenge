import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  cents,
  brl,
  daysOverdue,
  csv,
  financePeriod,
  moneyInput,
  dateInput,
} from "../lib/finance";
const uid = (n: number) =>
  `95000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("Finance: exact BRL, validation, real dates and formula-safe CSV", () => {
  assert.equal(cents("90071992547409.91"), 9007199254740991n);
  assert.equal(cents("0.10") + cents("0.20"), 30n);
  assert.equal(
    daysOverdue("2026-01-01", new Date("2026-01-02T08:00:00-03:00")),
    1,
  );
  assert.equal(brl("-1200.05"), "-R$ 1.200,05");
  assert.equal(brl(null), "Histórico indisponível");
  assert(csv([["-30.10"]]).includes('"-30.10"'));
  for (const v of ["0", "-1", "0.001", "1e5", "NaN", "1,50", "9999999999999"])
    assert(!moneyInput.safeParse(v).success, v);
  assert(!dateInput.safeParse("2026-02-30").success);
  assert.equal(financePeriod({ month: "2028-02" }).to, "2028-02-29");
  assert.throws(() => financePeriod({ from: "2026-03-01", to: "2026-02-01" }));
  assert(csv([["=cmd()", 'a"b', "á"]]).includes("'=cmd()"));
});
test("Finance PostgreSQL: ledger, recurrence, commissions, isolation and audit", async (t) => {
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;",
  );
  for (const name of [
    "001_ion.sql",
    "002_participant_management.sql",
    "003_access_control.sql",
    "004_commercial_crm.sql",
    "005_clients_services.sql",
    "006_operational_conversion_matching.sql",
    "007_finance.sql",
    "008_finance_historical_mrr.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + name, import.meta.url),
        "utf8",
      ),
    );
  for (let n = 1; n <= 4; n++) {
    await db.query("insert into auth.users values($1,$2)", [
      uid(n),
      `finance${n}@example.com`,
    ]);
    await db.query("insert into profiles(id,name,role) values($1,$2,$3)", [
      uid(n),
      "Pessoa " + n,
      n === 1 ? "admin" : n === 2 ? "sdr" : n === 3 ? "closer" : "partner",
    ]);
  }
  const actor = async (n: number) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      uid(n),
    ]);
    await db.exec("set role authenticated");
  };
  const rpc = async <T = string>(name: string, data: unknown) =>
    (
      await db.query<{ r: T }>(`select ${name}($1::jsonb) r`, [
        JSON.stringify(data),
      ])
    ).rows[0].r;
  const scalar = async <T = string>(sql: string) =>
    (await db.query<{ r: T }>(sql)).rows[0].r;
  await actor(1);
  const opts = await scalar<{ categories: { id: string; name: string }[] }>(
    "select fin_options() r",
  );
  const inc = opts.categories.find((c) => c.name === "Outras receitas")!.id,
    exp = opts.categories.find((c) => c.name === "Softwares e ferramentas")!.id;
  const base = {
    request_id: uid(30),
    kind: "income",
    description: "Receita de teste",
    category_id: inc,
    company_id: "",
    contract_id: "",
    amount: "100.30",
    competence: "2020-01-01",
    due_at: "2020-01-10",
    state: "pending",
    expense_type: "one_off",
    notes: "",
  };
  let income = "",
    expense = "",
    company = "",
    contract = "",
    schedule = "",
    settlement = "";
  await t.test(
    "create and partial receipts, no duplicate retries, overpayment blocked",
    async () => {
      income = await rpc("fin_save_entry", base);
      assert.equal(await rpc("fin_save_entry", base), income);
      await assert.rejects(rpc("fin_save_entry", { ...base, amount: "99.00" }));
      const pay = {
        entry_id: income,
        request_id: uid(10),
        amount: "30.10",
        paid_at: "2020-01-10",
        method: "PIX",
        notes: "",
      };
      settlement = await rpc("fin_settle", pay);
      assert.equal(await rpc("fin_settle", pay), settlement);
      await assert.rejects(rpc("fin_settle", { ...pay, amount: "31.10" }));
      await assert.rejects(
        rpc("fin_settle", { ...pay, request_id: uid(11), amount: "70.21" }),
      );
      const e = await scalar<{ paid: string; balance: string; status: string }>(
        `select fin_detail('${income}')->'entry' r`,
      );
      assert.equal(e.paid, "30.10");
      assert.equal(e.balance, "70.20");
      assert.equal(e.status, "partial");
    },
  );
  await t.test(
    "edits require current version and reason; origin immutable, partial totals protected",
    async () => {
      await assert.rejects(
        rpc("fin_save_entry", {
          ...base,
          id: income,
          version: "1",
          reason: "Correção",
        }),
      );
      await assert.rejects(
        rpc("fin_save_entry", {
          ...base,
          id: income,
          version: "2",
          amount: "20.00",
          reason: "Correção",
        }),
      );
      await rpc("fin_save_entry", {
        ...base,
        id: income,
        version: "2",
        due_at: "2020-01-20",
        reason: "Renegociação com cliente",
      });
      await assert.rejects(
        rpc("fin_save_entry", {
          ...base,
          id: income,
          version: "3",
          state: "cancelled",
          reason: "Cancelar",
        }),
      );
    },
  );
  await t.test(
    "expense and partial payments; exact cash/competence, reversals immutable",
    async () => {
      expense = await rpc("fin_save_entry", {
        ...base,
        request_id: uid(31),
        kind: "expense",
        category_id: exp,
        amount: "40.20",
        description: "Software",
      });
      await rpc("fin_settle", {
        entry_id: expense,
        request_id: uid(12),
        amount: "10.10",
        paid_at: "2020-01-10",
        method: "PIX",
        notes: "",
      });
      const report = await rpc<any>("fin_report", {
        from: "2020-01-01",
        to: "2020-01-31",
      });
      assert.equal(report.stats.received, "30.10");
      assert.equal(report.stats.spent, "10.10");
      assert.equal(report.stats.cash_net, "20.00");
      assert.equal(report.stats.operating, "60.10");
      assert.equal(report.stats.overdue, "70.20");
      const rev = {
        entry_id: income,
        request_id: uid(13),
        amount: "30.10",
        paid_at: "2020-02-01",
        method: "PIX",
        notes: "Devolução integral",
        reversal_of: settlement,
      };
      await rpc("fin_settle", rev);
      await assert.rejects(rpc("fin_settle", { ...rev, request_id: uid(14) }));
      await assert.rejects(
        db.exec(`update fin_settlements set amount=1 where id='${settlement}'`),
      );
      const e = await scalar<{ paid: string; balance: string }>(
        `select fin_detail('${income}')->'entry' r`,
      );
      assert.equal(e.paid, "0.00");
      assert.equal(e.balance, "100.30");
      await rpc("fin_save_entry", {
        ...base,
        id: income,
        version: "4",
        state: "cancelled",
        reason: "Cancelamento após devolução",
      });
      const r = await rpc<any>("fin_report", {
        from: "2020-01-01",
        to: "2020-01-31",
      });
      assert.equal(cents(r.stats.overdue), 0n);
      assert.equal(r.stats.received, "30.10");
      const feb = await rpc<any>("fin_report", {
        from: "2020-02-01",
        to: "2020-02-29",
      });
      assert.equal(feb.stats.received, "-30.10");
    },
  );
  await t.test(
    "contract recurrence: February clamp, reprocessing idempotent and MRR",
    async () => {
      company = await rpc("ops_save_client", {
        name: "Empresa financeira",
        contact: "Maria Silva",
        phone: "11988885555",
        email: "finance-client@example.com",
        niche: "Serviços",
        city: "São Paulo",
        state: "SP",
        joined_at: "2020-01-01",
        relationship: "active",
        assignees: [],
      });
      contract = await rpc("ops_save_contract", {
        company_id: company,
        reference: "FIN-001",
        starts_at: "2020-01-01",
        ends_at: "2020-12-31",
        min_months: 0,
        amount: "300.30",
        periodicity: "monthly",
        services_text: "Gestão financeira",
        status: "active",
        responsible_id: uid(2),
      });
      const data = {
        kind: "income",
        company_id: company,
        contract_id: contract,
        category_id: inc,
        description: "Mensalidade",
        amount: "300.30",
        starts_at: "2020-01-01",
        ends_at: "2020-12-31",
        due_day: "31",
        months: "1",
        active: "true",
      };
      schedule = await rpc("fin_save_schedule", data);
      assert.equal(
        await rpc<number>("fin_generate", {
          id: schedule,
          from: "2020-02-01",
          to: "2020-02-29",
        }),
        1,
      );
      assert.equal(
        await rpc<number>("fin_generate", {
          id: schedule,
          from: "2020-02-01",
          to: "2020-02-29",
        }),
        0,
      );
      const report = await rpc<any>("fin_report", {
        from: "2020-02-01",
        to: "2020-02-29",
        company_id: company,
      });
      assert.equal(report.entries[0].due_at, "2020-02-29");
      assert.equal(report.stats.mrr, null);
      await rpc("fin_save_schedule", {
        ...data,
        id: schedule,
        version: "1",
        amount: "400.40",
        reason: "Reajuste futuro",
      });
      const r = await rpc<any>("fin_report", {
        from: "2020-02-01",
        to: "2020-02-29",
      });
      assert.equal(r.entries[0].amount, "300.30");
      await assert.rejects(
        rpc("fin_generate", {
          id: schedule,
          from: "2020-01-01",
          to: "2022-01-01",
        }),
      );
      await db.exec("reset role");
      await db.query("update ops_contracts set status='ended' where id=$1", [
        contract,
      ]);
      await actor(1);
      await assert.rejects(
        rpc("fin_generate", {
          id: schedule,
          from: "2020-03-01",
          to: "2020-03-31",
        }),
      );
    },
  );
  await t.test("recurring expense and audit record every change", async () => {
    const id = await rpc("fin_save_schedule", {
      kind: "expense",
      category_id: exp,
      description: "Assinatura anual",
      amount: "1200.00",
      starts_at: "2020-01-01",
      ends_at: "2022-12-31",
      due_day: "10",
      months: "12",
      active: "true",
    });
    assert.equal(
      await rpc<number>("fin_generate", {
        id,
        from: "2020-01-01",
        to: "2020-12-31",
      }),
      1,
    );
    assert.equal(
      await rpc<number>("fin_generate", {
        id,
        from: "2020-01-01",
        to: "2020-12-31",
      }),
      0,
    );
    assert(
      Number(
        await scalar(
          "select count(*) r from audit_logs where entity like 'fin_%'",
        ),
      ) > 10,
    );
  });
  await t.test(
    "fixed and percentage commissions: confirmed CRM only, snapshots and one expense",
    async () => {
      await db.exec("reset role");
      await db.exec(
        `insert into opportunities(id,campaign_id,team_id,sdr_id,company,contact,phone,city,niche,crm_lead_id) select '${uid(20)}',null,null,'${uid(2)}','Empresa','Contato','11999998888','SP','Serviços',null where false`,
      );
      // Seed a genuine commercial relation for ledger integration; no scoring alterations.
      await db.query(
        "insert into crm_leads(id,company,contact,phone,niche,city,state,source,sdr_id,created_by) values($1,'Empresa','Contato','11999998888','Serviços','São Paulo','SP','Teste',$2,$2)",
        [uid(21), uid(2)],
      );
      await db.query(
        "insert into opportunities(id,sdr_id,company,contact,phone,city,niche,crm_lead_id) values($1,$2,'Empresa','Contato','11999998888','São Paulo','Serviços',$3)",
        [uid(20), uid(2), uid(21)],
      );
      await db.query(
        "insert into meetings(id,opportunity_id,closer_id,scheduled_at,status) values($1,$2,$3,'2020-01-01','qualified')",
        [uid(22), uid(20), uid(3)],
      );
      await db.query(
        "insert into contracts(id,opportunity_id,meeting_id,closed_at,amount,reference,confirmed_by) values($1,$2,$3,'2020-01-01',1000.10,'FIN-COMM',$4)",
        [uid(23), uid(20), uid(22), uid(1)],
      );
      await db.query(
        "insert into crm_deals(lead_id,amount,services,term_months,result,actor_id,contract_id) values($1,1000.10,'Design',12,'won',$2,$3)",
        [uid(21), uid(1), uid(23)],
      );
      await actor(1);
      const fixed = await rpc("fin_save_rule", {
        name: "SDR fixo",
        function_code: "sdr",
        basis: "fixed",
        rate: "20.15",
        starts_at: "2020-01-01",
        ends_at: "",
        active: "true",
      });
      await rpc("fin_save_rule", {
        name: "Closer percentual",
        function_code: "closer",
        basis: "percent",
        rate: "10.00",
        starts_at: "2020-01-01",
        ends_at: "",
        active: "true",
      });
      assert.equal(
        await rpc<number>("fin_commissions", {
          contract_id: uid(23),
          due_at: "2020-01-31",
        }),
        2,
      );
      assert.equal(
        await rpc<number>("fin_commissions", {
          contract_id: uid(23),
          due_at: "2020-01-31",
        }),
        0,
      );
      const report = await rpc<any>("fin_report", {
        from: "2020-01-01",
        to: "2020-01-31",
      });
      assert.equal(report.stats.commission_pending, "120.16");
      assert.equal(report.entries.filter((e: any) => e.rule_id).length, 2);
      await db.exec("reset role");
      await db.query("update contracts set active=false where id=$1", [
        uid(23),
      ]);
      await actor(1);
      await assert.rejects(
        rpc("fin_commissions", {
          contract_id: uid(23),
          due_at: "2020-01-31",
          rule_id: fixed,
        }),
      );
    },
  );
  await t.test(
    "non-admin and partners: direct tables, RPCs, helper and inactive JWT",
    async () => {
      for (const role of [2, 3, 4]) {
        await actor(role);
        assert.equal(
          Number(await scalar("select count(*) r from fin_entries")),
          0,
        );
        assert.equal(
          Number(await scalar("select count(*) r from fin_schedules")),
          0,
        );
        assert.equal(
          await scalar(`select fin_balance('${expense}')::text r`),
          "0",
        );
        for (const fn of [
          "fin_report",
          "fin_save_entry",
          "fin_settle",
          "fin_save_schedule",
          "fin_generate",
          "fin_save_rule",
          "fin_commissions",
        ])
          await assert.rejects(rpc(fn, {}));
        await assert.rejects(
          db.exec(
            "insert into fin_categories(name,kind) values('Ataque','income')",
          ),
        );
      }
      await db.exec("reset role");
      await db.query("update profiles set active=false where id=$1", [uid(2)]);
      await actor(2);
      await assert.rejects(
        rpc("fin_report", { from: "2020-01-01", to: "2020-12-31" }),
      );
      await db.exec("reset role;set role anon");
      await assert.rejects(rpc("fin_report", {}));
    },
  );
  await db.close();
});
