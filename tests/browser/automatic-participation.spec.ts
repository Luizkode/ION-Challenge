import { test, expect } from "@playwright/test";
async function login(page: any, role: string) {
  await page.goto("/login");
  await page.getByLabel("Email profissional").fill(role + "@ion.test");
  await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
  await page.getByRole("button", { name: "Entrar no ION OS" }).click();
  await page.waitForURL("/");
}
test.beforeEach(async ({ request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", {
    data: {
      mode: "automatic_participation",
      seed: {
        participants: [
          {
            campaign_id: "30000000-0000-0000-0000-000000000001",
            profile_id: "10000000-0000-0000-0000-000000000001",
            team_id: null,
            active: true,
            profiles: { name: "SDR de teste" },
            teams: null,
          },
        ],
      },
    },
  });
});
test("ADM vê participação automática sem remover individualmente nem alocar equipe aleatória", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/admin");
  await expect(
    page.getByText("Na campanha · Sem equipe definida", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Remover da campanha", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Adicionar à campanha", { exact: true }),
  ).toHaveCount(0);
  await page.getByText("Definir time", { exact: true }).click();
  await expect(page.getByLabel("Time de SDR de teste")).toHaveValue("");
});
test("SDR sem equipe continua no ranking e pode abrir cadastro sem bloqueio por equipe", async ({
  page,
}) => {
  await login(page, "sdr");
  await page.goto("/challenger");
  await expect(
    page.getByText("Sem equipe definida", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/meetings/new");
  await expect(
    page.getByRole("button", { name: "Cadastrar reunião" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
