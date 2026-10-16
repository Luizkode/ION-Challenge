import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySupabaseConfiguration } from "../lib/supabase-config";
const legacyKey = (role: string, ref = "existingproject") =>
  "test." + Buffer.from(JSON.stringify({ role, ref })).toString("base64url") + ".test-signature";
const current = {
  NEXT_PUBLIC_SUPABASE_URL: "https://existingproject.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: legacyKey("anon"),
};
test("Preview e Production reutilizam o mesmo projeto, sem Project Ref adicional", () => {
  for (const VERCEL_ENV of ["preview", "production"]) {
    assert.doesNotThrow(() => verifySupabaseConfiguration({ ...current, VERCEL_ENV }));
    assert.doesNotThrow(() => verifySupabaseConfiguration({ ...current, VERCEL_ENV, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_only" }));
  }
});
test("configuração remota rejeita chaves/URLs incoerentes sem expor valores", () => {
  for (const overrides of [
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "https://otherproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "http://existingproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@existingproject.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://existingproject.supabase.co/rest/v1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://existingproject.supabase.co?key=value" },
    { NEXT_PUBLIC_SUPABASE_URL: "invalid" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "invalid" },
  ]) assert.throws(() => verifySupabaseConfiguration({ ...current, VERCEL_ENV: "preview", ...overrides }), /Configuração Supabase inválida/);
});
test("chave administrativa nunca pode ser publicada como chave pública", () => {
  for (const key of ["sb_secret_test_only", legacyKey("service_role")]) {
    assert.throws(() => verifySupabaseConfiguration({ NEXT_PUBLIC_SUPABASE_ANON_KEY: key }), /Chave administrativa bloqueada/);
  }
});
test("desenvolvimento sem configuração ou com fixture local não exige infraestrutura extra", () => {
  assert.doesNotThrow(() => verifySupabaseConfiguration({}));
  assert.doesNotThrow(() => verifySupabaseConfiguration({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3101", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-public-key" }));
});
