import { test, expect, type Page } from "@playwright/test";
const stateUrl = "http://127.0.0.1:3101/__test/state";
async function requestRecovery(page: Page, email: string) {
  await page.goto("/login?recovery=1");
  await page.getByLabel("Email profissional").fill(email);
  await page.getByRole("button", { name: "Solicitar recuperação" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Solicitação processada.",
  );
  return {
    url: page.url(),
    notice: await page.getByRole("status").textContent(),
  };
}
test.beforeEach(async ({ request }) => {
  await request.post(stateUrl, { data: { mode: "active" } });
});

test("login oferece recuperação e solicita Auth sem criar sessão ou conceder permissões", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Esqueci minha senha" }).click();
  await expect(
    page.getByRole("heading", { name: "Recupere seu acesso." }),
  ).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toHaveCount(0);
  const result = await requestRecovery(page, "admin@ion.test");
  expect(result.url).not.toContain("admin@ion.test");
  const state = await (await request.get(stateUrl)).json();
  expect(state.recovery_requests).toEqual([
    {
      email: "admin@ion.test",
      redirect_to: "http://localhost:3100/auth/callback",
      pkce: true,
    },
  ]);
  expect(state.invitations).toHaveLength(0);
  expect(state.requests).toHaveLength(0);
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login$/);
});

test("conta conhecida, conta desconhecida e falha do serviço têm a mesma resposta pública", async ({
  page,
  request,
}) => {
  const known = await requestRecovery(page, "admin@ion.test");
  const unknown = await requestRecovery(page, "unknown@ion.test");
  await request.post(stateUrl, { data: { mode: "recovery_error" } });
  const unavailable = await requestRecovery(page, "admin@ion.test");
  expect(unknown).toEqual(known);
  expect(unavailable).toEqual(known);
  await page.getByRole("link", { name: "Voltar para entrar" }).click();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
});

test("servidor rejeita email inválido antes de chamar Auth mesmo sem validação nativa", async ({
  page,
  request,
}) => {
  await page.goto("/login?recovery=1");
  await page.getByLabel("Email profissional").fill("invalid-email");
  await page.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
  await page.getByRole("button", { name: "Solicitar recuperação" }).click();
  await expect(page.locator(".notice.error[role=alert]")).toContainText(
    "Informe um email válido",
  );
  expect(
    (await (await request.get(stateUrl)).json()).recovery_requests,
  ).toHaveLength(0);
});

test("callback não referencia tokens em navegações seguintes nem permite cache", async ({
  request,
}) => {
  const response = await request.get(
    "/auth/callback?type=recovery&token_hash=invalid-test-token",
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(307);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers().location).not.toContain("token_hash");
});
