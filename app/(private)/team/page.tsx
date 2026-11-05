import { pageNumber, pageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { ActionForm } from "@/components/action-form";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { createAccessCompany } from "@/app/team-actions";
import { Field, Notice, Empty } from "@/components/ui";
import { Submit } from "@/components/submit";
import { UserLifecycleHistory } from "@/components/user-lifecycle-history";
import { TeamAccountActions } from "@/components/team-account-actions";
import { after } from "next/server";
import { processRemovalQueue } from "@/lib/admin-auth";
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
      .eq("is_historical", false)
      .not("auth_user_id", "is", null)
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
  const directory = await db.rpc("team_auth_directory", {
    ids: (users.data ?? []).map((u) => u.id),
  });
  check(directory.error);
  const loginInfo = new Map<
    string,
    {
      email: string;
      last_access: string | null;
      invitation_pending: boolean;
      blocked_until?: string | null;
      confirmed?: boolean;
    }
  >(
    (directory.data ?? []).map(
      (u: {
        id: string;
        email: string;
        last_access: string | null;
        invitation_pending: boolean;
        blocked_until?: string | null;
        confirmed?: boolean;
      }) => [u.id, u],
    ),
  );
  after(async () => {
    try {
      await processRemovalQueue(3);
    } catch {
      console.warn("ion_removal_queue_unavailable");
    }
  });
  const lifecycle = await db
    .from("user_lifecycle_operations")
    .select("id,actor_id,target_id,mode,status,reason,created_at")
    .order("status", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  check(lifecycle.error);
  const membership = await db
    .from("campaign_participants")
    .select("profile_id,campaigns!inner(state)")
    .eq("active", true)
    .neq("campaigns.state", "finalized");
  check(membership.error);
  const activeParticipants = membership.data ?? [];
  const bindings = [...(clients.data ?? []), ...(partners.data ?? [])];
  const [responsibilities, assignments] = await Promise.all([
    db.from("ops_contracts").select("responsible_id,company_id"),
    db
      .from("ops_service_assignments")
      .select("profile_id,ops_services(company_id)"),
  ]);
  check(responsibilities.error);
  check(assignments.error);
  const operationalBindings = [
    ...bindings,
    ...(responsibilities.data ?? []).map((r) => ({
      profile_id: r.responsible_id,
      company_id: r.company_id,
    })),
    ...(assignments.data ?? []).map((r) => ({
      profile_id: r.profile_id,
      company_id: (Array.isArray(r.ops_services)
        ? r.ops_services[0]
        : r.ops_services
      )?.company_id,
    })),
  ];
  const companyLookup = await db
    .from("access_companies")
    .select("id,name")
    .in("id", [
      ...new Set(operationalBindings.map((b) => b.company_id).filter(Boolean)),
    ]);
  check(companyLookup.error);

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
        <AccessForm
          streamlined
          mode="invite"
          companies={companies.data ?? []}
        />
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
          <article className="team-member" key={u.id}>
            <h3>
              {u.name} ·{" "}
              {u.category === "admin"
                ? "Administrador"
                : u.category === "partner"
                  ? "Parceiro"
                  : "Colaborador"}{" "}
              ·{" "}
              {!u.active
                ? "Inativo"
                : loginInfo.get(u.id)?.invitation_pending
                  ? "Convite pendente"
                  : loginInfo.get(u.id)?.blocked_until &&
                      new Date(loginInfo.get(u.id)!.blocked_until!).getTime() >
                        Date.now()
                    ? "Bloqueado no Auth"
                    : "Ativo"}
            </h3>
            <p>{loginInfo.get(u.id)?.email ?? "E-mail indisponível"}</p>
            <p className="small muted">
              Empresas:{" "}
              {[
                ...new Set(
                  operationalBindings
                    .filter((b) => b.profile_id === u.id)
                    .map(
                      (b) =>
                        companyLookup.data?.find((c) => c.id === b.company_id)
                          ?.name,
                    )
                    .filter(Boolean),
                ),
              ].join(" · ") || "Sem empresas vinculadas"}{" "}
              · Último acesso:{" "}
              {loginInfo.get(u.id)?.last_access
                ? new Date(loginInfo.get(u.id)!.last_access!).toLocaleString(
                    "pt-BR",
                    { timeZone: "America/Sao_Paulo" },
                  )
                : "Ainda não registrado"}
            </p>
            <p className="small muted">
              {(roles.data ?? [])
                .filter((r) => r.profile_id === u.id)
                .map((r) => functionLabels[r.function_code as FunctionCode])
                .join(" · ") || "Sem funções de colaborador"}{" "}
            </p>
            <TeamAccountActions
              id={u.id}
              name={u.name}
              email={loginInfo.get(u.id)?.email ?? ""}
              active={u.active}
              invitationPending={loginInfo.get(u.id)?.invitation_pending}
              pendingRequest={
                lifecycle.data?.find(
                  (o) =>
                    o.target_id === u.id &&
                    o.mode === "remove" &&
                    o.status === "pending",
                )?.id ?? null
              }
            />
            <details>
              <summary>Editar usuário · categoria e funções</summary>
              {u.auth_user_id !== null && (
                <AccessForm
                  streamlined
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
              )}
            </details>
          </article>
        ))}
        <Pagination
          path="/team"
          params={params}
          page={page}
          total={users.count ?? 0}
          label="Paginação da equipe"
        />
      </section>
      <details>
        <summary>Histórico administrativo</summary>
        <UserLifecycleHistory rows={lifecycle.data ?? []} />
      </details>
      <details>
        <summary>Manutenção avançada de contas</summary>
        <section className="panel padded">
          <h2>Vincular conta Auth já existente / concluir convite</h2>
          <p className="small muted">
            Use o UUID do usuário em Authentication. Esta ação não altera a
            senha nem cria uma conta Auth.
          </p>
          <AccessForm
            streamlined
            mode="link"
            companies={companies.data ?? []}
          />
        </section>
      </details>
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
