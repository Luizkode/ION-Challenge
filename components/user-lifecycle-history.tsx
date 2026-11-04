"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cancelLifecycle } from "@/app/user-lifecycle-actions";
export function UserLifecycleHistory({
  rows,
}: {
  rows: {
    id: string;
    actor_id: string;
    target_id: string;
    mode: string;
    status: string;
    reason: string;
    created_at: string;
  }[];
}) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <section className="panel padded">
      <h2>Histórico de ciclo de vida</h2>
      {rows.length ? (
        rows.map((r) => (
          <details key={r.id}>
            <summary>
              {r.mode} · {r.status} · {r.created_at}
            </summary>
            <p className="small">
              Usuário: {r.target_id} · Administrador: {r.actor_id} ·
              Solicitação: {r.id}
            </p>
            <p>{r.reason}</p>
            {r.status === "pending" && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Encerrar esta solicitação pendente? O acesso continuará inativo.",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    const v = await cancelLifecycle(r.id);
                    setFeedback(v.message);
                    if (v.ok) router.refresh();
                  } catch {
                    setFeedback("Não foi possível confirmar o encerramento.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Encerrar solicitação pendente
              </button>
            )}
          </details>
        ))
      ) : (
        <p className="muted">Nenhuma operação registrada.</p>
      )}
      {feedback && (
        <p role="status" className="notice">
          {feedback}
        </p>
      )}
    </section>
  );
}
