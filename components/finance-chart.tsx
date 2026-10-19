import { cents, brl, type Daily } from "@/lib/finance";
export function FinanceChart({
  days,
  monthly = false,
}: {
  days: Daily[];
  monthly?: boolean;
}) {
  const grouped = new Map<
    string,
    {
      income: bigint;
      expense: bigint;
      expected_income: bigint;
      expected_expense: bigint;
    }
  >();
  for (const d of days) {
    const key = monthly ? d.day.slice(0, 7) : d.day;
    const row = grouped.get(key) ?? {
      income: 0n,
      expense: 0n,
      expected_income: 0n,
      expected_expense: 0n,
    };
    for (const k of [
      "income",
      "expense",
      "expected_income",
      "expected_expense",
    ] as const)
      row[k] += cents(d[k]);
    grouped.set(key, row);
  }
  const rows = [...grouped];
  const max = rows.reduce(
    (a, [, r]) =>
      [r.income, r.expense, r.expected_income, r.expected_expense].reduce(
        (m, n) => (n < 0n ? (-n > m ? -n : m) : n > m ? n : m),
        a,
      ),
    1n,
  );
  return (
    <section className="panel padded">
      <h2>Evolução de receitas, despesas e caixa</h2>
      <p className="muted">
        Linhas contínuas: realizado. Linhas pontilhadas: saldo ainda previsto
        nos vencimentos. Estornos podem produzir valores negativos. Saldo do
        período não representa saldo bancário.
      </p>
      <svg
        viewBox="0 0 800 250"
        width="100%"
        role="img"
        aria-label="Evolução do caixa realizado e previsto; valores exatos na tabela de fluxo de caixa"
      >
        <line x1="20" y1="125" x2="780" y2="125" stroke="var(--line)" />
        {(
          ["income", "expense", "expected_income", "expected_expense"] as const
        ).map((k, i) => (
          <polyline
            key={k}
            fill="none"
            stroke={i % 2 === 0 ? "var(--accent)" : "var(--muted)"}
            strokeWidth="3"
            strokeDasharray={i > 1 ? "7 5" : undefined}
            points={rows
              .map(
                ([, r], n) =>
                  `${20 + (n * 760) / Math.max(1, rows.length - 1)},${125 - Number((r[k] * 10000n) / max) / 100}`,
              )
              .join(" ")}
          />
        ))}
      </svg>
      <p className="small">
        Cor de destaque: entradas · cinza: saídas. Realizado líquido:{" "}
        {brl(decimal(rows.reduce((n, [, r]) => n + r.income - r.expense, 0n)))}
      </p>
    </section>
  );
}
function decimal(n: bigint) {
  return (
    (n < 0n ? "-" : "") +
    String((n < 0n ? -n : n) / 100n) +
    "." +
    String((n < 0n ? -n : n) % 100n).padStart(2, "0")
  );
}
