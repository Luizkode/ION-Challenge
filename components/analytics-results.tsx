import {
  formatMetric,
  metricKeys,
  metricDefinitions,
  platforms,
  sourceLabels,
  type Snapshot,
  type MetricKey,
} from "@/lib/analytics";
import { AnalyticsChart } from "./analytics-chart";
import { Empty } from "./ui";
export function AnalyticsResults({
  snapshot: s,
  metric = "spend",
  onlyMetric = false,
}: {
  snapshot: Snapshot;
  metric?: MetricKey;
  onlyMetric?: boolean;
}) {
  if (s.record_count && !s.points.some((p) => Object.hasOwn(p.stats, metric)))
    metric =
      metricKeys.find((k) => s.points.some((p) => Object.hasOwn(p.stats, k))) ??
      metric;
  const keys = (onlyMetric ? [metric] : metricKeys).filter((k) =>
    Object.prototype.hasOwnProperty.call(s.stats, k),
  );
  return (
    <>
      {s.partial_count > 0 && (
        <p className="notice" role="status">
          {s.partial_count} observação(ões) cruza(m) os limites do filtro e
          foi(ram) excluída(s), sem rateio. Selecione o período original para
          incluí-las.
        </p>
      )}
      {s.record_count ? (
        <>
          <div className="stats">
            {keys.map((k) => (
              <div className="stat" key={k}>
                <span title={metricDefinitions[k].definition}>
                  {metricDefinitions[k].label}
                </span>
                <strong>{formatMetric(k, s.stats[k])}</strong>
                {s.comparison && (
                  <small>
                    Anterior: {formatMetric(k, s.comparison.stats[k])}
                    {s.comparison_change?.changes[k]?.percent !== null &&
                    s.comparison_change?.changes[k]?.percent !== undefined
                      ? " · " + s.comparison_change.changes[k]!.percent + "%"
                      : " · sem base comparável"}
                  </small>
                )}
              </div>
            ))}
          </div>
          <p className="table-note">
            {s.record_count} observação(ões) real(is). {s.methodology}
          </p>
          {s.comparison && (
            <p className="small muted">
              Comparação: {s.comparison.from} a {s.comparison.to} ·{" "}
              {s.comparison.record_count} observação(ões).{" "}
              {s.comparison_change?.compatible
                ? "Mesmas contas de origem; variações calculadas somente quando as duas medidas são conhecidas."
                : "Fontes diferentes ou ausência de dados: não há variação percentual comparável."}
            </p>
          )}
          <AnalyticsChart snapshot={s} metric={metric} />
          <section className="panel padded">
            <h2>Desempenho por conta e metodologia</h2>
            {s.groups.map((g) => (
              <details key={g.account_id}>
                <summary>
                  {g.account} · {platforms[g.platform]} · {g.attribution} ·{" "}
                  {g.time_zone}
                </summary>
                <div className="stats">
                  {(onlyMetric ? [metric] : metricKeys)
                    .filter((k) => Object.hasOwn(g.stats, k))
                    .map((k) => (
                      <div className="stat" key={k}>
                        <span>{metricDefinitions[k].label}</span>
                        <strong>{formatMetric(k, g.stats[k])}</strong>
                      </div>
                    ))}
                </div>
              </details>
            ))}
          </section>
          <section className="panel padded">
            <h2>Observações da evolução</h2>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Tabela com rolagem horizontal"
            >
              <table>
                <thead>
                  <tr>
                    <th>Conta / fonte</th>
                    <th>Período observado</th>
                    <th>{metricDefinitions[metric].label}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.points.map((p, i) => (
                    <tr key={i}>
                      <td>
                        {p.account} · {platforms[p.platform]}
                      </td>
                      <td>
                        {p.from} a {p.to}
                      </td>
                      <td>{formatMetric(metric, p.stats[metric])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel padded">
            <details>
              <summary>Fontes e última atualização</summary>
              {s.sources.map((r, i) => (
                <p key={i}>
                  {r.campaign} · {platforms[r.platform]} ·{" "}
                  {sourceLabels[r.source_kind]} · {r.period_from} a{" "}
                  {r.period_to} · atualizado em{" "}
                  {new Date(r.updated_at).toLocaleString("pt-BR", {
                    timeZone: "America/Sao_Paulo",
                  })}
                  {r.source_reference && (
                    <>
                      <br />
                      Origem: {r.source_reference} · responsável:{" "}
                      {r.author ?? "Não disponível"}
                    </>
                  )}
                </p>
              ))}
            </details>
          </section>
        </>
      ) : (
        <Empty>
          Nenhum resultado real disponível ou autorizado neste período. Valores
          ausentes não são substituídos por zero.
        </Empty>
      )}
    </>
  );
}
