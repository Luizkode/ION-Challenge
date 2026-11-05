import Link from "next/link";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { scopedMeetings } from "@/lib/crm-workspace";
import { commercialDay, dayBounds, type AgendaMeeting } from "@/lib/crm-agenda";
import { CommercialNav, MeetingCard } from "@/components/crm-workspace";
import { Field, Select, Empty, Notice, labels } from "@/components/ui";
import { check } from "@/lib/session";
import { hasFunction } from "@/lib/access";
export default async function Agenda({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    owner?: string;
    owner_role?: string;
    status?: string;
    page?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const ctx = await crmContext(),
    p = await searchParams,
    people = await crmDirectory(ctx.db);
  const admin = ctx.profile.category === "admin";
  let date = p.date ?? commercialDay();
  try {
    dayBounds(date);
  } catch {
    date = commercialDay();
  }
  const { start, end } = dayBounds(date);
  const view = ["upcoming", "calendar", "history", "awaiting"].includes(
    p.view ?? "",
  )
    ? p.view!
    : "today";
  const page = Math.max(1, Math.floor(Number(p.page)) || 1);
  let q = scopedMeetings(ctx);
  if (view === "awaiting")
    q = q
      .lt("scheduled_at", new Date().toISOString())
      .in("status", ["scheduled", "pending", "held", "qualified", "no_show"])
      .is("crm_meeting_results", null);
  else if (view === "history") q = q.lt("scheduled_at", end);
  else if (view === "upcoming") q = q.gte("scheduled_at", end);
  else q = q.gte("scheduled_at", start).lt("scheduled_at", end);
  if (p.status && Object.keys(labels).includes(p.status))
    q = q.eq("status", p.status);
  if (admin && people.some((x) => x.id === p.owner))
    q =
      p.owner_role === "sdr"
        ? q.eq("opportunities.sdr_id", p.owner!)
        : q.eq("closer_id", p.owner!);
  const r = await q
    .order("scheduled_at", { ascending: view !== "history" })
    .order("id")
    .range((page - 1) * 40, page * 40 - 1);
  check(r.error);
  const ids = r.data?.map((m) => m.id) ?? [];
  const results = ids.length
    ? await ctx.db
        .from("crm_meeting_results")
        .select("meeting_id")
        .in("meeting_id", ids)
    : { data: [], error: null };
  check(results.error);
  const recorded = new Set(results.data?.map((x) => x.meeting_id));
  const url = (n: number) =>
    "/crm/agenda?" +
    new URLSearchParams({
      ...(Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      page: String(n),
    });
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION CRM · SÃO PAULO</p>
          <h1>Agenda comercial</h1>
        </div>
        {(admin || hasFunction(ctx.profile, "sdr")) && (
          <Link className="button" href="/crm/schedule">
            Agendar reunião
          </Link>
        )}
      </div>
      <CommercialNav />
      <Notice params={p} />
      <nav className="crm-tabs" aria-label="Visualização da agenda">
        {[
          ["today", "Hoje"],
          ["upcoming", "Próximos dias"],
          ["calendar", "Calendário"],
          ["history", "Histórico de reuniões"],
          ["awaiting", "Aguardando resultado"],
        ].map(([v, l]) => (
          <Link
            key={v}
            className="button"
            aria-current={view === v ? "page" : undefined}
            href={"/crm/agenda?view=" + v}
          >
            {l}
          </Link>
        ))}
      </nav>
      <section className="panel padded">
        <form method="get" className="filters">
          <input type="hidden" name="view" value={view} />
          <Field
            type="date"
            name="date"
            label={
              view === "calendar"
                ? "Calendário — selecionar dia"
                : "Data de referência"
            }
            value={date}
          />
          <Select name="status" label="Status" value={p.status}>
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
          {admin && (
            <>
              <Select name="owner" label="Colaborador" value={p.owner}>
                <option value="">Todos</option>
                {people.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Select
                name="owner_role"
                label="Filtrar como"
                value={p.owner_role}
              >
                <option value="closer">Closer</option>
                <option value="sdr">SDR</option>
              </Select>
            </>
          )}
          <button className="button">Atualizar agenda</button>
        </form>
        <p className="muted">
          {r.count ?? 0} reuniões · horários de São Paulo · página {page}
        </p>
        <div className="commercial-grid">
          {(r.data ?? []).map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m as AgendaMeeting}
              people={people}
              canResult={
                !recorded.has(m.id) &&
                [
                  "scheduled",
                  "pending",
                  "held",
                  "qualified",
                  "no_show",
                ].includes(m.status) &&
                (admin ||
                  (hasFunction(ctx.profile, "closer") &&
                    m.closer_id === ctx.profile.id &&
                    m.opportunities.sdr_id !== ctx.profile.id))
              }
              canReschedule={
                ["scheduled", "pending", "no_show"].includes(m.status) &&
                (admin ||
                  (hasFunction(ctx.profile, "closer") &&
                    m.closer_id === ctx.profile.id) ||
                  (hasFunction(ctx.profile, "sdr") &&
                    m.opportunities.sdr_id === ctx.profile.id))
              }
            />
          ))}
        </div>
        {!r.count && <Empty>Nenhuma reunião nesta seleção.</Empty>}
        <div className="crm-actions">
          {page > 1 && (
            <Link className="button" href={url(page - 1)}>
              Anterior
            </Link>
          )}
          {page * 40 < (r.count ?? 0) && (
            <Link className="button" href={url(page + 1)}>
              Próxima
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
