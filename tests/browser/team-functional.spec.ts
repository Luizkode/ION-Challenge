import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill("admin@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("**/");
  await page.goto("/team");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("Team identifies missing fields without calling Auth and retains the entered data", async ({
  page,
  request,
}) => {
  await login(page);
  const f = page
    .locator("form")
    .filter({ has: page.getByLabel("Email do convite") });
  await f.getByLabel("Nome", { exact: true }).fill("Pessoa nova");
  await f.getByLabel("Email do convite").fill("pessoa@ion.test");
  await f.getByLabel("Justificativa (mínimo 8 caracteres)").fill("Teste");
  await f.getByRole("button", { name: "Enviar convite" }).click();
  await expect(
    f.getByText(
      "Selecione pelo menos uma função para o colaborador (por exemplo, SDR).",
    ),
  ).toBeVisible();
  await expect(
    f.getByText("Explique o motivo com pelo menos 8 caracteres."),
  ).toBeVisible();
  await expect(
    f.getByText("Confirme a operação antes de continuar."),
  ).toBeVisible();
  await expect(f.getByLabel("Nome", { exact: true })).toHaveValue(
    "Pessoa nova",
  );
  await expect(f.getByLabel("Email do convite")).toHaveValue("pessoa@ion.test");
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .invitations,
  ).toHaveLength(0);
});
test("Promote an existing SDR to admin, persist the RPC payload and show the category after reload", async ({
  page,
  request,
}) => {
  await login(page);
  let d = page
    .locator("main details")
    .filter({
      has: page.locator("summary").filter({ hasText: "SDR de teste" }),
    });
  await d.locator("summary").click();
  let f = d.locator("form");
  await f.getByLabel("Categoria de acesso").selectOption("admin");
  await expect(
    f.getByText(
      "Administradores recebem permissões administrativas; funções operacionais não são exigidas.",
    ),
  ).toBeVisible();
  await f.getByLabel("Remover participação na campanha").check();
  await f
    .getByLabel("Justificativa (mínimo 8 caracteres)")
    .fill("Promoção administrativa autorizada");
  await f.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Salvar acesso" }).click();
  await expect(f.getByRole("status")).toContainText("Acesso atualizado");
  const s = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(s.requests.at(-1).data.category).toBe("admin");
  expect(s.requests.at(-1).data.functions).toEqual([]);
  expect(s.requests.at(-1).data.remove_from_campaign).toBe("true");
  await page.reload();
  d = page
    .locator("main details")
    .filter({
      has: page.locator("summary").filter({ hasText: "SDR de teste" }),
    });
  await expect(d.locator("summary")).toContainText("Administrador");
});
test("Cancel security confirmation performs no write", async ({
  page,
  request,
}) => {
  await login(page);
  const d = page
    .locator("main details")
    .filter({
      has: page.locator("summary").filter({ hasText: "SDR de teste" }),
    });
  await d.locator("summary").click();
  const f = d.locator("form");
  await f
    .getByLabel("Justificativa (mínimo 8 caracteres)")
    .fill("Cancelamento de teste");
  await f.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (x) => x.dismiss());
  await f.getByRole("button", { name: "Salvar acesso" }).click();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .requests,
  ).toHaveLength(0);
});
test("SMTP rejection keeps SDR fields and never displays a successful invitation", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "invite_unauthorized" },
  });
  await login(page);
  const f = page
    .locator("form")
    .filter({ has: page.getByLabel("Email do convite") });
  await f.getByLabel("Email do convite").fill("externo@ion.test");
  await f.getByLabel("Nome", { exact: true }).fill("SDR externo");
  await f.getByLabel("SDR", { exact: true }).check();
  await f
    .getByLabel("Justificativa (mínimo 8 caracteres)")
    .fill("Convite autorizado de SDR");
  await f.getByRole("checkbox", { name: /Confirmo/ }).check();
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Enviar convite" }).click();
  await expect(f.getByRole("alert")).toContainText("SMTP próprio");
  await expect(f.getByRole("status")).toHaveCount(0);
  await expect(f.getByLabel("Email do convite")).toHaveValue(
    "externo@ion.test",
  );
  await expect(f.getByLabel("SDR", { exact: true })).toBeChecked();
  await expect(f.getByRole("checkbox", { name: /Confirmo/ })).not.toBeChecked();
  const s = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(s.invitations[0].status).toBe("failed");
});
