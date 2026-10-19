import {
  metricDefinitions,
  formatMetric,
  type Snapshot,
  type MetricKey,
} from "@/lib/analytics";
function scaled(v: string) {
  const [a, b = ""] = v.split(".");
  return BigInt(a) * 1_000_000n + BigInt(b.padEnd(6, "0").slice(0, 6));
}
export function AnalyticsChart({
  snapshot: s,
  metric = "spend",
}: {
  snapshot: Snapshot;
  metric?: MetricKey;
}) {
  const cohorts = [...new Set(s.points.map((p) => p.account_id))];
  const start = Date.parse(s.from),
    span = Math.max(86400000, Date.parse(s.to) - start);
  const position = (date: string) =>
    20 + 720 * Math.max(0, Math.min(1, (Date.parse(date) - start) / span));
  const max = s.points.reduce((m, p) => {
    const value = p.stats[metric];
    if (value === null || value === undefined) return m;
    const n = scaled(value);
    return n > m ? n : m;
  }, 1n);
  return (
    <section className="panel padded">
      <h2>Evolução · {metricDefinitions[metric].label}</h2>
      {s.record_count ? (
        <>
          <svg
            viewBox="0 0 760 260"
            width="100%"
            role="img"
            aria-label={
              "Evolução por observação real de " +
              metricDefinitions[metric].label +
              ". Os valores exatos estão nas tabelas."
            }
          >
            <line x1="20" y1="220" x2="740" y2="220" stroke="var(--line)" />
            {cohorts.map((id, index) => {
              const points = s.points.filter((p) => p.account_id === id);
              return (
                <g key={id}>
                  {points.map((p, n) => {
                    const value = p.stats[metric];
                    if (value === null || value === undefined) return null;
                    const x = position(p.to),
                      y = 220 - Number((scaled(value) * 19000n) / max) / 100;
                    const prev = points[n - 1]?.stats[metric];
                    const px = position(points[n - 1]?.to ?? p.to),
                      py =
                        prev === null || prev === undefined
                          ? y
                          : 220 - Number((scaled(prev) * 19000n) / max) / 100;
                    return (
                      <g key={p.from + p.to}>
                        {n > 0 && prev !== null && prev !== undefined && (
                          <line
                            x1={px}
                            y1={py}
                            x2={x}
                            y2={y}
                            stroke={
                              index % 2 ? "var(--muted)" : "var(--accent)"
                            }
                            strokeWidth="2"
                            strokeDasharray={index % 2 ? "5 3" : undefined}
                          />
                        )}
                        <circle
                          cx={x}
                          cy={y}
                          r="3"
                          fill={index % 2 ? "var(--muted)" : "var(--accent)"}
                        >
                          <title>
                            {p.account} · {p.from} a {p.to}:{" "}
                            {formatMetric(metric, value)}
                          </title>
                        </circle>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <p className="small muted">
            Cada ponto é um período efetivamente observado; não há rateio
            diário, preenchimento de lacunas ou soma de alcance. Séries por
            conta; limites cronológicos: {s.from} a {s.to}.
          </p>
          {s.groups.map((g, i) => (
            <p className="small" key={g.account_id}>
              {i + 1}. {g.account} · {g.attribution} · {g.time_zone}
            </p>
          ))}
        </>
      ) : (
        <p className="muted">Sem resultados disponíveis para este período.</p>
      )}
    </section>
  );
}
