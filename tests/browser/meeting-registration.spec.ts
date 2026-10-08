import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "sdr") {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION Challenge" }).click();
  await page.waitForURL("/");
  await page.goto("/meetings");
}
async function fill(page: Page) {
  for (const [label, value] of [
    ["Empresa", "Empresa teste"],
    ["Responsável", "Maria"],
    ["Telefone / WhatsApp (com DDD)", "(11) 99999-9999"],
    ["Cidade", "São Paulo"],
    ["Nicho", "Serviços"],
    ["Observações", "Reunião de teste"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const tomorrow = new Date(Date.now() + 86400000);
  await page
    .getByLabel("Data e horário (seu horário local)")
    .fill(tomorrow.toISOString().slice(0, 16));
  await page
    .getByLabel("Closer responsável")
    .selectOption("10000000-0000-0000-0000-000000000002");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("botão abre formulário próprio e cadastra via create_meeting", async ({
  page,
  request,
  browser,
}) => {
  await login(page);
  await page.goto("/");
  await page
    .locator("header")
    .getByRole("link", { name: /Nova reunião/ })
    .click();
  await expect(page).toHaveURL("/meetings/new");
  await expect(
    page.getByRole("heading", { name: "Nova reunião", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Empresa", { exact: true })).toBeVisible();
  await fill(page);
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(page).toHaveURL(/\/meetings\?success=/);
  await expect(page.getByRole("status")).toContainText("Agendada");
  await expect(
    page.getByRole("heading", { name: "Empresa teste" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article").getByText("Agendada", { exact: true }),
  ).toBeVisible();
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].sdr_id).toBeUndefined();
  expect(state.requests[0].phone).toBe("11999999999");
  expect(state.meetings[0].opportunities.sdr_id).toBe(
    "10000000-0000-0000-0000-000000000001",
  );
  const context = await browser.newContext();
  const closer = await context.newPage();
  await login(closer, "closer");
  await closer.goto("/validation");
  await expect(
    closer.getByRole("heading", { name: "Empresa teste" }),
  ).toBeVisible();
  await context.close();
});
for (const [mode, message] of [
  ["draft", "A campanha ainda não está ativa"],
  ["no_team", "Você não está vinculado a um time"],
  ["no_closer", "Não há closer ativo disponível"],
  ["future", "A campanha ainda não começou"],
  ["ended", "O período da campanha foi encerrado"],
  ["query_error", "Não foi possível carregar os requisitos"],
])
  test("abertura mostra bloqueio: " + mode, async ({ page, request }) => {
    await request.post("http://127.0.0.1:3101/__test/state", {
      data: { mode },
    });
    await login(page);
    await page
      .locator("header")
      .getByRole("link", { name: /Nova reunião/ })
      .click();
    await expect(page).toHaveURL("/meetings/new");
    await expect(
      page.getByRole("alert").filter({ hasText: message }),
    ).toBeVisible();
    await expect(page.getByLabel("Empresa", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cadastrar reunião" }),
    ).toBeDisabled();
  });
test("erro de RPC retorna ao cadastro com mensagem", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "rpc_error" },
  });
  await login(page);
  await page.goto("/meetings/new");
  await fill(page);
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(page).toHaveURL(/\/meetings\/new\?error=/);
  await expect(
    page.getByRole("alert").filter({ hasText: "duplicidade" }),
  ).toBeVisible();
  await expect(page.getByLabel("Empresa", { exact: true })).toBeVisible();
});

test("closer não acessa cadastro de SDR", async ({ page }) => {
  await login(page, "closer");
  await page.goto("/meetings/new");
  await expect(page).toHaveURL("/meetings");
  await expect(
    page.getByRole("button", { name: "Cadastrar reunião" }),
  ).toHaveCount(0);
});
