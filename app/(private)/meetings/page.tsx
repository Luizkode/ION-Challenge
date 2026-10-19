import { pageNumber, pageSize } from "@/lib/pagination";
import { Pagination } from "@/components/pagination";
import { dateInput } from "@/lib/finance";
import { ActionForm } from "@/components/action-form";
import { commercialAccess } from "@/lib/access";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { adminOperation } from "@/app/actions";
import { Field, Select, Notice, Empty, labels } from "@/components/ui";
import { Submit } from "@/components/submit";
export default async function Meetings({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    status?: string;
    company?: string;
    date?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const { db, profile } = await session();
  if (!commercialAccess(profile))
    redirect(
      profile.category === "partner"
        ? "/partners"
        : "/?error=" +
            encodeURIComponent(
              "Você não tem permissão para acessar este recurso.",
            ),
    );
  const page = pageNumber(params.page);
  const dateValid = !params.date || dateInput.safeParse(params.date).success;
  const statusValid =
    !params.status ||
    [
      "scheduled",
      "pending",
      "held",
      "qualified",
      "no_show",
      "cancelled",
      "invalidated",
    ].includes(params.status);
  let query = db
    .from("meetings")
    .select("*,opportunities!inner(*)", { count: "exact" })
    .order("scheduled_at", { ascending: false })
    .order("id")
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (params.status && statusValid) query = query.eq("status", params.status);
  if (params.company)
    query = query.ilike(
      "opportunities.company",
      "%" + params.company.replace(/[%_\\]/g, "") + "%",
    );
  if (params.date && dateValid) {
    query = query
      .gte("scheduled_at", params.date + "T00:00:00-03:00")
      .lt(
        "scheduled_at",
        new Date(
          new Date(params.date + "T00:00:00-03:00").getTime() + 86400000,
        ).toISOString(),
      );
  }
  const { data: meetings, error, count } = await query;
  check(error);
  const { data: closers, error: closerError } =
    profile.category === "admin"
      ? await db.rpc("available_closers")
      : { data: [], error: null };
  check(closerError);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">OPERAÇÃO</p>
          <h1>{profile.role === "sdr" ? "Minhas reuniões" : "Reuniões"}</h1>
          <p className="muted">
            Agendar é o primeiro passo. A pontuação vem após a validação.
          </p>
        </div>
      </div>
      <Notice
        params={{
          ...params,
          error: !dateValid
            ? "Informe uma data válida para filtrar as reuniões."
            : !statusValid
              ? "Status inválido. Selecione uma opção disponível."
              : params.error,
        }}
      />
      <section className="panel">
        <div className="panel-title">
          <h2>Registros</h2>
        </div>
        <form className="filters" method="get">
          <Field
            label="Empresa"
            name="company"
            value={params.company}
            required={false}
          />
          <Select label="Status" name="status" value={params.status ?? ""}>
            <option value="">Todos</option>
            {[
              "scheduled",
              "pending",
              "held",
              "qualified",
              "no_show",
              "cancelled",
              "invalidated",
            ].map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </Select>
          <Field
            label="Data"
            name="date"
            type="date"
            value={params.date}
            required={false}
          />
          <button className="button">Filtrar</button>
        </form>
        {meetings?.length ? (
          <div className="meeting-list">
            {meetings.map((m) => (
              <article key={m.id}>
                <div className="meeting-heading">
                  <div>
                    <h3>{m.opportunities.company}</h3>
                    <p className="muted small">
                      {m.opportunities.contact} · {m.opportunities.phone} ·{" "}
                      {m.opportunities.city}
                    </p>
                  </div>
                  <span className="badge">{labels[m.status]}</span>
                </div>
                <p className="muted small">
                  {new Date(m.scheduled_at).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}{" "}
                  (Brasília) · {m.opportunities.niche}
                </p>
                <p className="small">{m.notes || "Sem observações."}</p>
                <p className="small muted">
                  {["held", "qualified"].includes(m.status)
                    ? "Validação contabilizada por oportunidade. Contratos confirmados substituem a pontuação."
                    : "Este registro não pontua: " +
                      labels[m.status].toLowerCase() +
                      "."}
                </p>
                {profile.role === "admin" && (
                  <details>
                    <summary>Correção / revisão administrativa</summary>
                    <ActionForm action={adminOperation} className="form-grid">
                      <input
                        type="hidden"
                        name="operation"
                        value="correct_meeting"
                      />
                      <input type="hidden" name="id" value={m.id} />
                      <Select name="status" label="Novo status">
                        {[
                          "pending",
                          "held",
                          "qualified",
                          "no_show",
                          "cancelled",
                          "invalidated",
                        ].map((s) => (
                          <option key={s} value={s}>
                            {labels[s]}
                          </option>
                        ))}
                      </Select>
                      <Field
                        label="Justificativa (mín. 8 caracteres)"
                        name="reason"
                      />
                      <Submit>Corrigir e auditar</Submit>
                    </ActionForm>
                    <ActionForm action={adminOperation} className="form-grid">
                      <input
                        type="hidden"
                        name="operation"
                        value="duplicate_exception"
                      />
                      <input
                        type="hidden"
                        name="opportunity_id"
                        value={m.opportunity_id}
                      />
                      <Field
                        label="Exceção: data da reunião de outra oportunidade legítima"
                        name="scheduled_at"
                        type="datetime-local"
                      />
                      <Select label="Closer" name="closer_id">
                        {closers?.map((c: { id: string; name: string }) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                      <Field
                        label="Justificativa da oportunidade independente"
                        name="reason"
                      />
                      <Submit>Autorizar exceção de duplicidade</Submit>
                    </ActionForm>
                  </details>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>Nenhuma reunião encontrada para estes filtros.</Empty>
        )}
        <Pagination
          path="/meetings"
          params={params}
          page={page}
          total={count ?? 0}
        />
      </section>
    </>
  );
}
