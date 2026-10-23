import { z } from "zod";
export const accessInput = z
  .object({
    id: z
      .string()
      .uuid("Informe um UUID válido do usuário em Authentication.")
      .optional(),
    name: z
      .string()
      .trim()
      .min(2, "Informe um nome com pelo menos 2 caracteres.")
      .max(120, "O nome deve ter no máximo 120 caracteres."),
    category: z.enum(["admin", "employee", "partner"], {
      errorMap: () => ({
        message: "Selecione Administrador, Colaborador ou Parceiro.",
      }),
    }),
    active: z.enum(["true", "false"], {
      errorMap: () => ({ message: "Selecione Ativo ou Inativo." }),
    }),
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
    company_ids: z.array(z.string().uuid("Selecione uma empresa válida.")),
    confirm: z.literal("true", {
      errorMap: () => ({ message: "Confirme a operação antes de continuar." }),
    }),
    reason: z
      .string()
      .trim()
      .min(8, "Explique o motivo com pelo menos 8 caracteres.")
      .max(2000, "A justificativa deve ter no máximo 2000 caracteres."),
    remove_from_campaign: z.enum(["true", "false"]),
  })
  .superRefine((data, ctx) => {
    if (data.category === "employee" && !data.functions.length)
      ctx.addIssue({
        code: "custom",
        path: ["functions"],
        message:
          "Selecione pelo menos uma função para o colaborador (por exemplo, SDR).",
      });
    if (data.category === "partner" && !data.company_ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["company_ids"],
        message: "Selecione pelo menos uma empresa para o parceiro.",
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
export type AccessMode = "invite" | "edit" | "link";
export type FieldErrors = Record<string, string[]>;
export type TeamFailure = {
  ok: false;
  kind:
    "validation" | "permission" | "infrastructure" | "conflict" | "uncertain";
  message: string;
  fields: FieldErrors;
};
export type TeamResult = TeamFailure | { ok: true; message: string };
export function validateAccess(form: FormData, mode: AccessMode) {
  const raw = accessForm(form);
  const input = accessInput.safeParse(raw);
  const fields: FieldErrors = {};
  if (!input.success)
    for (const issue of input.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fields[key] ??= []).push(issue.message);
    }
  if (raw.category === "employee" && !raw.functions.length && !fields.functions)
    fields.functions = [
      "Selecione pelo menos uma função para o colaborador (por exemplo, SDR).",
    ];
  if (
    raw.category === "partner" &&
    !raw.company_ids.length &&
    !fields.company_ids
  )
    fields.company_ids = ["Selecione pelo menos uma empresa para o parceiro."];
  if (mode !== "invite" && !form.get("id"))
    fields.id = ["Informe o UUID da conta existente em Authentication."];
  const email = z
    .string()
    .trim()
    .email("Informe um email válido para o convite.")
    .safeParse(form.get("email"));
  if (mode === "invite" && !email.success)
    fields.email = ["Informe um email válido para o convite."];
  return { input, email, fields };
}
export function teamDatabaseError(error: {
  code?: string;
  message?: string;
}): TeamFailure {
  const message = error.message ?? "";
  let field = "";
  if (/remover.*campanha|retirar.*SDR/i.test(message))
    field = "remove_from_campaign";
  else if (/empresa|parceiro.*vincul/i.test(message)) field = "company_ids";
  else if (/funç|Selecione.*fun/i.test(message)) field = "functions";
  else if (/justificativa/i.test(message)) field = "reason";
  else if (/email/i.test(message)) field = "email";
  if (error.code === "P0001")
    return {
      ok: false,
      kind: /administrador|acesso administrativo/i.test(message)
        ? "permission"
        : "validation",
      message,
      fields: field ? { [field]: [message] } : {},
    };
  if (error.code === "23503")
    return {
      ok: false,
      kind: "validation",
      message:
        "A conta ou empresa selecionada não foi encontrada. Confira os dados antes de salvar.",
      fields: { id: ["Confirme que este UUID existe em Authentication."] },
    };
  if (error.code === "23505")
    return {
      ok: false,
      kind: "conflict",
      message:
        "Já existe um cadastro ou convite pendente com esses dados. Consulte os usuários e o histórico de convites.",
      fields: {
        email: [
          "Confira se este email já está cadastrado ou possui convite pendente.",
        ],
      },
    };
  if (error.code === "42501" || error.code === "PGRST301")
    return {
      ok: false,
      kind: "permission",
      message:
        "Sua sessão não tem permissão para esta operação. Entre novamente com uma conta administrativa ativa.",
      fields: {},
    };
  return {
    ok: false,
    kind: "infrastructure",
    message:
      "O Supabase não confirmou a alteração. Confira a conexão e recarregue o usuário antes de repetir a operação.",
    fields: {},
  };
}
export function invitationError(error: {
  code?: string;
  status?: number;
  message?: string;
}): TeamFailure {
  const code = error.code ?? "",
    message = error.message ?? "";
  if (
    ["email_exists", "user_already_exists"].includes(code) ||
    /already.*registered|already.*exists/i.test(message)
  )
    return {
      ok: false,
      kind: "conflict",
      message:
        "Este email já possui uma conta. Edite o usuário existente ou use “Vincular conta existente”; um novo convite não altera seu perfil.",
      fields: { email: ["Este email já está cadastrado."] },
    };
  if (code === "email_address_invalid")
    return {
      ok: false,
      kind: "validation",
      message: "O serviço de autenticação recusou o endereço de email.",
      fields: { email: ["Confira o endereço de email informado."] },
    };
  if (
    code === "email_address_not_authorized" ||
    /not authorized.*email|email.*not authorized/i.test(message)
  )
    return {
      ok: false,
      kind: "infrastructure",
      message:
        "O envio padrão do Supabase não autorizou este destinatário. Configure SMTP próprio para convidar usuários externos. Nenhuma permissão foi concedida.",
      fields: {
        email: ["Destinatário não autorizado pelo serviço de email atual."],
      },
    };
  if (
    ["over_email_send_rate_limit", "over_request_rate_limit"].includes(code) ||
    error.status === 429
  )
    return {
      ok: false,
      kind: "infrastructure",
      message:
        "O Supabase atingiu o limite de envio de emails. Aguarde antes de tentar novamente; não envie o formulário repetidamente. Nenhuma permissão foi concedida.",
      fields: {},
    };
  return {
    ok: false,
    kind: "infrastructure",
    message:
      "O serviço de email não concluiu o convite. Verifique SMTP, remetente e os logs de Auth no Supabase. Nenhuma permissão foi concedida.",
    fields: {},
  };
}
