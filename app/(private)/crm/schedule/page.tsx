import Link from "next/link";
import { crmContext, crmDirectory } from "@/lib/crm-server";
import { hasFunction } from "@/lib/access";
import { check } from "@/lib/session";
import { redirect } from "next/navigation";
import { ScheduleForm } from "@/components/crm-agenda-forms";
import { CommercialNav } from "@/components/crm-workspace";
import { Notice, Select, Empty } from "@/components/ui";
import type { AgendaLead } from "@/lib/crm-agenda";
export default async function QuickSchedule({
  searchParams,
}: {
  searchParams: Promise<{
    lead?: string;
    q?: string;
    error?: string;
    success?: string;
    page?: string;
  }>;
}) {
  const { db, profile } = await crmContext();
  if (profile.category !== "admin" && !hasFunction(profile, "sdr"))
    redirect("/crm");
  const p = await searchParams;
  const page = Math.max(1, Math.floor(Number(p.page)) || 1);
  let q = db
    .from("crm_leads")
    .select("id,company,contact,phone,sdr_id,closer_id,stage,archived", {
      count: "exact",
    })
    .eq("archived", false)
    .not("stage", "eq", "won")
    .order("company")
    .range((page - 1) * 40, page * 40 - 1);
  if (profile.category !== "admin") q = q.eq("sdr_id", profile.id);
  if (p.q)
    q = q.ilike("company", "%" + p.q.replace(/[%_]/g, "").slice(0, 100) + "%");
  const [r, people] = await Promise.all([q, crmDirectory(db)]);
  check(r.error);
  let lead = (r.data ?? []).find((l) => l.id === p.lead) as
    AgendaLead | undefined;
  if (p.lead && !lead) {
    let query = db
      .from("crm_leads")
      .select("id,company,contact,phone,sdr_id,closer_id,stage,archived")
      .eq("id", p.lead)
      .eq("archived", false)
      .not("stage", "eq", "won");
    if (profile.category !== "admin") query = query.eq("sdr_id", profile.id);
    const selected = await query.maybeSingle();
    if (!selected.error) lead = selected.data as AgendaLead | undefined;
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION CRM</p>
          <h1>Agendar reunião</h1>
        </div>
        <Link className="button" href="/crm/new">
          Novo lead
        </Link>
      </div>
      <CommercialNav />
      <Notice params={p} />
      <section className="panel padded">
        <form method="get" className="filters">
          <label className="field">
            <span>Buscar empresa</span>
            <input name="q" defaultValue={p.q} />
          </label>
          <button className="button">Buscar lead</button>
        </form>
        <form method="get" className="filters">
          <Select name="lead" label="Lead ou empresa" value={lead?.id} required>
            <option value="">Selecione um lead cadastrado</option>
            {lead && !r.data?.some((l) => l.id === lead!.id) && (
              <option value={lead.id}>{lead.company}</option>
            )}
            {r.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.company} · {l.contact}
              </option>
            ))}
          </Select>
          <button className="button">Selecionar lead</button>
        </form>
        {page > 1 && (
          <Link
            href={
              "/crm/schedule?" +
              new URLSearchParams({ q: p.q ?? "", page: String(page - 1) })
            }
          >
            Anterior
          </Link>
        )}{" "}
        {page * 40 < (r.count ?? 0) && (
          <Link
            href={
              "/crm/schedule?" +
              new URLSearchParams({ q: p.q ?? "", page: String(page + 1) })
            }
          >
            Mais leads
          </Link>
        )}
        {lead ? (
          <ScheduleForm lead={lead} people={people} />
        ) : (
          <Empty>
            Selecione o lead para reutilizar empresa, contato e telefone. Nenhum
            dado precisa ser digitado novamente.
          </Empty>
        )}
      </section>
    </>
  );
}
