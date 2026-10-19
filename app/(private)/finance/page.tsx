import Link from "next/link";
import { financeAdmin, financeFilters } from "@/lib/finance-server";
import { check } from "@/lib/session";
import {
  brl,
  cents,
  daysOverdue,
  statuses,
  type Report,
  type Options,
} from "@/lib/finance";
import { Field, Select, Notice, Empty } from "@/components/ui";
import { EntryForm, ScheduleForm, RuleForm } from "@/components/finance-forms";
import { FinanceChart } from "@/components/finance-chart";
import { ConfirmedAdminForm } from "@/components/confirmed-admin-form";
import { generate, commissions } from "@/app/finance-actions";
export default async function Finance({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db } = await financeAdmin();
  const p = await searchParams;
  let filters;
  try {
    filters = financeFilters(p);
  } catch {
    return (
      <>
        <h1>Financeiro</h1>
        <p className="notice error">
          Período inválido. Informe datas reais em ordem cronológica (até 10
          anos).
        </p>
        <Link href="/finance">Voltar ao mês atual</Link>
      </>
    );
  }
  const view = [
    "income",
    "expense",
    "recurring",
    "commissions",
    "collections",
    "cash",
    "reports",
  ].includes(p.view ?? "")
    ? p.view!
    : "dashboard";
  if (view === "income" || view === "collections") filters.kind = "income";
  if (view === "expense") filters.kind = "expense";
  const [r, o] = await Promise.all([
    db.rpc("fin_report", { filters }),
    db.rpc("fin_options"),
  ]);
  if (r.error || o.error)
    return (
      <>
        <h1>Financeiro</h1>
        <p className="notice error">
          {r.error?.code === "P0001"
            ? r.error.message
            : "Não foi possível carregar os dados financeiros. Verifique a migration 007 e a conexão."}
        </p>
      </>
    );
  const report = r.data as Report;
  const options = o.data as Options;
  const stats = report.stats;
  const page = Math.max(1, Math.floor(Number(p.page) || 1));
  const entries = report.entries.filter(
    (e) => view !== "commissions" || e.rule_id,
  );
  const rows = entries.slice((page - 1) * 50, page * 50);
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...(Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      ...extra,
    }).toString();
  const exportUrl =
    "/finance/export?" +
    new URLSearchParams({
      ...filters,
      report: view === "cash" ? "cash" : "entries",
    } as Record<string, string>);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · ION FINANCE</p>
          <h1>Financeiro</h1>
          <p className="muted">
            Receitas, despesas e comissões em BRL, com histórico auditável.
          </p>
        </div>
        <Link className="button" href={exportUrl}>
          Exportar CSV
        </Link>
      </div>
      <Notice params={p} />
      <nav className="crm-actions" aria-label="Áreas financeiras">
        {[
          ["dashboard", "Visão geral"],
          ["income", "Contas a receber"],
          ["expense", "Contas a pagar"],
          ["recurring", "Recorrências"],
          ["commissions", "Comissões"],
          ["collections", "Cobranças"],
          ["cash", "Fluxo de caixa"],
          ["reports", "Relatórios"],
        ].map(([key, label]) => (
          <Link
            className="button"
            aria-current={view === key ? "page" : undefined}
            key={key}
            href={"/finance?" + query({ view: key, page: "1" })}
          >
            {label}
          </Link>
        ))}
      </nav>
      <section className="panel padded">
        <form className="filters" method="get">
          <input type="hidden" name="view" value={view} />
          <Field
            name="month"
            label="Mês e ano"
            type="month"
            value={filters.month}
          />
          <Field
            name="from"
            label="Início personalizado"
            type="date"
            required={false}
            value={p.from}
          />
          <Field
            name="to"
            label="Fim personalizado"
            type="date"
            required={false}
            value={p.to}
          />
          <Select name="company_id" label="Cliente" value={filters.company_id}>
            <option value="">Todos / avulsos</option>
            {options.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            name="category_id"
            label="Categoria"
            value={filters.category_id}
          >
            <option value="">Todas</option>
            {options.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            name="basis"
            label="Período da listagem"
            value={filters.basis}
          >
            <option value="due">Vencimento</option>
            <option value="competence">Competência</option>
          </Select>
          <Select
            name="status"
            label="Status dos lançamentos"
            value={filters.status}
          >
            <option value="">Todos</option>
            {Object.entries(statuses).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </Select>
          <button className="button">Aplicar filtros</button>
        </form>
        <p className="small muted">
          {filters.from} a {filters.to}. Cliente e categoria filtram todos os
          indicadores. Tipo e status filtram a listagem; caixa considera a data
          real de liquidação. MRR retrata condições contratuais atualmente
          ativas na data final, sem reconstrução histórica de vigências.
        </p>
      </section>
      {view === "dashboard" && (
        <>
          <div className="stats">
            {[
              ["Receita recebida", stats.received],
              ["Receita prevista (vencimentos)", stats.income_due],
              ["MRR contratado ativo", stats.mrr],
              ["Despesas pagas", stats.spent],
              ["Despesas previstas (vencimentos)", stats.expense_due],
              ["Comissões pagas", stats.commission_paid],
              ["Comissões pendentes", stats.commission_pending],
              ["Contas a receber (saldo)", stats.receivable],
              ["Contas a pagar (saldo)", stats.payable],
              ["Receitas em atraso", stats.overdue],
              ["Saldo de caixa do período", stats.cash_net],
              ["Resultado operacional (competência)", stats.operating],
            ].map(([name, value]) => (
              <div className="stat" key={name}>
                <span>{name}</span>
                <strong>{brl(value)}</strong>
              </div>
            ))}
          </div>
          <p className="table-note">
            Previsto = valor integral agendado, incluindo parcelas já
            liquidadas; contas a receber/pagar = saldo restante. Comissões
            integram despesas uma única vez. Resultado operacional = receitas
            menos despesas por competência, sem lançamentos cancelados. Não há
            saldo inicial bancário cadastrado; o saldo exibido é apenas a
            variação do período. Ausência de lançamentos significa ausência de
            dados registrados, não confirmação de caixa bancário zerado.
          </p>
          <FinanceChart
            days={report.daily}
            monthly={report.daily.length > 62}
          />
        </>
      )}
      {["income", "expense"].includes(view) && (
        <section className="panel padded">
          <details>
            <summary>
              Cadastrar {view === "income" ? "receita" : "despesa"}
            </summary>
            <EntryForm options={options} kind={view as "income" | "expense"} />
          </details>
        </section>
      )}
      {["income", "expense", "collections", "commissions"].includes(view) && (
        <section className="panel">
          <div className="panel-title">
            <h2>
              {view === "collections"
                ? "Central de cobranças"
                : view === "commissions"
                  ? "Histórico de comissões"
                  : "Lançamentos"}
            </h2>
            <span>{entries.length} registros</span>
          </div>
          {rows.length ? (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Descrição / origem</th>
                    <th>Competência</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Liquidado</th>
                    <th>Saldo</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <Link href={"/finance/entries/" + e.id}>
                          {e.description}
                        </Link>
                        <small className="muted">
                          {e.company ?? "Avulso"}
                          {e.beneficiary ? " · " + e.beneficiary : ""}
                          {e.contract_id ? " · contrato vinculado" : ""}
                        </small>
                      </td>
                      <td>{e.competence}</td>
                      <td>
                        {e.due_at}
                        {e.state !== "cancelled" &&
                          cents(e.balance) > 0n &&
                          e.due_at <
                            new Intl.DateTimeFormat("en-CA", {
                              timeZone: "America/Sao_Paulo",
                              year: "numeric",
                              month: "2-digit",
                              day: "2-digit",
                            }).format(new Date()) && (
                            <small>
                              {daysOverdue(e.due_at)} dia(s) em atraso
                            </small>
                          )}
                      </td>
                      <td>{brl(e.amount)}</td>
                      <td>{brl(e.paid)}</td>
                      <td>{brl(e.balance)}</td>
                      <td>
                        {statuses[e.status]}
                        {e.state !== "cancelled" &&
                        cents(e.balance) > 0n &&
                        e.due_at < filters.from
                          ? " · anterior ao período"
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              Nenhum lançamento neste filtro. Cadastre ou gere as parcelas
              explicitamente.
            </Empty>
          )}
          <div className="crm-actions padded">
            {page > 1 && (
              <Link
                className="button"
                href={"/finance?" + query({ page: String(page - 1) })}
              >
                Anterior
              </Link>
            )}
            {page * 50 < entries.length && (
              <Link
                className="button"
                href={"/finance?" + query({ page: String(page + 1) })}
              >
                Próxima
              </Link>
            )}
          </div>
        </section>
      )}
      {view === "recurring" && (
        <>
          <section className="panel padded">
            <h2>Mensalidades contratuais e despesas recorrentes</h2>
            <p className="muted">
              O valor por parcela é aprovado aqui. Nenhum contrato gera cobrança
              automaticamente. Datas de início, fim e status do contrato limitam
              a geração. Dia 31 usa o último dia dos meses menores. Alterações
              só afetam ciclos ainda não gerados; ajuste parcelas existentes
              individualmente com motivo.
            </p>
            <details>
              <summary>Configurar mensalidade de contrato</summary>
              <ScheduleForm options={options} kind="income" />
            </details>
            <details>
              <summary>Configurar despesa recorrente</summary>
              <ScheduleForm options={options} kind="expense" />
            </details>
          </section>
          {options.schedules
            .filter(
              (s) => !filters.company_id || s.company_id === filters.company_id,
            )
            .map((s) => (
              <section className="panel padded" key={s.id}>
                <h2>{s.description}</h2>
                <p>
                  {brl(s.amount)} · a cada {s.months} mês(es) ·{" "}
                  {s.active ? "Ativa" : "Pausada"}
                </p>
                <ConfirmedAdminForm
                  action={generate}
                  confirmation="Gerar parcelas previstas neste intervalo, sem duplicar ciclos?"
                  submitLabel="Gerar parcelas previstas"
                >
                  <input type="hidden" name="id" value={s.id} />
                  <Field
                    name="from"
                    label="Gerar de"
                    type="date"
                    value={filters.from}
                  />
                  <Field
                    name="to"
                    label="Gerar até (máximo 12 meses)"
                    type="date"
                    value={filters.to}
                  />
                </ConfirmedAdminForm>
                <details>
                  <summary>Editar recorrência / pausar</summary>
                  <ScheduleForm
                    options={options}
                    kind={s.kind as "income" | "expense"}
                    schedule={s}
                  />
                </details>
              </section>
            ))}
        </>
      )}
      {view === "commissions" && (
        <>
          <section className="panel padded">
            <h2>Regras de comissão</h2>
            <p className="muted">
              Aprovação explícita por fechamento confirmado no CRM. Funções SDR
              e closer usam os responsáveis pela oportunidade/reunião. Outras
              funções exigem vínculo operacional com o cliente. Regra individual
              remunera o colaborador selecionado. Regras distintas são
              cumulativas; não cadastre duas regras para remunerar o mesmo
              evento sem intenção. Mudanças/cancelamento na origem comercial
              exigem revisão administrativa, preservando a comissão já aprovada.
            </p>
            <details>
              <summary>Nova regra de comissão</summary>
              <RuleForm options={options} />
            </details>
            {options.rules.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.name} · {r.active ? "Ativa" : "Inativa"} ·{" "}
                  {r.basis === "percent" ? r.rate + "%" : brl(r.rate)}
                </summary>
                <RuleForm options={options} rule={r} />
              </details>
            ))}
          </section>
          <section className="panel padded">
            <h2>Aprovar comissões de um fechamento</h2>
            <ConfirmedAdminForm
              action={commissions}
              confirmation="Aprovar as comissões elegíveis e criar suas despesas, sem duplicar?"
              submitLabel="Aprovar comissões"
            >
              <Select
                label="Contrato comercial confirmado"
                name="contract_id"
                required
              >
                <option value="">Selecione</option>
                {options.closures.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company} · {c.reference} · {brl(c.amount)}
                  </option>
                ))}
              </Select>
              <Select name="rule_id" label="Regra">
                <option value="">Todas as regras elegíveis</option>
                {options.rules
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
              <Field name="due_at" label="Vencimento previsto" type="date" />
            </ConfirmedAdminForm>
          </section>
        </>
      )}
      {view === "cash" && (
        <>
          <FinanceChart
            days={report.daily}
            monthly={p.group === "month" || report.daily.length > 62}
          />
          <section className="panel padded">
            <h2>Fluxo realizado e saldo ainda previsto</h2>
            <div className="crm-actions">
              <Link
                className="button"
                href={"/finance?" + query({ group: "day" })}
              >
                Diário
              </Link>
              <Link
                className="button"
                href={"/finance?" + query({ group: "month" })}
              >
                Mensal
              </Link>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th>Recebido</th>
                    <th>Pago</th>
                    <th>Entradas previstas restantes</th>
                    <th>Saídas previstas restantes</th>
                  </tr>
                </thead>
                <tbody>
                  {cashRows(report, p.group === "month").map((row) => (
                    <tr key={row[0]}>
                      {row.map((v, i) => (
                        <td key={i}>{i ? brl(v) : v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Variação realizada: {brl(stats.cash_net)}. Saldo bancário total
              indisponível: não há saldo inicial nem integração bancária.
            </p>
          </section>
        </>
      )}
      {view === "reports" && (
        <section className="panel padded">
          <h2>Relatórios financeiros</h2>
          <p>
            Dados persistidos, calculados em NUMERIC no PostgreSQL. Exportações
            incluem os identificadores de origem e preservam precisão em
            centavos.
          </p>
          {[
            ["entries", "Receitas e despesas por período"],
            ["categories", "Receitas e despesas por categoria (competência)"],
            ["summary", "Resultado operacional e indicadores"],
            ["delinquency", "Inadimplência por cliente"],
            ["commissions", "Comissões por colaborador"],
            ["recurring", "Condições de receitas recorrentes atuais"],
            ["cash", "Fluxo realizado e evolução diária"],
          ].map(([key, label]) => (
            <p key={key}>
              <Link
                className="button"
                href={
                  "/finance/export?" +
                  new URLSearchParams({ ...filters, report: key } as Record<
                    string,
                    string
                  >)
                }
              >
                {label} · CSV
              </Link>
            </p>
          ))}
          <h3>Resultado operacional por competência</h3>
          <strong>{brl(stats.operating)}</strong>
          <p>
            Saldo de caixa realizado: {brl(stats.cash_net)}. Estes indicadores
            usam bases distintas.
          </p>
          <h3>Receitas e despesas por categoria</h3>
          {report.categories.map((c) => (
            <p key={c.kind + c.name}>
              {c.name} · {c.kind === "income" ? "Receita" : "Despesa"}:{" "}
              {brl(c.amount)}
            </p>
          ))}
          <h3>Inadimplência por cliente</h3>
          {report.delinquency.length ? (
            report.delinquency.map((c) => (
              <p key={c.company}>
                {c.company}: {brl(c.amount)}
              </p>
            ))
          ) : (
            <Empty>Nenhuma receita vencida com saldo neste período.</Empty>
          )}
          <h3>Comissões por colaborador</h3>
          {report.commissions.map((c) => (
            <p key={c.beneficiary}>
              {c.beneficiary} · Total {brl(c.amount)} · Pago {brl(c.paid)} ·
              Pendente {brl(c.balance)}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
function cashRows(r: Report, monthly: boolean) {
  const map = new Map<string, bigint[]>();
  for (const d of r.daily) {
    const key = monthly ? d.day.slice(0, 7) : d.day;
    const sums = map.get(key) ?? [0n, 0n, 0n, 0n];
    [d.income, d.expense, d.expected_income, d.expected_expense].forEach(
      (s, i) => (sums[i] += cents(s)),
    );
    map.set(key, sums);
  }
  return [...map].map(([k, v]) => [
    k,
    ...v.map(
      (n) =>
        (n < 0n ? "-" : "") +
        String((n < 0n ? -n : n) / 100n) +
        "." +
        String((n < 0n ? -n : n) % 100n).padStart(2, "0"),
    ),
  ]);
}
