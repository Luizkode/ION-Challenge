import { test } from "node:test";
import assert from "node:assert/strict";
import { osModules, canAccessModule } from "../lib/os-modules";
import { dashboardPeriod, commercialSummary } from "../lib/os-dashboard";
test("nove módulos com permissões restritivas por função atual", () => {
  assert.equal(osModules.length, 9);
  assert(osModules.every((m) => canAccessModule(m.id, "admin")));
  for (const role of ["sdr", "closer"] as const) {
    assert(canAccessModule("dashboard", role));
    assert(canAccessModule("crm", role));
    assert(canAccessModule("challenger", role));
    for (const id of [
      "finance",
      "partners",
      "settings",
      "team",
      "clients",
      "analytics",
    ])
      assert(!canAccessModule(id, role));
  }
  assert(!canAccessModule("unknown", "admin"));
});
test("período usa data de Brasília, rejeita datas inválidas e inclui todo dia final", () => {
  const now = new Date("2026-10-13T01:00:00Z");
  const p = dashboardPeriod({}, now);
  assert.equal(p.from, "2026-10-01");
  assert.equal(p.to, "2026-10-12");
  assert.equal(p.end, "2026-10-13T03:00:00.000Z");
  assert(dashboardPeriod({ from: "2026-02-30" }, now).error);
  assert(dashboardPeriod({ from: "2026-10-15", to: "2026-10-01" }, now).error);
});
test("indicadores separam agendamento de resultado e deduplicam conversão por oportunidade", () => {
  const meetings = [
    { status: "scheduled", opportunity_id: "a" },
    { status: "held", opportunity_id: "b" },
    { status: "qualified", opportunity_id: "b" },
    { status: "cancelled", opportunity_id: "c" },
  ];
  const s = commercialSummary(meetings, [{ opportunity_id: "b" }]);
  assert.equal(s.scheduled, 1);
  assert.equal(s.held, 2);
  assert.equal(s.contracts, 1);
  assert.equal(s.conversion, 100);
  const restricted = commercialSummary(meetings);
  assert.equal(restricted.contracts, undefined);
  assert.equal(restricted.conversion, undefined);
  assert.equal(commercialSummary([], []).conversion, undefined);
});
