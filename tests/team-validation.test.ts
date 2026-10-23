import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAccess,
  invitationError,
  teamDatabaseError,
  accessForm,
} from "../lib/access-input";
function form(extra: Record<string, string | string[]> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    name: "Pessoa de teste",
    category: "employee",
    active: "true",
    functions: ["sdr"],
    reason: "Configuração autorizada",
    confirm: "true",
    ...extra,
  }))
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
test("Team validation identifies the actual fields and preserves role rules", () => {
  const missing = validateAccess(
    form({
      name: "X",
      reason: "Teste",
      functions: [],
      confirm: "false",
      email: "errado",
    }),
    "invite",
  );
  assert.deepEqual(Object.keys(missing.fields).sort(), [
    "confirm",
    "email",
    "functions",
    "name",
    "reason",
  ]);
  assert.match(missing.fields.reason[0], /8 caracteres/);
  assert.equal(
    validateAccess(form({ category: "partner", functions: [] }), "invite")
      .fields.company_ids.length,
    1,
  );
  assert.equal(validateAccess(form(), "link").fields.id.length, 1);
  const promotion = validateAccess(
    form({
      id: "10000000-0000-0000-0000-000000000001",
      category: "admin",
      company_ids: ["90000000-0000-0000-0000-000000000001"],
    }),
    "edit",
  );
  assert(promotion.input.success);
  if (promotion.input.success) {
    assert.deepEqual(promotion.input.data.functions, []);
    assert.deepEqual(promotion.input.data.company_ids, []);
  }
});
test("Team errors distinguish campaign restriction, expired session, duplicate, SMTP and rate limit", () => {
  assert(
    teamDatabaseError({
      code: "P0001",
      message: "Selecione remover da campanha ao retirar a função SDR",
    }).fields.remove_from_campaign,
  );
  assert.equal(teamDatabaseError({ code: "42501" }).kind, "permission");
  assert(invitationError({ code: "email_exists" }).fields.email);
  const smtp = invitationError({ code: "email_address_not_authorized" });
  assert.equal(smtp.kind, "infrastructure");
  assert.match(smtp.message, /SMTP próprio/);
  assert.match(invitationError({ status: 429 }).message, /limite/);
  assert(
    !invitationError({ message: "private-token-example" }).message.includes(
      "private-token-example",
    ),
  );
});
test("Form normalization never converts admin into an operational role or auto-removes campaign history", () => {
  assert.deepEqual(accessForm(form({ category: "admin" })).functions, []);
  assert.equal(accessForm(form()).remove_from_campaign, "false");
  assert.equal(
    accessForm(form({ remove_from_campaign: "true" })).remove_from_campaign,
    "true",
  );
});
