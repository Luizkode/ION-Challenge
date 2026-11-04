import { test, expect, type Page } from "@playwright/test";
const target = "10000000-0000-0000-0000-000000000004";
async function open(page: Page, id = target) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill("admin@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("/");
  await page.goto("/team");
  const d = page
    .locator("main details")
    .filter({ has: page.getByText("UUID: " + id, { exact: false }) })
    .first();
  await d.locator(":scope > summary").click();
  await d.getByText("Ciclo de vida da conta", { exact: true }).click();
  return d;
}
async function fill(
  page: Page,
  d: ReturnType<Page["locator"]>,
  mode: string,
  id = target,
) {
  const f = d.locator('form:has(input[name="target_id"])');
  await f
    .getByRole("combobox", { name: "Operação", exact: true })
    .selectOption(mode);
  await f
    .getByLabel("Justificativa (obrigatória)")
    .fill("Remoção de conta técnica de teste");
  await f.getByLabel("Digite o UUID completo").fill(id);
  await f.getByRole("checkbox", { name: /Conferi o usuário/ }).check();
  if (mode === "delete_test")
    await f
      .getByRole("checkbox", { name: /Confirmo que é uma conta de teste/ })
      .check();
  return f;
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "admin_management" },
  });
});
test("cancelar confirmação não prepara remoção", async ({ page, request }) => {
  const d = await open(page);
  const f = await fill(page, d, "delete_test");
  page.once("dialog", (x) => x.dismiss());
  await f.getByRole("button", { name: "Confirmar operação na conta" }).click();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .lifecycle,
  ).toHaveLength(0);
});
test("UUID incorreto recebe erro por campo; nenhuma operação é criada", async ({
  page,
  request,
}) => {
  const d = await open(page);
  const f = await fill(page, d, "delete_test");
  await f.getByLabel("Digite o UUID completo").fill("outro");
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Confirmar operação na conta" }).click();
  await expect(
    f.getByText("Digite o UUID completo do usuário selecionado."),
  ).toBeVisible();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .lifecycle,
  ).toHaveLength(0);
});
test("exclusão de conta técnica reflete no recarregamento e mantém auditoria", async ({
  page,
}) => {
  const d = await open(page);
  await d.getByRole("button", { name: "Consultar dependências" }).click();
  await expect(d.getByText(/Sem vínculos que impeçam/)).toBeVisible();
  const f = await fill(page, d, "delete_test");
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Confirmar operação na conta" }).click();
  await expect(
    page.getByText(
      "Conta de teste sem histórico removida do Auth e da Equipe.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("UUID: " + target, { exact: false })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Histórico de ciclo de vida" }),
  ).toBeVisible();
});
test("participante com histórico recebe bloqueio antes da remoção", async ({
  page,
  request,
}) => {
  const id = "10000000-0000-0000-0000-000000000001";
  const d = await open(page, id);
  await d.getByRole("button", { name: "Consultar dependências" }).click();
  await expect(
    d.getByText("campaign_participants_profile_id_fkey: 1 registro(s)"),
  ).toBeVisible();
  const f = await fill(page, d, "delete_test", id);
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Confirmar operação na conta" }).click();
  await expect(
    d.getByText("Exclusão definitiva bloqueada: há histórico ou atribuições", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get("http://127.0.0.1:3101/__test/state")).json())
      .lifecycle,
  ).toHaveLength(0);
});

test("falha do Auth preserva solicitação, congela confirmação e permite encerrar após recarregar", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "lifecycle_auth_error" },
  });
  const d = await open(page);
  const f = await fill(page, d, "delete_test");
  page.once("dialog", (x) => x.accept());
  await f.getByRole("button", { name: "Confirmar operação na conta" }).click();
  await expect(d.getByText(/O Auth não confirmou a remoção/)).toBeVisible();
  await expect(
    f.getByRole("checkbox", { name: /Conferi o usuário/ }),
  ).toBeDisabled();
  const before = (
    await (await request.get("http://127.0.0.1:3101/__test/state")).json()
  ).lifecycle;
  expect(before).toHaveLength(1);
  expect(before[0].status).toBe("pending");
  await page.reload();
  const history = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Histórico de ciclo de vida" }),
    });
  await history.locator("summary").click();
  page.once("dialog", (x) => x.accept());
  await history
    .getByRole("button", { name: "Encerrar solicitação pendente" })
    .click();
  await expect(history.getByRole("status")).toContainText(
    "permanece desativado",
  );
  const after = (
    await (await request.get("http://127.0.0.1:3101/__test/state")).json()
  ).lifecycle;
  expect(after[0].status).toBe("failed");
  await expect(page.getByText("UUID: " + target, { exact: false })).toHaveCount(
    1,
  );
});
