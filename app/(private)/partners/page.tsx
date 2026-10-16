import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { FileDownload } from "@/components/operations-files";
import {
  serviceStatuses,
  contractStatuses,
  type PartnerSnapshot,
} from "@/lib/operations";
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
  const snapshot = await db.rpc("ops_partner_snapshot");
  check(snapshot.error);
  const published = (snapshot.data ?? []) as PartnerSnapshot[];
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
            {published.some((p) => p.id === c.id) ? (
              published
                .filter((p) => p.id === c.id)
                .map((p) => (
                  <div className="padded" key={p.id}>
                    <h3>Serviços autorizados</h3>
                    {p.services.length ? (
                      p.services.map((s) => (
                        <div className="team-row" key={s.id}>
                          <div>
                            <strong>{s.name}</strong>
                            <small>
                              {s.description} · Prazo:{" "}
                              {s.due_at || "Não definido"}
                            </small>
                          </div>
                          <span className="badge">
                            {serviceStatuses[s.status]}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="muted">Nenhum serviço publicado.</p>
                    )}
                    <h3>Contratos autorizados</h3>
                    {p.contracts.map((x) => (
                      <p key={x.id}>
                        {x.reference} · {contractStatuses[x.status]} ·{" "}
                        {x.starts_at} a {x.ends_at || "prazo indeterminado"}
                      </p>
                    ))}
                    <h3>Atualizações publicadas</h3>
                    {p.updates.map((u) => (
                      <p key={u.id}>
                        {u.body}{" "}
                        <small className="muted">
                          {new Date(u.created_at).toLocaleDateString("pt-BR")}
                        </small>
                      </p>
                    ))}
                    <h3>Documentos autorizados</h3>
                    {p.files.map((f) => (
                      <p key={f.id}>
                        <FileDownload id={f.id} name={f.name} />
                      </p>
                    ))}
                    <p className="table-note">
                      Somente consulta. Apenas informações publicadas pela
                      administração.
                    </p>
                  </div>
                ))
            ) : (
              <Empty>
                Nenhum dado operacional publicado para esta empresa. Este portal
                não permite alterações, solicitações ou aprovações.
              </Empty>
            )}
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
