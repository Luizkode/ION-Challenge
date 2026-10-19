import { test, expect } from "@playwright/test";
async function login(page: import("@playwright/test").Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL(role === "partner" ? "**/partners" : "**/");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("Finance interface: administrator dashboard, forms, reports and responsive layout", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/finance");
  await expect(
    page.getByRole("heading", { name: "Financeiro", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Receita recebida", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("MRR contratado ativo", { exact: true }),
  ).toBeVisible();
  for (const [view, summary, field] of [
    ["income", "Cadastrar receita", "Descrição"],
    ["expense", "Cadastrar despesa", "Descrição"],
    [
      "recurring",
      "Configurar mensalidade de contrato",
      "Valor por parcela em reais",
    ],
    ["commissions", "Nova regra de comissão", "Nome da regra"],
  ]) {
    await page.goto("/finance?view=" + view);
    await page
      .locator("summary")
      .filter({ hasText: new RegExp("^" + summary + "$") })
      .click();
    await expect(page.getByLabel(field, { exact: true }).first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.goto("/finance?view=reports");
  await expect(
    page.getByRole("heading", { name: "Relatórios financeiros", exact: true }),
  ).toBeVisible();
  const response = await page.request.get("/finance/export?report=summary");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
});
test("Finance interface: direct routes and export denied to collaborators and partners", async ({
  page,
}) => {
  for (const role of ["sdr", "traffic", "partner"]) {
    await page.context().clearCookies();
    await login(page, role);
    await page.goto("/finance");
    await expect(page).not.toHaveURL(/\/finance/);
    await expect(
      page.getByRole("link", { name: "Financeiro", exact: true }),
    ).toHaveCount(0);
    const response = await page.request.get("/finance/export?report=summary");
    expect(response.headers()["content-type"]).not.toContain("text/csv");
  }
});
