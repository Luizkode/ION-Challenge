import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registrationBlockers,
  meetingSchema,
} from "../lib/meeting-registration";
const campaign = {
  id: "30000000-0000-0000-0000-000000000001",
  state: "active",
  starts_at: "2026-10-01T00:00:00Z",
  ends_at: "2026-11-01T00:00:00Z",
};
test("requisitos do cadastro: ativo, time e closer", () => {
  assert.deepEqual(
    registrationBlockers(campaign, true, 1, Date.parse("2026-10-08T12:00:00Z")),
    [],
  );
  assert.equal(
    registrationBlockers(campaign, false, 0, Date.parse("2026-10-08T12:00:00Z"))
      .length,
    2,
  );
  assert.match(registrationBlockers(null, true, 1)[0], /não está ativa/);
});
test("data inválida é rejeitada antes da chamada RPC e telefone é normalizado", () => {
  const data = {
    campaign_id: campaign.id,
    company: "Empresa",
    contact: "Maria",
    phone: "(11) 99999-9999",
    city: "São Paulo",
    niche: "Serviços",
    closer_id: "10000000-0000-0000-0000-000000000002",
    scheduled_at: "2026-10-09T12:00:00-03:00",
    sdr_id: "fraud",
    points: 7,
  };
  assert.equal(
    meetingSchema.safeParse({ ...data, scheduled_at: "invalid" }).success,
    false,
  );
  const parsed = meetingSchema.parse(data);
  assert.equal(parsed.phone, "11999999999");
  assert.equal(parsed.notes, "");
  assert(!("sdr_id" in parsed));
  assert(!("points" in parsed));
});
