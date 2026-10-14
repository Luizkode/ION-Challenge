"use client";
import type { ReactNode, FormEvent } from "react";
import { adminOperation } from "@/app/actions";
import { Submit } from "@/components/submit";
export function ConfirmedAdminForm({
  children,
  confirmation,
  submitLabel,
  action = adminOperation,
}: {
  children: ReactNode;
  confirmation: string;
  submitLabel: string;
  action?: (form: FormData) => void | Promise<void>;
}) {
  function confirm(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const remove = data.get("remove_from_campaign") === "true";
    const message =
      confirmation +
      (remove
        ? " A participação na campanha em aberto também será removida. Os registros históricos serão preservados."
        : "");
    if (!window.confirm(message)) event.preventDefault();
  }
  return (
    <form action={action} className="form-grid" onSubmit={confirm}>
      {children}
      <label className="small">
        <input
          type="checkbox"
          name="confirm"
          value="true"
          required
          style={{ width: "auto", minHeight: 0, marginRight: 8 }}
        />
        Confirmo a operação selecionada e a preservação do histórico.
      </label>
      <Submit>{submitLabel}</Submit>
    </form>
  );
}
