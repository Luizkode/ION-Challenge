import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "admin") {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("/");
}
async function createClient(page: Page) {
  await page.goto("/clients");
  await page.getByRole("link", { name: "Novo cliente", exact: true }).click();
  for (const [label, value] of [
    ["Nome da empresa", "Cliente operacional"],
    ["Responsável do cliente", "Maria Silva"],
    ["WhatsApp", "11999990000"],
    ["E-mail", "cliente@example.com"],
    ["Segmento", "Serviços"],
    ["Cidade", "São Paulo"],
    ["Estado (UF)", "SP"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page
    .getByRole("button", { name: "Salvar cliente", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Cliente operacional", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("admin cadastra cliente, contrato e serviço, atualiza entrega e mantém layout mobile", async ({
  page,
}) => {
  await login(page);
  await createClient(page);
  await page.getByText("Novo contrato ou aditivo", { exact: true }).click();
  let form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", { name: "Salvar contrato", exact: true }),
    })
    .last();
  await form.getByLabel("Identificação do contrato").fill("OPS-001");
  await form.getByLabel("Início do contrato").fill("2026-01-01");
  await form.getByLabel("Valor contratado (R$)").fill("1200");
  await form.getByLabel("Serviços inclusos no contrato").fill("Design mensal");
  await form
    .getByRole("combobox", { name: "Responsável interno", exact: true })
    .selectOption("10000000-0000-0000-0000-000000000004");
  await form
    .getByRole("button", { name: "Salvar contrato", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Contrato salvo");
  await page.getByText("Novo serviço contratado", { exact: true }).click();
  form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", { name: "Salvar serviço", exact: true }),
    })
    .last();
  await form
    .getByLabel("Descrição interna do serviço")
    .fill("Peças de campanha");
  await form.getByLabel("Início do serviço").fill("2026-01-01");
  await form.getByLabel("Prazo previsto").fill("2026-02-01");
  await form
    .locator(
      'input[name=assignees][value="10000000-0000-0000-0000-000000000004"]',
    )
    .check();
  await form
    .getByRole("button", { name: "Salvar serviço", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Serviço e atribuições salvos",
  );
  await page.getByText("Atualizar andamento · Design", { exact: true }).click();
  form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: "Registrar andamento",
        exact: true,
      }),
    })
    .first();
  await form
    .getByRole("combobox", { name: "Novo status", exact: true })
    .selectOption("completed");
  await form.getByLabel("Data da entrega").fill("2026-02-01");
  await form.getByLabel("Atualização interna").fill("Entrega finalizada");
  await form
    .getByRole("button", { name: "Registrar andamento", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Andamento registrado");
  await expect(
    page.getByText("Entrega finalizada", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("documento privado: valida tipo, envia diretamente ao Storage e confirma metadados", async ({
  page,
  request,
}) => {
  await login(page);
  await createClient(page);
  const section = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Documentos do cliente",
        exact: true,
      }),
    });
  await section
    .getByLabel("Arquivo privado (até 10 MB)")
    .setInputFiles({
      name: "segredo.html",
      mimeType: "text/html",
      buffer: Buffer.from("<html/>"),
    });
  await section
    .getByRole("button", { name: "Enviar documento", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText("Tipo não permitido");
  await section
    .getByLabel("Arquivo privado (até 10 MB)")
    .setInputFiles({
      name: "contrato.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("teste"),
    });
  await section
    .getByRole("button", { name: "Enviar documento", exact: true })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "Documento enviado com acesso privado",
  );
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.ops_files).toHaveLength(1);
  expect(state.ops_files[0].state).toBe("ready");
  await expect(
    section.getByRole("button", { name: "Baixar contrato.txt" }),
  ).toBeVisible();
});
