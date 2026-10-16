import { test, expect } from "@playwright/test";

test("convite padrão com fragmento cria sessão e limpa tokens da URL", async ({ page, request }) => {
  await request.post("http://127.0.0.1:3101/__test/state", { data: { mode: "active" } });
  const response = await request.post("http://127.0.0.1:3101/auth/v1/token?grant_type=password", {
    data: { email: "admin@ion.test", password: "test-only-password" },
  });
  const session = await response.json();
  await page.goto("/auth/callback#access_token=" + session.access_token + "&refresh_token=" + session.refresh_token + "&type=invite");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Definir senha" })).toBeVisible();
  expect(page.url()).not.toContain("access_token");
  await page.goto("/team");
  await expect(page.getByRole("heading", { name: "Equipe", exact: true })).toBeVisible();
});

test("callback sem sessão não libera conta nem preserva fragmento inválido", async ({ page }) => {
  await page.goto("/auth/callback#error=access_denied&type=invite");
  await expect(page).toHaveURL(/\/login\?error=/);
  await expect(page.locator(".notice.error[role=alert]")).toHaveText("Link inválido ou expirado");
  expect(page.url()).not.toContain("#");
});
