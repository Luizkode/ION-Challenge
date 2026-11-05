import { randomUUID } from "node:crypto";
import { ActionForm } from "./action-form";
import { Field, Select } from "./ui";
import { CommercialDateField } from "./commercial-date-field";
import { Submit } from "./submit";
import {
  scheduleCrm,
  saveMeetingResult,
  saveFollowup,
  rescheduleMeeting,
} from "@/app/crm-actions";
import {
  commercialOutcomes,
  type AgendaLead,
  type AgendaMeeting,
  type Followup,
} from "@/lib/crm-agenda";
import type { Person } from "@/lib/crm";
function Identity({
  id,
  leadId,
  version,
  operation,
}: {
  id?: string;
  leadId: string;
  version?: number;
  operation?: string;
}) {
  return (
    <>
      <input type="hidden" name="request_id" value={randomUUID()} />
      <input type="hidden" name="lead_id" value={leadId} />
      {id && <input type="hidden" name="id" value={id} />}{" "}
      {version && <input type="hidden" name="version" value={version} />}{" "}
      {operation && <input type="hidden" name="operation" value={operation} />}
    </>
  );
}
function Responsible({
  people,
  value,
  closer = false,
}: {
  people: Person[];
  value?: string | null;
  closer?: boolean;
}) {
  return (
    <Select
      name={closer ? "closer_id" : "assigned_to"}
      label={closer ? "Closer" : "Responsável pelo acompanhamento"}
      value={value ?? ""}
      required
    >
      <option value="">Selecione</option>
      {people
        .filter((p) => (closer ? p.is_closer : p.is_closer || p.is_sdr))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </Select>
  );
}
export function ScheduleForm({
  lead,
  people,
}: {
  lead: AgendaLead;
  people: Person[];
}) {
  return (
    <>
      <p className="muted">
        {lead.company} · {lead.contact} · {lead.phone}. Dados reutilizados do
        lead.
      </p>
      <ActionForm action={scheduleCrm} className="form-grid">
        <Identity leadId={lead.id} />
        <CommercialDateField
          name="scheduled_at"
          label="Data e horário"
          required
        />
        <Responsible
          people={people}
          closer
          value={
            lead.closer_id ??
            (people.filter((p) => p.is_closer).length === 1
              ? people.find((p) => p.is_closer)!.id
              : "")
          }
        />
        <Field
          name="meeting_url"
          label="Link da reunião"
          type="url"
          required={false}
        />
        <Field name="notes" label="Observações da reunião" required={false} />
        <Submit>Agendar reunião</Submit>
      </ActionForm>
      {!people.some((p) => p.is_closer) && (
        <p className="notice error">
          Não há closer ativo. Solicite ao administrador um responsável.
        </p>
      )}
      <p className="table-note">
        Agendamento comercial independente de campanha. Pontos somente pela
        validação oficial elegível.
      </p>
    </>
  );
}
export function ResultForm({
  meeting,
  people,
  outcome,
}: {
  meeting: AgendaMeeting;
  people: Person[];
  outcome?: string;
}) {
  return (
    <ActionForm action={saveMeetingResult} className="form-grid">
      <Identity
        id={meeting.id}
        leadId={meeting.opportunities.crm_lead_id}
        version={meeting.version}
      />
      <Select
        name="outcome"
        label="Resultado da reunião"
        value={outcome}
        required
      >
        {Object.entries(commercialOutcomes).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </Select>
      <Select name="qualified" label="Validação do Challenger">
        <option value="false">Realizada, sem qualificação adicional</option>
        <option value="true">
          Bem qualificada, conforme regras da campanha
        </option>
      </Select>
      <label className="field">
        <span>Observações comerciais *</span>
        <textarea name="notes" required maxLength={2000} />
      </label>
      <Field name="needs" label="Necessidades identificadas" required={false} />
      <Field name="objections" label="Principais objeções" required={false} />
      <Field name="services" label="Serviços de interesse" required={false} />
      <Field
        name="amount"
        label="Valor da proposta (R$)"
        type="number"
        min={0.01}
        required={false}
      />
      <Field
        name="term_months"
        label="Prazo da proposta (meses)"
        type="number"
        min={1}
        required={false}
      />
      <p className="table-note">
        Proposta e contrato exigem valor, serviços e prazo. Contrato comercial
        não concede pontos sem confirmação administrativa.
      </p>
      <Field name="next_action" label="Próxima ação" required={false} />
      <CommercialDateField
        name="follow_up_at"
        label="Data e horário do follow-up"
      />
      <Responsible people={people} value={meeting.closer_id} />
      <Submit>Salvar resultado</Submit>
    </ActionForm>
  );
}
export function RescheduleForm({
  meeting,
  people,
  admin,
}: {
  meeting: AgendaMeeting;
  people: Person[];
  admin: boolean;
}) {
  return (
    <ActionForm action={rescheduleMeeting} className="form-grid">
      <Identity
        id={meeting.id}
        leadId={meeting.opportunities.crm_lead_id}
        version={meeting.version}
      />
      <CommercialDateField
        name="scheduled_at"
        label="Novo agendamento"
        required
      />
      {admin ? (
        <Responsible people={people} closer value={meeting.closer_id} />
      ) : (
        <input type="hidden" name="closer_id" value={meeting.closer_id} />
      )}
      <Field
        name="meeting_url"
        label="Novo link da reunião"
        type="url"
        value={meeting.meeting_url}
        required={false}
      />
      <Submit>Confirmar reagendamento</Submit>
    </ActionForm>
  );
}
export function NewFollowupForm({
  leadId,
  people,
  owner,
}: {
  leadId: string;
  people: Person[];
  owner?: string | null;
}) {
  return (
    <ActionForm action={saveFollowup} className="form-grid">
      <Identity leadId={leadId} operation="create" />
      <CommercialDateField
        name="due_at"
        label="Data e horário do retorno"
        required
      />
      <Responsible people={people} value={owner} />
      <Field name="reason" label="Motivo do acompanhamento" />
      <Submit>Programar retorno</Submit>
    </ActionForm>
  );
}
export function FollowupForms({
  followup: f,
  people,
}: {
  followup: Followup;
  people: Person[];
}) {
  return (
    <>
      <section className="panel padded" id="contact">
        <h2>Registrar contato</h2>
        <ActionForm action={saveFollowup} className="form-grid">
          <Identity id={f.id} leadId={f.lead_id} version={f.version} />
          <Select name="operation" label="Ação após o contato">
            <option value="complete">Concluir follow-up</option>
            <option value="contact">Registrar contato e manter pendente</option>
          </Select>
          <label className="field">
            <span>Resultado da conversa *</span>
            <textarea name="result" required maxLength={4000} />
          </label>
          <CommercialDateField
            name="next_due_at"
            label="Próximo retorno (opcional ao concluir)"
          />
          <Responsible people={people} value={f.assigned_to} />
          <Field
            name="reason"
            label="Motivo do próximo retorno"
            required={false}
            value={f.reason}
          />
          <Submit>Salvar contato</Submit>
        </ActionForm>
      </section>
      <section className="panel padded" id="reschedule">
        <h2>Reagendar follow-up</h2>
        <ActionForm action={saveFollowup} className="form-grid">
          <Identity
            id={f.id}
            leadId={f.lead_id}
            version={f.version}
            operation="reschedule"
          />
          <CommercialDateField
            name="due_at"
            label="Novo horário do retorno"
            required
          />
          <Responsible people={people} value={f.assigned_to} />
          <Field
            name="result"
            label="Observação do reagendamento"
            required={false}
          />
          <Submit>Reagendar follow-up</Submit>
        </ActionForm>
      </section>
      <section className="panel padded">
        <h2>Cancelar acompanhamento</h2>
        <p className="muted">O histórico permanece disponível.</p>
        <ActionForm action={saveFollowup} className="form-grid">
          <Identity
            id={f.id}
            leadId={f.lead_id}
            version={f.version}
            operation="cancel"
          />
          <Field name="result" label="Motivo do cancelamento" />
          <Submit>Cancelar follow-up</Submit>
        </ActionForm>
      </section>
    </>
  );
}
