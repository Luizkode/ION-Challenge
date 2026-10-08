"use client";
import { useFormStatus } from "react-dom";
export function Submit({
  children = "Salvar",
  disabled = false,
}: {
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="button" disabled={pending || disabled} type="submit">
      {pending ? "Salvando…" : children}
    </button>
  );
}
