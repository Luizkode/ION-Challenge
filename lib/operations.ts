import { z } from "zod";
export const relationships = {
  onboarding: "Em implantação",
  active: "Ativo",
  paused: "Pausado",
  inactive: "Inativo",
  ended: "Encerrado",
} as const;
export const contractStatuses = {
  preparation: "Em preparação",
  active: "Ativo",
  paused: "Pausado",
  ended: "Encerrado",
  cancelled: "Cancelado",
} as const;
export const serviceStatuses = {
  pending: "Pendente",
  running: "Em andamento",
  completed: "Concluído",
  paused: "Pausado",
} as const;
export const periods = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
  one_off: "Única",
  custom: "Personalizada",
} as const;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const optionalId = z.union([z.string().uuid(), z.literal("")]).optional();
const optionalDate = z.union([date, z.literal("")]).optional();
export const clientSchema = z.object({
  company_id: optionalId,
  version: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2).max(150),
  contact: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .pipe(z.string().min(10).max(15)),
  email: z
    .union([z.literal(""), z.string().trim().toLowerCase().email()])
    .default(""),
  niche: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  instagram: z.string().max(200).default(""),
  website: z
    .union([
      z.literal(""),
      z
        .string()
        .url()
        .regex(/^https?:\/\//),
    ])
    .default(""),
  joined_at: date,
  relationship: z.enum(["onboarding", "active", "paused", "inactive", "ended"]),
  partner_visible: z.boolean().default(false),
  admin_notes: z.string().max(10000).default(""),
  assignees: z.array(z.string().uuid()).max(100).default([]),
});
export const contractSchema = z.object({
  id: optionalId,
  version: z.coerce.number().int().positive().optional(),
  company_id: z.string().uuid(),
  reference: z.string().trim().min(3).max(150),
  starts_at: date,
  ends_at: optionalDate,
  min_months: z.coerce.number().int().min(0).max(120),
  amount: z.coerce.number().positive().max(999999999999.99),
  periodicity: z.enum(["monthly", "quarterly", "annual", "one_off", "custom"]),
  services_text: z.string().trim().min(2).max(4000),
  status: z.enum(["preparation", "active", "paused", "ended", "cancelled"]),
  responsible_id: z.string().uuid(),
  parent_id: optionalId,
  partner_visible: z.boolean().default(false),
});
export const serviceSchema = z.object({
  id: optionalId,
  version: z.coerce.number().int().positive().optional(),
  company_id: z.string().uuid(),
  contract_id: z.string().uuid(),
  catalog_id: z.string().uuid(),
  description: z.string().trim().min(2).max(4000),
  partner_description: z.string().max(4000).default(""),
  starts_at: date,
  due_at: optionalDate,
  delivered_at: optionalDate,
  status: z.enum(["pending", "running", "completed", "paused"]),
  partner_visible: z.boolean().default(false),
  assignees: z.array(z.string().uuid()).max(100).default([]),
});
export const allowedMime = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
export const fileSchema = z
  .object({
    company_id: z.string().uuid(),
    service_id: optionalId,
    contract_id: optionalId,
    name: z.string().trim().min(1).max(200),
    mime: z.enum(allowedMime),
    size: z.number().int().min(1).max(10485760),
  })
  .refine((v) => !v.service_id || !v.contract_id);
export type Client = z.infer<typeof clientSchema> & {
  company_id: string;
  version: number;
  created_at: string;
  access_companies: { name: string; active: boolean };
};
export type Contract = z.infer<typeof contractSchema> & {
  id: string;
  version: number;
  source_deal_id: string | null;
  commercial_contract_id: string | null;
};
export type Service = z.infer<typeof serviceSchema> & {
  id: string;
  version: number;
  ops_catalog: { name: string };
};
export type OperationalFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  state: string;
  partner_visible: boolean;
  service_id: string | null;
  contract_id: string | null;
  created_at: string;
  uploaded_by: string;
};
export type Update = {
  id: string;
  service_id: string | null;
  contract_id: string | null;
  body: string;
  partner_body: string;
  published: boolean;
  created_at: string;
  actor_id: string;
};
export type Person = { id: string; name: string };
export type Catalog = { id: string; name: string; active: boolean };
export type PartnerSnapshot = {
  id: string;
  services: {
    id: string;
    name: string;
    description: string;
    status: keyof typeof serviceStatuses;
    starts_at: string;
    due_at: string | null;
    delivered_at: string | null;
  }[];
  contracts: {
    id: string;
    reference: string;
    status: keyof typeof contractStatuses;
    starts_at: string;
    ends_at: string | null;
  }[];
  updates: { id: string; body: string; created_at: string }[];
  files: { id: string; name: string }[];
};
export function formObject(form: FormData) {
  return {
    ...Object.fromEntries(form),
    partner_visible: form.get("partner_visible") === "true",
    published: form.get("published") === "true",
    assignees: form.getAll("assignees").map(String),
  };
}
export function overdue(
  service: Pick<Service, "due_at" | "status">,
  today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date()),
) {
  return (
    !!service.due_at &&
    service.due_at < today &&
    ["pending", "running"].includes(service.status)
  );
}
