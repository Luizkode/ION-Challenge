import { redirect } from "next/navigation";
import { session } from "./session";
import { financePeriod } from "./finance";
import { z } from "zod";
export async function financeAdmin() {
  const s = await session();
  if (s.profile.category !== "admin")
    redirect(
      "/?error=Você+não+tem+permissão+para+acessar+este+módulo.+Financeiro+restrito+ao+administrador",
    );
  return s;
}
export function financeFilters(p: Record<string, string | undefined>) {
  const period = financePeriod(p);
  return {
    ...period,
    company_id: z.string().uuid().safeParse(p.company_id).success
      ? p.company_id
      : "",
    category_id: z.string().uuid().safeParse(p.category_id).success
      ? p.category_id
      : "",
    basis: p.basis === "competence" ? "competence" : "due",
    kind: ["income", "expense"].includes(p.kind ?? "") ? p.kind : "",
    status: [
      "planned",
      "pending",
      "received",
      "paid",
      "partial",
      "cancelled",
      "overdue",
    ].includes(p.status ?? "")
      ? p.status
      : "",
  };
}
