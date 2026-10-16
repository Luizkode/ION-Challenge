import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL(
    role === "partner"
      ? "/partners"
      : role === "inactive"
        ? /\/login\?error=/
        : "/",
  );
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("produção: dashboard próprio, clientes atribuídos e URLs comerciais bloqueadas", async ({
  page,
}) => {
  await login(page, "traffic");
  await expect(
    page.getByRole("heading", { name: "Seu dashboard" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Módulos do ION OS" });
  await expect(
    nav.getByRole("link", { name: "Clientes e Serviços" }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "CRM Comercial" })).toHaveCount(0);
  await expect(
    page.locator("header").getByRole("link", { name: /Nova reunião/ }),
  ).toHaveCount(0);
  for (const url of [
    "/meetings/new",
    "/meetings",
    "/validation",
    "/challenger",
    "/admin",
    "/team",
    "/finance",
  ]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/(\?error=.*)?$/);
    await expect(
      page.getByRole("heading", { name: "Seu dashboard" }),
    ).toBeVisible();
  }
});
test("parceiro só navega no portal da própria empresa", async ({ page }) => {
  await login(page, "partner");
  await expect(page).toHaveURL("/partners");
  await expect(
    page.getByRole("heading", { name: "Minha empresa" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Módulos do ION OS" })
      .getByRole("link"),
  ).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Empresa A" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Empresa B" })).toHaveCount(0);
  for (const url of [
    "/meetings/new",
    "/crm",
    "/admin",
    "/team",
    "/finance",
    "/challenger",
  ]) {
    await page.goto(url);
    await expect(page).toHaveURL("/partners");
  }
  await expect(page.locator("main form")).toHaveCount(0);
});
test("conta desativada não entra mesmo após autenticação Auth", async ({
  page,
}) => {
  await login(page, "inactive");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(
    page.getByRole("alert").filter({ hasText: "Conta sem perfil ativo" }),
  ).toBeVisible();
});
test("funções múltiplas combinam menu e validação sem liberar administração", async ({
  page,
}) => {
  await login(page, "multi");
  const nav = page.getByRole("navigation", { name: "Módulos do ION OS" });
  await expect(nav.getByRole("link", { name: "CRM Comercial" })).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Clientes e Serviços" }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Financeiro" })).toHaveCount(0);
  await page.goto("/challenger");
  await expect(
    page
      .getByRole("navigation", { name: "Operação do Challenger" })
      .getByRole("link", { name: "Validação de reuniões" }),
  ).toBeVisible();
});
test("admin altera funções, atribui cliente e desativa usuário por Equipe", async ({
  page,
  request,
}) => {
  await login(page, "admin");
  await page.goto("/team");
  expect(await page.content()).not.toContain("test-only-service-role");
  const detail = page.locator("main details").filter({
    has: page.locator("summary").filter({ hasText: "SDR de teste" }),
  });
  await detail.locator("summary").click();
  const form = detail.locator("form");
  await form.getByLabel("SDR", { exact: true }).uncheck();
  await form.getByLabel("Gestor de Tráfego", { exact: true }).check();
  await form.getByLabel("Empresa A", { exact: true }).check();
  await form.getByLabel("Situação do acesso").selectOption("false");
  await form.getByLabel("Remover participação na campanha").check();
  await form
    .getByLabel("Justificativa (mínimo 8 caracteres)")
    .fill("Alteração de função para testes");
  await form.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Salvar acesso" }).click();
  await expect(page.getByRole("status")).toContainText("Acesso atualizado");
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.requests[0].data.functions).toEqual(["traffic"]);
  expect(state.requests[0].data.company_ids).toHaveLength(1);
  expect(state.requests[0].data.active).toBe("false");
});
for (const category of ["employee", "partner"])
  test("admin convida " + category + " pelo Auth seguro", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/team");
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel("Email do convite") });
    await form.getByLabel("Email do convite").fill("novo@ion.test");
    await form.getByLabel("Nome", { exact: true }).fill("Pessoa convidada");
    await form.getByLabel("Categoria de acesso").selectOption(category);
    if (category === "employee")
      await form.getByLabel("Designer", { exact: true }).check();
    else await form.getByLabel("Empresa A", { exact: true }).check();
    await form
      .getByLabel("Justificativa (mínimo 8 caracteres)")
      .fill("Convite de teste autorizado");
    await form.getByRole("checkbox", { name: /Confirmo/ }).check();
    page.once("dialog", (d) => d.accept());
    await form.getByRole("button", { name: "Enviar convite" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Convite enviado e acesso configurado",
    );
  });
test("falha no envio de convite não concede permissões", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "invite_error" },
  });
  await login(page, "admin");
  await page.goto("/team");
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Email do convite") });
  await form.getByLabel("Email do convite").fill("falha@ion.test");
  await form.getByLabel("Nome", { exact: true }).fill("Convite com falha");
  await form.getByLabel("SDR", { exact: true }).check();
  await form
    .getByLabel("Justificativa (mínimo 8 caracteres)")
    .fill("Convite de teste com falha");
  await form.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Enviar convite" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Nenhuma permissão foi concedida" }),
  ).toBeVisible();
});
