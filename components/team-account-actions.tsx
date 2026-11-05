"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import {
  manageTeamAuth,
  removeTeamUser,
  toggleTeamAccess,
} from "@/app/team-admin-actions";
export function TeamAccountActions({
  id,
  name,
  email,
  active,
  invitationPending = false,
  pendingRequest = null,
}: {
  id: string;
  name: string;
  email: string;
  active: boolean;
  invitationPending?: boolean;
  pendingRequest?: string | null;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(!!pendingRequest),
    [message, setMessage] = useState("");
  const rid = useRef<string | null>(pendingRequest),
    router = useRouter(),
    cancel = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) {
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
      cancel.current?.focus();
    }
  }, [confirm]);
  async function remove() {
    if (busy) return;
    setBusy(true);
    rid.current ??= crypto.randomUUID();
    try {
      const r = await removeTeamUser(id, rid.current);
      setMessage(r.message);
      setPending(!r.ok && r.kind === "uncertain");
      if (r.ok) {
        setConfirm(false);
        router.replace("/team?success=" + encodeURIComponent(r.message), {
          scroll: false,
        });
      } else if (r.kind !== "uncertain") setConfirm(false);
    } catch (e) {
      unstable_rethrow(e);
      setPending(true);
      setMessage(
        "Acesso em conferência. O sistema tentará confirmar a remoção automaticamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!pending || busy) return;
    const t = setTimeout(() => {
      void remove();
    }, 4000);
    return () => clearTimeout(t);
  });
  async function action(kind: string) {
    if (
      !window.confirm(
        kind === "toggle"
          ? (active
              ? "Desativar o acesso e encerrar as sessões de "
              : "Ativar o acesso de ") +
              name +
              "?"
          : "Confirmar esta ação de acesso para " + name + " (" + email + ")?",
      )
    )
      return;
    setBusy(true);
    try {
      const r =
        kind === "toggle"
          ? await toggleTeamAccess(id, !active)
          : await manageTeamAuth(id, kind, crypto.randomUUID());
      setMessage(r.message);
      if (r.ok) router.refresh();
    } catch (e) {
      unstable_rethrow(e);
      setMessage(
        "Não foi possível confirmar a operação. Recarregue antes de repetir.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="team-actions">
      <button
        type="button"
        disabled={busy || pending}
        onClick={() => void action("toggle")}
      >
        {active ? "Desativar acesso" : "Ativar acesso"}
      </button>
      <details>
        <summary>Redefinir acesso</summary>
        <button
          type="button"
          disabled={busy}
          onClick={() => void action("reset_password")}
        >
          Enviar redefinição de senha
        </button>
        {invitationPending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void action("resend_invite")}
          >
            Reenviar convite
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void action("revoke_sessions")}
        >
          Revogar sessões
        </button>
      </details>
      <button
        ref={opener}
        type="button"
        disabled={busy || pending}
        onClick={() => {
          if (!pending) rid.current = null;
          setConfirm(true);
          setMessage("");
        }}
      >
        Remover usuário
      </button>
      {confirm && (
        <dialog
          ref={dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={"remove-" + id}
          className="panel padded removal-dialog"
          onCancel={(e) => {
            if (busy || pending) e.preventDefault();
            else {
              setConfirm(false);
              opener.current?.focus();
            }
          }}
        >
          <h2 id={"remove-" + id}>Remover {name}?</h2>
          <p>{email}</p>
          <p>
            O login será eliminado e os vínculos pessoais serão encerrados.
            Registros comerciais e financeiros necessários serão preservados com
            identificação anônima. Esta ação é definitiva.
          </p>
          <button
            ref={cancel}
            type="button"
            disabled={busy || pending}
            onClick={() => {
              setConfirm(false);
              opener.current?.focus();
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => void remove()}
          >
            {busy
              ? "Removendo…"
              : pending
                ? "Em processamento…"
                : "Remover definitivamente"}
          </button>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </dialog>
      )}
      {!confirm && message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </div>
  );
}
