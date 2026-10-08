"use client";
import { useFormStatus } from "react-dom";
export function Submit({
  children = "Salvar",
}: {
  children?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="button" disabled={pending} type="submit">
      {pending ? "Salvando…" : children}
    </button>
  );
}
