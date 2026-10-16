import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("/");
  await page.goto("/admin");
}
const member = (page: Page) =>
  page.locator("tbody tr").filter({ hasText: "SDR de teste" });
async function removal(page: Page) {
  const row = member(page);
  await row
    .locator("summary")
    .filter({ hasText: "Remover da campanha" })
    .click();
  const form = row
    .locator("form")
    .filter({ has: page.locator('input[name="remove"]') });
  await form
    .getByLabel("Justificativa da remoção")
    .fill("Remover colaborador de testes");
  await form.getByRole("checkbox", { name: /Confirmo/ }).check();
  return form;
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "admin_management" },
  });
});
test("cancelar mantém vínculo; confirmar remove e permite reinclusão", async ({
  page,
  request,
}) => {
  await login(page);
  let form = await removal(page);
  page.once("dialog", (d) => d.dismiss());
  await form.getByRole("button", { name: "Remover da campanha" }).click();
  await expect(
    member(page).getByText("Na campanha", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .requests,
  ).toHaveLength(0);
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Remover da campanha" }).click();
  await expect(page.getByRole("status")).toContainText("Histórico preservado");
  await expect(
    member(page).getByText("Fora da campanha", { exact: true }),
  ).toBeVisible();
  await member(page)
    .locator("summary")
    .filter({ hasText: "Adicionar à campanha" })
    .click();
  form = member(page)
    .locator("form")
    .filter({ has: page.locator('select[name="team_id"]') });
  await form
    .getByLabel("Justificativa da inclusão")
    .fill("Reincluir colaborador elegível");
  await form.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Adicionar à campanha" }).click();
  await expect(
    member(page).getByText("Na campanha", { exact: true }),
  ).toBeVisible();
});
test("troca de perfil pode remover participante na mesma operação", async ({
  page,
  request,
}) => {
  await login(page);
  const row = member(page);
  await row.locator("summary").filter({ hasText: "Alterar perfil" }).click();
  const form = row
    .locator("form")
    .filter({ has: page.locator('select[name="role"]') });
  await form.getByLabel("Perfil de SDR de teste").selectOption("admin");
  await form
    .getByRole("checkbox", { name: /Remover da campanha durante/ })
    .check();
  await form
    .getByLabel("Justificativa", { exact: true })
    .fill("Promover o colaborador de testes");
  await form.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", async (d) => {
    expect(d.message()).toContain("participação na campanha");
    await d.accept();
  });
  await form.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("status")).toContainText("na mesma operação");
  await expect(
    member(page).getByRole("cell", { name: "admin", exact: true }),
  ).toBeVisible();
  await expect(
    member(page).getByText("Fora da campanha", { exact: true }),
  ).toBeVisible();
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.requests[0].data.confirm).toBe("true");
  expect(state.requests[0].data.remove_from_campaign).toBe("true");
});
test("falha mostra erro sem remover participante", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "admin_error" },
  });
  await login(page);
  const form = await removal(page);
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: "Remover da campanha" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "nenhuma alteração aplicada" }),
  ).toBeVisible();
  await expect(
    member(page).getByText("Na campanha", { exact: true }),
  ).toBeVisible();
});
test("SDR não recebe acesso à administração", async ({ page }) => {
  await login(page, "sdr");
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Administração", exact: true }),
  ).toHaveCount(0);
});
