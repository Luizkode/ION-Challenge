import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Entre no ION OS." }),
  ).toBeVisible();
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("/");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("ION OS abre dashboard da agência, nove módulos e Challenger preservado", async ({
  page,
}) => {
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Visão geral da agência" }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Módulos do ION OS" });
  await expect(nav.getByRole("link")).toHaveCount(9);
  await expect(
    page.getByRole("heading", { name: "Ranking individual" }),
  ).toHaveCount(0);
  await nav.getByRole("link", { name: "ION Challenger" }).click();
  await expect(page).toHaveURL("/challenger");
  await expect(
    page.getByRole("heading", { name: "Uma equipe. Um objetivo." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ranking individual" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Meta coletiva" }),
  ).toHaveAttribute("aria-valuemax", "700");
  await expect(
    page
      .getByRole("navigation", { name: "Operação do Challenger" })
      .getByRole("link", { name: "Administração do Challenger" }),
  ).toBeVisible();
});
test("módulos futuros têm estado informativo sem formulários simulados", async ({
  page,
}) => {
  await login(page);
  for (const [path, name] of [
    ["/crm", "CRM Comercial"],
    ["/analytics", "Analytics"],
    ["/finance", "Financeiro"],
    ["/settings", "Configurações"],
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Em desenvolvimento", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
  }
});
test("SDR tem dashboard próprio e não acessa módulos administrativos por URL", async ({
  page,
}) => {
  await login(page, "sdr");
  await expect(
    page.getByRole("heading", { name: "Sua operação, em um só lugar." }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Módulos do ION OS" })
      .getByRole("link"),
  ).toHaveCount(3);
  for (const path of [
    "/finance",
    "/partners",
    "/team",
    "/settings",
    "/clients",
    "/analytics",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/?error=/);
    await expect(
      page.getByRole("alert").filter({ hasText: "não tem permissão" }),
    ).toBeVisible();
  }
  await page.goto("/challenger");
  await expect(
    page.getByRole("heading", { name: "Ranking individual" }),
  ).toBeVisible();
});
test("filtro de período aplica intervalo e reporta erro de datas sem quebrar a página", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("Início do período").fill("2026-01-01");
  await page.getByLabel("Fim do período").fill("2026-01-31");
  await page.getByRole("button", { name: "Aplicar período" }).click();
  await expect(page).toHaveURL(/from=2026-01-01&to=2026-01-31/);
  await page.goto("/?from=invalid");
  await expect(
    page.getByRole("alert").filter({ hasText: "período válido" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Visão geral da agência" }),
  ).toBeVisible();
});
