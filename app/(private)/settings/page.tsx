import Link from "next/link";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { Empty, labels } from "@/components/ui";
export const metadata = { title: "Configurações | ION OS" };
export default async function Settings() {
  const { db, profile } = await session();
  if (profile.category !== "admin")
    redirect("/?error=Você+não+tem+permissão+para+acessar+este+módulo.");
  const { data: campaigns, error } = await db
    .from("campaigns")
    .select(
      "id,name,state,goal,meeting_points,qualified_points,contract_points",
    )
    .order("starts_at", { ascending: false, nullsFirst:true }).order("id");
  check(error);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · ADMINISTRAÇÃO</p>
          <h1>Configurações</h1>
          <p className="muted">
            Acesse os controles existentes. Alterações de acesso e de campanha
            são validadas e auditadas.
          </p>
        </div>
        <span className="badge">Versão 1.0</span>
      </div>
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Conta e segurança</h2>
          <p className="muted">
            Atualize sua senha na área pessoal. Senhas e chaves privadas não são
            exibidas pela plataforma.
          </p>
          <Link className="button" href="/account">
            Abrir minha conta
          </Link>
        </section>
        <section className="panel padded">
          <h2>Equipe e permissões</h2>
          <p className="muted">
            Convide pessoas, revise funções, empresas vinculadas e a situação de
            cada acesso.
          </p>
          <Link className="button" href="/team">
            Gerenciar equipe
          </Link>
        </section>
        <section className="panel padded">
          <h2>Publicações para parceiros</h2>
          <p className="muted">
            Autorize resultados em Analytics e informações operacionais em
            Clientes e Serviços. O portal é somente para consulta.
          </p>
          <div className="crm-actions">
            <Link className="button" href="/analytics?view=publication">
              Gerenciar resultados
            </Link>
            <Link className="button" href="/clients">
              Gerenciar serviços e documentos
            </Link>
          </div>
        </section>
        <section className="panel padded">
          <h2>Integrações de anúncios</h2>
          <p className="muted">
            Meta Ads e Google Ads aguardam credenciais e autorização. Cadastro
            manual e CSV continuam disponíveis.
          </p>
          <Link className="button" href="/analytics?view=integrations">
            Ver requisitos das integrações
          </Link>
        </section>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Regras das campanhas</h2>
          <Link className="button" href="/admin">
            Abrir administração existente
          </Link>
        </div>
        <p className="table-note">
          Os valores abaixo refletem as configurações salvas. O cálculo dos
          pontos e os registros históricos permanecem no Challenger.
        </p>
        {campaigns?.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Configurações das campanhas"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Campanha</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Meta coletiva</th>
                  <th scope="col">Realizada</th>
                  <th scope="col">Qualificada</th>
                  <th scope="col">Contrato</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{labels[c.state] ?? c.state}</td>
                    <td>{c.goal}</td>
                    <td>{c.meeting_points}</td>
                    <td>{c.qualified_points}</td>
                    <td>{c.contract_points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            Nenhuma campanha configurada. Use a administração do Challenger para
            cadastrar a primeira.
          </Empty>
        )}
      </section>
    </>
  );
}
