"use client";
import { useState } from "react";
/** Commercial dates are always entered in São Paulo, independently of browser timezone. */
export function CommercialDateField({
  name,
  label,
  required = false,
  value = "",
}: {
  name: string;
  label: string;
  required?: boolean;
  value?: string;
}) {
  const initial = value
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(value))
        .replace(" ", "T")
    : "";
  const [local, setLocal] = useState(initial);
  const timestamp = Date.parse(local + "-03:00");
  return (
    <label className="field">
      <span>
        {label}
        {required && " *"} <small className="muted">(São Paulo)</small>
      </span>
      <input
        aria-label={label}
        type="datetime-local"
        name={name + "__local"}
        required={required}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
      />
      <input
        type="hidden"
        name={name}
        value={
          local && Number.isFinite(timestamp)
            ? new Date(timestamp).toISOString()
            : ""
        }
      />
    </label>
  );
}
