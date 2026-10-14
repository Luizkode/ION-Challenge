import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { canAccessModule } from "@/lib/os-modules";
import { Empty } from "@/components/ui";
export default async function Clients() {
  const { db, profile } = await session();
  if (!canAccessModule("clients", profile))
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  const { data, error } = await db
    .from("access_companies")
    .select("id,name,active");
  check(error);
  return (
    <>
      <div className="page-title">
        <h1>Clientes e Serviços</h1>
      </div>
      <section className="panel">
        {data?.length ? (
          data.map((c) => (
            <div className="team-row" key={c.id}>
              <strong>{c.name}</strong>
              <span className="muted">{c.active ? "Ativo" : "Inativo"}</span>
            </div>
          ))
        ) : (
          <Empty>Nenhuma empresa atribuída.</Empty>
        )}
        <p className="table-note">
          Nesta etapa, apenas vínculos e controle de acesso. A operação de
          serviços será desenvolvida na Etapa 4.
        </p>
      </section>
    </>
  );
}
