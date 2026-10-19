import { z } from "zod";
export const moneyInput = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Use reais com até duas casas decimais")
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v) && cents(v) > 0n);
export const dateInput = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v + "T12:00:00Z")) &&
      new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v,
  );
const optionalId = z.union([z.string().uuid(), z.literal("")]).optional();
const common = {
  id: optionalId,
  version: z.string().regex(/^\d+$/).optional(),
  description: z.string().trim().min(3).max(250),
  kind: z.enum(["income", "expense"]),
  company_id: optionalId,
  contract_id: optionalId,
  category_id: z.string().uuid(),
  amount: moneyInput,
  notes: z.string().max(4000).default(""),
  reason: z.string().max(2000).optional(),
};
export const entrySchema = z.object({
  ...common,
  request_id: z.string().uuid().optional(),
  competence: dateInput,
  due_at: dateInput,
  state: z.enum(["planned", "pending", "cancelled"]),
  expense_type: z.enum(["fixed", "variable", "recurring", "one_off"]),
});
export const scheduleSchema = z
  .object({
    ...common,
    starts_at: dateInput,
    ends_at: z.union([dateInput, z.literal("")]),
    due_day: z.string().regex(/^([1-9]|[12]\d|3[01])$/),
    months: z.enum(["1", "3", "12"]),
    active: z.enum(["true", "false"]),
  })
  .refine((v) => !v.ends_at || v.ends_at >= v.starts_at);
export const ruleSchema = z
  .object({
    id: optionalId,
    version: z.string().regex(/^\d+$/).optional(),
    name: z.string().trim().min(3).max(120),
    profile_id: optionalId,
    function_code: z.union([
      z.enum([
        "sdr",
        "closer",
        "traffic",
        "designer",
        "video_editor",
        "copywriter",
      ]),
      z.literal(""),
    ]),
    basis: z.enum(["fixed", "percent"]),
    rate: moneyInput,
    starts_at: dateInput,
    ends_at: z.union([dateInput, z.literal("")]),
    active: z.enum(["true", "false"]),
    reason: z.string().max(2000).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.profile_id) !== Boolean(v.function_code) &&
      (!v.ends_at || v.ends_at >= v.starts_at),
  );
export const settlementSchema = z.object({
  entry_id: z.string().uuid(),
  amount: moneyInput,
  paid_at: dateInput,
  method: z.string().trim().min(2).max(80),
  notes: z.string().max(4000),
  reversal_of: optionalId,
  request_id: z.string().uuid(),
});
export const statuses: Record<string, string> = {
  planned: "Previsto",
  pending: "Pendente",
  received: "Recebido",
  paid: "Pago",
  partial: "Parcialmente liquidado",
  cancelled: "Cancelado",
  overdue: "Vencido",
};
export function cents(value: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Valor monetário inválido");
  const negative = value.startsWith("-");
  const [whole, part = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"))) * (negative ? -1n : 1n)
  );
}
export function brl(value: string | null | undefined) {
  if (value === null) return "Histórico indisponível";
  const n = cents(value ?? "0");
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}R$ ${(abs / 100n).toLocaleString("pt-BR")},${String(abs % 100n).padStart(2, "0")}`;
}
export function financePeriod(
  p: Record<string, string | undefined>,
  now = new Date(),
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month ?? "")
    ? p.month!
    : today.slice(0, 7);
  const end = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const from = p.from || month + "-01",
    to = p.to || end;
  if (
    !dateInput.safeParse(from).success ||
    !dateInput.safeParse(to).success ||
    from > to ||
    Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 9
  )
    throw new Error("Informe um período válido de até 10 anos");
  return { from, to, month };
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v ?? "");
            if (/^[=+@\-\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s))
              s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
export type FinEntry = {
  id: string;
  kind: "income" | "expense";
  description: string;
  company_id: string | null;
  contract_id: string | null;
  category_id: string;
  amount: string;
  paid: string;
  balance: string;
  competence: string;
  due_at: string;
  state: string;
  status: string;
  expense_type: string;
  notes: string;
  version: number;
  company?: string;
  category?: string;
  beneficiary?: string;
  rule_id?: string;
  commercial_contract_id?: string;
  rule_snapshot?: unknown;
};
export type Schedule = {
  id: string;
  kind: string;
  company_id: string | null;
  contract_id: string | null;
  category_id: string;
  description: string;
  amount: string;
  starts_at: string;
  ends_at: string | null;
  due_day: number;
  months: number;
  active: boolean;
  notes: string;
  version: number;
};
export type Rule = {
  id: string;
  name: string;
  profile_id: string | null;
  function_code: string | null;
  basis: string;
  rate: string;
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  version: number;
};
export type Options = {
  categories: { id: string; name: string; kind: string }[];
  companies: { id: string; name: string }[];
  contracts: {
    id: string;
    company_id: string;
    company: string;
    reference: string;
    status: string;
    starts_at: string;
    ends_at: string | null;
    amount: string;
    periodicity: string;
  }[];
  people: { id: string; name: string }[];
  schedules: Schedule[];
  rules: Rule[];
  closures: {
    id: string;
    reference: string;
    company: string;
    amount: string;
  }[];
};
export type Daily = {
  day: string;
  income: string;
  expense: string;
  expected_income: string;
  expected_expense: string;
};
export type Report = {
  stats: Record<string, string | null>;
  entries: FinEntry[];
  daily: Daily[];
  cash: {
    id: string;
    entry_id: string;
    description: string;
    kind: string;
    paid_at: string;
    method: string;
    signed_amount: string;
    reversal_of: string | null;
  }[];
  categories: { name: string; kind: string; amount: string }[];
  delinquency: { company: string; amount: string }[];
  commissions: {
    beneficiary: string;
    amount: string;
    paid: string;
    balance: string;
  }[];
};

export function daysOverdue(due: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return Math.max(
    0,
    Math.round(
      (Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) /
        86400000,
    ),
  );
}
