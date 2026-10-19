import { ActionForm } from "@/components/action-form";
import { randomUUID } from "node:crypto";
import { Field, Select } from "./ui";
import { Submit } from "./submit";
import { ConfirmedAdminForm } from "./confirmed-admin-form";
import { saveEntry, saveSchedule, saveRule } from "@/app/finance-actions";
import {
  brl,
  type FinEntry,
  type Options,
  type Schedule,
  type Rule,
} from "@/lib/finance";
import { functionLabels } from "@/lib/access";
export function Association({
  options: o,
  value,
}: {
  options: Options;
  value?: { company_id: string | null; contract_id: string | null };
}) {
  return (
    <>
      <Select name="company_id" label="Cliente" value={value?.company_id ?? ""}>
        <option value="">Avulso / sem cliente</option>
        {o.companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        name="contract_id"
        label="Contrato do mesmo cliente"
        value={value?.contract_id ?? ""}
      >
        <option value="">Sem contrato</option>
        {o.contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.company} · {c.reference} · {c.status} · {brl(c.amount)}
          </option>
        ))}
      </Select>
    </>
  );
}
function Category({
  options: o,
  kind,
  value,
}: {
  options: Options;
  kind: string;
  value?: string;
}) {
  return (
    <Select name="category_id" label="Categoria" required value={value}>
      {o.categories
        .filter((c) => c.kind === kind || c.kind === "both")
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </Select>
  );
}
export function EntryForm({
  options: o,
  kind,
  entry: e,
}: {
  options: Options;
  kind: "income" | "expense";
  entry?: FinEntry;
}) {
  const fields = (
    <>
      <input type="hidden" name="request_id" value={randomUUID()} />
      <input type="hidden" name="kind" value={kind} />
      {e ? (
        <>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="version" value={e.version} />
          <input type="hidden" name="company_id" value={e.company_id ?? ""} />
          <input type="hidden" name="contract_id" value={e.contract_id ?? ""} />
        </>
      ) : (
        <Association options={o} />
      )}
      <Field label="Descrição" name="description" value={e?.description} />
      <Category options={o} kind={kind} value={e?.category_id} />
      <Field
        label="Valor em reais (ex.: 1250.50)"
        name="amount"
        value={e?.amount}
      />
      <Field
        label="Competência"
        name="competence"
        type="date"
        value={e?.competence}
      />
      <Field label="Vencimento" name="due_at" type="date" value={e?.due_at} />
      <Select name="state" label="Situação" value={e?.state ?? "pending"}>
        <option value="planned">Previsto</option>
        <option value="pending">Pendente</option>
        {e && (
          <option value="cancelled">
            Cancelar (saldo liquidado deve ser zero)
          </option>
        )}
      </Select>
      <Select
        name="expense_type"
        label="Tipo de lançamento"
        value={e?.expense_type ?? "one_off"}
      >
        <option value="one_off">Avulso</option>
        <option value="fixed">Fixo</option>
        <option value="variable">Variável</option>
        <option value="recurring">Recorrente</option>
      </Select>
      <Field
        label="Observações"
        name="notes"
        required={false}
        value={e?.notes}
      />
      {e && <Field label="Motivo da alteração / renegociação" name="reason" />}
    </>
  );
  return e ? (
    <ConfirmedAdminForm
      action={saveEntry}
      confirmation="Salvar esta alteração financeira e registrar o histórico?"
      submitLabel="Salvar alteração"
    >
      {fields}
    </ConfirmedAdminForm>
  ) : (
    <ActionForm className="form-grid" action={saveEntry}>
      {fields}
      <Submit>Cadastrar {kind === "income" ? "receita" : "despesa"}</Submit>
    </ActionForm>
  );
}
export function ScheduleForm({
  options: o,
  kind,
  schedule: s,
}: {
  options: Options;
  kind: "income" | "expense";
  schedule?: Schedule;
}) {
  return (
    <ConfirmedAdminForm
      action={saveSchedule}
      confirmation="Salvar as condições para os próximos ciclos? Parcelas existentes serão preservadas."
      submitLabel="Salvar recorrência"
    >
      <input type="hidden" name="kind" value={kind} />
      {s ? (
        <>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="version" value={s.version} />
          <input type="hidden" name="company_id" value={s.company_id ?? ""} />
          <input type="hidden" name="contract_id" value={s.contract_id ?? ""} />
          <input type="hidden" name="starts_at" value={s.starts_at} />
          <input type="hidden" name="months" value={s.months} />
          <p>
            Início: {s.starts_at} · a cada {s.months} mês(es)
          </p>
        </>
      ) : (
        <>
          <Association options={o} />
          <Field label="Início da vigência" name="starts_at" type="date" />
          <Select name="months" label="Periodicidade">
            <option value="1">Mensal</option>
            <option value="3">Trimestral</option>
            <option value="12">Anual</option>
          </Select>
        </>
      )}
      <Field
        label="Descrição da recorrência"
        name="description"
        value={s?.description}
      />
      <Category options={o} kind={kind} value={s?.category_id} />
      <Field
        label="Valor por parcela em reais"
        name="amount"
        value={s?.amount}
      />
      <Field
        label="Fim da vigência"
        name="ends_at"
        type="date"
        required={false}
        value={s?.ends_at ?? ""}
      />
      <Field
        label="Dia de vencimento (1 a 31)"
        name="due_day"
        type="number"
        min={1}
        value={s?.due_day ?? 10}
      />
      <Select name="active" label="Cobrança" value={String(s?.active ?? true)}>
        <option value="true">Ativa</option>
        <option value="false">Pausada</option>
      </Select>
      <Field
        label="Observações"
        name="notes"
        required={false}
        value={s?.notes}
      />
      {s && <Field label="Motivo da alteração" name="reason" />}
    </ConfirmedAdminForm>
  );
}
export function RuleForm({
  options: o,
  rule: r,
}: {
  options: Options;
  rule?: Rule;
}) {
  return (
    <ConfirmedAdminForm
      action={saveRule}
      confirmation="Salvar regra para novas comissões? Comissões anteriores serão preservadas."
      submitLabel="Salvar regra"
    >
      <Field name="name" label="Nome da regra" value={r?.name} />
      {r ? (
        <>
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="version" value={r.version} />
          <input type="hidden" name="profile_id" value={r.profile_id ?? ""} />
          <input
            type="hidden"
            name="function_code"
            value={r.function_code ?? ""}
          />
        </>
      ) : (
        <>
          <Select name="profile_id" label="Colaborador individual">
            <option value="">Usar função</option>
            {o.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            name="function_code"
            label="Função (deixe vazia ao selecionar colaborador)"
          >
            <option value="">Usar colaborador individual</option>
            {Object.entries(functionLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </>
      )}
      <Select
        name="basis"
        label="Cálculo da comissão"
        value={r?.basis ?? "fixed"}
      >
        <option value="fixed">Valor fixo em reais</option>
        <option value="percent">Percentual do contrato fechado</option>
      </Select>
      <Field
        name="rate"
        label="Valor ou percentual (até duas casas decimais)"
        value={r?.rate}
      />
      <Field
        name="starts_at"
        label="Fechamentos a partir de"
        type="date"
        value={r?.starts_at}
      />
      <Field
        name="ends_at"
        label="Fechamentos até"
        type="date"
        required={false}
        value={r?.ends_at ?? ""}
      />
      <Select name="active" label="Regra" value={String(r?.active ?? true)}>
        <option value="true">Ativa</option>
        <option value="false">Inativa</option>
      </Select>
      {r && <Field name="reason" label="Motivo da alteração" />}
    </ConfirmedAdminForm>
  );
}
