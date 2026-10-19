import { pageNumber, pageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { ActionForm } from "@/components/action-form";
import { commercialAccess } from "@/lib/access";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { changePassword } from "@/app/actions";
import { Field, Empty, Notice, labels } from "@/components/ui";
import { Submit } from "@/components/submit";
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    page?: string;
    events_page?: string;
  }>;
}) {
  const { db, profile, user } = await session();
  if (!commercialAccess(profile))
    redirect(
      profile.category === "partner"
        ? "/partners"
        : "/?error=" +
            encodeURIComponent(
              "Você não tem permissão para acessar este recurso.",
            ),
    );
  const params = await searchParams,
    page = pageNumber(params.page),
    eventsPage = pageNumber(params.events_page);
  const { data, error, count } = await db
    .from("meeting_validations")
    .select("*,meetings(opportunities(company))", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  check(error);
  const { data: history, error: he } = await db.rpc("point_history");
  check(he);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">MINHA CONTA</p>
          <h1>{profile.name}</h1>
          <p className="muted">
            {user.email} · {profile.role.toUpperCase()}
          </p>
        </div>
      </div>
      <Notice params={params} />
      <section className="panel padded">
        <h2>Segurança da conta</h2>
        <ActionForm action={changePassword} className="form-grid">
          <Field
            name="password"
            label="Nova senha (mínimo 12 caracteres)"
            type="password"
            minLength={12}
          />
          <Submit>Atualizar senha</Submit>
        </ActionForm>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Histórico de validações</h2>
        </div>
        <p className="table-note">
          A pontuação segue a configuração de cada campanha e o resultado atual
          da oportunidade. Correções e anulações recalculam o total.
        </p>
        {data?.length ? (
          data.map((v) => (
            <div className="team-row" key={v.id}>
              <div>
                <strong>{v.meetings?.opportunities?.company}</strong>
                <small>
                  {labels[v.previous_status]} → {labels[v.new_status]} ·{" "}
                  {v.notes || "Sem observações"}
                </small>
              </div>
              <span className="muted small">
                {new Date(v.created_at).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                })}
              </span>
            </div>
          ))
        ) : (
          <Empty>Nenhuma validação registrada.</Empty>
        )}
        <Pagination
          path="/history"
          params={params}
          page={page}
          total={count ?? 0}
        />
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Eventos de pontuação</h2>
        </div>
        {(
          history as {
            date: string;
            company: string;
            action: string;
            reason: string | null;
          }[]
        )?.length ? (
          (
            history as {
              date: string;
              company: string;
              action: string;
              reason: string | null;
            }[]
          )
            .slice((eventsPage - 1) * pageSize, eventsPage * pageSize)
            .map((e, i) => (
              <div className="team-row" key={i}>
                <div>
                  <strong>{e.company}</strong>
                  <small>
                    {e.action} · {e.reason}
                  </small>
                </div>
                <span className="muted small">
                  {new Date(e.date).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                </span>
              </div>
            ))
        ) : (
          <Empty>Nenhum evento de pontuação nesta página.</Empty>
        )}
        <Pagination
          path="/history"
          params={params}
          page={eventsPage}
          total={Array.isArray(history) ? history.length : 0}
          pageKey="events_page"
          label="Paginação de pontuação"
        />
      </section>
    </>
  );
}
