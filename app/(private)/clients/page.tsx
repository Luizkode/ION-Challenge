import { ActionForm } from "@/components/action-form";
import Link from "next/link";
import { operationsContext } from "@/lib/operations-server";
import { check } from "@/lib/session";
import { Field, Select, Notice, Empty } from "@/components/ui";
import { Submit } from "@/components/submit";
import { convertDeal, saveCatalog } from "@/app/operations-actions";
import {
  relationships,
  serviceStatuses,
  type Client,
  type Catalog,
  type Person,
} from "@/lib/operations";
import { z } from "zod";
type Params = {
  q?: string;
  company_id?: string;
  owner?: string;
  catalog_id?: string;
  status?: string;
  relationship?: string;
  page?: string;
  deal?: string;
  error?: string;
  success?: string;
};
export default async function Clients({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { db, profile } = await operationsContext();
  const admin = profile.category === "admin";
  const p = await searchParams;
  const page = Math.max(1, Math.floor(Number(p.page) || 1));
  const uuid = (v?: string) =>
    z.string().guid().safeParse(v).success ? v : "";
  const filters = {
    company_id: uuid(p.company_id),
    owner: uuid(p.owner),
    catalog_id: uuid(p.catalog_id),
    status: Object.keys(serviceStatuses).includes(p.status ?? "")
      ? p.status
      : "",
    relationship: Object.keys(relationships).includes(p.relationship ?? "")
      ? p.relationship
      : "",
  };
  const [clients, companies, catalog, people, summary, alerts, deals, linked] =
    await Promise.all([
      db.rpc("ops_list_clients", {
        filters,
        page,
        query: p.q?.slice(0, 150) ?? "",
      }),
      db.from("access_companies").select("id,name").order("name"),
      db.from("ops_catalog").select("*").order("name"),
      db.rpc("ops_directory"),
      db.rpc("ops_summary", { filters }),
      admin
        ? db.rpc("ops_source_alerts")
        : Promise.resolve({ data: [], error: null }),
      admin
        ? db
            .from("crm_deals")
            .select("id,services,contract_id,crm_leads(company)")
            .eq("result", "won")
            .not("contract_id", "is", null)
            .limit(100)
        : Promise.resolve({ data: [], error: null }),
      admin
        ? db
            .from("ops_contracts")
            .select("source_deal_id,company_id")
            .not("source_deal_id", "is", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
  for (const r of [
    clients,
    companies,
    catalog,
    people,
    summary,
    alerts,
    deals,
    linked,
  ])
    check(r.error);
  const data = (clients.data?.rows ?? []) as Client[];
  const stats = summary.data ?? {};
  const allCatalog = (catalog.data ?? []) as Catalog[];
  const staff = (people.data ?? []) as Person[];
  let eligibleDeals = (deals.data ?? []) as unknown as {
    id: string;
    services: string;
    crm_leads: { company: string } | null;
  }[];
  if (admin && uuid(p.deal) && !eligibleDeals.some((d) => d.id === p.deal)) {
    const selected = await db
      .from("crm_deals")
      .select("id,services,crm_leads(company)")
      .eq("id", p.deal!)
      .eq("result", "won")
      .not("contract_id", "is", null)
      .maybeSingle();
    check(selected.error);
    if (selected.data)
      eligibleDeals = [
        selected.data as unknown as (typeof eligibleDeals)[number],
        ...eligibleDeals,
      ];
  }
  const next = (n: number) => {
    const s = new URLSearchParams(
      Object.entries(p).filter(([, v]) => v !== undefined) as [
        string,
        string,
      ][],
    );
    s.set("page", String(n));
    return "/clients?" + s;
  };
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · CENTRAL OPERACIONAL</p>
          <h1>Clientes e Serviços</h1>
          <p className="muted">
            Clientes, contratos, entregas e documentos em um só lugar.
          </p>
        </div>
        {admin && (
          <Link className="button" href="/clients/new">
            Novo cliente
          </Link>
        )}
      </div>
      <Notice params={p} />
      <section className="panel">
        <form className="filters" method="get">
          <Field label="Buscar cliente" name="q" required={false} value={p.q} />
          <Select label="Cliente" name="company_id" value={filters.company_id}>
            <option value="">Todos autorizados</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Relacionamento"
            name="relationship"
            value={filters.relationship}
          >
            <option value="">Todos</option>
            {Object.entries(relationships).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </Select>
          {admin && (
            <Select
              label="Responsável dos serviços"
              name="owner"
              value={filters.owner}
            >
              <option value="">Todos</option>
              {staff.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Select label="Serviço" name="catalog_id" value={filters.catalog_id}>
            <option value="">Todos</option>
            {allCatalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Status do serviço"
            name="status"
            value={filters.status}
          >
            <option value="">Todos</option>
            {Object.entries(serviceStatuses).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </Select>
          <button className="button">Filtrar</button>
        </form>
      </section>
      <div className="stats">
        {[
          ["Clientes ativos", stats.active_clients],
          ["Clientes inativos", stats.inactive_clients],
          ["Contratos ativos", stats.active_contracts],
          ["Serviços em andamento", stats.running],
          ["Serviços concluídos", stats.completed],
          ["Serviços pausados", stats.paused],
          ["Serviços atrasados", stats.overdue],
        ].map(([n, v]) => (
          <div className="stat" key={n}>
            <span>{n}</span>
            <strong>{v ?? 0}</strong>
          </div>
        ))}
      </div>
      <p className="table-note">
        Indicadores calculados no banco conforme seu acesso. Contratos são
        restritos ao ADM e ao responsável interno. Filtros aplicam-se aos
        clientes correspondentes e à execução autorizada dos serviços. Atraso:
        prazo anterior a hoje, sem conclusão ou pausa.
      </p>
      {admin && (alerts.data ?? []).length > 0 && (
        <section className="panel padded">
          <h2>Origem comercial exige revisão</h2>
          <p className="notice error">
            Há contratos comerciais corrigidos ou cancelados. Os registros
            operacionais foram preservados.
          </p>
          {alerts.data.map(
            (a: { id: string; company_id: string; reference: string }) => (
              <p key={a.id}>
                <Link href={"/clients/" + a.company_id}>
                  {a.reference} · revisar decisão operacional
                </Link>
              </p>
            ),
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-title">
          <h2>Clientes autorizados</h2>
          <span className="small muted">
            {clients.data?.count ?? data.length} clientes
          </span>
        </div>
        {data.length ? (
          data.map((c) => (
            <div className="team-row" key={c.company_id}>
              <div>
                <Link href={"/clients/" + c.company_id}>
                  <strong>{c.access_companies.name}</strong>
                </Link>
                <small>
                  {c.contact} · {c.city} / {c.state}
                </small>
              </div>
              <span className="badge">{relationships[c.relationship]}</span>
            </div>
          ))
        ) : (
          <Empty>Nenhuma empresa atribuída.</Empty>
        )}
        <div className="padded crm-actions">
          {page > 1 && (
            <Link className="button" href={next(page - 1)}>
              Anterior
            </Link>
          )}
          {page * 30 < (clients.data?.count ?? 0) && (
            <Link className="button" href={next(page + 1)}>
              Próxima
            </Link>
          )}
        </div>
      </section>
      {admin && (
        <>
          <section className="panel padded">
            <details open={!!p.deal}>
              <summary>
                Criar ou vincular cliente de fechamento confirmado no CRM
              </summary>
              <p className="small muted">
                Apenas contratos comerciais confirmados e válidos. Repetir a
                conversão retorna o mesmo cliente e contrato.
              </p>
              <ActionForm action={convertDeal} className="form-grid">
                <Select
                  name="deal_id"
                  label="Fechamento confirmado"
                  value={p.deal}
                  required
                >
                  {eligibleDeals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.crm_leads?.company ?? d.services}
                      {linked.data?.some((x) => x.source_deal_id === d.id)
                        ? " · já vinculado"
                        : ""}
                    </option>
                  ))}
                </Select>
                <Select name="company_id" label="Vincular cliente existente">
                  <option value="">Identificar automaticamente ou criar</option>
                  {companies.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select
                  name="responsible_id"
                  label="Responsável interno do contrato importado"
                >
                  <option value="">Usar SDR de origem (se ativo)</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
                <Submit>Criar ou vincular cliente</Submit>
              </ActionForm>
            </details>
          </section>
          <section className="panel padded">
            <details>
              <summary>Catálogo configurável de serviços</summary>
              <ActionForm action={saveCatalog} className="form-grid">
                <Field label="Novo serviço do catálogo" name="name" />
                <Submit>Adicionar ao catálogo</Submit>
              </ActionForm>
              {allCatalog.map((c) => (
                <details key={c.id}>
                  <summary>
                    {c.name} · {c.active ? "Ativo" : "Inativo"}
                  </summary>
                  <ActionForm action={saveCatalog} className="form-grid">
                    <input type="hidden" name="id" value={c.id} />
                    <Field label="Nome do serviço" name="name" value={c.name} />
                    <Select
                      label="Disponibilidade"
                      name="active"
                      value={String(c.active)}
                    >
                      <option value="true">Ativo</option>
                      <option value="false">Inativo</option>
                    </Select>
                    <Submit>Atualizar catálogo</Submit>
                  </ActionForm>
                </details>
              ))}
            </details>
          </section>
          <section className="panel padded">
            <details>
              <summary>Completar empresa já cadastrada em Equipe</summary>
              {companies.data?.map((c) => (
                <p key={c.id}>
                  <Link href={"/clients/new?company=" + c.id}>{c.name}</Link>
                </p>
              ))}
            </details>
          </section>
        </>
      )}
    </>
  );
}
