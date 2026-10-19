import { Field, Select } from "./ui";
import { Submit } from "./submit";
import {
  saveAdAccount,
  saveAdCampaign,
  saveMetric,
} from "@/app/analytics-actions";
import {
  rawMetricKeys,
  metricDefinitions,
  platforms,
  type AnalyticsOptions,
  type Account,
  type Campaign,
} from "@/lib/analytics";
function Company({ o, value }: { o: AnalyticsOptions; value?: string }) {
  return (
    <Select name="company_id" label="Cliente" required value={value}>
      <option value="">Selecione</option>
      {o.companies
        .filter((c) => c.can_write)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </Select>
  );
}
export function AccountForm({
  options: o,
  account: a,
}: {
  options: AnalyticsOptions;
  account?: Account;
}) {
  return (
    <form action={saveAdAccount} className="form-grid">
      {a ? (
        <>
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="version" value={a.version} />
          <input type="hidden" name="company_id" value={a.company_id} />
        </>
      ) : (
        <Company o={o} />
      )}
      <Field name="name" label="Nome da conta de dados" value={a?.name} />
      <Field
        name="reference"
        label="Identificador da conta / referência manual"
        value={a?.reference}
      />
      <Select name="platform" label="Plataforma" value={a?.platform}>
        {Object.entries(platforms).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      <Field
        name="time_zone"
        label="Fuso IANA da fonte"
        value={a?.time_zone ?? "America/Sao_Paulo"}
      />
      <Field
        name="attribution"
        label="Definição dos cliques e janela / modelo de atribuição"
        value={a?.attribution}
      />
      {a && (
        <>
          <Select name="active" label="Conta" value={String(a.active)}>
            <option value="true">Ativa</option>
            <option value="false">Inativa</option>
          </Select>
          <Field name="reason" label="Motivo da alteração" />
        </>
      )}
      <p className="small muted">
        Somente BRL. Nenhum token deve ser informado aqui. A API oficial não é
        ativada pelo cadastro da conta.
      </p>
      <Submit>Salvar conta de dados</Submit>
    </form>
  );
}
export function CampaignForm({
  options: o,
  campaign: c,
}: {
  options: AnalyticsOptions;
  campaign?: Campaign;
}) {
  return (
    <form action={saveAdCampaign} className="form-grid">
      {c ? (
        <>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="version" value={c.version} />
          <input type="hidden" name="company_id" value={c.company_id} />
          <input type="hidden" name="account_id" value={c.account_id} />
        </>
      ) : (
        <>
          <Company o={o} />
          <Select name="account_id" label="Conta do mesmo cliente" required>
            <option value="">Selecione</option>
            {o.accounts
              .filter((a) =>
                o.companies.some((c) => c.id === a.company_id && c.can_write),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {o.companies.find((c) => c.id === a.company_id)?.name} ·{" "}
                  {a.name}
                </option>
              ))}
          </Select>
        </>
      )}
      <Field name="name" label="Nome da campanha de anúncios" value={c?.name} />
      <Field
        name="reference"
        label="Identificador da campanha / referência de origem"
        value={c?.reference}
      />
      <Select
        name="contract_id"
        label="Contrato do mesmo cliente (opcional)"
        value={c?.contract_id ?? ""}
      >
        <option value="">Sem contrato operacional</option>
        {o.contracts.map((x) => (
          <option key={x.id} value={x.id}>
            {o.companies.find((c) => c.id === x.company_id)?.name} ·{" "}
            {x.reference}
          </option>
        ))}
      </Select>
      {c && (
        <>
          <Select name="active" label="Campanha" value={String(c.active)}>
            <option value="true">Ativa</option>
            <option value="false">Inativa</option>
          </Select>
          <Field name="reason" label="Motivo da alteração" />
        </>
      )}
      <Submit>Salvar campanha de anúncios</Submit>
    </form>
  );
}
export function MetricForm({
  options: o,
  record: r,
}: {
  options: AnalyticsOptions;
  record?: Record<string, unknown>;
}) {
  const val = (k: string) =>
    r?.[k] === null ? undefined : (r?.[k] as string | number | undefined);
  return (
    <form action={saveMetric} className="form-grid">
      {r ? (
        <>
          <input type="hidden" name="id" value={String(r.id)} />
          <input type="hidden" name="version" value={String(r.version)} />
          <input
            type="hidden"
            name="campaign_id"
            value={String(r.campaign_id)}
          />
        </>
      ) : (
        <Select name="campaign_id" label="Campanha do resultado" required>
          <option value="">Selecione</option>
          {o.campaigns
            .filter((c) =>
              o.companies.some((p) => p.id === c.company_id && p.can_write),
            )
            .map((c) => (
              <option key={c.id} value={c.id}>
                {o.companies.find((p) => p.id === c.company_id)?.name} ·{" "}
                {c.name}
              </option>
            ))}
        </Select>
      )}
      <Field
        name="period_from"
        label="Início da observação"
        type="date"
        value={val("period_from")}
      />
      <Field
        name="period_to"
        label="Fim da observação"
        type="date"
        value={val("period_to")}
      />
      {rawMetricKeys.map((k) => (
        <Field
          key={k}
          name={k}
          label={
            metricDefinitions[k].label +
            (metricDefinitions[k].unit === "money"
              ? " (BRL; ex.: 1250.50)"
              : "")
          }
          required={false}
          value={val(k)}
        />
      ))}
      <Field
        name="source_reference"
        label="Referência real da origem (arquivo, relatório ou evidência)"
        value={val("source_reference")}
      />
      <Field
        name="revenue_evidence"
        label="Comprovação da receita atribuída (obrigatória se informada)"
        required={false}
        value={val("revenue_evidence")}
      />
      <Field
        name="acquisition_evidence"
        label="Comprovação das aquisições (obrigatória se informadas)"
        required={false}
        value={val("acquisition_evidence")}
      />
      {r && (
        <>
          <Field name="reason" label="Motivo da correção" />
          <Select
            name="voided"
            label="Validade do resultado"
            value={String(r.voided ?? false)}
          >
            <option value="false">Válido</option>
            <option value="true">Desconsiderar com histórico preservado</option>
          </Select>
        </>
      )}
      <p className="small muted">
        Deixe vazio o que não foi medido. Zero significa medição efetiva igual a
        zero. Períodos não podem se sobrepor na mesma campanha. Receita
        atribuída não é o valor dos contratos da ION. Correções ocultam o
        resultado e revogam relatórios publicados até revisão administrativa.
      </p>
      <Submit>Salvar resultado real</Submit>
    </form>
  );
}
