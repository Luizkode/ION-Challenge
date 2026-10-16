type DashboardPeriod = {
  from: string;
  to: string;
  start: string;
  end: string;
  error?: string;
};
export function dashboardPeriod(
  input: { from?: string; to?: string },
  now = new Date(),
): DashboardPeriod {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s + "T12:00:00Z")) &&
    new Date(s + "T12:00:00Z").toISOString().slice(0, 10) === s;
  const from = input.from ?? today.slice(0, 8) + "01",
    to = input.to ?? today;
  if (!valid(from) || !valid(to) || from > to)
    return {
      ...dashboardPeriod({}, now),
      error: "Informe um período válido, com início anterior ou igual ao fim.",
    };
  return {
    from,
    to,
    start: from + "T00:00:00-03:00",
    end: new Date(Date.parse(to + "T00:00:00-03:00") + 86400000).toISOString(),
    error: undefined as string | undefined,
  };
}
export function commercialSummary(
  meetings: { status: string; opportunity_id: string }[],
  contracts?: { opportunity_id: string }[],
) {
  const held = new Set(
    meetings
      .filter((m) => ["held", "qualified"].includes(m.status))
      .map((m) => m.opportunity_id),
  );
  const converted = new Set(
    contracts
      ?.filter((c) => held.has(c.opportunity_id))
      .map((c) => c.opportunity_id),
  );
  return {
    scheduled: meetings.filter((m) =>
      ["scheduled", "pending"].includes(m.status),
    ).length,
    held: meetings.filter((m) => ["held", "qualified"].includes(m.status))
      .length,
    contracts: contracts?.length,
    conversion:
      contracts === undefined
        ? undefined
        : held.size
          ? (converted.size / held.size) * 100
          : undefined,
  };
}
