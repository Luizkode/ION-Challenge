import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL(role === "partner" ? "**/partners" : "**/");
  await expect(page.locator("aside")).toBeVisible();
}
async function meeting(page: Page) {
  await page.goto("/meetings/new");
  for (const [label, value] of [
    ["Empresa", "Empresa preservada"],
    ["Responsável", "Maria"],
    ["Telefone / WhatsApp (com DDD)", "11999999999"],
    ["Cidade", "São Paulo"],
    ["Nicho", "Serviços"],
    ["Observações", "Não perder este texto"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByLabel("Data e horário (seu horário local)")
    .fill("2027-01-01T10:00");
  await page
    .getByLabel("Closer responsável")
    .selectOption("10000000-0000-0000-0000-000000000002");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("menu acessível, navegação de Configurações e logout também no celular", async ({
  page,
}) => {
  await login(page);
  const menu = page.getByRole("button", { name: "Menu de módulos" });
  if (await menu.isVisible()) {
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    await menu.click();
  }
  const nav = page.getByRole("navigation", { name: "Módulos do ION OS" });
  await nav.getByRole("link", { name: "Configurações", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Configurações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Em desenvolvimento", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Abrir minha conta" }).click();
  await expect(
    page.getByRole("heading", { name: /Minha conta/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/finance");
  await expect(page).toHaveURL(/\/login/);
});
test("erro recuperável preserva campos e horário e permite corrigir e salvar", async ({
  page,
  request,
}) => {
  await login(page, "sdr");
  await meeting(page);
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "rpc_error" },
  });
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Possível duplicidade",
  );
  await expect(page.getByLabel("Empresa", { exact: true })).toHaveValue(
    "Empresa preservada",
  );
  await expect(page.getByLabel("Observações", { exact: true })).toHaveValue(
    "Não perder este texto",
  );
  await expect(
    page.getByLabel("Data e horário (seu horário local)"),
  ).toHaveValue("2027-01-01T10:00");
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(page).toHaveURL(/\/meetings\?success=/);
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.meetings).toHaveLength(1);
  expect(state.meetings[0].notes).toBe("Não perder este texto");
});
test("falha de rede apresenta feedback, mantém dados e bloqueia envio duplicado durante processamento", async ({
  page,
  request,
}) => {
  await login(page, "sdr");
  await meeting(page);
  let failed = false;
  await page.route("**/meetings/new", async (route) => {
    if (route.request().method() === "POST" && !failed) {
      failed = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Verifique a conexão",
  );
  await expect(page.getByLabel("Empresa", { exact: true })).toHaveValue(
    "Empresa preservada",
  );
  await page.unroute("**/meetings/new");
  await page.route("**/meetings/new", async (route) => {
    if (route.request().method() === "POST")
      await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await page.getByRole("button", { name: "Cadastrar reunião" }).click();
  await expect(
    page.getByRole("button", { name: "Salvando…", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/\/meetings\?success=/);
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .meetings,
  ).toHaveLength(1);
});
test("datas inválidas de filtros têm mensagem e não derrubam reuniões", async ({
  page,
}) => {
  await login(page, "sdr");
  await page.goto("/meetings?date=2026-02-30");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "data válida",
  );
  await expect(
    page.getByRole("heading", { name: "Minhas reuniões", exact: true }),
  ).toBeVisible();
});
test("auditoria visual em desktop Full HD, notebook, tablet e celulares 320–430 px", async ({
  page,
}, info) => {
  test.skip(
    info.project.name === "mobile",
    "Matriz completa executada uma vez, incluindo celulares reais no viewport.",
  );
  test.setTimeout(180000);
  await login(page);
  for (const width of [1920, 1366, 768, 430, 320]) {
    await page.setViewportSize({ width, height: width > 700 ? 900 : 844 });
    for (const path of [
      "/",
      "/crm",
      "/challenger",
      "/clients",
      "/finance",
      "/analytics",
      "/team",
      "/partners",
      "/settings",
      "/meetings",
      "/validation",
      "/history",
      "/account",
    ]) {
      await page.goto(path);
      await expect(page.locator("main").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path} @${width}`,
      ).toBeTruthy();
      await expect(
        page.getByText("Não foi possível carregar os dados.", { exact: true }),
      ).toHaveCount(0);
      const failures = await page
        .locator("main input:not([type=hidden]),main select,main textarea")
        .evaluateAll(
          (nodes) =>
            nodes.filter((n) => {
              const r = n.getBoundingClientRect();
              return r.width > 0 && (r.left < 0 || r.right > innerWidth + 1);
            }).length,
        );
      expect(failures, `campos ${path} @${width}`).toBe(0);
    }
  }
});
test("WCAG 2.2 AA: formulários, menu, contraste e regiões principais", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.goto("/login");
  const issues: unknown[] = [];
  async function audit(path: string) {
    await page.goto(path);
    const report = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    issues.push(
      ...report.violations.map((v) => ({
        path,
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    );
  }
  await audit("/login");
  await login(page);
  for (const path of [
    "/",
    "/settings",
    "/team",
    "/clients/new",
    "/crm/new",
    "/finance",
    "/analytics",
    "/partners",
  ])
    await audit(path);
  await page.goto("/analytics?view=accounts");
  await page.screenshot({
    path: `/tmp/ion-v1-${info.project.name}-analytics.png`,
    fullPage: true,
  });
  await page.goto("/settings");
  await page.screenshot({
    path: `/tmp/ion-v1-${info.project.name}-settings.png`,
    fullPage: true,
  });
  await page.goto("/");
  await page.screenshot({
    path: `/tmp/ion-v1-${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  await info.attach("accessibility-findings", {
    body: JSON.stringify(issues, null, 2),
    contentType: "application/json",
  });
  expect(issues).toEqual([]);
});
