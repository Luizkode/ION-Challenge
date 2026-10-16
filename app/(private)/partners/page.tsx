import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { Empty } from "@/components/ui";
export default async function Partners() {
  const { db, profile } = await session();
  if (!["admin", "partner"].includes(profile.category))
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  const { data: companies, error } = await db
    .from("access_companies")
    .select("id,name");
  check(error);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION PARTNERS · SOMENTE CONSULTA</p>
          <h1>
            {profile.category === "admin" ? "Parceiros" : "Minha empresa"}
          </h1>
        </div>
      </div>
      {companies?.length ? (
        companies.map((c) => (
          <section className="panel" key={c.id}>
            <div className="panel-title">
              <h2>{c.name}</h2>
            </div>
            <Empty>
              Os serviços, resultados, relatórios e documentos autorizados serão
              disponibilizados nas próximas etapas. Este portal não permite
              alterações, solicitações ou aprovações.
            </Empty>
          </section>
        ))
      ) : (
        <section className="panel">
          <Empty>
            Nenhuma empresa vinculada a este acesso. Contate o administrador.
          </Empty>
        </section>
      )}
    </>
  );
}
