import Link from "next/link";
import { workspaceSummary } from "@/lib/crm-workspace";
import {
  commercialDate,
  commercialDay,
  whatsapp,
  type AgendaMeeting,
  type Followup,
} from "@/lib/crm-agenda";
import { labels, Empty } from "./ui";
import type { session } from "@/lib/session";
import type { Person } from "@/lib/crm";
export function CommercialNav() {
  return (
    <nav aria-label="Operação comercial" className="crm-tabs">
      <Link className="button" href="/crm">
        Painel e leads
      </Link>
      <Link className="button" href="/crm/agenda">
        Agenda do dia
      </Link>
      <Link className="button" href="/crm/followups">
        Central de follow-ups
      </Link>
    </nav>
  );
}
export function MeetingCard({
  meeting: m,
  people,
  canResult = false,
  canReschedule = false,
}: {
  meeting: AgendaMeeting;
  people: Person[];
  canResult?: boolean;
  canReschedule?: boolean;
}) {
  return (
    <article className="commercial-card">
      <div className="meeting-heading">
        <h3>{m.opportunities.company}</h3>
        <span className="badge">{labels[m.status] ?? m.status}</span>
      </div>
      <strong>{commercialDate(m.scheduled_at)} · São Paulo</strong>
      <p>
        {m.opportunities.contact} · {m.opportunities.phone}
      </p>
      <p className="muted small">
        SDR:{" "}
        {people.find((p) => p.id === m.opportunities.sdr_id)?.name ??
          "Responsável histórico"}{" "}
        · Closer:{" "}
        {people.find((p) => p.id === m.closer_id)?.name ??
          "Responsável histórico"}
      </p>
      <div className="crm-actions">
        <Link className="button" href={"/crm/meetings/" + m.id}>
          Abrir detalhes
        </Link>
        {canResult && (
          <>
            <Link className="button" href={"/crm/meetings/" + m.id + "#result"}>
              Registrar resultado
            </Link>
            <Link
              className="button"
              href={"/crm/meetings/" + m.id + "?outcome=no_show#result"}
            >
              Marcar ausência
            </Link>
          </>
        )}
        {canReschedule && (
          <Link
            className="button"
            href={"/crm/meetings/" + m.id + "#reschedule"}
          >
            Reagendar
          </Link>
        )}
        {m.meeting_url && (
          <a
            className="button"
            href={m.meeting_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir link da reunião
          </a>
        )}
        <a
          className="button"
          href={whatsapp(m.opportunities.phone)}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        <Link href={"/crm/" + m.opportunities.crm_lead_id}>
          Histórico do lead
        </Link>
      </div>
    </article>
  );
}
export function FollowupCard({
  followup: f,
  people,
  canAct = false,
}: {
  followup: Followup;
  people: Person[];
  canAct?: boolean;
}) {
  const overdue =
    f.status === "pending" && new Date(f.due_at).getTime() < Date.now();
  return (
    <article
      className={"commercial-card" + (overdue ? " commercial-overdue" : "")}
    >
      <div className="meeting-heading">
        <h3>{f.crm_leads.company}</h3>
        <span className="badge">
          {f.status === "completed"
            ? "Concluído"
            : f.status === "cancelled"
              ? "Cancelado"
              : overdue
                ? "Pendente · vencido"
                : "Pendente"}
        </span>
      </div>
      <strong>{commercialDate(f.due_at)} · São Paulo</strong>
      <p>
        {f.crm_leads.contact} · {f.crm_leads.phone}
      </p>
      <p>{f.reason}</p>
      <p className="muted small">
        Responsável:{" "}
        {people.find((p) => p.id === f.assigned_to)?.name ??
          "Responsável histórico"}{" "}
        · Última atualização: {commercialDate(f.updated_at)}
      </p>
      {f.result && <p>Último contato registrado: {f.result}</p>}
      <div className="crm-actions">
        <a
          className="button"
          href={whatsapp(f.crm_leads.phone)}
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp
        </a>
        <Link className="button" href={"/crm/followups/" + f.id}>
          Visualizar histórico
        </Link>
        {canAct && f.status === "pending" && (
          <>
            <Link
              className="button"
              href={"/crm/followups/" + f.id + "#contact"}
            >
              Registrar contato / concluir
            </Link>
            <Link
              className="button"
              href={"/crm/followups/" + f.id + "#reschedule"}
            >
              Reagendar
            </Link>
          </>
        )}
      </div>
    </article>
  );
}
export async function CrmWorkspace({
  context,
  people,
}: {
  context: Awaited<ReturnType<typeof session>>;
  people: Person[];
}) {
  const s = await workspaceSummary(context);
  const admin = context.profile.category === "admin";
  return (
    <>
      <CommercialNav />
      <div className="stats">
        <div className="stat">
          <span>Reuniões de hoje</span>
          <strong>{s.today.count ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Follow-ups de hoje</span>
          <strong>{s.followups.count ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Follow-ups atrasados</span>
          <strong>{s.overdue.count ?? 0}</strong>
        </div>
        <div className="stat">
          <span>Negociações em andamento</span>
          <strong>{s.negotiations}</strong>
        </div>
      </div>
      <div className="commercial-columns">
        <section className="panel padded">
          <div className="panel-title">
            <h2>Reuniões de hoje</h2>
            <Link href="/crm/agenda">Ver agenda completa</Link>
          </div>
          <p className="muted small">{commercialDay()} · São Paulo</p>
          {(s.today.data ?? []).map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m as AgendaMeeting}
              people={people}
              canResult={admin || m.closer_id === context.profile.id}
              canReschedule={
                admin ||
                m.closer_id === context.profile.id ||
                m.opportunities.sdr_id === context.profile.id
              }
            />
          ))}
          {!s.today.count && <Empty>Nenhuma reunião para hoje.</Empty>}
        </section>
        <section className="panel padded">
          <div className="panel-title">
            <h2>Follow-ups de hoje</h2>
            <Link href="/crm/followups?view=today">Ver todos</Link>
          </div>
          {(s.followups.data ?? []).map((f) => (
            <FollowupCard
              key={f.id}
              followup={f as Followup}
              people={people}
              canAct={admin || f.assigned_to === context.profile.id}
            />
          ))}
          {!s.followups.count && <Empty>Nenhum retorno para hoje.</Empty>}
          <h2>Follow-ups atrasados</h2>
          {(s.overdue.data ?? []).map((f) => (
            <FollowupCard
              key={f.id}
              followup={f as Followup}
              people={people}
              canAct={admin || f.assigned_to === context.profile.id}
            />
          ))}
          {s.overdue.count ? (
            <Link href="/crm/followups?view=overdue">
              Tratar todos os atrasados ({s.overdue.count})
            </Link>
          ) : (
            <Empty>Nenhum retorno atrasado.</Empty>
          )}
        </section>
      </div>
      <section className="panel padded">
        <h2>Aguardando registro de resultado</h2>
        {s.awaiting.slice(0, 5).map((m) => (
          <MeetingCard
            key={m.id}
            meeting={m as AgendaMeeting}
            people={people}
            canResult={admin || m.closer_id === context.profile.id}
          />
        ))}
        {!s.awaiting.length && (
          <Empty>Nenhuma reunião aguardando registro de resultado.</Empty>
        )}
        <Link href="/crm/agenda?view=awaiting">
          Consultar todas as pendências
        </Link>
      </section>
      <section className="panel padded">
        <h2>Próximos agendamentos</h2>
        {(s.upcoming.data ?? []).map((m) => (
          <MeetingCard
            key={m.id}
            meeting={m as AgendaMeeting}
            people={people}
          />
        ))}
        {!s.upcoming.count && <Empty>Nenhum próximo agendamento.</Empty>}
        <Link href="/crm/agenda?view=upcoming">
          Todos os próximos agendamentos
        </Link>
      </section>
    </>
  );
}
