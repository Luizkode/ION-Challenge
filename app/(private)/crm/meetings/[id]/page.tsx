import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { meetingSelect } from "@/lib/crm-workspace";
import {
  commercialOutcomes,
  commercialDate,
  type AgendaMeeting,
} from "@/lib/crm-agenda";
import { CommercialNav, MeetingCard } from "@/components/crm-workspace";
import { ResultForm, RescheduleForm } from "@/components/crm-agenda-forms";
import { Notice } from "@/components/ui";
import { check } from "@/lib/session";
import { hasFunction } from "@/lib/access";
export default async function MeetingDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string; outcome?: string }>;
}) {
  const { id } = await params;
  if (!z.string().guid().safeParse(id).success) notFound();
  const ctx = await crmContext(),
    p = await searchParams;
  const [r, people, result] = await Promise.all([
    ctx.db.from("meetings").select(meetingSelect).eq("id", id).maybeSingle(),
    crmDirectory(ctx.db),
    ctx.db
      .from("crm_meeting_results")
      .select("*")
      .eq("meeting_id", id)
      .maybeSingle(),
  ]);
  check(r.error);
  check(result.error);
  if (!r.data?.opportunities?.crm_lead_id) notFound();
  const m = r.data as AgendaMeeting;
  const admin = ctx.profile.category === "admin",
    closer =
      hasFunction(ctx.profile, "closer") &&
      m.closer_id === ctx.profile.id &&
      m.opportunities.sdr_id !== ctx.profile.id;
  const canResult =
    (admin || closer) &&
    !result.data &&
    ["scheduled", "pending", "held", "qualified", "no_show"].includes(m.status);
  const canReschedule =
    (admin ||
      (hasFunction(ctx.profile, "closer") && m.closer_id === ctx.profile.id) ||
      (hasFunction(ctx.profile, "sdr") &&
        m.opportunities.sdr_id === ctx.profile.id)) &&
    ["scheduled", "pending", "no_show"].includes(m.status);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION CRM · AGENDAMENTO</p>
          <h1>Reunião · {m.opportunities.company}</h1>
        </div>
        <Link className="button" href={"/crm/" + m.opportunities.crm_lead_id}>
          Abrir lead
        </Link>
      </div>
      <CommercialNav />
      <Notice params={p} />
      <MeetingCard
        meeting={m}
        people={people}
        canResult={canResult}
        canReschedule={canReschedule}
      />
      <section className="panel padded">
        <h2>Observações do agendamento</h2>
        <p className="commercial-notes">
          {m.notes || "Sem observações prévias."}
        </p>
        {m.rescheduled_from_id && (
          <Link href={"/crm/meetings/" + m.rescheduled_from_id}>
            Consultar agendamento anterior
          </Link>
        )}
      </section>
      {canResult && (
        <section className="panel padded" id="result">
          <h2>Registrar resultado</h2>
          {new Date(m.scheduled_at).getTime() > Date.now() ? (
            <p className="notice">
              O resultado poderá ser registrado a partir do horário agendado.
            </p>
          ) : (
            <ResultForm
              meeting={m}
              people={people}
              outcome={
                p.outcome === "no_show" || m.status === "no_show"
                  ? "no_show"
                  : undefined
              }
            />
          )}
        </section>
      )}
      {result.data && (
        <section className="panel padded">
          <h2>Resultado registrado</h2>
          <strong>
            {result.data.outcome === "rescheduled"
              ? "Reagendada"
              : commercialOutcomes[
                  result.data.outcome as keyof typeof commercialOutcomes
                ]}
          </strong>
          <p className="muted">
            Por{" "}
            {people.find((x) => x.id === result.data.actor_id)?.name ??
              "Administração"}{" "}
            · {commercialDate(result.data.created_at)}
          </p>
          {Object.entries(result.data.details as Record<string, string | null>)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <p className="commercial-notes" key={k}>
                <strong>
                  {{
                    notes: "Observações",
                    needs: "Necessidades",
                    objections: "Objeções",
                    services: "Serviços",
                    amount: "Valor da proposta",
                    next_action: "Próxima ação",
                  }[k] ?? k}
                  :
                </strong>{" "}
                {v}
              </p>
            ))}
          <Link className="button" href="/crm/followups">
            Acompanhar follow-ups
          </Link>
        </section>
      )}
      {canReschedule && (
        <section className="panel padded" id="reschedule">
          <h2>Reagendar reunião</h2>
          <p className="muted">
            O agendamento anterior permanece no histórico. Elegibilidade de
            campanha é reavaliada sem duplicar a reunião.
          </p>
          <RescheduleForm meeting={m} people={people} admin={admin} />
        </section>
      )}
    </>
  );
}
