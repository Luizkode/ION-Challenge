import { redirect } from "next/navigation";
import { session } from "./session";
import { canAccessModule } from "./os-modules";
import type { Person } from "./crm";
export async function crmContext() {
  const s = await session();
  if (!canAccessModule("crm", s.profile)) redirect("/?error=Sem+acesso+ao+CRM");
  return s;
}
export async function crmDirectory(
  db: Awaited<ReturnType<typeof session>>["db"],
) {
  const { data, error } = await db.rpc("crm_directory");
  if (error) throw new Error("Não foi possível consultar responsáveis do CRM.");
  return (data ?? []) as Person[];
}
