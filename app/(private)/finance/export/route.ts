import { financeAdmin, financeFilters } from "@/lib/finance-server";
import { csv, type Report, type Options } from "@/lib/finance";
export async function GET(request: Request) {
  const { db } = await financeAdmin();
  const p = Object.fromEntries(new URL(request.url).searchParams);
  let filters;
  try {
    filters = financeFilters(p);
  } catch {
    return new Response("Período inválido", { status: 400 });
  }
  const r = await db.rpc("fin_report", { filters });
  if (r.error)
    return new Response(
      r.error.code === "P0001" ? r.error.message : "Falha ao gerar relatório",
      { status: 400 },
    );
  const data = r.data as Report;
  let rows: unknown[][];
  switch (p.report) {
    case "summary":
      rows = [
        ["Indicador", "BRL"],
        ...Object.entries(data.stats).map(([k, v]) => [
          k,
          v === null ? "Histórico indisponível" : v,
        ]),
      ];
      break;
    case "categories":
      rows = [
        ["Categoria", "Tipo", "Valor BRL"],
        ...data.categories.map((c) => [c.name, c.kind, c.amount]),
      ];
      break;
    case "delinquency":
      rows = [
        ["Cliente", "Saldo vencido BRL"],
        ...data.delinquency.map((c) => [c.company, c.amount]),
      ];
      break;
    case "commissions":
      rows = [
        ["Colaborador", "Comissão BRL", "Liquidado BRL", "Pendente BRL"],
        ...data.commissions.map((c) => [
          c.beneficiary,
          c.amount,
          c.paid,
          c.balance,
        ]),
      ];
      break;
    case "cash":
      rows = [
        [
          "Dia",
          "Recebido BRL",
          "Pago BRL",
          "Entradas previstas restantes BRL",
          "Saídas previstas restantes BRL",
        ],
        ...data.daily.map((d) => [
          d.day,
          d.income,
          d.expense,
          d.expected_income,
          d.expected_expense,
        ]),
      ];
      break;
    case "settlements":
      rows = [
        [
          "ID",
          "Lançamento",
          "Descrição",
          "Tipo",
          "Data efetiva",
          "Forma",
          "Valor com sinal BRL",
          "Estorno de",
        ],
        ...data.cash.map((c) => [
          c.id,
          c.entry_id,
          c.description,
          c.kind,
          c.paid_at,
          c.method,
          c.signed_amount,
          c.reversal_of,
        ]),
      ];
      break;
    case "recurring": {
      const o = await db.rpc("fin_options");
      if (o.error)
        return new Response("Falha ao consultar recorrências", { status: 500 });
      rows = [
        [
          "ID",
          "Contrato",
          "Cliente",
          "Descrição",
          "Valor por parcela BRL",
          "Meses",
          "Início",
          "Fim",
          "Ativa",
        ],
        ...(o.data as Options).schedules
          .filter(
            (s) =>
              s.kind === "income" &&
              (!filters.company_id || s.company_id === filters.company_id) &&
              (!filters.category_id || s.category_id === filters.category_id) &&
              s.starts_at <= filters.to &&
              (!s.ends_at || s.ends_at >= filters.from),
          )
          .map((s) => [
            s.id,
            s.contract_id,
            s.company_id,
            s.description,
            s.amount,
            s.months,
            s.starts_at,
            s.ends_at,
            s.active,
          ]),
      ];
      break;
    }
    default:
      rows = [
        [
          "ID",
          "Tipo",
          "Descrição",
          "Cliente",
          "Contrato",
          "Categoria",
          "Competência",
          "Vencimento",
          "Valor BRL",
          "Liquidado BRL",
          "Saldo BRL",
          "Status",
          "Colaborador",
          "Contrato comercial",
          "Referência comercial",
          "Regra",
          "Observações",
        ],
        ...data.entries.map((e) => [
          e.id,
          e.kind,
          e.description,
          e.company,
          e.contract_id,
          e.category,
          e.competence,
          e.due_at,
          e.amount,
          e.paid,
          e.balance,
          e.status,
          e.beneficiary,
          e.commercial_contract_id,
          e.commercial_reference,
          e.rule_id,
          e.notes,
        ]),
      ];
  }
  return new Response(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="ion-finance-' +
        filters.from +
        "-" +
        filters.to +
        '.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
