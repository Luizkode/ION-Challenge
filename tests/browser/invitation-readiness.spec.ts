import { test, expect } from "@playwright/test";

// Contract regression only: all requests go to the local fixture, never an email provider.
// These cases do not establish mailbox delivery or operational SMTP readiness.
const cases = [
  { label: "SDR", category: "employee", functions: ["SDR"], codes: ["sdr"] },
  {
    label: "closer",
    category: "employee",
    functions: ["Closer"],
    codes: ["closer"],
  },
  {
    label: "Produção",
    category: "employee",
    functions: ["Designer", "Gestor de Tráfego"],
    codes: ["designer", "traffic"],
  },
  { label: "Parceiro", category: "partner", functions: [], codes: [] },
];
for (const role of cases)
  test(`fixture sem envio externo: contrato do convite de ${role.label}`, async ({
    page,
    request,
  }) => {
    await request.post("http://127.0.0.1:3101/__test/state", {
      data: { mode: "active" },
    });
    await page.goto("/login");
    await page.getByLabel("Email profissional").fill("admin@ion.test");
    await page.getByLabel("Senha", { exact: true }).fill("test-only-password");
    await page.getByRole("button", { name: "Entrar no ION OS" }).click();
    await page.waitForURL("/");
    await page.goto("/team");
    const form = page
      .locator("form")
      .filter({ has: page.getByLabel("Email do convite") });
    await form
      .getByLabel("Email do convite")
      .fill("fixture-invitation@ion.test");
    await form
      .getByLabel("Nome", { exact: true })
      .fill("Pessoa de teste de convite");
    await form.getByLabel("Categoria de acesso").selectOption(role.category);
    for (const label of role.functions)
      await form.getByLabel(label, { exact: true }).check();
    if (role.category === "partner")
      await form.getByLabel("Empresa A", { exact: true }).check();
    await form
      .getByLabel("Justificativa (mínimo 8 caracteres)")
      .fill("Verificação automatizada sem envio externo");
    await form.getByRole("checkbox", { name: /Confirmo/ }).check();
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Enviar convite" }).click();
    await expect(form.getByRole("status")).toContainText(
      "não comprova a entrega",
    );
    const state = await (
      await request.get("http://127.0.0.1:3101/__test/state")
    ).json();
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0].category).toBe(role.category);
    expect(state.invitations[0].functions.sort()).toEqual(
      [...role.codes].sort(),
    );
    expect(state.invitations[0].company_ids).toHaveLength(
      role.category === "partner" ? 1 : 0,
    );
    expect(state.invitations[0].status).toBe("completed");
    expect(await page.content()).not.toContain("test-only-service-role");
  });
