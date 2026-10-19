import { z } from "zod";
import { dateInput, brl } from "./finance";
export const metricDefinitions = {
  spend: {
    label: "Investimento publicitário",
    unit: "money",
    definition:
      "Valor real investido pelo cliente em anúncios, em BRL; não é pagamento à ION.",
  },
  reach: {
    label: "Alcance único",
    unit: "count",
    definition:
      "Pessoas únicas na observação original. Não somado entre períodos/campanhas.",
  },
  impressions: {
    label: "Impressões",
    unit: "count",
    definition: "Exibições registradas nas fontes selecionadas.",
  },
  frequency: {
    label: "Frequência",
    unit: "ratio",
    definition:
      "Impressões / alcance único; somente quando há uma observação compatível.",
  },
  clicks: {
    label: "Cliques",
    unit: "count",
    definition:
      "Cliques reportados; a definição e metodologia da conta precisam ser consistentes.",
  },
  ctr: {
    label: "CTR",
    unit: "percent",
    definition:
      "100 × cliques / impressões, em medidas completas e de mesma conta.",
  },
  cpc: { label: "CPC", unit: "money", definition: "Investimento / cliques." },
  cpm: {
    label: "CPM",
    unit: "money",
    definition: "1000 × investimento / impressões.",
  },
  leads: {
    label: "Leads reportados",
    unit: "count",
    definition:
      "Leads informados pela fonte; não representam deduplicação global de pessoas.",
  },
  cpl: {
    label: "Custo por lead",
    unit: "money",
    definition: "Investimento / leads reportados.",
  },
  conversions: {
    label: "Conversões atribuídas",
    unit: "decimal",
    definition:
      "Créditos de conversão da fonte. Aceita atribuição fracionária de até seis casas.",
  },
  acquisitions: {
    label: "Aquisições comprovadas",
    unit: "count",
    definition:
      "Aquisições efetivas acompanhadas de uma referência de comprovação, distintas de conversões genéricas.",
  },
  cpa: {
    label: "Custo por aquisição",
    unit: "money",
    definition:
      "Investimento / aquisições comprovadas. Conversões genéricas não substituem aquisições.",
  },
  revenue: {
    label: "Receita atribuída comprovada",
    unit: "money",
    definition:
      "Receita do anunciante comprovada e atribuída. Nunca inferida dos contratos ou do Financeiro da ION.",
  },
  roas: {
    label: "ROAS",
    unit: "ratio",
    definition: "Receita atribuída comprovada / investimento. Não é lucro.",
  },
} as const;
export type MetricKey = keyof typeof metricDefinitions;
export const metricKeys = Object.keys(metricDefinitions) as MetricKey[];
export const rawMetricKeys = [
  "spend",
  "reach",
  "impressions",
  "clicks",
  "leads",
  "conversions",
  "acquisitions",
  "revenue",
] as const;
export const platforms = {
  meta: "Meta Ads",
  google: "Google Ads",
  other: "Outra fonte",
};
export const sourceLabels = {
  manual: "Cadastro manual",
  csv: "Importação CSV",
  meta_api: "API oficial Meta",
  google_api: "API oficial Google",
};
const oid = z.union([z.string().uuid(), z.literal("")]).optional();
const zeroMoney = z
  .string()
  .regex(/^\d{1,16}(\.\d{1,2})?$|^$/)
  .default("");
const count = z
  .string()
  .regex(/^\d{1,18}$|^$/)
  .default("");
export const metricSchema = z
  .object({
    id: oid,
    version: z.string().regex(/^\d+$/).optional(),
    campaign_id: z.string().uuid(),
    period_from: dateInput,
    period_to: dateInput,
    spend: zeroMoney,
    reach: count,
    impressions: count,
    clicks: count,
    leads: count,
    conversions: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,6})?$|^$/)
      .default(""),
    acquisitions: count,
    revenue: zeroMoney,
    source_reference: z.string().trim().min(3).max(2000),
    revenue_evidence: z.string().max(2000).default(""),
    acquisition_evidence: z.string().max(2000).default(""),
    reason: z.string().max(2000).optional(),
    voided: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.period_to >= v.period_from &&
      Date.parse(v.period_to) - Date.parse(v.period_from) <= 366 * 86400000,
  )
  .refine((v) => rawMetricKeys.some((k) => v[k] !== ""))
  .refine(
    (v) =>
      (v.revenue === "" || v.revenue_evidence.trim().length >= 3) &&
      (v.acquisitions === "" || v.acquisition_evidence.trim().length >= 3),
  );
export const accountSchema = z.object({
  id: oid,
  version: z.string().regex(/^\d+$/).optional(),
  company_id: z.string().uuid(),
  platform: z.enum(["meta", "google", "other"]),
  name: z.string().trim().min(2).max(150),
  reference: z.string().trim().min(2).max(150),
  time_zone: z.string().min(3).max(100),
  attribution: z.string().trim().min(3).max(200),
  active: z.boolean().default(true),
  reason: z.string().max(2000).optional(),
});
export const campaignSchema = z.object({
  id: oid,
  version: z.string().regex(/^\d+$/).optional(),
  company_id: z.string().uuid(),
  account_id: z.string().uuid(),
  contract_id: oid,
  name: z.string().trim().min(2).max(200),
  reference: z.string().trim().min(2).max(150),
  active: z.boolean().default(true),
  reason: z.string().max(2000).optional(),
});
export function formatMetric(k: MetricKey, value: string | null | undefined) {
  if (value === null || value === undefined) return "Não disponível";
  const d = metricDefinitions[k];
  if (d.unit === "money") {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const amount =
      BigInt(whole) * 100n +
      BigInt(fraction.padEnd(2, "0").slice(0, 2)) +
      (Number(fraction[2] ?? "0") >= 5 ? 1n : 0n);
    return brl(
      `${negative ? "-" : ""}${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`,
    );
  }
  const [a, b] = value.split(".");
  const formatted =
    BigInt(a).toLocaleString("pt-BR") +
    (b && b.replace(/0+$/, "") ? "," + b.replace(/0+$/, "") : "");
  return (
    formatted + (d.unit === "percent" ? "%" : d.unit === "ratio" ? "×" : "")
  );
}
function day(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function analyticsPeriod(
  p: Record<string, string | undefined>,
  now = new Date(),
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (p.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month))
    throw new Error("Mês inválido");
  const month = p.month || today.slice(0, 7);
  const y = Number(month.slice(0, 4)),
    m = Number(month.slice(5, 7));
  let from = p.from || month + "-01",
    to =
      p.to ||
      (month === today.slice(0, 7) ? today : day(new Date(Date.UTC(y, m, 0))));
  if (p.range === "week" && !p.from && !p.to) {
    to = today;
    from = day(new Date(Date.parse(to + "T00:00:00Z") - 6 * 86400000));
  }
  if (
    !dateInput.safeParse(from).success ||
    !dateInput.safeParse(to).success ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 731 * 86400000
  )
    throw new Error("Período inválido (máximo dois anos)");
  let compare_from = "",
    compare_to = "";
  if (p.compare !== "none") {
    if (p.compare_from || p.compare_to) {
      compare_from = p.compare_from ?? "";
      compare_to = p.compare_to ?? "";
    } else if (!p.from && !p.to && p.range !== "week") {
      compare_from = day(new Date(Date.UTC(y, m - 2, 1)));
      const last = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
      compare_to = day(
        new Date(
          Date.UTC(
            y,
            m - 2,
            month === today.slice(0, 7)
              ? Math.min(Number(today.slice(8)), last)
              : last,
          ),
        ),
      );
    } else {
      compare_to = day(new Date(Date.parse(from + "T00:00:00Z") - 86400000));
      compare_from = day(
        new Date(
          Date.parse(compare_to + "T00:00:00Z") -
            (Date.parse(to) - Date.parse(from)),
        ),
      );
    }
    if (
      !dateInput.safeParse(compare_from).success ||
      !dateInput.safeParse(compare_to).success ||
      compare_from > compare_to ||
      Date.parse(compare_to) - Date.parse(compare_from) > 731 * 86400000
    )
      throw new Error("Comparação inválida");
  }
  return { from, to, compare_from, compare_to, month };
}
export function parsePerformanceCSV(
  text: string,
  campaignId: string,
  reference: string,
) {
  if (text.length > 2_000_000) throw new Error("CSV excede 2 MB");
  text = text.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/)[0];
  const separator = first.includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted) {
        quoted = false;
        closed = true;
      } else if (cell === "" && !closed) quoted = true;
      else throw new Error("Aspas inválidas no CSV");
    } else if (!quoted && c === separator) {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      closed = false;
    } else {
      if (closed) {
        if (!/\s/.test(c)) throw new Error("Conteúdo após aspas no CSV");
      } else cell += c;
    }
  }
  if (quoted) throw new Error("Aspas não encerradas");
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  const headers = rows.shift()?.map((x) => x.trim()) ?? [];
  const allowed = [
    "campaign_id",
    "period_from",
    "period_to",
    ...rawMetricKeys,
    "source_reference",
    "revenue_evidence",
    "acquisition_evidence",
  ];
  if (
    new Set(headers).size !== headers.length ||
    headers.some((x) => !allowed.includes(x)) ||
    !["period_from", "period_to"].every((k) => headers.includes(k))
  )
    throw new Error(
      "Cabeçalho inválido. Use o modelo CSV; taxas são calculadas pelo sistema",
    );
  if (rows.length < 1 || rows.length > 500)
    throw new Error("Importe de 1 a 500 linhas");
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`Linha ${index + 2}: número incorreto de colunas`);
    const data = Object.fromEntries(
      headers.map((k, n) => [k, values[n].trim()]),
    );
    const parsed = metricSchema.safeParse({
      ...data,
      campaign_id: data.campaign_id || campaignId,
      source_reference: data.source_reference || reference,
    });
    if (!parsed.success)
      throw new Error(
        `Linha ${index + 2}: revise datas, valores, origem e comprovações`,
      );
    return parsed.data;
  });
}
export type Stats = Partial<Record<MetricKey, string | null>>;
export type MetricRow = {
  id: string;
  version: number;
  company_id: string;
  company: string;
  campaign_id: string;
  campaign: string;
  account_id: string;
  account: string;
  platform: keyof typeof platforms;
  time_zone: string;
  attribution: string;
  contract_id: string | null;
  contract_reference: string | null;
  period_from: string;
  period_to: string;
  source_kind: keyof typeof sourceLabels;
  source_reference?: string;
  revenue_evidence?: string;
  acquisition_evidence?: string;
  author?: string;
  updated_at: string;
  published: boolean;
  allowed: MetricKey[];
} & Partial<Record<(typeof rawMetricKeys)[number], string | null>>;
export type Snapshot = {
  from: string;
  to: string;
  generated_at: string;
  record_count: number;
  partial_count: number;
  stats: Stats;
  records: MetricRow[];
  groups: {
    account_id: string;
    account: string;
    platform: keyof typeof platforms;
    time_zone: string;
    attribution: string;
    stats: Stats;
  }[];
  points: {
    account_id: string;
    account: string;
    platform: keyof typeof platforms;
    from: string;
    to: string;
    stats: Stats;
  }[];
  sources: Omit<MetricRow, (typeof rawMetricKeys)[number]>[];
  methodology: string;
  comparison?: Snapshot | null;
  comparison_change?: {
    compatible: boolean;
    changes: Partial<
      Record<MetricKey, { difference: string | null; percent: string | null }>
    >;
  };
};
export type Account = {
  id: string;
  company_id: string;
  platform: keyof typeof platforms;
  name: string;
  reference: string;
  time_zone: string;
  attribution: string;
  active: boolean;
  version: number;
};
export type Campaign = {
  id: string;
  company_id: string;
  account_id: string;
  contract_id: string | null;
  name: string;
  reference: string;
  active: boolean;
  version: number;
  published: boolean;
  published_metrics: MetricKey[];
};
export type ReportHeader = {
  id: string;
  company_id: string;
  title: string;
  period_from: string;
  period_to: string;
  created_at: string;
  published: boolean;
};
export type AnalyticsOptions = {
  companies: {
    id: string;
    name: string;
    can_write: boolean;
    portal_visible: boolean;
  }[];
  accounts: Account[];
  campaigns: Campaign[];
  contracts: {
    id: string;
    company_id: string;
    reference: string;
    status: string;
    source_deal_id: string | null;
  }[];
  reports: ReportHeader[];
  people: { id: string; name: string }[];
  grants: {
    company_id: string;
    profile_id: string;
    can_write: boolean;
    active: boolean;
  }[];
};
export type SavedReport = {
  id: string;
  title: string;
  company_id: string;
  company: string;
  created_at: string;
  published: boolean;
  view?: "internal" | "published";
  snapshot: Snapshot;
};
