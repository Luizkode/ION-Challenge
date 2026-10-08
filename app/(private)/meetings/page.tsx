import { session, check } from "@/lib/session";
import { createMeeting, adminOperation } from "@/app/actions";
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
  }>;
}) {
  const params = await searchParams;
  const { db, profile } = await session();
  let query = db
    .from("meetings")
    .select("*,opportunities(*)")
    .order("scheduled_at", { ascending: false });
  if (params.status) query = query.eq("status", params.status);
  if (params.date) {
    query = query
      .gte("scheduled_at", params.date + "T00:00:00-03:00")
      .lt(
        "scheduled_at",
        new Date(
          new Date(params.date + "T00:00:00-03:00").getTime() + 86400000,
        ).toISOString(),
      );
  }
  const { data: raw, error } = await query;
  check(error);
  const meetings =
    raw?.filter(
      (m) =>
        !params.company ||
        m.opportunities.company
          .toLowerCase()
          .includes(params.company.toLowerCase()),
    ) ?? [];
  const { data: closers } = await db
    .from("profiles")
    .select("id,name")
    .eq("role", "closer")
    .eq("active", true);
  const { data: campaign } = await db
    .from("campaigns")
    .select("*")
    .eq("state", "active")
    .maybeSingle();
  const { data: opportunities } = await db
    .from("opportunities")
    .select("id,company,phone")
    .order("company");
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
      <Notice params={params} />
      {profile.role === "sdr" && (
        <section className="panel" id="new">
          <div className="panel-title">
            <h2>Nova reunião</h2>
            <span className="badge">0 pontos até validar</span>
          </div>
          {campaign ? (
            <form action={createMeeting} className="form-grid padded">
              <input type="hidden" name="campaign_id" value={campaign.id} />
              <Field label="Empresa" name="company" />
              <Field label="Responsável" name="contact" />
              <Field
                label="Telefone / WhatsApp (com DDD)"
                name="phone"
                type="tel"
              />
              <Field label="Cidade" name="city" />
              <Field label="Nicho" name="niche" />
              <Field
                label="Data e horário (seu horário local)"
                name="scheduled_at"
                type="datetime-local"
              />
              <Select label="Closer responsável" name="closer_id">
                <option value="">Selecione</option>
                {closers?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select
                label="Oportunidade (revise possíveis duplicidades)"
                name="opportunity_id"
              >
                <option value="">Nova oportunidade</option>
                {opportunities?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.company} · {o.phone}
                  </option>
                ))}
              </Select>
              <Field label="Observações" name="notes" required={false} />
              <p className="small muted">
                Reuniões da mesma oportunidade contam uma única vez. Telefone
                repetido exige reutilizar a oportunidade ou revisão
                administrativa.
              </p>
              <Submit>Cadastrar reunião</Submit>
            </form>
          ) : (
            <Empty>
              A campanha ainda não está ativa. Aguarde a configuração
              administrativa.
            </Empty>
          )}
        </section>
      )}
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
        {meetings.length ? (
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
                    <form action={adminOperation} className="form-grid">
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
                    </form>
                    <form action={adminOperation} className="form-grid">
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
                        {closers?.map((c) => (
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
                    </form>
                  </details>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>Nenhuma reunião encontrada para estes filtros.</Empty>
        )}
      </section>
    </>
  );
}
