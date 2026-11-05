import { z } from "zod";
export const commercialOutcomes = {
  negotiation: "Reunião realizada — negociação em andamento",
  proposal: "Proposta apresentada",
  won: "Contrato fechado",
  no_show: "Não compareceu",
  lost: "Sem interesse",
} as const;
export const saoPaulo = "America/Sao_Paulo";
export function commercialDay(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: saoPaulo,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
export function dayBounds(day = commercialDay()) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(day + "T00:00:00-03:00"))
  )
    throw new Error("Data inválida");
  const start = new Date(day + "T00:00:00-03:00");
  if (commercialDay(start) !== day) throw new Error("Data inválida");
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 86400000).toISOString(),
  };
}
export function commercialDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    timeZone: saoPaulo,
    dateStyle: "short",
    timeStyle: "short",
  });
}
export function whatsapp(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return "https://wa.me/" + (digits.length <= 11 ? "55" : "") + digits;
}
const uuid = z.string().guid();
const date = z.string().datetime({ offset: true });
const optionalDate = z.union([date, z.literal("")]).optional();
const link = z
  .union([
    z.literal(""),
    z.url().refine((s) => /^https?:\/\//.test(s), "Use um link http ou https"),
  ])
  .default("");
export const agendaMeetingInput = z.object({
  request_id: uuid,
  lead_id: uuid,
  closer_id: uuid,
  scheduled_at: date,
  meeting_url: link,
  notes: z.string().max(2000).default(""),
});
export const resultInput = z
  .object({
    request_id: uuid,
    id: uuid,
    lead_id: uuid,
    version: z.coerce.number().int().positive(),
    outcome: z.enum(["negotiation", "proposal", "won", "no_show", "lost"]),
    notes: z
      .string()
      .trim()
      .min(1, "Informe as observações comerciais")
      .max(2000),
    needs: z.string().max(4000).default(""),
    objections: z.string().max(4000).default(""),
    services: z.string().max(2000).default(""),
    amount: z
      .union([z.literal(""), z.coerce.number().positive().max(999999999999.99)])
      .optional(),
    term_months: z
      .union([z.literal(""), z.coerce.number().int().min(1).max(120)])
      .optional(),
    next_action: z.string().max(2000).default(""),
    follow_up_at: optionalDate,
    assigned_to: z.union([uuid, z.literal("")]).optional(),
    qualified: z.enum(["true", "false"]).default("false"),
  })
  .superRefine((v, ctx) => {
    if (["proposal", "won"].includes(v.outcome) || v.amount) {
      for (const [key, ok] of [
        ["amount", !!v.amount],
        ["services", v.services.trim().length >= 2],
        ["term_months", !!v.term_months],
      ] as const)
        if (!ok)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "Obrigatório para proposta ou contrato",
          });
    }
    if (v.follow_up_at && ["lost", "won"].includes(v.outcome))
      ctx.addIssue({
        code: "custom",
        path: ["follow_up_at"],
        message: "Não programe retorno para negociação encerrada",
      });
  });
export const followupInput = z
  .object({
    request_id: uuid,
    lead_id: uuid,
    id: uuid.optional(),
    version: z.coerce.number().int().positive().optional(),
    operation: z.enum([
      "create",
      "contact",
      "complete",
      "reschedule",
      "cancel",
    ]),
    assigned_to: z.union([uuid, z.literal("")]).optional(),
    due_at: optionalDate,
    next_due_at: optionalDate,
    reason: z.string().max(2000).default(""),
    result: z.string().max(4000).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.operation !== "create" && (!v.id || !v.version))
      ctx.addIssue({ code: "custom", message: "Recarregue o follow-up" });
    if (["create", "reschedule"].includes(v.operation) && !v.due_at)
      ctx.addIssue({
        code: "custom",
        path: ["due_at"],
        message: "Informe data e horário",
      });
    if (v.operation === "create" && !v.reason.trim())
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Informe o motivo do retorno",
      });
    if (
      ["complete", "contact", "cancel"].includes(v.operation) &&
      !v.result.trim()
    )
      ctx.addIssue({
        code: "custom",
        path: ["result"],
        message: "Informe o resultado ou motivo",
      });
  });
export const rescheduleInput = z.object({
  request_id: uuid,
  id: uuid,
  lead_id: uuid,
  version: z.coerce.number().int().positive(),
  scheduled_at: date,
  closer_id: z.union([uuid, z.literal("")]).optional(),
  meeting_url: link,
});
export type AgendaLead = {
  id: string;
  company: string;
  contact: string;
  phone: string;
  sdr_id: string;
  closer_id: string | null;
  stage: string;
  archived: boolean;
};
export type AgendaMeeting = {
  id: string;
  version: number;
  closer_id: string;
  scheduled_at: string;
  status: string;
  notes: string;
  meeting_url: string;
  rescheduled_from_id: string | null;
  opportunities: {
    crm_lead_id: string;
    company: string;
    contact: string;
    phone: string;
    sdr_id: string;
    campaign_id: string | null;
  };
};
export type Followup = {
  id: string;
  lead_id: string;
  meeting_id: string | null;
  assigned_to: string;
  due_at: string;
  reason: string;
  status: string;
  result: string;
  version: number;
  updated_at: string;
  crm_leads: AgendaLead;
};
