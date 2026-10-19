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
    <button
      className="button"
      disabled={pending || disabled}
      type="submit"
      aria-disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? "Salvando…" : children}
    </button>
  );
}
