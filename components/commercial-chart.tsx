export function CommercialChart({
  scheduled,
  held,
  contracts,
}: {
  scheduled: number;
  held: number;
  contracts?: number;
}) {
  const values = [
    { label: "Agendadas", value: scheduled },
    { label: "Realizadas", value: held },
    ...(contracts === undefined
      ? []
      : [{ label: "Contratos", value: contracts }]),
  ];
  const max = Math.max(1, ...values.map((v) => v.value));
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Atividade comercial no período</h2>
      </div>
      <div className="padded">
        <svg
          role="img"
          aria-label={values.map((v) => `${v.label}: ${v.value}`).join(". ")}
          viewBox={`0 0 540 ${values.length * 48}`}
          width="100%"
          style={{ maxHeight: 190 }}
        >
          {values.map((v, i) => (
            <g key={v.label}>
              <text x="0" y={i * 48 + 24} fill="var(--muted)" fontSize="12">
                {v.label}
              </text>
              <rect
                x="105"
                y={i * 48 + 10}
                width="385"
                height="18"
                rx="3"
                fill="var(--line)"
              />
              <rect
                x="105"
                y={i * 48 + 10}
                width={(v.value / max) * 385}
                height="18"
                rx="3"
                fill="var(--accent)"
              />
              <text x="510" y={i * 48 + 24} fill="var(--text)" fontSize="12">
                {v.value}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
