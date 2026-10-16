import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { check } from "@/lib/session";
import { hasFunction } from "@/lib/access";
import {
  stages,
  type Lead,
  type Activity,
  type Deal,
  type CrmMeeting,
} from "@/lib/crm";
import { Field, Select, Notice, Empty, labels } from "@/components/ui";
import { Submit } from "@/components/submit";
import { CrmLeadForm } from "@/components/crm-lead-form";
import {
  addActivity,
  scheduleCrm,
  recordDeal,
  archiveLead,
  validateCrm,
  confirmCrm,
} from "@/app/crm-actions";
export default async function LeadDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { db, profile } = await crmContext();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const [record, activityResult, dealResult, meetingResult, people] =
    await Promise.all([
      db.from("crm_leads").select("*").eq("id", id).maybeSingle(),
      db
        .from("crm_activities")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("crm_deals")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("meetings")
        .select("*,opportunities!inner(crm_lead_id,company,campaign_id,sdr_id)")
        .eq("opportunities.crm_lead_id", id)
        .order("scheduled_at", { ascending: false })
        .limit(200),
      crmDirectory(db),
    ]);
  for (const r of [record, activityResult, dealResult, meetingResult])
    check(r.error);
  if (!record.data) notFound();
  const lead = record.data as Lead;
  const activities = (activityResult.data ?? []) as Activity[];
  const deals = (dealResult.data ?? []) as Deal[];
  const meetings = (meetingResult.data ?? []) as CrmMeeting[];
  const admin = profile.category === "admin";
  const canSchedule =
    admin || (hasFunction(profile, "sdr") && lead.sdr_id === profile.id);
  const canDeal =
    admin || (hasFunction(profile, "closer") && lead.closer_id === profile.id);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · CRM COMERCIAL</p>
          <h1>{lead.company}</h1>
          <p className="muted">
            {lead.contact} · {lead.phone} · {lead.city} / {lead.state}
          </p>
        </div>
        <Link href="/crm" className="button">
          Voltar ao CRM
        </Link>
      </div>
      <Notice params={await searchParams} />
      <p>
        <span className="badge">{stages[lead.stage]}</span>{" "}
        {lead.archived && <span className="badge">Arquivado</span>}
      </p>
      <section className="panel padded">
        <details>
          <summary>Cadastro e responsáveis</summary>
          <CrmLeadForm
            lead={lead}
            people={people}
            admin={admin}
            userId={profile.id}
          />
          <p className="table-note">
            Cadastro: {new Date(lead.created_at).toLocaleString("pt-BR")} ·
            Atualizado: {new Date(lead.updated_at).toLocaleString("pt-BR")}
          </p>
        </details>
        <form action={archiveLead} className="crm-actions">
          <input type="hidden" name="id" value={id} />
          <input
            type="hidden"
            name="archived"
            value={lead.archived ? "false" : "true"}
          />
          <label className="check">
            <input type="checkbox" name="confirm" value="true" required />
            Confirmo {lead.archived ? "restaurar" : "arquivar"} sem apagar
            histórico
          </label>
          <Submit>{lead.archived ? "Restaurar lead" : "Arquivar lead"}</Submit>
        </form>
      </section>
      {!lead.archived && (
        <section className="panel padded">
          <h2>Registrar abordagem / atividade</h2>
          <form action={addActivity} className="form-grid">
            <input type="hidden" name="version" value={lead.version} />
            <input type="hidden" name="lead_id" value={id} />
            <Select label="Tipo" name="kind">
              <option value="contact">Abordagem realizada</option>
              <option value="response">Resposta recebida</option>
              <option value="note">Observação</option>
              <option value="stage">Alterar situação comercial</option>
            </Select>
            <Select name="channel" label="Canal">
              <option>WhatsApp</option>
              <option>Telefone</option>
              <option>E-mail</option>
              <option>Instagram</option>
              <option>LinkedIn</option>
              <option>Outro</option>
            </Select>
            <Select label="Situação comercial" name="stage" value={lead.stage}>
              <option value={lead.stage}>Manter: {stages[lead.stage]}</option>
              {(["new", "contacted", "replied", "interested", "lost"] as const)
                .filter((s) => s !== lead.stage)
                .map((s) => (
                  <option key={s} value={s}>
                    {stages[s]}
                  </option>
                ))}
            </Select>
            <Field
              name="follow_up_at"
              label="Próximo contato"
              type="datetime-local"
              required={false}
              value={lead.follow_up_at ?? undefined}
            />
            <label className="field">
              <span>Descrição / resposta</span>
              <textarea name="description" maxLength={4000} required />
            </label>
            <Submit>Registrar atividade</Submit>
          </form>
        </section>
      )}
      {canSchedule && !lead.archived && (
        <section className="panel padded">
          <h2>Agendar reunião</h2>
          <p className="muted small">
            O SDR é o responsável do lead. Campanhas elegíveis são vinculadas
            automaticamente. Fora de campanha, a reunião permanece no CRM sem
            pontuação.
          </p>
          <form action={scheduleCrm} className="form-grid">
            <input type="hidden" name="lead_id" value={id} />
            <Field
              name="scheduled_at"
              label="Data e horário"
              type="datetime-local"
            />
            <Select
              name="closer_id"
              label="Closer"
              value={lead.closer_id ?? ""}
              required
            >
              <option value="">Selecione</option>
              {people
                .filter((p) => p.is_closer)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </Select>
            <Field
              name="notes"
              label="Observações da reunião"
              required={false}
            />
            <Submit>Agendar reunião</Submit>
          </form>
          {!people.some((p) => p.is_closer) && (
            <p className="notice error">
              Não há closer ativo. Solicite ao administrador a configuração de
              um responsável.
            </p>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-title">
          <h2>Reuniões vinculadas</h2>
        </div>
        {meetings.length ? (
          <div className="meeting-list">
            {meetings.map((m) => (
              <article key={m.id}>
                <div className="meeting-heading">
                  <h3>
                    {new Date(m.scheduled_at).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    (Brasília)
                  </h3>
                  <span className="badge">{labels[m.status]}</span>
                </div>
                <p>
                  {people.find((p) => p.id === m.closer_id)?.name ?? "Closer"} ·{" "}
                  {m.notes || "Sem observações"}
                </p>
                <p className="muted small">
                  {m.opportunities.campaign_id
                    ? "Campanha vinculada; regras originais de pontuação preservadas"
                    : "Sem campanha elegível; não gera pontos"}
                </p>
                {(admin ||
                  (hasFunction(profile, "closer") &&
                    m.closer_id === profile.id &&
                    lead.sdr_id !== profile.id)) &&
                  ["scheduled", "pending", "held"].includes(m.status) && (
                    <form action={validateCrm} className="form-grid">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="lead_id" value={id} />
                      <Select name="attended" label="Comparecimento">
                        <option value="true">Compareceu</option>
                        <option value="false">Não compareceu</option>
                      </Select>
                      <Select name="qualified" label="Qualificação">
                        <option value="false">Reunião realizada</option>
                        <option value="true">Bem qualificada</option>
                      </Select>
                      <Field
                        name="notes"
                        label="Resultado da reunião"
                        required={false}
                      />
                      <Submit>Validar reunião</Submit>
                    </form>
                  )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>Nenhuma reunião vinculada.</Empty>
        )}
      </section>
      {canDeal && !lead.archived && (
        <section className="panel padded">
          <h2>Registrar proposta ou negociação</h2>
          <form action={recordDeal} className="form-grid">
            <input type="hidden" name="lead_id" value={id} />
            <Field
              name="amount"
              label="Valor da proposta (R$)"
              type="number"
              min={0.01}
            />
            <Field name="services" label="Serviços oferecidos" />
            <Field
              name="term_months"
              label="Prazo de contrato (meses)"
              type="number"
              min={1}
            />
            <Select name="result" label="Resultado comercial">
              <option value="proposal">Proposta apresentada</option>
              <option value="negotiation">Em negociação</option>
              <option value="won">Contrato fechado</option>
              <option value="lost">Negociação perdida</option>
            </Select>
            <Field name="reason" label="Observações / motivo do resultado" />
            <Submit>Registrar negociação</Submit>
          </form>
          <p className="table-note">
            Fechamento pelo closer registra o resultado comercial. Pontos de
            contrato dependem de reunião validada e confirmação do ADM.
          </p>
        </section>
      )}
      <section className="panel">
        <div className="panel-title">
          <h2>Propostas e resultados</h2>
        </div>
        {deals.length ? (
          <div className="meeting-list">
            {deals.map((d) => (
              <article key={d.id}>
                <h3>
                  {Number(d.amount).toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}{" "}
                  ·{" "}
                  {d.result === "proposal"
                    ? "Proposta"
                    : d.result === "won"
                      ? "Contrato fechado"
                      : d.result === "lost"
                        ? "Perdido"
                        : "Negociação"}
                </h3>
                <p>
                  {d.services} · {d.term_months} meses
                </p>
                <p className="muted small">
                  {d.reason} · {new Date(d.created_at).toLocaleString("pt-BR")}
                </p>
                {d.contract_id ? (
                  <span className="badge">Contrato confirmado pelo ADM</span>
                ) : (
                  d.result === "won" &&
                  admin && (
                    <form action={confirmCrm} className="form-grid">
                      <input type="hidden" name="lead_id" value={id} />
                      <input type="hidden" name="deal_id" value={d.id} />
                      <Select
                        name="meeting_id"
                        label="Reunião validada"
                        required
                      >
                        {meetings
                          .filter((m) =>
                            ["held", "qualified"].includes(m.status),
                          )
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {new Date(m.scheduled_at).toLocaleString("pt-BR")}
                            </option>
                          ))}
                      </Select>
                      <Field
                        name="closed_at"
                        label="Data de fechamento"
                        type="date"
                      />
                      <Field name="reference" label="Referência do contrato" />
                      <Field
                        name="notes"
                        label="Observações"
                        required={false}
                      />
                      <Submit>Confirmar contrato</Submit>
                    </form>
                  )
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>Nenhuma proposta registrada.</Empty>
        )}
      </section>
      <section className="panel">
        <div className="panel-title">
          <h2>Histórico de atividades</h2>
          <span className="small muted">Últimos 200 registros</span>
        </div>
        {activities.length ? (
          <div className="meeting-list">
            {activities.map((a) => (
              <article key={a.id}>
                <p>{a.description}</p>
                <p className="muted small">
                  {people.find((p) => p.id === a.actor_id)?.name ??
                    (a.actor_id === profile.id
                      ? profile.name
                      : "Administração")}{" "}
                  · {a.channel} ·{" "}
                  {new Date(a.created_at).toLocaleString("pt-BR")}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Nenhuma atividade registrada.</Empty>
        )}
      </section>
    </>
  );
}
