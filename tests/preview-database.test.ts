import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPreviewDatabase } from "../next.config";
const staging = {
  VERCEL_ENV: "preview",
  ION_OS_PREVIEW_SUPABASE_PROJECT_REF: "stagingtestproject",
  NEXT_PUBLIC_SUPABASE_URL: "https://stagingtestproject.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only-public-key",
};
test("preview exige seleção explícita de homologação e correspondência de URL", () => {
  assert.doesNotThrow(() => verifyPreviewDatabase(staging));
  assert.throws(
    () =>
      verifyPreviewDatabase({
        ...staging,
        ION_OS_PREVIEW_SUPABASE_PROJECT_REF: undefined,
      }),
    /Preview bloqueado/,
  );
  assert.throws(
    () =>
      verifyPreviewDatabase({
        ...staging,
        NEXT_PUBLIC_SUPABASE_URL: "https://otherproject.supabase.co",
      }),
    /Preview bloqueado/,
  );
  assert.throws(
    () =>
      verifyPreviewDatabase({
        ...staging,
        NEXT_PUBLIC_SUPABASE_URL: "http://stagingtestproject.supabase.co",
      }),
    /Preview bloqueado/,
  );
  assert.throws(
    () =>
      verifyPreviewDatabase({
        ...staging,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      }),
    /Preview bloqueado/,
  );
});
test("verificação não altera produção nem desenvolvimento local", () => {
  assert.doesNotThrow(() =>
    verifyPreviewDatabase({ VERCEL_ENV: "production" }),
  );
  assert.doesNotThrow(() => verifyPreviewDatabase({}));
});
