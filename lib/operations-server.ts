import { redirect } from "next/navigation";
import { session } from "./session";
import { canAccessModule } from "./os-modules";
export async function operationsContext() {
  const s = await session();
  if (!canAccessModule("clients", s.profile))
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  return s;
}
export async function operationsAdmin() {
  const s = await operationsContext();
  if (s.profile.category !== "admin")
    redirect("/clients?error=Acesso+restrito+ao+administrador");
  return s;
}
