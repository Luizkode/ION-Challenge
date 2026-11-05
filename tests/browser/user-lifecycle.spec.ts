import { test, expect, type Page } from "@playwright/test";
async function open(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill("admin@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("**/");
  await page.goto("/team");
  return page
    .locator("article.team-member")
    .filter({ has: page.getByRole("heading", { name: /SDR de teste/ }) });
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "admin_management" },
  });
});
test("remover usuário com campanha exige somente abrir e confirmar, preservando histórico", async ({
  page,
  request,
}) => {
  const card = await open(page);
  await card
    .getByRole("button", { name: "Remover usuário", exact: true })
    .click();
  const d = page.getByRole("alertdialog");
  await expect(d).toBeVisible();
  await expect(d.getByRole("textbox")).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await d
    .getByRole("button", { name: "Remover definitivamente", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Usuário removido");
  await page.reload();
  await expect(page.getByText("sdr@ion.test", { exact: true })).toHaveCount(0);
  const s = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(s.lifecycle[0].mode).toBe("remove");
  expect(s.lifecycle[0].status).toBe("completed");
  expect(s.participants).toHaveLength(1);
  expect(s.participants[0].active).toBe(false);
});
test("cancelar a remoção não altera acesso ou registros", async ({
  page,
  request,
}) => {
  const card = await open(page);
  await card
    .getByRole("button", { name: "Remover usuário", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .lifecycle,
  ).toHaveLength(0);
});
test("remoção da própria conta administrativa é bloqueada", async ({
  page,
}) => {
  await open(page);
  const self = page
    .locator("article.team-member")
    .filter({
      has: page.getByRole("heading", { name: /Administrador de teste/ }),
    });
  await self
    .getByRole("button", { name: "Remover usuário", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remover definitivamente", exact: true })
    .click();
  await expect(self.getByRole("status")).toContainText("própria");
});
test("job interno não aceita chamadas públicas", async ({ request }) => {
  const r = await request.get("/api/internal/user-removals");
  expect(r.status()).toBe(401);
  expect(await r.json()).toEqual({ error: "Não autorizado" });
  const valid = await request.get("/api/internal/user-removals", {
    headers: { Authorization: "Bearer test-only-cron-secret" },
  });
  expect(valid.status()).toBe(200);
  expect(await valid.json()).toEqual({ processed: 0, pending: 0 });
});
