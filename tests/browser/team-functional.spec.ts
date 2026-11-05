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
test("Equipe mostra login e mantém validação essencial sem justificativas redundantes", async ({
  page,
  request,
}) => {
  await login(page);
  await expect(page.getByText("sdr@ion.test", { exact: true })).toBeVisible();
  const f = page
    .locator("form")
    .filter({ has: page.getByLabel("Email do convite") });
  await f.getByLabel("Nome", { exact: true }).fill("Pessoa nova");
  await f.getByLabel("Email do convite").fill("pessoa@ion.test");
  await f.getByRole("button", { name: "Enviar convite" }).click();
  await expect(f.getByText(/Selecione pelo menos uma função/)).toBeVisible();
  await expect(f.getByLabel("Justificativa", { exact: false })).toHaveCount(0);
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .invitations,
  ).toHaveLength(0);
});
test("promoção confirma uma vez e encerra participação incompatível automaticamente", async ({
  page,
  request,
}) => {
  await login(page);
  const card = page
    .locator("article.team-member")
    .filter({ has: page.getByRole("heading", { name: /SDR de teste/ }) });
  await card
    .getByText("Editar usuário · categoria e funções", { exact: true })
    .click();
  const f = card.locator("form");
  await f.getByLabel("Categoria de acesso").selectOption("admin");
  await expect(f.getByText(/encerrada automaticamente/)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await f.getByRole("button", { name: "Salvar acesso" }).click();
  await expect(f.getByRole("status")).toContainText("Acesso atualizado");
  const s = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(s.requests.at(-1).data.remove_from_campaign).toBe("true");
  expect(s.participants[0].active).toBe(false);
  await page.reload();
  await expect(
    page
      .locator("article.team-member")
      .filter({ has: page.getByRole("heading", { name: /SDR de teste/ }) })
      .getByRole("heading"),
  ).toContainText("Administrador");
});
test("cancelar confirmação de permissão não grava alterações", async ({
  page,
  request,
}) => {
  await login(page);
  const card = page
    .locator("article.team-member")
    .filter({ has: page.getByRole("heading", { name: /SDR de teste/ }) });
  await card
    .getByText("Editar usuário · categoria e funções", { exact: true })
    .click();
  const f = card.locator("form");
  await f.getByLabel("Categoria de acesso").selectOption("admin");
  page.once("dialog", (d) => d.dismiss());
  await f.getByRole("button", { name: "Salvar acesso" }).click();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .requests,
  ).toHaveLength(0);
});
test("falha SMTP mantém campos e não anuncia entrega", async ({
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
  await f.getByLabel("Nome", { exact: true }).fill("SDR novo");
  await f.getByLabel("Email do convite").fill("novo@ion.test");
  await f.getByLabel("SDR", { exact: true }).check();
  page.once("dialog", (d) => d.accept());
  await f.getByRole("button", { name: "Enviar convite" }).click();
  await expect(f.getByRole("alert")).toContainText("SMTP");
  await expect(f.getByLabel("Email do convite")).toHaveValue("novo@ion.test");
  await expect(f.getByRole("status")).toHaveCount(0);
});

test("editar nome não pede justificativa nem confirmação adicional", async ({
  page,
}) => {
  await login(page);
  const card = page
    .locator("article.team-member")
    .filter({ has: page.getByRole("heading", { name: /SDR de teste/ }) });
  await card
    .getByText("Editar usuário · categoria e funções", { exact: true })
    .click();
  let extra = false;
  page.on("dialog", async (d) => {
    extra = true;
    await d.dismiss();
  });
  await card.getByLabel("Nome", { exact: true }).fill("Colaborador atualizado");
  await card.getByRole("button", { name: "Salvar acesso" }).click();
  await expect(page.getByRole("status")).toContainText("Acesso atualizado");
  expect(extra).toBe(false);
});
