import { z } from "zod";
export const accessInput = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(2).max(120),
    category: z.enum(["admin", "employee", "partner"]),
    active: z.enum(["true", "false"]),
    functions: z.array(
      z.enum([
        "sdr",
        "closer",
        "traffic",
        "designer",
        "video_editor",
        "copywriter",
      ]),
    ),
    company_ids: z.array(z.string().uuid()),
    confirm: z.literal("true"),
    reason: z.string().trim().min(8).max(2000),
    remove_from_campaign: z.enum(["true", "false"]),
  })
  .superRefine((data, ctx) => {
    if (data.category === "employee" && !data.functions.length)
      ctx.addIssue({ code: "custom", message: "Selecione uma função" });
    if (data.category === "partner" && !data.company_ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Vincule uma empresa ao parceiro",
      });
  });
export function accessForm(form: FormData) {
  const category = String(form.get("category"));
  return {
    id: form.get("id") ? String(form.get("id")) : undefined,
    name: String(form.get("name") ?? ""),
    category,
    active: String(form.get("active") ?? "true"),
    functions:
      category === "employee" ? form.getAll("functions").map(String) : [],
    company_ids:
      category === "admin" ? [] : form.getAll("company_ids").map(String),
    confirm: form.get("confirm"),
    reason: String(form.get("reason") ?? ""),
    remove_from_campaign:
      form.get("remove_from_campaign") === "true" ? "true" : "false",
  };
}
