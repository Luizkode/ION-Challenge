import Link from "next/link";
import { session, check } from "@/lib/session";
export async function AnalyticsOverview() {
  const { db, profile } = await session();
  if (profile.category !== "admin") return null;
  const r = await db.rpc("ana_overview");
  check(r.error);
  const s = r.data ?? {};
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Resultados dos clientes</h2>
        <Link className="button" href="/analytics">
          Abrir Analytics
        </Link>
      </div>
      <div className="stats padded">
        {[
          ["Clientes com resultados", s.clients],
          ["Observações reais", s.records],
          ["Relatórios publicados", s.published_reports],
        ].map(([n, v]) => (
          <div className="stat" key={n}>
            <span>{n}</span>
            <strong>{v ?? 0}</strong>
          </div>
        ))}
      </div>
      <p className="table-note">
        Somente dados persistidos. Indicadores de plataformas/atribuições
        diferentes não são combinados como se fossem uma única operação.
      </p>
    </section>
  );
}
