import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { hasFunction } from "@/lib/access";
import { stages, stageCodes, type Lead, type CrmMeeting } from "@/lib/crm";
import { Field, Select, Notice, Empty, labels } from "@/components/ui";
import { CrmPipeline } from "@/components/crm-pipeline";
import { CrmImport } from "@/components/crm-import";
import { grantCrm } from "@/app/crm-actions";
import { Submit } from "@/components/submit";
import { check } from "@/lib/session";
import { dashboardPeriod } from "@/lib/os-dashboard";
type Params = {
  q?: string;
  stage?: string;
  owner?: string;
  from?: string;
  to?: string;
  sort?: string;
  view?: string;
  archived?: string;
  page?: string;
  error?: string;
  success?: string;
};
export default async function Crm({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { db, profile } = await crmContext();
  const p = await searchParams;
  const people = await crmDirectory(db);
  const admin = profile.category === "admin";
  const canCreate = admin || hasFunction(profile, "sdr");
  const period = dashboardPeriod(p);
  const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page)) || 1));
  const sort = ["company", "created_at", "follow_up_at"].includes(p.sort ?? "")
    ? p.sort!
    : "created_at";
  let query = db
    .from("crm_leads")
    .select("*", { count: "exact" })
    .eq("archived", p.archived === "true")
    .order(sort, { ascending: sort !== "created_at", nullsFirst: false })
    .order("id")
    .range((page - 1) * 40, page * 40 - 1);
  if (p.q) {
    const search = p.q.replace(/[,%_()\\"]/g, "").slice(0, 150);
    query = query.or(
      ["company", "contact", "phone", "email"]
        .map((c) => c + ".ilike.%" + search + "%")
        .join(","),
    );
  }
  if (p.stage && stageCodes.includes(p.stage as keyof typeof stages))
    query = query.eq("stage", p.stage);
  const owner = people.some((x) => x.id === p.owner) ? p.owner : "";
  if (owner) query = query.or("sdr_id.eq." + owner + ",closer_id.eq." + owner);
  const [result, report, agenda, grants, employees] = await Promise.all([
    query,
    db.rpc("crm_report", {
      filters: {
        from: period.start,
        to: period.end,
        owner,
        stage: stageCodes.includes(p.stage as keyof typeof stages)
          ? p.stage
          : "",
      },
    }),
    db
      .from("meetings")
      .select("*,opportunities!inner(crm_lead_id,company,campaign_id,sdr_id)")
      .not("opportunities.crm_lead_id", "is", null)
      .gte("scheduled_at", period.start)
      .lt("scheduled_at", period.end)
      .order("scheduled_at")
      .limit(200),
    admin
      ? db.from("crm_grants").select("profile_id")
      : Promise.resolve({ data: [], error: null }),
    admin
      ? db
          .from("profiles")
          .select("id,name")
          .eq("category", "employee")
          .eq("active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [result, report, agenda, grants, employees]) check(r.error);
  const leads = (result.data ?? []) as Lead[];
  const summary = report.data ?? {};
  const pageLink = (n: number) => {
    const s = new URLSearchParams(
      Object.entries(p).filter(([, v]) => v !== undefined) as [
        string,
        string,
      ][],
    );
    s.set("page", String(n));
    return "/crm?" + s;
  };
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · OPERAÇÃO COMERCIAL</p>
          <h1>CRM Comercial</h1>
          <p className="muted">
            {admin
              ? "Visão global da operação"
              : hasFunction(profile, "closer")
                ? "Painel do closer · oportunidades e reuniões atribuídas"
                : "Painel do SDR · leads e próximos contatos"}
          </p>
        </div>
        {canCreate && (
          <Link href="/crm/new" className="button">
            Novo lead
          </Link>
        )}
      </div>
      <Notice params={{ ...p, error: period.error ?? p.error }} />
      <section className="panel">
        <form className="filters" method="get">
          <Field
            label="Buscar empresa, contato ou WhatsApp"
            name="q"
            required={false}
            value={p.q}
          />
          <Select name="stage" label="Etapa" value={p.stage}>
            <option value="">Todas</option>
            {stageCodes.map((s) => (
              <option key={s} value={s}>
                {stages[s]}
              </option>
            ))}
          </Select>
          <Select label="Responsável" name="owner" value={owner}>
            <option value="">Todos autorizados</option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Field
            label="Indicadores: início"
            name="from"
            type="date"
            value={period.from}
          />
          <Field
            label="Indicadores: fim"
            name="to"
            type="date"
            value={period.to}
          />
          <Select label="Ordenar leads" name="sort" value={sort}>
            <option value="created_at">Mais recentes</option>
            <option value="company">Empresa</option>
            <option value="follow_up_at">Próximo follow-up</option>
          </Select>
          <Select label="Visualização" name="view" value={p.view}>
            <option value="list">Lista</option>
            <option value="pipeline">Funil comercial</option>
            <option value="agenda">Agenda de reuniões</option>
          </Select>
          <Select
            label="Cadastro"
            name="archived"
            value={p.archived ?? "false"}
          >
            <option value="false">Ativos</option>
            <option value="true">Arquivados</option>
          </Select>
          <button className="button">Filtrar</button>
        </form>
      </section>
      <div className="stats">
        {[
          ["Leads cadastrados", summary.leads],
          ["Contatos realizados", summary.contacts],
          ["Taxa de resposta", summary.response + "%"],
          ["Reuniões agendadas", summary.scheduled],
          ["Reuniões realizadas", summary.held],
          ["Comparecimento", summary.attendance + "%"],
          ["Propostas apresentadas", summary.proposals],
          ["Contratos fechados", summary.won],
          ["Conversão de leads", summary.conversion + "%"],
        ].map(([name, value]) => (
          <div className="stat" key={name}>
            <span>{name}</span>
            <strong>{value ?? 0}</strong>
          </div>
        ))}
      </div>
      <p className="table-note">
        Indicadores por período, responsável e etapa; leads pela criação,
        atividades e negociações pelo registro, reuniões pelo agendamento.
        Resposta: leads respondidos entre os contatados no período.
        Comparecimento: realizadas / (realizadas + ausências). Conversão: leads
        criados no período com fechamento registrado no período / leads criados.
        Fechamento comercial não concede pontos sem confirmação administrativa.
      </p>
      <section className="panel">
        <div className="panel-title">
          <h2>
            {p.view === "pipeline"
              ? "Funil comercial"
              : p.view === "agenda"
                ? "Agenda de reuniões"
                : "Leads e follow-ups"}
          </h2>
          <span className="small muted">
            {result.count ?? 0} leads · página {page}
          </span>
        </div>
        {p.view === "pipeline" ? (
          <CrmPipeline leads={leads} />
        ) : p.view === "agenda" ? (
          <div className="meeting-list">
            {((agenda.data as CrmMeeting[]) ?? [])
              .filter(
                (m) =>
                  !owner ||
                  m.closer_id === owner ||
                  m.opportunities.sdr_id === owner,
              )
              .map((m) => (
                <article key={m.id}>
                  <Link href={"/crm/" + m.opportunities.crm_lead_id}>
                    <h3>{m.opportunities.company}</h3>
                  </Link>
                  <p>
                    {new Date(m.scheduled_at).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    · {labels[m.status]}
                  </p>
                  <p className="small muted">
                    {m.opportunities.campaign_id
                      ? "Vinculada ao Challenger"
                      : "Sem campanha elegível; não pontua"}
                  </p>
                </article>
              ))}
            {!agenda.data?.length && <Empty>Nenhuma reunião no período.</Empty>}
            <p className="table-note">
              Até 200 reuniões por período. Reduza o período para consultar
              mais.
            </p>
          </div>
        ) : leads.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tabela com rolagem horizontal"
          >
            <table>
              <thead>
                <tr>
                  <th>Empresa / responsável</th>
                  <th>Etapa</th>
                  <th>WhatsApp</th>
                  <th>SDR / closer</th>
                  <th>Último contato</th>
                  <th>Próximo follow-up</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={"/crm/" + l.id}>
                        <strong>{l.company}</strong>
                      </Link>
                      <br />
                      {l.contact}
                    </td>
                    <td>{stages[l.stage]}</td>
                    <td>{l.phone}</td>
                    <td>
                      {people.find((x) => x.id === l.sdr_id)?.name ?? "SDR"} /{" "}
                      {people.find((x) => x.id === l.closer_id)?.name ??
                        "Não atribuído"}
                    </td>
                    <td>
                      {l.last_contact_at
                        ? new Date(l.last_contact_at).toLocaleString("pt-BR")
                        : "—"}
                    </td>
                    <td>
                      {l.follow_up_at ? (
                        <span
                          className={
                            new Date(l.follow_up_at).getTime() < Date.now()
                              ? "notice error"
                              : ""
                          }
                        >
                          {new Date(l.follow_up_at).toLocaleString("pt-BR")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            Nenhum lead encontrado. Cadastre ou importe seus contatos.
          </Empty>
        )}
        <div className="padded crm-actions">
          {page > 1 && (
            <Link className="button" href={pageLink(page - 1)}>
              Anterior
            </Link>
          )}
          {page * 40 < (result.count ?? 0) && (
            <Link className="button" href={pageLink(page + 1)}>
              Próxima
            </Link>
          )}
        </div>
        {canCreate && <CrmImport people={people} admin={admin} />}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Desempenho por SDR e closer</h2>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Tabela com rolagem horizontal"
        >
          <table>
            <thead>
              <tr>
                <th>Responsável</th>
                <th>Função</th>
                <th>Leads</th>
                <th>Fechamentos</th>
              </tr>
            </thead>
            <tbody>
              {(summary.performance ?? []).map(
                (x: {
                  id: string;
                  name: string;
                  function: string;
                  leads: number;
                  won: number;
                }) => (
                  <tr key={x.id + x.function}>
                    <td>{x.name}</td>
                    <td>{x.function === "sdr" ? "SDR" : "Closer"}</td>
                    <td>{x.leads}</td>
                    <td>{x.won}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
      {admin && (
        <section className="panel padded">
          <details>
            <summary>
              Permissão administrativa expressa para outros colaboradores
            </summary>
            <p className="muted small">
              Concede consulta global do CRM e registro de atividades.
              Agendamento e fechamento continuam exclusivos dos responsáveis
              SDR/closer e ADM. Parceiros não são elegíveis.
            </p>
            <p className="small">
              Acessos expressos:{" "}
              {grants.data
                ?.map(
                  (g) =>
                    employees.data?.find((e) => e.id === g.profile_id)?.name,
                )
                .join(", ") || "Nenhum"}
            </p>
            <ActionForm action={grantCrm} className="form-grid">
              <Select name="profile_id" label="Colaborador" required>
                {employees.data?.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
              <Select name="enabled" label="Acesso">
                <option value="true">Conceder</option>
                <option value="false">Revogar</option>
              </Select>
              <Field label="Justificativa (mín. 8 caracteres)" name="reason" />
              <label className="check">
                <input type="checkbox" name="confirm" value="true" required />
                Confirmo a alteração de permissão
              </label>
              <Submit>Atualizar permissão</Submit>
            </ActionForm>
          </details>
        </section>
      )}
    </>
  );
}
