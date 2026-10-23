import { pageNumber, pageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { createAccessCompany } from "@/app/team-actions";
import { Field, Notice, Empty } from "@/components/ui";
import { Submit } from "@/components/submit";
import { AccessForm } from "@/components/access-form";
import { functionLabels, type FunctionCode } from "@/lib/access";
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    page?: string;
    invitations_page?: string;
  }>;
}) {
  const { db, profile } = await session();
  if (profile.category !== "admin")
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  const params = await searchParams,
    page = pageNumber(params.page),
    invitationsPage = pageNumber(params.invitations_page);
  const result = await Promise.all([
    db
      .from("profiles")
      .select("*", { count: "exact" })
      .order("name")
      .order("id")
      .range((page - 1) * pageSize, page * pageSize - 1),
    db.from("user_functions").select("*"),
    db
      .from("access_companies")
      .select("id,name")
      .eq("active", true)
      .order("name"),
    db.from("client_assignments").select("*"),
    db.from("partner_companies").select("*"),
    db
      .from("access_invitations")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((invitationsPage - 1) * pageSize, invitationsPage * pageSize - 1),
  ]);
  result.forEach((r) => check(r.error));
  const [users, roles, companies, clients, partners, invitations] = result;
  const membership = await db
    .from("campaign_participants")
    .select("profile_id,campaigns!inner(state)")
    .eq("active", true)
    .neq("campaigns.state", "finalized");
  check(membership.error);
  const activeParticipants = membership.data ?? [];
  const bindings = [...(clients.data ?? []), ...(partners.data ?? [])];
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION TEAM · GESTÃO DE ACESSOS</p>
          <h1>Equipe</h1>
          <p className="muted">
            Categorias, funções e vínculos. As alterações ficam registradas na
            auditoria.
          </p>
        </div>
      </div>
      <Notice params={params} />
      <section className="panel padded">
        <h2>Convidar colaborador ou parceiro</h2>
        <p className="muted small">
          O convite seguro é enviado pelo Supabase Auth. Nenhuma senha é
          cadastrada neste formulário.
        </p>
        <AccessForm mode="invite" companies={companies.data ?? []} />
      </section>
      <section className="panel padded">
        <h2>Empresas para vínculos de acesso</h2>
        <p className="muted small">
          Cadastro de identificação para vínculos de acesso. Contratos, entregas
          e dados operacionais são gerenciados em Clientes e Serviços.
        </p>
        <ActionForm action={createAccessCompany} className="form-grid">
          <Field label="Nome da empresa" name="name" />
          <Submit>Cadastrar empresa</Submit>
        </ActionForm>
      </section>
      <section className="panel padded">
        <h2>Usuários cadastrados</h2>
        {users.data?.map((u) => (
          <details key={u.id}>
            <summary>
              {u.name} ·{" "}
              {u.category === "admin"
                ? "Administrador"
                : u.category === "partner"
                  ? "Parceiro"
                  : "Colaborador"}{" "}
              · {u.active ? "Ativo" : "Inativo"}
            </summary>
            <p className="small muted">
              {(roles.data ?? [])
                .filter((r) => r.profile_id === u.id)
                .map((r) => functionLabels[r.function_code as FunctionCode])
                .join(" · ") || "Sem funções de colaborador"}{" "}
              · UUID: {u.id}
            </p>
            <AccessForm
              mode="edit"
              profile={u}
              functions={(roles.data ?? [])
                .filter((r) => r.profile_id === u.id)
                .map((r) => r.function_code)}
              bindings={bindings
                .filter((b) => b.profile_id === u.id)
                .map((b) => b.company_id)}
              companies={companies.data ?? []}
              participates={activeParticipants.some(
                (p) => p.profile_id === u.id,
              )}
            />
          </details>
        ))}
        <Pagination
          path="/team"
          params={params}
          page={page}
          total={users.count ?? 0}
          label="Paginação da equipe"
        />
      </section>
      <section className="panel padded">
        <h2>Vincular conta Auth já existente / concluir convite</h2>
        <p className="small muted">
          Use o UUID do usuário em Authentication. Esta ação não altera a senha
          nem cria uma conta Auth.
        </p>
        <AccessForm mode="link" companies={companies.data ?? []} />
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Histórico de convites</h2>
          <span className="small muted">Histórico auditado</span>
        </div>
        {invitations.data?.length ? (
          invitations.data.map((i) => (
            <div className="team-row" key={i.id}>
              <div>
                <strong>{i.email}</strong>
                <small>
                  {i.status === "completed"
                    ? "Convite enviado e acesso configurado"
                    : i.status === "failed"
                      ? "Falha · revisar envio ou vínculo"
                      : "Pendente"}{" "}
                  · {i.created_at}
                </small>
                <small>{i.detail}</small>
              </div>
            </div>
          ))
        ) : (
          <Empty>Nenhum convite registrado nesta página.</Empty>
        )}
        <Pagination
          path="/team"
          params={params}
          page={invitationsPage}
          total={invitations.count ?? 0}
          pageKey="invitations_page"
          label="Paginação dos convites"
        />
      </section>
    </>
  );
}
