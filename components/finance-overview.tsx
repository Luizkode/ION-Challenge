import Link from "next/link";
import { session, check } from "@/lib/session";
import { financePeriod, brl, type Report } from "@/lib/finance";
export async function FinanceOverview() {
  const { db, profile } = await session();
  if (profile.category !== "admin") return null;
  const r = await db.rpc("fin_report", { filters: financePeriod({}) });
  check(r.error);
  const s = (r.data as Report).stats;
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Financeiro · mês atual</h2>
        <Link className="button" href="/finance">
          Abrir Financeiro
        </Link>
      </div>
      <div className="stats padded">
        {[
          ["Receita recebida", s.received],
          ["Despesas pagas", s.spent],
          ["Resultado de caixa do mês", s.cash_net],
        ].map(([n, v]) => (
          <div className="stat" key={n}>
            <span>{n}</span>
            <strong>{brl(v)}</strong>
          </div>
        ))}
      </div>
      <p className="table-note">
        Valores liquidados em BRL. Resultado do mês não é saldo bancário total.
      </p>
    </section>
  );
}
