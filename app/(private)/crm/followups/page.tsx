import Link from "next/link";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { scopedFollowups } from "@/lib/crm-workspace";
import { commercialDay, dayBounds, type Followup } from "@/lib/crm-agenda";
import { CommercialNav, FollowupCard } from "@/components/crm-workspace";
import { Select, Empty, Notice, Field } from "@/components/ui";
import { check } from "@/lib/session";
import { hasFunction } from "@/lib/access";
export default async function Followups({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    owner?: string;
    page?: string;
    from?: string;
    to?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const ctx = await crmContext(),
    p = await searchParams,
    people = await crmDirectory(ctx.db);
  const { start, end } = dayBounds();
  const view = ["today", "upcoming", "completed", "cancelled"].includes(
    p.view ?? "",
  )
    ? p.view!
    : "overdue";
  const page = Math.max(1, Math.floor(Number(p.page)) || 1);
  let q = scopedFollowups(ctx);
  q = q.eq(
    "status",
    view === "completed"
      ? "completed"
      : view === "cancelled"
        ? "cancelled"
        : "pending",
  );
  if (view === "overdue") q = q.lt("due_at", new Date().toISOString());
  if (view === "today") q = q.gte("due_at", start).lt("due_at", end);
  if (view === "upcoming") q = q.gte("due_at", end);
  if (ctx.profile.category === "admin" && people.some((x) => x.id === p.owner))
    q = q.eq("assigned_to", p.owner!);
  for (const [key, op] of [
    ["from", "gte"],
    ["to", "lt"],
  ] as const) {
    try {
      if (p[key]) {
        const b = dayBounds(p[key]);
        q = op === "gte" ? q.gte("due_at", b.start) : q.lt("due_at", b.end);
      }
    } catch {
      /* Invalid optional date never bypasses RLS. */
    }
  }
  const r = await q
    .order("due_at")
    .order("id")
    .range((page - 1) * 40, page * 40 - 1);
  check(r.error);
  const url = (n: number) =>
    "/crm/followups?" +
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
          <p className="eyebrow">ION CRM · ACOMPANHAMENTOS</p>
          <h1>Central de follow-ups</h1>
          <p className="muted">
            {commercialDay()} · São Paulo. Pendências permanecem até conclusão,
            cancelamento ou reagendamento.
          </p>
        </div>
      </div>
      <CommercialNav />
      <Notice params={p} />
      <nav className="crm-tabs" aria-label="Situação dos follow-ups">
        {[
          ["overdue", "Atrasados"],
          ["today", "Hoje"],
          ["upcoming", "Próximos"],
          ["completed", "Concluídos"],
          ["cancelled", "Cancelados"],
        ].map(([v, l]) => (
          <Link
            key={v}
            className="button"
            aria-current={view === v ? "page" : undefined}
            href={"/crm/followups?view=" + v}
          >
            {l}
          </Link>
        ))}
      </nav>
      <section className="panel padded">
        <form className="filters" method="get">
          <input type="hidden" name="view" value={view} />
          {ctx.profile.category === "admin" && (
            <Select name="owner" label="Responsável" value={p.owner}>
              <option value="">Todos</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
          <Field
            name="from"
            label="Desde"
            type="date"
            required={false}
            value={p.from}
          />
          <Field
            name="to"
            label="Até"
            type="date"
            required={false}
            value={p.to}
          />
          <button className="button">Filtrar retornos</button>
        </form>
        <p className="muted">
          {r.count ?? 0} acompanhamentos · página {page}
        </p>
        <div className="commercial-grid">
          {(r.data ?? []).map((f) => (
            <FollowupCard
              key={f.id}
              followup={f as Followup}
              people={people}
              canAct={
                ctx.profile.category === "admin" ||
                ((hasFunction(ctx.profile, "closer") ||
                  hasFunction(ctx.profile, "sdr")) &&
                  f.assigned_to === ctx.profile.id)
              }
            />
          ))}
        </div>
        {!r.count && <Empty>Nenhum follow-up nesta seleção.</Empty>}
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
