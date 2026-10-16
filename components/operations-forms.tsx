import { Field, Select } from "./ui";
import { Submit } from "./submit";
import {
  saveClient,
  saveContract,
  saveService,
  progressService,
} from "@/app/operations-actions";
import {
  relationships,
  contractStatuses,
  serviceStatuses,
  periods,
  type Client,
  type Contract,
  type Service,
  type Catalog,
  type Person,
} from "@/lib/operations";
export function Assignees({
  people,
  selected = [],
}: {
  people: Person[];
  selected?: string[];
}) {
  return (
    <fieldset className="field">
      <legend>Colaboradores responsáveis</legend>
      {people.map((p) => (
        <label className="confirm-line" key={p.id}>
          <input
            type="checkbox"
            name="assignees"
            value={p.id}
            defaultChecked={selected.includes(p.id)}
          />
          {p.name}
        </label>
      ))}
    </fieldset>
  );
}
export function Published({
  label = "Autorizar consulta pelo parceiro",
  value = false,
}: {
  label?: string;
  value?: boolean;
}) {
  return (
    <label className="confirm-line">
      <input
        type="checkbox"
        name="partner_visible"
        value="true"
        defaultChecked={value}
      />
      {label}
    </label>
  );
}
export function ClientForm({
  client,
  people,
  selected,
  notes = "",
  company,
}: {
  client?: Client;
  people: Person[];
  selected?: string[];
  notes?: string;
  company?: { id: string; name: string };
}) {
  return (
    <form action={saveClient} className="form-grid">
      {(client || company) && (
        <input
          type="hidden"
          name="company_id"
          value={client?.company_id ?? company?.id}
        />
      )}
      {client && <input type="hidden" name="version" value={client.version} />}
      <Field
        name="name"
        label="Nome da empresa"
        value={client?.access_companies.name ?? company?.name}
      />
      <Field
        name="contact"
        label="Responsável do cliente"
        value={client?.contact}
      />
      <Field name="phone" label="WhatsApp" value={client?.phone} />
      <Field
        name="email"
        label="E-mail"
        type="email"
        required={false}
        value={client?.email}
      />
      <Field name="niche" label="Segmento" value={client?.niche} />
      <Field name="city" label="Cidade" value={client?.city} />
      <Field name="state" label="Estado (UF)" value={client?.state} />
      <Field
        name="instagram"
        label="Instagram"
        required={false}
        value={client?.instagram}
      />
      <Field
        name="website"
        label="Site (https://)"
        type="url"
        required={false}
        value={client?.website}
      />
      <Field
        name="joined_at"
        label="Data de entrada"
        type="date"
        value={client?.joined_at ?? new Date().toISOString().slice(0, 10)}
      />
      <Select
        name="relationship"
        label="Relacionamento"
        value={client?.relationship ?? "active"}
      >
        {Object.entries(relationships).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Assignees people={people} selected={selected} />
      <label className="field">
        <span>Observações administrativas (somente ADM)</span>
        <textarea name="admin_notes" maxLength={10000} defaultValue={notes} />
      </label>
      <Published
        label="Autorizar dados publicados deste cliente no portal de consulta"
        value={client?.partner_visible}
      />
      <Submit>Salvar cliente</Submit>
    </form>
  );
}
export function ContractForm({
  companyId,
  contract,
  people,
  contracts,
}: {
  companyId: string;
  contract?: Contract;
  people: Person[];
  contracts: Contract[];
}) {
  return (
    <form action={saveContract} className="form-grid">
      <input type="hidden" name="company_id" value={companyId} />
      {contract && (
        <>
          <input type="hidden" name="id" value={contract.id} />
          <input type="hidden" name="version" value={contract.version} />
        </>
      )}
      <Field
        label="Identificação do contrato"
        name="reference"
        value={contract?.reference}
      />
      <Field
        label="Início do contrato"
        name="starts_at"
        type="date"
        value={contract?.starts_at}
      />
      <Field
        label="Fim do contrato"
        name="ends_at"
        type="date"
        required={false}
        value={contract?.ends_at ?? undefined}
      />
      <Field
        label="Prazo mínimo (meses)"
        name="min_months"
        type="number"
        min={0}
        value={contract?.min_months ?? 0}
      />
      <Field
        label="Valor contratado (R$)"
        name="amount"
        type="number"
        min={0.01}
        value={contract?.amount}
      />
      <Select
        label="Periodicidade"
        name="periodicity"
        value={contract?.periodicity ?? "monthly"}
      >
        {Object.entries(periods).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Field
        label="Serviços inclusos no contrato"
        name="services_text"
        value={contract?.services_text}
      />
      <Select
        label="Status contratual"
        name="status"
        value={contract?.status ?? "preparation"}
      >
        {Object.entries(contractStatuses).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Select
        name="responsible_id"
        label="Responsável interno"
        value={contract?.responsible_id}
        required
      >
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {!contract && (
        <Select label="Aditivo de contrato existente" name="parent_id">
          <option value="">Contrato principal</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.reference}
            </option>
          ))}
        </Select>
      )}
      <Published value={contract?.partner_visible} />
      <Submit>Salvar contrato</Submit>
    </form>
  );
}
export function ServiceForm({
  companyId,
  service,
  people,
  catalog,
  contracts,
  selected,
}: {
  companyId: string;
  service?: Service;
  people: Person[];
  catalog: Catalog[];
  contracts: Contract[];
  selected?: string[];
}) {
  return (
    <form action={saveService} className="form-grid">
      <input type="hidden" name="company_id" value={companyId} />
      {service && (
        <>
          <input type="hidden" name="id" value={service.id} />
          <input type="hidden" name="version" value={service.version} />
        </>
      )}
      <Select
        label="Contrato associado"
        name="contract_id"
        value={service?.contract_id}
        required
      >
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.reference}
          </option>
        ))}
      </Select>
      <Select
        label="Serviço do catálogo"
        name="catalog_id"
        value={service?.catalog_id}
        required
      >
        {catalog
          .filter((c) => c.active || c.id === service?.catalog_id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {!c.active ? " (inativo)" : ""}
            </option>
          ))}
      </Select>
      <Field
        name="description"
        label="Descrição interna do serviço"
        value={service?.description}
      />
      <Field
        name="partner_description"
        label="Descrição autorizada para parceiro"
        required={false}
        value={service?.partner_description}
      />
      <Field
        name="starts_at"
        label="Início do serviço"
        type="date"
        value={service?.starts_at}
      />
      <Field
        name="due_at"
        label="Prazo previsto"
        type="date"
        required={false}
        value={service?.due_at ?? undefined}
      />
      <Field
        name="delivered_at"
        label="Data de entrega"
        type="date"
        required={false}
        value={service?.delivered_at ?? undefined}
      />
      <Select
        name="status"
        label="Status operacional"
        value={service?.status ?? "pending"}
      >
        {Object.entries(serviceStatuses).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Assignees people={people} selected={selected} />
      <Published value={service?.partner_visible} />
      <Submit>Salvar serviço</Submit>
    </form>
  );
}
export function ProgressForm({
  service,
  admin,
}: {
  service: Service;
  admin: boolean;
}) {
  return (
    <form action={progressService} className="form-grid">
      <input type="hidden" name="company_id" value={service.company_id} />
      <input type="hidden" name="service_id" value={service.id} />
      <input type="hidden" name="version" value={service.version} />
      <Select name="status" label="Novo status" value={service.status}>
        {Object.entries(serviceStatuses).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Field
        name="delivered_at"
        label="Data da entrega"
        type="date"
        required={false}
        value={service.delivered_at ?? undefined}
      />
      <label className="field">
        <span>Atualização interna</span>
        <textarea name="body" maxLength={4000} required />
      </label>
      <label className="field">
        <span>Resumo para parceiro (publicação depende do ADM)</span>
        <textarea name="partner_body" maxLength={4000} />
      </label>
      {admin && (
        <label className="confirm-line">
          <input type="checkbox" name="published" value="true" />
          Publicar resumo autorizado
        </label>
      )}
      <Submit>Registrar andamento</Submit>
    </form>
  );
}
