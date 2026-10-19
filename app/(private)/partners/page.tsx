import Link from "next/link";
import { redirect } from "next/navigation";
import { session, check } from "@/lib/session";
import { FileDownload } from "@/components/operations-files";
import { AnalyticsResults } from "@/components/analytics-results";
import {
  analyticsPeriod,
  metricKeys,
  metricDefinitions,
  platforms,
  type Snapshot,
  type MetricKey,
  type ReportHeader,
} from "@/lib/analytics";
import {
  serviceStatuses,
  contractStatuses,
  type PartnerSnapshot,
} from "@/lib/operations";
import { Field, Select, Empty } from "@/components/ui";
import { z } from "zod";
type Context = {
  companies: { id: string; name: string }[];
  campaigns: {
    id: string;
    company_id: string;
    name: string;
    contract_id: string | null;
    platform: keyof typeof platforms;
  }[];
  reports: ReportHeader[];
};
export default async function Partners({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db, profile } = await session();
  if (!["admin", "partner"].includes(profile.category))
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  const p = await searchParams;
  const [context, snapshot, companies] = await Promise.all([
    db.rpc("ana_partner_options"),
    db.rpc("ops_partner_snapshot"),
    db.from("access_companies").select("id,name"),
  ]);
  check(context.error);
  check(snapshot.error);
  check(companies.error);
  const options = context.data as Context;
  const published = (snapshot.data ?? []) as PartnerSnapshot[];
  let period;
  try {
    period = analyticsPeriod(p);
  } catch {
    return (
      <>
        <h1>Minha empresa</h1>
        <p className="notice error">
          Período inválido. Informe datas reais em ordem cronológica.
        </p>
        <Link href="/partners">Voltar ao portal</Link>
      </>
    );
  }
  const selected =
    options.companies.find((c) => c.id === p.company_id) ??
    options.companies[0];
  const cid = selected?.id;
  const campaign = options.campaigns.find(
    (c) => c.id === p.campaign_id && c.company_id === cid,
  );
  const metric = metricKeys.includes(p.metric as MetricKey)
    ? (p.metric as MetricKey)
    : "spend";
  const filters = {
    ...period,
    company_id: cid ?? "",
    campaign_id: campaign?.id ?? "",
    platform: ["meta", "google", "other"].includes(p.platform ?? "")
      ? p.platform
      : "",
    contract_id: z.string().uuid().safeParse(p.contract_id).success
      ? p.contract_id
      : "",
  };
  const result = cid
    ? await db.rpc("ana_portal_report", { filters })
    : { data: null, error: null };
  check(result.error);
  const operation = published.find((c) => c.id === cid);
  const reports = options.reports.filter(
    (r) =>
      r.company_id === cid &&
      r.period_from <= period.to &&
      r.period_to >= period.from,
  );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION PARTNERS · SOMENTE CONSULTA</p>
          <h1>
            {profile.category === "admin" ? "Parceiros" : "Minha empresa"}
          </h1>
          <p className="muted">
            {profile.category === "admin"
              ? "Prévia somente das informações publicadas para parceiros."
              : "Resultados, serviços, relatórios e documentos autorizados para sua empresa."}
          </p>
        </div>
      </div>
      {cid ? (
        <>
          <section className="panel padded">
            <h2>{selected.name}</h2>
            <form method="get" className="filters">
              <Select name="company_id" label="Empresa autorizada" value={cid}>
                {options.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select
                name="campaign_id"
                label="Campanha publicada"
                value={campaign?.id ?? ""}
              >
                <option value="">Todas publicadas</option>
                {options.campaigns
                  .filter((c) => c.company_id === cid)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
              <Select
                name="contract_id"
                label="Contrato autorizado"
                value={filters.contract_id}
              >
                <option value="">Todos</option>
                {operation?.contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.reference}
                  </option>
                ))}
              </Select>
              <Select
                name="platform"
                label="Plataforma"
                value={filters.platform}
              >
                <option value="">Todas</option>
                {Object.entries(platforms).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
              <Select name="metric" label="Indicador" value={p.metric ?? ""}>
                <option value="">Todos autorizados</option>
                {metricKeys
                  .filter(
                    (k) =>
                      !result.data?.record_count ||
                      Object.hasOwn((result.data as Snapshot).stats, k),
                  )
                  .map((k) => (
                    <option key={k} value={k}>
                      {metricDefinitions[k].label}
                    </option>
                  ))}
              </Select>
              <Field
                name="month"
                label="Mês e ano"
                type="month"
                value={period.month}
              />
              <Field
                name="from"
                label="Início personalizado"
                type="date"
                required={false}
                value={p.from}
              />
              <Field
                name="to"
                label="Fim personalizado"
                type="date"
                required={false}
                value={p.to}
              />
              <Select
                name="compare"
                label="Comparação"
                value={p.compare ?? "previous"}
              >
                <option value="previous">Período anterior equivalente</option>
                <option value="none">Sem comparação</option>
              </Select>
              <button className="button">Consultar período</button>
            </form>
            <p className="small muted">
              {period.from} a {period.to}. Investimento publicitário é o
              orçamento do cliente para anúncios, distinto dos valores pagos à
              Agência ION. Este portal não permite solicitações, mensagens,
              aprovações ou alterações.
            </p>
          </section>
          <section className="panel padded">
            <h2>Contratos e serviços autorizados</h2>
            <div className="stats">
              <div className="stat">
                <span>Serviços em andamento</span>
                <strong>
                  {operation?.services.filter((s) =>
                    ["pending", "running"].includes(s.status),
                  ).length ?? 0}
                </strong>
              </div>
              <div className="stat">
                <span>Serviços concluídos</span>
                <strong>
                  {operation?.services.filter((s) => s.status === "completed")
                    .length ?? 0}
                </strong>
              </div>
              <div className="stat">
                <span>Relatórios neste período</span>
                <strong>{reports.length}</strong>
              </div>
            </div>
            {operation?.contracts.length ? (
              operation.contracts.map((c) => (
                <p key={c.id}>
                  {c.reference} · {contractStatuses[c.status]} · {c.starts_at} a{" "}
                  {c.ends_at ?? "prazo indeterminado"}
                </p>
              ))
            ) : (
              <p className="muted">
                Nenhum contrato disponibilizado para consulta.
              </p>
            )}
            {operation?.services.length ? (
              operation.services.map((s) => (
                <div className="team-row" key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <small>{s.description}</small>
                    <small>
                      Início: {s.starts_at ?? "Não informado"} · Prazo:{" "}
                      {s.due_at ?? "Não definido"} · Entrega:{" "}
                      {s.delivered_at ?? "Não concluída"}
                    </small>
                  </div>
                  <span className="badge">{serviceStatuses[s.status]}</span>
                </div>
              ))
            ) : (
              <Empty>Nenhum serviço publicado.</Empty>
            )}
          </section>
          <section className="panel padded">
            <h2>Resultados autorizados</h2>
            <p className="muted">
              Apenas indicadores e observações explicitamente conferidos e
              publicados pela ION.
            </p>
          </section>
          <AnalyticsResults
            snapshot={result.data as Snapshot}
            metric={metric}
            onlyMetric={!!p.metric}
          />
          <section className="panel padded">
            <h2>Últimas atualizações dos serviços</h2>
            {operation?.updates.length ? (
              operation.updates.map((u) => (
                <p key={u.id}>
                  {u.body}
                  <small className="muted">
                    {" "}
                    ·{" "}
                    {new Date(u.created_at).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}
                  </small>
                </p>
              ))
            ) : (
              <Empty>Nenhuma atualização publicada.</Empty>
            )}
          </section>
          <section className="panel padded">
            <h2>Relatórios disponíveis</h2>
            {reports.length ? (
              reports.map((r) => (
                <div className="team-row" key={r.id}>
                  <div>
                    <Link href={"/analytics/reports/" + r.id + "?public=1"}>
                      <strong>{r.title}</strong>
                    </Link>
                    <small>
                      {r.period_from} a {r.period_to} · gerado em{" "}
                      {new Date(r.created_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </small>
                  </div>
                  <Link
                    className="button"
                    href={"/analytics/reports/" + r.id + "/pdf?public=1"}
                  >
                    Baixar PDF
                  </Link>
                </div>
              ))
            ) : (
              <Empty>Nenhum relatório publicado neste período.</Empty>
            )}
          </section>
          <section className="panel padded">
            <h2>Documentos autorizados</h2>
            {operation?.files.length ? (
              operation.files.map((f) => (
                <p key={f.id}>
                  <FileDownload id={f.id} name={f.name} />
                </p>
              ))
            ) : (
              <Empty>Nenhum documento disponível.</Empty>
            )}
            <p className="table-note">
              Downloads privados revalidam sua sessão e o vínculo com a empresa.
              Uma revogação bloqueia novos acessos; arquivos já baixados não
              podem ser recolhidos.
            </p>
          </section>
        </>
      ) : (
        <section className="panel padded">
          {companies.data?.map((c) => (
            <div key={c.id}>
              <h2>{c.name}</h2>
              <p className="muted">Nenhum dado publicado para esta empresa.</p>
            </div>
          ))}
          <Empty>
            {companies.data?.length
              ? "Contate o administrador para conferir as publicações."
              : "Nenhuma empresa vinculada a este acesso. Contate o administrador."}
          </Empty>
        </section>
      )}
    </>
  );
}
