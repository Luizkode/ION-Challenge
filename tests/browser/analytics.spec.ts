import { test, expect, type Page } from "@playwright/test";
const campaign = "97000000-0000-0000-0000-000000000002";
const company = "90000000-0000-0000-0000-000000000001";
async function login(page: Page, role = "admin") {
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
test("admin records real metrics, CSV origin and creates a persisted report / PDF", async ({
  page,
  request,
}) => {
  await login(page);
  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Analytics", exact: true }),
  ).toBeVisible();
  await page
    .locator("summary")
    .filter({ hasText: /^Cadastrar resultado real$/ })
    .click();
  let form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: "Salvar resultado real",
        exact: true,
      }),
    });
  await form
    .getByRole("combobox", { name: "Campanha do resultado", exact: true })
    .selectOption(campaign);
  await form
    .getByLabel("Início da observação", { exact: true })
    .fill("2020-01-01");
  await form
    .getByLabel("Fim da observação", { exact: true })
    .fill("2020-01-01");
  await form
    .getByLabel("Investimento publicitário (BRL; ex.: 1250.50)", {
      exact: true,
    })
    .fill("10.25");
  await form.getByLabel("Impressões", { exact: true }).fill("1000");
  await form.getByLabel("Cliques", { exact: true }).fill("10");
  await form
    .getByLabel("Referência real da origem (arquivo, relatório ou evidência)", {
      exact: true,
    })
    .fill("Exportação original Meta 2020");
  await form
    .getByRole("button", { name: "Salvar resultado real", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Resultado salvo");
  let state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.ana_metrics).toHaveLength(1);
  expect(state.ana_metrics[0].source_kind).toBe("manual");
  await page.goto("/analytics?from=2020-01-01&to=2020-01-01&compare=none");
  await expect(
    page.getByRole("img", { name: /Evolução por observação real/ }),
  ).toBeVisible();
  await page.goto(
    "/analytics?view=reports&from=2020-01-01&to=2020-01-01&compare=none",
  );
  form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: "Gerar relatório com dados reais",
        exact: true,
      }),
    });
  await form
    .getByRole("combobox", { name: "Cliente do relatório", exact: true })
    .selectOption(company);
  await form
    .getByLabel("Título do relatório", { exact: true })
    .fill("Relatório mensal de desempenho");
  await form
    .getByRole("button", {
      name: "Gerar relatório com dados reais",
      exact: true,
    })
    .click();
  await page.waitForURL(/\/analytics\/reports\//);
  await expect(
    page.getByRole("heading", {
      name: "Relatório mensal de desempenho",
      exact: true,
    }),
  ).toBeVisible();
  const pdf = await page.request.get(new URL(page.url()).pathname + "/pdf");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.goto("/analytics");
  await page
    .locator("summary")
    .filter({ hasText: /^Importar resultados por CSV$/ })
    .click();
  form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", { name: "Importar CSV real", exact: true }),
    });
  await form
    .getByRole("combobox", { name: "Campanha do arquivo", exact: true })
    .selectOption(campaign);
  await form
    .getByLabel("Origem do arquivo (exportação e data)", { exact: true })
    .fill("Exportação CSV original");
  await form
    .getByLabel("Arquivo CSV real", { exact: true })
    .setInputFiles({
      name: "resultados.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "period_from;period_to;spend\n2020-01-02;2020-01-02;20.50",
      ),
    });
  await form
    .getByRole("button", { name: "Importar CSV real", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "1 resultados importados",
  );
  state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.ana_metrics[1].source_kind).toBe("csv");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("accounts, campaigns and publication forms preserve mobile layout and demand confirmation", async ({
  page,
}) => {
  await login(page);
  await page.goto("/analytics?view=accounts");
  await page
    .locator("summary")
    .filter({ hasText: /^Nova conta de dados$/ })
    .click();
  await expect(
    page.getByLabel("Fuso IANA da fonte", { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/analytics?view=campaigns");
  await page
    .locator("summary")
    .filter({ hasText: /^Nova campanha de anúncios$/ })
    .click();
  await expect(
    page.getByLabel("Nome da campanha de anúncios", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/analytics?view=publication");
  await page
    .locator("summary")
    .filter({ hasText: /^Campanha de teste ·/ })
    .click();
  const form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", {
        name: "Atualizar publicação da campanha",
        exact: true,
      }),
    });
  await expect(
    form.getByRole("checkbox", { name: /Confirmo a operação/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/analytics?view=integrations");
  await expect(
    page.getByRole("heading", { name: "Meta Ads · desativada" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Google Ads · desativada" }),
  ).toBeVisible();
});
test("partner consults only published performance, GET filters and no editing / messaging actions", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: { mode: "analytics_published" },
  });
  await login(page, "partner");
  await page.goto("/partners?from=2020-01-01&to=2020-01-01&compare=none");
  await expect(
    page.getByRole("heading", { name: "Minha empresa", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Empresa A", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("R$ 10,25", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("ORIGEM INTERNA PRIVADA")).toHaveCount(0);
  await expect(page.getByText("999.99")).toHaveCount(0);
  expect(
    await page
      .locator("main form")
      .evaluateAll((forms) =>
        forms.every(
          (f) => (f as HTMLFormElement).method.toLowerCase() === "get",
        ),
      ),
  ).toBeTruthy();
  await expect(
    page.getByRole("button", {
      name: /Salvar|Aprovar|Solicitar|Enviar mensagem/,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/analytics");
  await expect(page).not.toHaveURL(/\/analytics/);
  const response = await page.request.get(
    "/analytics/reports/97000000-0000-0000-0000-000000000099/pdf",
  );
  expect(response.status()).toBe(404);
});
