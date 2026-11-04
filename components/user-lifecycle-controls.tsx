"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelLifecycle,
  executeLifecycle,
  inspectLifecycle,
} from "@/app/user-lifecycle-actions";
import type { LifecycleInspection } from "@/lib/user-lifecycle";
export function UserLifecycleControls({
  id,
  removed = false,
}: {
  id: string;
  removed?: boolean;
}) {
  const [inspection, setInspection] = useState<LifecycleInspection | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState("deactivate");
  const savedRequest = useRef<FormData | null>(null);
  const requestId = useRef<string | null>(null);
  const router = useRouter();
  if (removed)
    return (
      <p className="notice">
        Identidade removida. Perfil histórico preservado, sem possibilidade de
        reativar este login.
      </p>
    );
  return (
    <details>
      <summary>Ciclo de vida da conta</summary>
      <p className="small muted">
        Desativar bloqueia o acesso e permite revisão posterior. Anonimizar
        remove o login e substitui o nome cadastral, preservando resultados e
        documentos históricos. Excluir definitivamente é permitido apenas para
        contas de teste sem vínculos comerciais ou participação em campanhas.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await inspectLifecycle(id);
            setInspection(r.data ?? null);
            setFeedback(
              r.error ??
                "Dependências conferidas no banco. A operação será validada novamente ao executar.",
            );
          } catch {
            setFeedback(
              "Não foi possível conferir as dependências. Tente novamente.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        Consultar dependências
      </button>
      {inspection && (
        <div className="small">
          <p>
            {inspection.can_delete_test
              ? "Sem vínculos que impeçam a exclusão de uma conta confirmada como teste."
              : "Exclusão definitiva bloqueada. Preserve o histórico com desativação ou anonimização."}
          </p>
          <ul>
            {inspection.dependencies.map((d) => (
              <li key={d.relationship}>
                {d.relationship}: {d.records} registro(s)
              </li>
            ))}
          </ul>
          {!!inspection.owned_files && (
            <p>
              Arquivos no Storage: {inspection.owned_files}. Revise a
              propriedade antes de remover o login.
            </p>
          )}
        </div>
      )}
      <form
        className="form-grid"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget;
          const data =
            pending && savedRequest.current
              ? savedRequest.current
              : new FormData(form);
          requestId.current ??= crypto.randomUUID();
          data.set("request_id", requestId.current);
          if (
            !window.confirm(
              "Confirma executar a operação selecionada para o UUID " +
                id +
                "? Remoção de login e exclusão definitiva são irreversíveis.",
            )
          )
            return;
          savedRequest.current = data;
          setBusy(true);
          setErrors({});
          try {
            const r = await executeLifecycle(data);
            setFeedback(r.message);
            if (r.ok) {
              setPending(false);
              requestId.current = null;
              form.reset();
              router.replace("/team?success=" + encodeURIComponent(r.message), {
                scroll: false,
              });
            } else {
              setErrors(r.fields);
              setPending((previous) => previous || r.kind === "uncertain");
            }
          } catch {
            setPending(true);
            setFeedback(
              "Resultado não confirmado. Confira a conta antes de repetir; use a mesma solicitação para tentar novamente.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="hidden" name="target_id" value={id} />
        <label>
          Operação
          <select
            name="mode"
            value={mode}
            disabled={busy || pending}
            onChange={(e) => {
              setMode(e.target.value);
              requestId.current = null;
            }}
          >
            <option value="deactivate">Desativar acesso</option>
            <option value="anonymize">
              Anonimizar cadastro e remover login
            </option>
            <option value="delete_test">
              Excluir conta de teste sem histórico
            </option>
          </select>
        </label>
        <label>
          Justificativa (obrigatória)
          <textarea
            name="reason"
            required
            minLength={8}
            maxLength={2000}
            disabled={busy}
            readOnly={pending}
            aria-invalid={!!errors.reason}
          />
          {errors.reason?.join(" ")}
        </label>
        <label>
          Digite o UUID completo para confirmar (obrigatório)
          <input
            name="confirmation"
            required
            autoComplete="off"
            disabled={busy}
            readOnly={pending}
            aria-invalid={!!errors.confirmation}
          />
          {errors.confirmation?.join(" ")}
        </label>
        {mode === "delete_test" && (
          <label>
            <input
              type="checkbox"
              name="test_account"
              value="true"
              disabled={busy || pending}
            />
            Confirmo que é uma conta de teste, sem dados legítimos a preservar.
            {errors.test_account?.join(" ")}
          </label>
        )}
        <label>
          <input
            type="checkbox"
            name="confirm"
            value="true"
            disabled={busy || pending}
          />
          Conferi o usuário, as dependências e o impacto da operação.
          {errors.confirm?.join(" ")}
        </label>
        <button disabled={busy} type="submit">
          {busy ? "Processando…" : "Confirmar operação na conta"}
        </button>
      </form>
      {pending && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              !requestId.current ||
              !window.confirm(
                "Encerrar a solicitação pendente e manter o acesso inativo?",
              )
            )
              return;
            setBusy(true);
            try {
              const r = await cancelLifecycle(requestId.current);
              setFeedback(r.message);
              if (r.ok) {
                setPending(false);
                requestId.current = null;
                router.refresh();
              }
            } catch {
              setFeedback(
                "Não foi possível encerrar. Confira o histórico antes de repetir.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Encerrar solicitação pendente
        </button>
      )}
      {feedback && (
        <p className="notice" role="status">
          {feedback}
        </p>
      )}
    </details>
  );
}
