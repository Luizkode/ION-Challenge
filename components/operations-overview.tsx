import Link from "next/link";
import { session, check } from "@/lib/session";
import { canAccessModule } from "@/lib/os-modules";
export async function OperationsOverview() {
  const { db, profile } = await session();
  if (!canAccessModule("clients", profile)) return null;
  const result = await db.rpc("ops_summary", { filters: {} });
  check(result.error);
  const s = result.data ?? {};
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Operação de clientes</h2>
        <Link href="/clients" className="button">
          Abrir Clientes e Serviços
        </Link>
      </div>
      <div className="stats padded">
        {[
          ["Clientes ativos", s.active_clients],
          ["Serviços em andamento", s.running],
          ["Serviços atrasados", s.overdue],
        ].map(([n, v]) => (
          <div className="stat" key={n}>
            <span>{n}</span>
            <strong>{v ?? 0}</strong>
          </div>
        ))}
      </div>
      <p className="table-note">
        Indicadores reais limitados aos clientes e serviços autorizados.
      </p>
    </section>
  );
}
