import type { ReactNode } from "react";
import { DateField } from "./date-field";
export function Field({
  label,
  name,
  type = "text",
  value,
  required = true,
  min,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {type === "datetime-local" ? (
        <DateField name={name} value={value} required={required} />
      ) : (
        <input
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          min={min}
          step={type === "number" ? "any" : undefined}
          maxLength={type === "text" ? 2000 : undefined}
        />
      )}
    </label>
  );
}
export function Select({
  label,
  name,
  children,
  value,
  required = false,
}: {
  label: string;
  name: string;
  required?: boolean;
  children: ReactNode;
  value?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name} defaultValue={value} required={required}>
        {children}
      </select>
    </label>
  );
}
export function Notice({
  params,
}: {
  params: { error?: string; success?: string };
}) {
  return (
    <>
      {params.error && (
        <p className="notice error" role="alert">
          {params.error}
        </p>
      )}
      {params.success && (
        <p className="notice" role="status">
          {params.success}
        </p>
      )}
    </>
  );
}
export const labels: Record<string, string> = {
  scheduled: "Agendada",
  pending: "Aguardando validação",
  held: "Realizada",
  qualified: "Bem qualificada",
  no_show: "Não compareceu",
  cancelled: "Cancelada",
  invalidated: "Invalidada",
  draft: "Em configuração",
  active: "Ativa",
  ended: "Encerrada",
  finalized: "Finalizada",
};
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
