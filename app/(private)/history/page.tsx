import { session, check } from "@/lib/session";
import { changePassword } from "@/app/actions";
import { Field, Empty, Notice, labels } from "@/components/ui";
import { Submit } from "@/components/submit";
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile, user } = await session();
  const { data, error } = await db
    .from("meeting_validations")
    .select("*,meetings(opportunities(company))")
    .order("created_at", { ascending: false });
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
      <Notice params={await searchParams} />
      <section className="panel padded">
        <h2>Segurança da conta</h2>
        <form action={changePassword} className="form-grid">
          <Field
            name="password"
            label="Nova senha (mínimo 12 caracteres)"
            type="password"
          />
          <Submit>Atualizar senha</Submit>
        </form>
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Histórico de validações</h2>
        </div>
        <p className="table-note">
          Cada oportunidade vale 0, 1, 3 ou 7 pontos conforme seu resultado
          atual. Correções e anulações recalculam o total.
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
          ).map((e, i) => (
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
          <Empty>Nenhum evento de pontuação.</Empty>
        )}
      </section>
    </>
  );
}
