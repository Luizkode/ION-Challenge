import { redirect } from "next/navigation";
import { session } from "./session";
import { analyticsPeriod } from "./analytics";
import { z } from "zod";
export async function analyticsContext() {
  const s = await session();
  if (
    s.profile.category === "partner" ||
    (s.profile.category !== "admin" &&
      !s.profile.analytics &&
      !s.profile.functions.includes("traffic"))
  )
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  return s;
}
export function analyticsFilters(p: Record<string, string | undefined>) {
  const ids = Object.fromEntries(
    ["company_id", "account_id", "contract_id", "campaign_id"].map((k) => [
      k,
      z.string().uuid().safeParse(p[k]).success ? p[k] : "",
    ]),
  );
  return {
    ...analyticsPeriod(p),
    ...(ids as Record<
      "company_id" | "account_id" | "contract_id" | "campaign_id",
      string
    >),
    platform: ["meta", "google", "other"].includes(p.platform ?? "")
      ? p.platform
      : "",
    only_published: p.only_published === "true",
  };
}
