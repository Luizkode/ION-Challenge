import { z } from "zod";
export const stages = {
  new: "Novo lead",
  contacted: "Primeiro contato",
  replied: "Respondeu",
  interested: "Interessado",
  scheduled: "Reunião agendada",
  held: "Reunião realizada",
  proposed: "Proposta apresentada",
  negotiation: "Negociação",
  won: "Contrato fechado",
  lost: "Perdido",
} as const;
export type Stage = keyof typeof stages;
export const stageCodes = Object.keys(stages) as Stage[];
const optionalDate = z
  .union([z.literal(""), z.string().datetime({ offset: true })])
  .optional();
export const leadSchema = z.object({
  id: z.string().uuid().optional(),
  version: z.coerce.number().int().positive().optional(),
  company: z.string().trim().min(2).max(150),
  contact: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .transform((s) => s.replace(/\D/g, ""))
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
  source: z.string().trim().min(2).max(100),
  sdr_id: z.string().uuid().optional(),
  closer_id: z.union([z.string().uuid(), z.literal("")]).optional(),
  notes: z.string().max(10000).default(""),
  follow_up_at: optionalDate,
});
export type LeadInput = z.infer<typeof leadSchema>;
export type Lead = Omit<LeadInput, "closer_id" | "follow_up_at"> & {
  id: string;
  version: number;
  stage: Stage;
  sdr_id: string;
  closer_id: string | null;
  created_at: string;
  updated_at: string;
  last_contact_at: string | null;
  follow_up_at: string | null;
  archived: boolean;
};
export type Activity = {
  id: string;
  lead_id: string;
  actor_id: string;
  kind: string;
  channel: string;
  description: string;
  created_at: string;
};
export type Deal = {
  id: string;
  lead_id: string;
  amount: number;
  services: string;
  term_months: number;
  result: string;
  reason: string;
  created_at: string;
  contract_id: string | null;
};
export type CrmMeeting = {
  id: string;
  opportunity_id: string;
  closer_id: string;
  scheduled_at: string;
  status: string;
  notes: string;
  opportunities: {
    crm_lead_id: string | null;
    company: string;
    campaign_id: string | null;
    sdr_id: string;
  };
};
export type Person = {
  id: string;
  name: string;
  is_sdr: boolean;
  is_closer: boolean;
};
export const meetingInput = z.object({
  lead_id: z.string().uuid(),
  closer_id: z.string().uuid(),
  scheduled_at: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).default(""),
});
export const dealInput = z.object({
  lead_id: z.string().uuid(),
  amount: z.coerce.number().positive().max(999999999999.99),
  services: z.string().trim().min(2).max(2000),
  term_months: z.coerce.number().int().min(1).max(120),
  result: z.enum(["proposal", "negotiation", "won", "lost"]),
  reason: z.string().max(2000).default(""),
});
export function crmMetrics(
  leads: Lead[],
  activities: Activity[],
  meetings: CrmMeeting[],
  deals: Deal[],
) {
  const contacts = activities.filter((a) => a.kind === "contact");
  const contacted = new Set(contacts.map((a) => a.lead_id));
  const responded = new Set(
    activities
      .filter((a) => a.kind === "response" && contacted.has(a.lead_id))
      .map((a) => a.lead_id),
  );
  const held = meetings.filter((m) => ["held", "qualified"].includes(m.status));
  const terminal = meetings.filter((m) =>
    ["held", "qualified", "no_show"].includes(m.status),
  );
  const won = new Set(
    deals.filter((d) => d.result === "won").map((d) => d.lead_id),
  );
  const proposals = new Set(
    deals.filter((d) => d.result === "proposal").map((d) => d.lead_id),
  );
  const percent = (n: number, d: number) =>
    d ? +((n / d) * 100).toFixed(1) : 0;
  return {
    leads: leads.length,
    contacts: contacts.length,
    response: percent(responded.size, contacted.size),
    scheduled: meetings.length,
    held: held.length,
    attendance: percent(held.length, terminal.length),
    proposals: proposals.size,
    won: won.size,
    conversion: percent(
      leads.filter((l) => won.has(l.id)).length,
      leads.length,
    ),
  };
}
// RFC4180 subset: comma/semicolon delimiter, escaped quotes, embedded newlines, BOM.
export function parseLeadCsv(text: string): {
  rows: LeadInput[];
  errors: string[];
} {
  if (text.length > 2_000_000)
    return { rows: [], errors: ["Arquivo excede 2 MB."] };
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = source.split(/\r?\n/)[0].includes(";") ? ";" : ",";
  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) table.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) return { rows: [], errors: ["Aspas não fechadas no CSV."] };
  row.push(field);
  if (row.some((v) => v.trim())) table.push(row);
  const headers = table.shift()?.map((v) => v.trim()) ?? [];
  const required = [
    "company",
    "contact",
    "phone",
    "niche",
    "city",
    "state",
    "source",
  ];
  if (
    required.some((h) => !headers.includes(h)) ||
    new Set(headers).size !== headers.length
  )
    return {
      rows: [],
      errors: [
        "Cabeçalhos obrigatórios: " +
          required.join(", ") +
          ". Sem colunas repetidas.",
      ],
    };
  if (!table.length || table.length > 500)
    return { rows: [], errors: ["O arquivo deve conter de 1 a 500 leads."] };
  const rows: LeadInput[] = [];
  const errors: string[] = [];
  const phones = new Set<string>();
  const emails = new Set<string>();
  table.forEach((r, i) => {
    const data = Object.fromEntries(headers.map((h, n) => [h, r[n] ?? ""]));
    delete data.id;
    delete data.version;
    const parsed = leadSchema.safeParse(data);
    if (r.length !== headers.length || !parsed.success) {
      errors.push(`Linha ${i + 2}: campos inválidos.`);
      return;
    }
    if (
      phones.has(parsed.data.phone) ||
      (parsed.data.email && emails.has(parsed.data.email))
    ) {
      errors.push(`Linha ${i + 2}: WhatsApp ou email repetido no arquivo.`);
      return;
    }
    phones.add(parsed.data.phone);
    if (parsed.data.email) emails.add(parsed.data.email);
    rows.push(parsed.data);
  });
  return { rows, errors };
}
