import { test, expect, type Page } from "@playwright/test";
const leadId = "92000000-0000-0000-0000-000000000001",
  meetingId = "92000000-0000-0000-0000-000000000002";
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL(role === "partner" ? "/partners" : "/");
}
test.beforeEach(async ({ request }) => {
  const now = new Date().toISOString();
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: {
      mode: "active",
      seed: {
        crm_leads: [
          {
            id: leadId,
            company: "Operação comercial",
            contact: "Contato comercial",
            phone: "11987654321",
            email: "",
            city: "São Paulo",
            state: "SP",
            niche: "Serviços",
            source: "Teste",
            notes: "",
            stage: "scheduled",
            version: 1,
            sdr_id: "10000000-0000-0000-0000-000000000001",
            closer_id: "10000000-0000-0000-0000-000000000002",
            created_at: now,
            updated_at: now,
            archived: false,
          },
        ],
        meetings: [
          {
            id: meetingId,
            version: 1,
            closer_id: "10000000-0000-0000-0000-000000000002",
            scheduled_at: new Date(Date.now() - 3600000).toISOString(),
            status: "scheduled",
            notes: "Informação prévia",
            meeting_url: "https://meet.example.test/comercial",
            opportunities: {
              crm_lead_id: leadId,
              company: "Operação comercial",
              contact: "Contato comercial",
              phone: "11987654321",
              sdr_id: "10000000-0000-0000-0000-000000000001",
              campaign_id: null,
            },
          },
        ],
      },
    },
  });
});
test("closer registra resultado e retorno, conclui e preserva histórico em desktop e mobile", async ({
  page,
}) => {
  await login(page, "closer");
  await page.goto("/crm");
  await expect(
    page.getByRole("heading", { name: "Reuniões de hoje", exact: true }),
  ).toBeVisible();
  await page.screenshot({path:"/tmp/ion-crm-agenda/closer-"+test.info().project.name+".png",fullPage:false});
  await page.goto("/crm/meetings/" + meetingId + "#result");
  await page
    .getByLabel("Observações comerciais")
    .fill("Precisa de mais leads qualificados");
  await page.getByLabel("Necessidades identificadas").fill("Captação regional");
  await page.getByLabel("Principais objeções").fill("Prazo para decidir");
  await page
    .getByLabel("Próxima ação", { exact: true })
    .fill("Retomar com sócio");
  await page
    .getByLabel("Data e horário do follow-up", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page
    .getByRole("button", { name: "Salvar resultado", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Resultado registrado");
  await page.reload();
  await expect(
    page.getByText("Captação regional", { exact: false }),
  ).toBeVisible();
  await page.goto("/crm/followups?view=upcoming");
  await expect(
    page.getByText("Retomar com sócio", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Registrar contato / concluir" })
    .click();
  await page
    .getByLabel("Resultado da conversa")
    .fill("Sócio confirmou interesse");
  await page
    .getByRole("button", { name: "Salvar contato", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Follow-up atualizado");
  await page.reload();
  await expect(
    page.getByText("Sócio confirmou interesse", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Concluído", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("SDR agenda da tela principal reutilizando cadastro e vê confirmação persistida", async ({
  page,
  request,
}) => {
  await login(page, "sdr");
  await page.goto("/crm");
  await page
    .getByRole("link", { name: "Agendar reunião", exact: true })
    .click();
  await page.getByLabel("Lead ou empresa").selectOption(leadId);
  await page.getByRole("button", { name: "Selecionar lead" }).click();
  await expect(page.getByText(/Dados reutilizados do lead/)).toBeVisible();
  await page
    .getByLabel("Data e horário", { exact: true })
    .fill(new Date(Date.now() + 172800000).toISOString().slice(0, 16));
  await page
    .getByLabel("Link da reunião", { exact: true })
    .fill("https://meet.example.test/nova");
  await page
    .getByRole("button", { name: "Agendar reunião", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Reunião agendada");
  const state = await (
    await request.get("http://127.0.0.1:3101/__test/state")
  ).json();
  expect(state.meetings).toHaveLength(2);
  await page.goto("/crm/agenda?view=upcoming");
  await expect(
    page.getByRole("link", { name: "Abrir link da reunião" }),
  ).toHaveAttribute("href", "https://meet.example.test/nova");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("closer vê ausência e reagenda sem apagar reunião anterior", async ({
  page,
}) => {
  await login(page, "closer");
  await page.goto("/crm/meetings/" + meetingId + "?outcome=no_show#result");
  await expect(
    page.getByLabel("Resultado da reunião", { exact: true }),
  ).toHaveValue("no_show");
  await page
    .getByLabel("Observações comerciais")
    .fill("Contato não compareceu");
  await page
    .getByRole("button", { name: "Salvar resultado", exact: true })
    .click();
  await page
    .getByLabel("Novo agendamento", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Confirmar reagendamento" }).click();
  await expect(page.getByRole("status")).toContainText("Reunião reagendada");
  await expect(
    page.getByRole("link", { name: "Consultar agendamento anterior" }),
  ).toHaveAttribute("href", "/crm/meetings/" + meetingId);
});
for (const role of ["traffic", "partner"])
  test(role + " não acessa agenda nem follow-ups", async ({ page }) => {
    await login(page, role);
    for (const path of [
      "/crm/agenda",
      "/crm/followups",
      "/crm/meetings/" + meetingId,
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(
        role === "partner" ? /\/partners$/ : /error=Sem/,
      );
    }
  });
