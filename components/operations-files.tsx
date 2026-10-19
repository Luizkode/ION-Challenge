"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import {
  reserveFile,
  finishFile,
  downloadFile,
} from "@/app/operations-actions";
import { allowedMime } from "@/lib/operations";
export function FileUpload({
  companyId,
  serviceId,
  contractId,
}: {
  companyId: string;
  serviceId?: string;
  contractId?: string;
}) {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const router = useRouter();
  return (
    <div className="padded">
      <label className="field">
        <span>Arquivo privado (até 10 MB)</span>
        <input
          type="file"
          ref={inputRef}
          disabled={pending}
          accept={allowedMime.join(",")}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
            setMessage("");
          }}
        />
      </label>
      <button
        type="button"
        className="button"
        disabled={!file || pending}
        onClick={() =>
          start(async () => {
            if (!file) return;
            if (
              file.size < 1 ||
              file.size > 10485760 ||
              !allowedMime.includes(file.type as (typeof allowedMime)[number])
            ) {
              setError("Tipo não permitido ou arquivo maior que 10 MB.");
              return;
            }
            try {
              const record = await reserveFile({
                company_id: companyId,
                service_id: serviceId,
                contract_id: contractId,
                name: file.name,
                mime: file.type,
                size: file.size,
              });
              if (record.error || !record.path || !record.id) {
                setError(record.error ?? "Não foi possível iniciar o envio.");
                return;
              }
              const db = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL!,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
              );
              const upload = await db.storage
                .from(record.bucket!)
                .upload(record.path, file, {
                  contentType: file.type,
                  upsert: false,
                });
              if (upload.error) {
                setError(
                  "Upload não concluído. Verifique a conexão e tente novamente.",
                );
                return;
              }
              const r = await finishFile(record.id);
              if (r.error) setError(r.error);
              else {
                setMessage("Documento enviado com acesso privado.");
                setFile(null);
                if (inputRef.current) inputRef.current.value = "";
                router.refresh();
              }
            } catch {
              setError("Não foi possível enviar o arquivo. Tente novamente.");
            }
          })
        }
      >
        {pending ? "Enviando…" : "Enviar documento"}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
export function FileDownload({ id, name }: { id: string; name: string }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            try {
              const r = await downloadFile(id);
              if (r.error) setError(r.error);
              else if (r.url) {
                window.location.assign(r.url);
              }
            } catch {
              setError(
                "Não foi possível autorizar o download. Verifique a conexão e tente novamente.",
              );
            }
          })
        }
      >
        {pending ? "Autorizando…" : "Baixar " + name}
      </button>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
