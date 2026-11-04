import { z } from "zod";
export const lifecycleSchema = z
  .object({
    target_id: z.string().guid("Informe um UUID válido."),
    request_id: z.string().guid(),
    mode: z.enum(["deactivate", "anonymize", "delete_test"]),
    reason: z
      .string()
      .trim()
      .min(8, "Explique o motivo com pelo menos 8 caracteres.")
      .max(2000),
    confirmation: z.string(),
    confirm: z.literal("true", {
      error: "Confirme que conferiu o usuário e o impacto.",
    }),
    test_account: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.confirmation !== v.target_id)
      ctx.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: "Digite o UUID completo do usuário selecionado.",
      });
    if (v.mode === "delete_test" && v.test_account !== "true")
      ctx.addIssue({
        code: "custom",
        path: ["test_account"],
        message: "Confirme que esta é uma conta de teste sem dados legítimos.",
      });
  });
export type LifecycleInspection = {
  dependencies: { relationship: string; records: number }[];
  owned_files: number;
  can_delete_test: boolean;
  auth_exists: boolean;
  profile_retained: boolean;
};
