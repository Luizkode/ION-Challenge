import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { validateMeeting } from "@/app/actions";
import { Field, Select, Notice, Empty, labels } from "@/components/ui";
import { Submit } from "@/components/submit";
export default async function Validation({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile } = await session();
  if (profile.role === "sdr") redirect("/");
  const { data, error } = await db
    .from("meetings")
    .select("*,opportunities(company,contact)")
    .order("scheduled_at");
  check(error);
  const groups = [
    ["Pendentes", ["scheduled", "pending", "held"]],
    ["Validadas", ["qualified"]],
    ["Não compareceram", ["no_show"]],
    ["Canceladas / invalidadas", ["cancelled", "invalidated"]],
  ] as const;
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">QUALIDADE E RESULTADO</p>
          <h1>Validação de reuniões</h1>
          <p className="muted">
            Confirme a presença e a qualificação. O banco calcula os pontos.
          </p>
        </div>
      </div>
      <Notice params={await searchParams} />
      {groups.map(([title, statuses]) => {
        const items =
          data?.filter((m) =>
            (statuses as readonly string[]).includes(m.status),
          ) ?? [];
        return (
          <section className="panel" key={title}>
            <div className="panel-title">
              <h2>{title}</h2>
              <span className="muted">{items.length}</span>
            </div>
            {items.length ? (
              items.map((m) => (
                <article className="validation-item" key={m.id}>
                  <div className="meeting-heading">
                    <div>
                      <h3>{m.opportunities.company}</h3>
                      <p className="muted small">
                        {new Date(m.scheduled_at).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })}{" "}
                        (Brasília)
                      </p>
                    </div>
                    <span className="badge">{labels[m.status]}</span>
                  </div>
                  {["scheduled", "pending", "held"].includes(m.status) && (
                    <details>
                      <summary>
                        Validar reunião
                        {m.status === "held" ? " / qualificar" : ""}
                      </summary>
                      <form action={validateMeeting} className="form-grid">
                        <input type="hidden" name="id" value={m.id} />
                        <Select label="A empresa compareceu?" name="attended">
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </Select>
                        <Select label="Foi bem qualificada?" name="qualified">
                          <option value="false">Não</option>
                          <option value="true">Sim</option>
                        </Select>
                        <Field
                          label="Observações"
                          name="notes"
                          required={false}
                        />
                        <Submit>Confirmar validação</Submit>
                      </form>
                    </details>
                  )}
                </article>
              ))
            ) : (
              <Empty>Nenhuma reunião nesta categoria.</Empty>
            )}
          </section>
        );
      })}
    </>
  );
}
