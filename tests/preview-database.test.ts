import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPreviewDatabase } from "../lib/preview-database";
const legacyKey = (role: string, ref = "stagingproject") =>
  "test." + Buffer.from(JSON.stringify({ role, ref })).toString("base64url") + ".test-signature";

const staging = {
  VERCEL_ENV: "preview",
  ION_OS_PREVIEW_SUPABASE_PROJECT_REF: "stagingproject",
  NEXT_PUBLIC_SUPABASE_URL: "https://stagingproject.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("anon"),
};
test("Preview exige escolha explícita do banco e bloqueia URL herdada de produção", () => {
  assert.doesNotThrow(() => verifyPreviewDatabase(staging));
  for (const overrides of [
    { ION_OS_PREVIEW_SUPABASE_PROJECT_REF: undefined },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://productionproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://stagingproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@stagingproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://stagingproject.supabase.co/rest/v1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://stagingproject.supabase.co?key=value" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://stagingproject.supabase.co:444" },
    { NEXT_PUBLIC_SUPABASE_URL: "invalid" },
    { ION_OS_PREVIEW_SUPABASE_PROJECT_REF: "../production" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("anon", "productionproject") },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "invalid" },
  ]) assert.throws(() => verifyPreviewDatabase({ ...staging, ...overrides }), /Preview bloqueado/);
});
test("chave administrativa nunca pode ser publicada como chave pública", () => {
  for (const key of ["sb_secret_test_only", legacyKey("service_role")]) {
    assert.throws(() => verifyPreviewDatabase({ NEXT_PUBLIC_SUPABASE_ANON_KEY: key }), /Chave administrativa bloqueada/);
  }
  assert.doesNotThrow(() => verifyPreviewDatabase({ ...staging, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_only" }));
});
test("trava de Preview preserva desenvolvimento e produção", () => {
  assert.doesNotThrow(() => verifyPreviewDatabase({}));
  assert.doesNotThrow(() => verifyPreviewDatabase({ VERCEL_ENV: "production" }));
});
