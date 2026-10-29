import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recoveryCallback,
  recoveryEmail,
  recoveryNotice,
} from "../lib/auth-recovery";

test("recuperação usa somente origem confiável configurada no servidor", () => {
  assert.equal(
    recoveryCallback({
      ION_OS_APP_URL: "https://ion-challenge-eight.vercel.app",
      VERCEL_ENV: "production",
    }),
    "https://ion-challenge-eight.vercel.app/auth/callback",
  );
  assert.equal(
    recoveryCallback({
      VERCEL_URL: "preview.vercel.app",
      VERCEL_ENV: "preview",
    }),
    "https://preview.vercel.app/auth/callback",
  );
  assert.equal(
    recoveryCallback({ ION_OS_APP_URL: "http://localhost:3100" }),
    "http://localhost:3100/auth/callback",
  );
  for (const value of [
    "https://user:password@example.com",
    "https://example.com/?next=evil",
    "https://example.com/#token",
    "https://example.com/path",
    "javascript:alert(1)",
    "http://example.com",
    "not-a-url",
  ])
    assert.equal(recoveryCallback({ ION_OS_APP_URL: value }), null);
  assert.equal(
    recoveryCallback({
      ION_OS_APP_URL: "http://localhost:3100",
      VERCEL_ENV: "production",
    }),
    null,
  );
  assert.equal(
    recoveryCallback({
      ION_OS_APP_URL: "https://localhost",
      VERCEL_ENV: "production",
    }),
    null,
  );
  assert.equal(recoveryCallback({}), null);
});

test("email de recuperação é validado e a mensagem não comprova envio nem existência da conta", () => {
  assert.equal(recoveryEmail.parse(" admin@example.com "), "admin@example.com");
  assert.equal(recoveryEmail.safeParse("not-email").success, false);
  assert.equal(
    recoveryEmail.safeParse(new File([], "email.txt")).success,
    false,
  );
  assert.match(recoveryNotice, /Se este email tiver uma conta/);
  assert.match(recoveryNotice, /envio for autorizado/);
  assert.doesNotMatch(recoveryNotice, /email enviado|conta encontrada/i);
});
