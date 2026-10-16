import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role = "sdr") {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL(role === "partner" ? "/partners" : "/");
}
async function newLead(page: Page) {
  await page.goto("/crm");
  await page.getByRole("link", { name: "Novo lead", exact: true }).click();
  for (const [field, value] of [
    ["Nome da empresa", "Empresa CRM"],
    ["Responsável", "Maria"],
    ["WhatsApp", "11988887777"],
    ["E-mail", "maria@example.com"],
    ["Segmento", "Serviços"],
    ["Cidade", "São Paulo"],
    ["Estado (UF)", "SP"],
    ["Origem", "Prospecção"],
  ])
    await page.getByLabel(field, { exact: true }).fill(value);
  await page
    .getByLabel("Closer responsável")
    .selectOption("10000000-0000-0000-0000-000000000002");
  await page.getByRole("button", { name: "Salvar lead" }).click();
  await expect(
    page.getByRole("heading", { name: "Empresa CRM", exact: true }),
  ).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "active" },
  });
});
test("SDR cadastra lead, registra abordagem, agenda e navega no funil sem overflow", async ({
  page,
}) => {
  await login(page);
  await newLead(page);
  await page
    .getByLabel("Descrição / resposta")
    .fill("Abordagem de teste pelo WhatsApp");
  await page.getByRole("button", { name: "Registrar atividade" }).click();
  await expect(
    page.getByText("Abordagem de teste pelo WhatsApp", { exact: true }),
  ).toBeVisible();
  const future = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await page.getByLabel("Data e horário", { exact: true }).fill(future);
  await page
    .getByRole("combobox", { name: "Closer", exact: true })
    .selectOption("10000000-0000-0000-0000-000000000002");
  await page
    .getByRole("button", { name: "Agendar reunião", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Reunião agendada");
  await expect(
    page.getByText(
      "Campanha vinculada; regras originais de pontuação preservadas",
    ),
  ).toBeVisible();
  await page.goto("/crm?view=pipeline");
  await expect(
    page.getByRole("link", { name: "Empresa CRM", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Mover Empresa CRM").selectOption("interested");
  await expect(page.getByLabel("Mover Empresa CRM")).toHaveValue("interested");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("CSV mostra prévia e só importa após confirmação", async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto("/crm");
  await page.getByText("Importar leads por CSV", { exact: true }).click();
  await page
    .getByLabel("Arquivo CSV")
    .setInputFiles({
      name: "leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "company,contact,phone,niche,city,state,source\nImportada,Maria,11999998888,Serviços,São Paulo,SP,Evento",
      ),
    });
  await expect(
    page.getByRole("heading", { name: "Prévia · 1 leads" }),
  ).toBeVisible();
  let state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.crm_leads).toHaveLength(0);
  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect(page.getByRole("status")).toContainText("1 leads importados");
  state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.crm_leads).toHaveLength(1);
  expect(
    state.requests.find((r: { rows?: unknown[] }) => r.rows)?.rows,
  ).toHaveLength(1);
});
test("closer vê oportunidades atribuídas, registra proposta e não cadastra leads", async ({
  page,
}) => {
  await login(page);
  await newLead(page);
  await page.context().clearCookies();
  await login(page, "closer");
  await page.goto("/crm");
  await expect(
    page.getByRole("link", { name: "Novo lead", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Empresa CRM", exact: true }).click();
  await page.getByLabel("Valor da proposta (R$)").fill("1200");
  await page.getByLabel("Serviços oferecidos").fill("Marketing digital");
  await page.getByLabel("Prazo de contrato (meses)").fill("12");
  await page
    .getByLabel("Observações / motivo do resultado")
    .fill("Proposta enviada");
  await page.getByRole("button", { name: "Registrar negociação" }).click();
  await expect(page.getByRole("status")).toContainText("Negociação registrada");
  await expect(page.getByText("Marketing digital · 12 meses")).toBeVisible();
});
for (const role of ["traffic", "partner"]) test(role + " não acessa CRM por URL", async ({ page }) => {
  await login(page, role);
  await page.goto("/crm");
  await expect(page).toHaveURL(role === "partner" ? /\/partners$/ : /error=Sem/);
  await expect(
    page.getByRole("heading", { name: "CRM Comercial", exact: true }),
  ).toHaveCount(0);
});
