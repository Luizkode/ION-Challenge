import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { followupSelect } from "@/lib/crm-workspace";
import { type Followup, commercialDate } from "@/lib/crm-agenda";
import { CommercialNav, FollowupCard } from "@/components/crm-workspace";
import { FollowupForms } from "@/components/crm-agenda-forms";
import { Notice, Empty } from "@/components/ui";
import { check } from "@/lib/session";
import { hasFunction } from "@/lib/access";
export default async function FollowupDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  if (!z.string().guid().safeParse(id).success) notFound();
  const ctx = await crmContext();
  const [r, people, events] = await Promise.all([
    ctx.db
      .from("crm_followups")
      .select(followupSelect)
      .eq("id", id)
      .maybeSingle(),
    crmDirectory(ctx.db),
    ctx.db
      .from("crm_activities")
      .select("id,description,created_at,actor_id")
      .eq("followup_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  check(r.error);
  check(events.error);
  if (!r.data) notFound();
  const f = r.data as Followup;
  const can =
    ctx.profile.category === "admin" ||
    ((hasFunction(ctx.profile, "closer") || hasFunction(ctx.profile, "sdr")) &&
      f.assigned_to === ctx.profile.id);
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION CRM · RETORNO COMERCIAL</p>
          <h1>Follow-up · {f.crm_leads.company}</h1>
        </div>
        <Link className="button" href={"/crm/" + f.lead_id}>
          Histórico do lead
        </Link>
      </div>
      <CommercialNav />
      <Notice params={await searchParams} />
      <FollowupCard followup={f} people={people} />
      {f.meeting_id && (
        <p>
          <Link href={"/crm/meetings/" + f.meeting_id}>Reunião de origem</Link>
        </p>
      )}
      {can && f.status === "pending" && (
        <FollowupForms followup={f} people={people} />
      )}
      <section className="panel padded">
        <h2>Histórico do acompanhamento</h2>
        <p className="muted">
          Últimas 200 interações. O histórico completo do lead permanece
          disponível.
        </p>
        {events.data?.map((e) => (
          <article className="commercial-card" key={e.id}>
            <p className="commercial-notes">{e.description}</p>
            <p className="muted small">
              {people.find((x) => x.id === e.actor_id)?.name ?? "Administração"}{" "}
              · {commercialDate(e.created_at)}
            </p>
          </article>
        ))}
        {!events.data?.length && <Empty>Nenhuma interação registrada.</Empty>}
      </section>
    </>
  );
}
