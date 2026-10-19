import Link from "next/link";
import { analyticsContext, analyticsFilters } from "@/lib/analytics-server";
import {
  metricDefinitions,
  metricKeys,
  platforms,
  sourceLabels,
  formatMetric,
  type AnalyticsOptions,
  type Snapshot,
  type MetricKey,
} from "@/lib/analytics";
import { Field, Select, Notice, Empty } from "@/components/ui";
import { Submit } from "@/components/submit";
import { ConfirmedAdminForm } from "@/components/confirmed-admin-form";
import {
  AccountForm,
  CampaignForm,
  MetricForm,
} from "@/components/analytics-forms";
import { AnalyticsResults } from "@/components/analytics-results";
import {
  createAnalyticsReport,
  importPerformance,
  publishCampaign,
  publishMetrics,
  publishReport,
  saveAnalyticsGrant,
} from "@/app/analytics-actions";
import { integrationStatus } from "@/lib/ads-connectors";
export default async function Analytics({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { db, profile } = await analyticsContext();
  const p = await searchParams;
  const admin = profile.category === "admin";
  let filters;
  try {
    filters = analyticsFilters(p);
  } catch {
    return (
      <>
        <h1>Analytics</h1>
        <p className="notice error">
          Informe um período válido e datas reais (máximo dois anos).
        </p>
        <Link href="/analytics">Voltar ao período atual</Link>
      </>
    );
  }
  const [o, r] = await Promise.all([
    db.rpc("ana_options"),
    db.rpc("ana_report", { filters }),
  ]);
  if (o.error || r.error)
    return (
      <>
        <h1>Analytics</h1>
        <p className="notice error">
          {r.error?.code === "P0001"
            ? r.error.message
            : "Não foi possível consultar o Analytics. Verifique a migration 010 e suas permissões."}
        </p>
      </>
    );
  const options = o.data as AnalyticsOptions;
  const snapshot = r.data as Snapshot;
  const canWrite = options.companies.some((c) => c.can_write);
  const view = [
    "accounts",
    "campaigns",
    "reports",
    "publication",
    "access",
    "integrations",
  ].includes(p.view ?? "")
    ? p.view!
    : "results";
  const metric = metricKeys.includes(p.metric as MetricKey)
    ? (p.metric as MetricKey)
    : "spend";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(p.page) || 1)));
  const rows = snapshot.records.slice((page - 1) * 50, page * 50);
  const selectedCompany = String(filters.company_id || "");
  const campaigns = options.campaigns.filter(
    (c) => !selectedCompany || c.company_id === selectedCompany,
  );
  const accounts = options.accounts.filter(
    (a) => !selectedCompany || a.company_id === selectedCompany,
  );
  const reports = options.reports.filter(
    (r) =>
      (!selectedCompany || r.company_id === selectedCompany) &&
      r.period_from <= filters.to &&
      r.period_to >= filters.from,
  );
  const next = (extra: Record<string, string>) =>
    "/analytics?" +
    new URLSearchParams({
      ...(Object.fromEntries(
        Object.entries(p).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      ...extra,
    });
  const history =
    admin && selectedCompany
      ? await db.rpc("ana_history", { cid: selectedCompany, page })
      : { data: [], error: null };
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · ION ANALYTICS</p>
          <h1>Analytics</h1>
          <p className="muted">
            Resultados reais, origem rastreável e publicação controlada.
          </p>
        </div>
        {admin && (
          <Link className="button" href="/partners">
            Conferir portal publicado
          </Link>
        )}
      </div>
      <Notice params={p} />
      <nav className="crm-actions" aria-label="Áreas do Analytics">
        {[
          ["results", "Resultados"],
          ["accounts", "Contas de dados"],
          ["campaigns", "Campanhas"],
          ["reports", "Relatórios"],
          ...(admin
            ? [
                ["publication", "Publicações"],
                ["access", "Permissões"],
              ]
            : []),
          ["integrations", "Integrações"],
        ].map(([key, label]) => (
          <Link
            key={key}
            className="button"
            aria-current={view === key ? "page" : undefined}
            href={next({ view: key, page: "1" })}
          >
            {label}
          </Link>
        ))}
      </nav>
      <section className="panel padded">
        <form method="get" className="filters">
          <input type="hidden" name="view" value={view} />
          <Select name="company_id" label="Cliente" value={selectedCompany}>
            <option value="">Todos autorizados</option>
            {options.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            name="contract_id"
            label="Contrato"
            value={String(filters.contract_id || "")}
          >
            <option value="">Todos</option>
            {options.contracts
              .filter(
                (c) => !selectedCompany || c.company_id === selectedCompany,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.reference}
                </option>
              ))}
          </Select>
          <Select
            name="account_id"
            label="Conta de dados"
            value={String(filters.account_id || "")}
          >
            <option value="">Todas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            name="campaign_id"
            label="Campanha"
            value={String(filters.campaign_id || "")}
          >
            <option value="">Todas</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="platform" label="Plataforma" value={filters.platform}>
            <option value="">Todas</option>
            {Object.entries(platforms).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select name="metric" label="Indicador" value={p.metric ?? ""}>
            <option value="">Todos os indicadores</option>
            {metricKeys.map((k) => (
              <option key={k} value={k}>
                {metricDefinitions[k].label}
              </option>
            ))}
          </Select>
          <Select
            name="range"
            label="Período rápido"
            value={p.range ?? "month"}
          >
            <option value="month">Mês selecionado</option>
            <option value="week">Últimos sete dias</option>
            <option value="custom">Personalizado</option>
          </Select>
          <Field
            name="month"
            label="Mês e ano"
            type="month"
            value={filters.month}
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
          <Field
            name="compare_from"
            label="Comparar desde (opcional)"
            type="date"
            required={false}
            value={p.compare_from}
          />
          <Field
            name="compare_to"
            label="Comparar até (opcional)"
            type="date"
            required={false}
            value={p.compare_to}
          />
          <Select
            name="only_published"
            label="Visibilidade dos resultados"
            value={p.only_published ?? "false"}
          >
            <option value="false">Todos autorizados internamente</option>
            <option value="true">Somente publicados</option>
          </Select>
          <button className="button">Aplicar filtros</button>
        </form>
        <p className="small muted">
          Período: {filters.from} a {filters.to}. Datas seguem o fuso declarado
          em cada conta. Registros parciais não são rateados. Comparação mensal
          atual usa os mesmos dias disponíveis do mês anterior.
        </p>
      </section>
      {!options.companies.length && (
        <Empty>
          Nenhum cliente atribuído e autorizado no Analytics. O administrador
          gerencia os vínculos em Equipe/Serviços e as permissões nesta central.
        </Empty>
      )}
      {view === "results" && (
        <>
          <AnalyticsResults
            snapshot={snapshot}
            metric={metric}
            onlyMetric={!!p.metric}
          />
          {canWrite && (
            <section className="panel padded">
              <details>
                <summary>Cadastrar resultado real</summary>
                <MetricForm options={options} />
              </details>
              <details>
                <summary>Importar resultados por CSV</summary>
                <p>
                  Use datas ISO, valores monetários com ponto decimal e campos
                  vazios para medidas desconhecidas. Até 500 linhas/2 MB,
                  gravadas de forma transacional. Reimportar linhas idênticas
                  não duplica resultados; divergências exigem correção
                  individual com motivo.
                </p>
                <Link className="button" href="/analytics/template">
                  Baixar modelo CSV
                </Link>
                <form className="form-grid" action={importPerformance}>
                  <Select
                    name="campaign_id"
                    label="Campanha do arquivo"
                    required
                  >
                    <option value="">Selecione</option>
                    {options.campaigns
                      .filter((c) =>
                        options.companies.some(
                          (x) => x.id === c.company_id && x.can_write,
                        ),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                  <Field
                    name="source_reference"
                    label="Origem do arquivo (exportação e data)"
                  />
                  <label className="field">
                    <span>Arquivo CSV real</span>
                    <input
                      type="file"
                      name="csv"
                      accept=".csv,text/csv"
                      required
                    />
                  </label>
                  <Submit>Importar CSV real</Submit>
                </form>
              </details>
            </section>
          )}
          <section className="panel">
            <div className="panel-title">
              <h2>Registros de desempenho</h2>
              <span>{snapshot.record_count} registros</span>
            </div>
            {rows.length ? (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Campanha / cliente</th>
                      <th>Período</th>
                      <th>Investimento do cliente</th>
                      <th>Impressões</th>
                      <th>Fonte / atualização</th>
                      <th>Consulta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {m.campaign}
                          <small>
                            {m.company} · {platforms[m.platform]}
                          </small>
                        </td>
                        <td>
                          {m.period_from} a {m.period_to}
                        </td>
                        <td>{formatMetric("spend", m.spend)}</td>
                        <td>{formatMetric("impressions", m.impressions)}</td>
                        <td>
                          {sourceLabels[m.source_kind]}
                          <small>
                            {new Date(m.updated_at).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })}
                          </small>
                        </td>
                        <td>
                          <Link href={"/analytics/metrics/" + m.id}>
                            Abrir / corrigir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nenhum resultado neste filtro.</Empty>
            )}
            <div className="crm-actions padded">
              {page > 1 && (
                <Link
                  className="button"
                  href={next({ page: String(page - 1) })}
                >
                  Anterior
                </Link>
              )}
              {page * 50 < snapshot.records.length && (
                <Link
                  className="button"
                  href={next({ page: String(page + 1) })}
                >
                  Próxima
                </Link>
              )}
            </div>
          </section>
        </>
      )}
      {view === "accounts" && (
        <section className="panel padded">
          <h2>Contas e definições de origem</h2>
          {canWrite && (
            <details>
              <summary>Nova conta de dados</summary>
              <AccountForm options={options} />
            </details>
          )}
          {accounts.map((a) => (
            <details key={a.id}>
              <summary>
                {a.name} · {platforms[a.platform]} ·{" "}
                {a.active ? "Ativa" : "Inativa"}
              </summary>
              <p>
                {a.time_zone} · {a.attribution} · referência {a.reference}
              </p>
              {options.companies.some(
                (c) => c.id === a.company_id && c.can_write,
              ) && <AccountForm options={options} account={a} />}
            </details>
          ))}
          <p>
            O cadastro não solicita nem armazena credenciais. Conexões externas
            estão desativadas até autorização específica.
          </p>
        </section>
      )}
      {view === "campaigns" && (
        <section className="panel padded">
          <h2>Campanhas de anúncios</h2>
          {canWrite && (
            <details>
              <summary>Nova campanha de anúncios</summary>
              <CampaignForm options={options} />
            </details>
          )}
          {campaigns.map((c) => (
            <details key={c.id}>
              <summary>
                {c.name} · {c.published ? "Publicada" : "Interna"} ·{" "}
                {c.active ? "Ativa" : "Inativa"}
              </summary>
              <p>
                Conta:{" "}
                {options.accounts.find((a) => a.id === c.account_id)?.name} ·
                referência {c.reference}
              </p>
              <p>
                Contrato operacional:{" "}
                {options.contracts.find((x) => x.id === c.contract_id)
                  ?.reference ?? "Não vinculado"}
                . O vínculo identifica o cliente/contrato; não comprova
                aquisição ou receita publicitária. Valores de contratos da ION
                não são importados como resultados.
              </p>
              {c.contract_id && (
                <Link href={"/clients/" + c.company_id}>
                  Consultar cliente e serviços conforme suas permissões
                </Link>
              )}
              {options.companies.some(
                (x) => x.id === c.company_id && x.can_write,
              ) && <CampaignForm options={options} campaign={c} />}
            </details>
          ))}
        </section>
      )}
      {view === "reports" && (
        <>
          <section className="panel padded">
            <h2>Gerar relatório de desempenho</h2>
            <p>
              O relatório congela os dados reais e suas fontes. Semanal, mensal
              ou personalizado conforme os filtros acima. Nenhum relatório é
              publicado automaticamente.
            </p>
            {canWrite ? (
              <form className="form-grid" action={createAnalyticsReport}>
                {Object.entries(filters)
                  .filter(([k]) => k !== "company_id" && k !== "month")
                  .map(([k, v]) => (
                    <input
                      key={k}
                      type="hidden"
                      name={k}
                      value={String(v ?? "")}
                    />
                  ))}
                <Select
                  label="Cliente do relatório"
                  name="company_id"
                  required
                  value={selectedCompany}
                >
                  <option value="">Selecione</option>
                  {options.companies
                    .filter((c) => c.can_write)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
                <Field name="title" label="Título do relatório" />
                <Submit>Gerar relatório com dados reais</Submit>
              </form>
            ) : (
              <Empty>
                Sua permissão permite consultar os relatórios, sem gerar novos
                registros.
              </Empty>
            )}
          </section>
          <section className="panel padded">
            <h2>Histórico de relatórios</h2>
            {reports.length ? (
              reports.map((r) => (
                <div className="team-row" key={r.id}>
                  <div>
                    <Link href={"/analytics/reports/" + r.id}>
                      <strong>{r.title}</strong>
                    </Link>
                    <small>
                      {r.period_from} a {r.period_to} · gerado em{" "}
                      {new Date(r.created_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </small>
                  </div>
                  <span className="badge">
                    {r.published ? "Publicado" : "Interno"}
                  </span>
                  <Link
                    className="button"
                    href={"/analytics/reports/" + r.id + "/pdf"}
                  >
                    Baixar PDF
                  </Link>
                </div>
              ))
            ) : (
              <Empty>Nenhum relatório neste período.</Empty>
            )}
          </section>
        </>
      )}
      {view === "publication" && admin && (
        <>
          <section className="panel padded">
            <h2>Publicação controlada para parceiros</h2>
            <p>
              Primeiro autorize o portal do cliente em Clientes e Serviços.
              Publique a campanha e escolha os indicadores; depois publique os
              registros conferidos. Relatórios são autorizados separadamente.
              Indicadores derivados exigem autorização das medidas de origem
              para evitar inferências de valores ocultos. Alterações ou
              revogações invalidam os relatórios afetados.
            </p>
            {campaigns.map((c) => (
              <details key={c.id}>
                <summary>
                  {c.name} ·{" "}
                  {c.published ? "Campanha publicada" : "Campanha interna"}
                </summary>
                <ConfirmedAdminForm
                  action={publishCampaign}
                  confirmation="Alterar indicadores públicos desta campanha e revogar relatórios afetados?"
                  submitLabel="Atualizar publicação da campanha"
                >
                  <input type="hidden" name="id" value={c.id} />
                  <Select
                    name="published"
                    label="Visibilidade da campanha"
                    value={String(c.published)}
                  >
                    <option value="false">Interna / revogada</option>
                    <option value="true">Publicar no portal</option>
                  </Select>
                  <div>
                    <p>Indicadores autorizados</p>
                    {metricKeys.map((k) => (
                      <label
                        key={k}
                        className="small"
                        style={{ display: "block" }}
                      >
                        <input
                          type="checkbox"
                          name="metrics"
                          value={k}
                          defaultChecked={c.published_metrics.includes(k)}
                          style={{
                            width: "auto",
                            minHeight: 0,
                            marginRight: 8,
                          }}
                        />
                        {metricDefinitions[k].label}
                      </label>
                    ))}
                  </div>
                  <Field
                    name="reason"
                    label="Motivo da alteração de visibilidade"
                  />
                </ConfirmedAdminForm>
                <h3>Registros reais autorizados</h3>
                <ConfirmedAdminForm
                  action={publishMetrics}
                  confirmation="Alterar a publicação dos resultados deste período?"
                  submitLabel="Atualizar publicação dos resultados"
                >
                  <input type="hidden" name="campaign_id" value={c.id} />
                  <Field
                    name="from"
                    label="Publicar registros desde"
                    type="date"
                    value={filters.from}
                  />
                  <Field
                    name="to"
                    label="Publicar registros até"
                    type="date"
                    value={filters.to}
                  />
                  <Select name="published" label="Visibilidade dos registros">
                    <option value="true">Publicar dados conferidos</option>
                    <option value="false">Revogar dados</option>
                  </Select>
                  <Field
                    name="reason"
                    label="Motivo da conferência / revogação"
                  />
                </ConfirmedAdminForm>
              </details>
            ))}
          </section>
          <section className="panel padded">
            <h2>Publicação de relatórios</h2>
            {reports.map((r) => (
              <details key={r.id}>
                <summary>
                  {r.title} · {r.published ? "Publicado" : "Interno"}
                </summary>
                <ConfirmedAdminForm
                  action={publishReport}
                  confirmation="Alterar a publicação deste relatório? Somente indicadores e registros já autorizados serão incluídos."
                  submitLabel="Atualizar publicação do relatório"
                >
                  <input type="hidden" name="id" value={r.id} />
                  <Select
                    name="published"
                    label="Visibilidade do relatório"
                    value={String(r.published)}
                  >
                    <option value="true">Publicar relatório conferido</option>
                    <option value="false">Ocultar / revogar relatório</option>
                  </Select>
                  <Field
                    name="reason"
                    label="Motivo da publicação / revogação"
                  />
                </ConfirmedAdminForm>
              </details>
            ))}
          </section>
          <section className="panel padded">
            <h2>Histórico de visibilidade e alterações</h2>
            <p className="muted">
              Selecione um cliente no filtro. As auditorias preservam autor,
              data, operação e estados anteriores/posteriores; relatórios usam
              hashes do conteúdo imutável.
            </p>
            {selectedCompany &&
              (history.data ?? []).map(
                (
                  h: {
                    id: string;
                    entity_id: string;
                    at: string;
                    actor: string;
                    action: string;
                    entity: string;
                    reason: string;
                    published_before: boolean;
                    published_after: boolean;
                  },
                  i: number,
                ) => (
                  <p key={i}>
                    {new Date(h.at).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                    })}{" "}
                    · {h.actor ?? "Autor indisponível"} ·{" "}
                    {h.entity === "ana_metrics" ? (
                      <Link href={"/analytics/metrics/" + h.entity_id}>
                        Resultado corrigido
                      </Link>
                    ) : (
                      h.entity
                    )}{" "}
                    · {h.action} · {h.reason}{" "}
                    {typeof h.published_before === "boolean" ||
                    typeof h.published_after === "boolean"
                      ? `· ${h.published_before ? "Publicado" : "Interno"} → ${h.published_after ? "Publicado" : "Interno"}`
                      : ""}
                  </p>
                ),
              )}
            <div className="crm-actions">
              {selectedCompany && page > 1 && (
                <Link
                  className="button"
                  href={next({ page: String(page - 1) })}
                >
                  Histórico anterior
                </Link>
              )}
              {selectedCompany && (history.data ?? []).length === 50 && (
                <Link
                  className="button"
                  href={next({ page: String(page + 1) })}
                >
                  Histórico mais antigo
                </Link>
              )}
            </div>
          </section>
        </>
      )}
      {view === "access" && admin && (
        <section className="panel padded">
          <h2>Permissões por colaborador e cliente</h2>
          <p>
            Gestores de tráfego acessam apenas clientes atribuídos. Outros
            colaboradores precisam de concessão explícita e de vínculo
            operacional vigente. Parceiros não podem receber permissão de edição
            de Analytics.
          </p>
          <form action={saveAnalyticsGrant} className="form-grid">
            <Select name="company_id" label="Cliente da permissão" required>
              <option value="">Selecione</option>
              {options.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select name="profile_id" label="Colaborador autorizado" required>
              <option value="">Selecione</option>
              {options.people.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select name="can_write" label="Nível de acesso">
              <option value="false">Somente consulta</option>
              <option value="true">Consultar e registrar resultados</option>
            </Select>
            <Select name="active" label="Concessão">
              <option value="true">Ativa</option>
              <option value="false">Revogar concessão</option>
            </Select>
            <Field name="reason" label="Motivo da permissão" />
            <Submit>Salvar permissão de Analytics</Submit>
          </form>
          {options.grants.map((g) => (
            <p key={g.company_id + g.profile_id}>
              {options.companies.find((c) => c.id === g.company_id)?.name} ·{" "}
              {options.people.find((p) => p.id === g.profile_id)?.name ??
                "Colaborador inativo"}{" "}
              ·{" "}
              {g.active
                ? g.can_write
                  ? "Consulta e registro"
                  : "Somente consulta"
                : "Revogada"}
            </p>
          ))}
        </section>
      )}
      {view === "integrations" && (
        <section className="panel padded">
          <h2>Integrações oficiais</h2>
          {(["meta", "google"] as const).map((provider) => (
            <div key={provider}>
              <h3>{platforms[provider]} · desativada</h3>
              <p>{integrationStatus[provider].reason}</p>
            </div>
          ))}
          <p>
            Cadastro manual e CSV são identificados como tais. Contas registram
            cliente, campanha, fuso, moeda e atribuição. Nenhuma chamada
            automática, scraping ou resultado estimado é utilizado.
          </p>
        </section>
      )}
    </>
  );
}
