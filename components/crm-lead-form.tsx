import { ActionForm } from "@/components/action-form";
import { saveLead } from "@/app/crm-actions";
import { Field, Select } from "./ui";
import { Submit } from "./submit";
import type { Lead, Person } from "@/lib/crm";
export function CrmLeadForm({
  lead,
  people,
  admin,
  userId,
}: {
  lead?: Lead;
  people: Person[];
  admin: boolean;
  userId: string;
}) {
  return (
    <ActionForm action={saveLead} className="form-grid">
      {lead && (
        <>
          <input type="hidden" name="id" value={lead.id} />
          <input type="hidden" name="version" value={lead.version} />
        </>
      )}
      <Field label="Nome da empresa" name="company" value={lead?.company} />
      <Field label="Responsável" name="contact" value={lead?.contact} />
      <Field label="WhatsApp" name="phone" value={lead?.phone} />
      <Field
        label="E-mail"
        name="email"
        type="email"
        required={false}
        value={lead?.email}
      />
      <Field label="Segmento" name="niche" value={lead?.niche} />
      <Field label="Cidade" name="city" value={lead?.city} />
      <Field label="Estado (UF)" name="state" value={lead?.state} />
      <Field label="Origem" name="source" value={lead?.source} />
      {admin ? (
        <Select
          label="SDR responsável"
          name="sdr_id"
          value={lead?.sdr_id}
          required
        >
          {people
            .filter((p) => p.is_sdr)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      ) : (
        <input type="hidden" name="sdr_id" value={lead?.sdr_id ?? userId} />
      )}
      <Select
        label="Closer responsável"
        name="closer_id"
        value={lead?.closer_id ?? ""}
      >
        <option value="">Ainda não atribuído</option>
        {people
          .filter(
            (p) => p.is_closer && (admin || !lead || lead.closer_id === p.id),
          )
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </Select>
      <Field
        label="Próximo follow-up"
        name="follow_up_at"
        type="datetime-local"
        required={false}
        value={lead?.follow_up_at ?? undefined}
      />
      <label className="field">
        <span>Observações</span>
        <textarea name="notes" defaultValue={lead?.notes} maxLength={10000} />
      </label>
      <Submit>Salvar lead</Submit>
    </ActionForm>
  );
}
