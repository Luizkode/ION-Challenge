"use client";
import { useEffect, useState } from "react";
export function DateField({
  name,
  value,
  required,
}: {
  name: string;
  value?: string | number;
  required: boolean;
}) {
  const [iso, setIso] = useState(value ? String(value) : "");
  const [local, setLocal] = useState("");
  useEffect(() => {
    if (value) {
      const date = new Date(String(value));
      setLocal(
        new Date(date.getTime() - date.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16),
      );
      setIso(date.toISOString());
    }
  }, [value]);
  return (
    <>
      <input
        type="datetime-local"
        value={local}
        required={required}
        onChange={(e) => {
          setLocal(e.target.value);
          setIso(e.target.value ? new Date(e.target.value).toISOString() : "");
        }}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  );
}
