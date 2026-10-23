"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { Submit } from "./submit";
import { saveAccess, inviteAccess } from "@/app/team-actions";
import { functionLabels } from "@/lib/access";
import {
  validateAccess,
  type AccessMode,
  type FieldErrors,
  type TeamResult,
} from "@/lib/access-input";
type Profile = { id: string; name: string; category: string; active: boolean };
export function AccessForm({
  mode,
  profile,
  functions = [],
  bindings = [],
  companies,
  participates = false,
}: {
  mode: AccessMode;
  profile?: Profile;
  functions?: string[];
  bindings?: string[];
  companies: { id: string; name: string }[];
  participates?: boolean;
}) {
  const initial = {
    id: profile?.id ?? "",
    name: profile?.name ?? "",
    email: "",
    category: profile?.category ?? "employee",
    active: String(profile?.active ?? true),
    functions,
    company_ids: bindings,
    reason: "",
    confirm: false,
    remove_from_campaign: false,
  };
  const [values, setValues] = useState(initial),
    [fields, setFields] = useState<FieldErrors>({}),
    [feedback, setFeedback] = useState<{
      ok: boolean;
      message: string;
      kind?: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const id = useId(),
    ref = useRef<HTMLFormElement>(null),
    router = useRouter(),
    locked = useRef(false);
  const label =
    mode === "invite"
      ? "Enviar convite"
      : mode === "link"
        ? "Vincular conta existente"
        : "Salvar acesso";
  function change<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    setValues((v) => ({
      ...v,
      [key]: value,
      ...(key === "confirm" ? {} : { confirm: false }),
    }));
    setFields((f) => ({ ...f, [key]: [] }));
    setFeedback(null);
  }
  const errorId = (name: string) => id + "-" + name + "-error";
  function error(name: string) {
    return fields[name]?.length ? (
      <p className="field-error" id={errorId(name)}>
        {fields[name].join(" ")}
      </p>
    ) : null;
  }
  function props(name: string) {
    return {
      "aria-invalid": fields[name]?.length ? true : undefined,
      "aria-describedby": fields[name]?.length ? errorId(name) : undefined,
    };
  }
  function focus(errors: FieldErrors) {
    requestAnimationFrame(() => {
      const name = Object.keys(errors)[0];
      ref.current?.querySelector<HTMLElement>('[name="' + name + '"]')?.focus();
    });
  }
  function validate(event: FormEvent<HTMLFormElement>) {
    if (locked.current) {
      event.preventDefault();
      return;
    }
    const parsed = validateAccess(new FormData(event.currentTarget), mode);
    if (
      participates &&
      mode === "edit" &&
      !(values.category === "employee" && values.functions.includes("sdr")) &&
      !values.remove_from_campaign
    )
      parsed.fields.remove_from_campaign = [
        "Confirme a remoção da campanha ao retirar a função SDR ou promover este participante a Administrador.",
      ];
    if (Object.keys(parsed.fields).length) {
      event.preventDefault();
      setFields(parsed.fields);
      setFeedback({
        ok: false,
        kind: "validation",
        message: "Corrija os campos indicados antes de continuar.",
      });
      focus(parsed.fields);
      return;
    }
    const category =
      values.category === "admin"
        ? "Administrador"
        : values.category === "partner"
          ? "Parceiro"
          : "Colaborador";
    const operations = [
      mode === "invite"
        ? "Enviar convite para " + values.email
        : "Atualizar o acesso de " + values.name,
      "Categoria: " + category,
      "Situação: " + (values.active === "true" ? "Ativo" : "Inativo"),
      ...(values.category === "employee"
        ? [
            "Funções: " +
              values.functions
                .map((f) => functionLabels[f as keyof typeof functionLabels])
                .join(", "),
          ]
        : []),
      ...(values.remove_from_campaign
        ? [
            "Remover a participação na campanha em aberto, preservando o histórico.",
          ]
        : []),
    ];
    if (!window.confirm(operations.join("\n"))) {
      event.preventDefault();
      return;
    }
    locked.current = true;
  }
  async function execute(form: FormData) {
    setBusy(true);
    setFeedback(null);
    try {
      const result: TeamResult = await (mode === "invite"
        ? inviteAccess(form)
        : saveAccess(form));
      setFeedback(result);
      setFields(result.ok ? {} : result.fields);
      setValues((v) => ({ ...v, confirm: false }));
      if (result.ok) {
        if (mode === "invite" || mode === "link")
          setValues({ ...initial, functions: [], company_ids: [] });
        else {
          const normalized = validateAccess(form, mode).input;
          if (normalized.success)
            setValues((v) => ({
              ...v,
              functions: normalized.data.functions,
              company_ids: normalized.data.company_ids,
              reason: "",
              confirm: false,
              remove_from_campaign: false,
            }));
        }
        router.refresh();
      } else focus(result.fields);
    } catch (e) {
      unstable_rethrow(e);
      setValues((v) => ({ ...v, confirm: false }));
      setFeedback({
        ok: false,
        kind: "uncertain",
        message:
          "A conexão foi interrompida. Recarregue o usuário ou o histórico de convites para conferir o resultado antes de reenviar. Os campos foram preservados.",
      });
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  return (
    <form
      ref={ref}
      action={execute}
      onSubmit={validate}
      onReset={(event) => event.preventDefault()}
      noValidate
      className="form-grid"
      aria-busy={busy}
    >
      <p className="small muted" style={{ gridColumn: "1/-1" }}>
        Campos com <span aria-hidden="true">*</span> são obrigatórios. A
        justificativa exige pelo menos 8 caracteres.
      </p>
      {mode === "edit" ? (
        <input
          type="hidden"
          name="id"
          aria-label="UUID do usuário Auth"
          value={values.id}
        />
      ) : mode === "link" ? (
        <label className="field">
          <span>
            UUID do usuário Auth <span aria-hidden="true">*</span>
          </span>
          <input
            name="id"
            aria-label="UUID do usuário Auth"
            value={values.id}
            required
            disabled={busy}
            onChange={(e) => change("id", e.target.value)}
            {...props("id")}
          />
          {error("id")}
        </label>
      ) : null}
      {mode === "invite" && (
        <label className="field">
          <span>
            Email do convite <span aria-hidden="true">*</span>
          </span>
          <input
            name="email"
            aria-label="Email do convite"
            type="email"
            value={values.email}
            required
            disabled={busy}
            autoComplete="email"
            onChange={(e) => change("email", e.target.value)}
            {...props("email")}
          />
          {error("email")}
        </label>
      )}
      <label className="field">
        <span>
          Nome <span aria-hidden="true">*</span>
        </span>
        <input
          name="name"
          aria-label="Nome"
          value={values.name}
          required
          minLength={2}
          maxLength={120}
          disabled={busy}
          onChange={(e) => change("name", e.target.value)}
          {...props("name")}
        />
        {error("name")}
      </label>
      <label className="field">
        <span>
          Categoria de acesso <span aria-hidden="true">*</span>
        </span>
        <select
          name="category"
          aria-label="Categoria de acesso"
          value={values.category}
          required
          disabled={busy}
          onChange={(e) => change("category", e.target.value)}
          {...props("category")}
        >
          <option value="admin">Administrador</option>
          <option value="employee">Colaborador</option>
          <option value="partner">Parceiro</option>
        </select>
        {error("category")}
      </label>
      <label className="field">
        <span>
          Situação do acesso <span aria-hidden="true">*</span>
        </span>
        <select
          name="active"
          aria-label="Situação do acesso"
          value={values.active}
          disabled={busy}
          required
          onChange={(e) => change("active", e.target.value)}
          {...props("active")}
        >
          <option value="true">Ativo</option>
          <option value="false">Inativo</option>
        </select>
        {error("active")}
      </label>
      {values.category === "employee" ? (
        <fieldset disabled={busy} {...props("functions")}>
          <legend className="small muted">
            Funções · selecione uma ou mais <span aria-hidden="true">*</span>
          </legend>
          {Object.entries(functionLabels).map(([code, title]) => (
            <label className="check" key={code}>
              <input
                name="functions"
                type="checkbox"
                value={code}
                checked={values.functions.includes(code)}
                onChange={(e) =>
                  change(
                    "functions",
                    e.target.checked
                      ? [...values.functions, code]
                      : values.functions.filter((f) => f !== code),
                  )
                }
              />
              {title}
            </label>
          ))}
          {error("functions")}
          {values.functions.includes("sdr") && (
            <p className="small muted">
              A função SDR configura o acesso comercial. A participação no
              Challenger e o vínculo ao time são gerenciados na administração da
              campanha.
            </p>
          )}
        </fieldset>
      ) : (
        <p className="small muted">
          {values.category === "admin"
            ? "Administradores recebem permissões administrativas; funções operacionais não são exigidas."
            : "Parceiros acessam somente as informações publicadas das empresas vinculadas."}
        </p>
      )}
      {values.category !== "admin" && (
        <fieldset disabled={busy} {...props("company_ids")}>
          <legend className="small muted">
            Empresas ·{" "}
            {values.category === "partner"
              ? "obrigatório selecionar ao menos uma"
              : "opcional para colaboradores"}
            {values.category === "partner" && (
              <span aria-hidden="true"> *</span>
            )}
          </legend>
          {companies.length ? (
            companies.map((c) => (
              <label className="check" key={c.id}>
                <input
                  type="checkbox"
                  name="company_ids"
                  value={c.id}
                  checked={values.company_ids.includes(c.id)}
                  onChange={(e) =>
                    change(
                      "company_ids",
                      e.target.checked
                        ? [...values.company_ids, c.id]
                        : values.company_ids.filter((x) => x !== c.id),
                    )
                  }
                />
                {c.name}
              </label>
            ))
          ) : (
            <p className="small muted">
              Nenhuma empresa ativa disponível. Cadastre uma empresa antes de
              vincular um parceiro.
            </p>
          )}
          {error("company_ids")}
        </fieldset>
      )}
      {mode !== "invite" && (
        <div>
          {participates && (
            <p className="notice">
              Este usuário participa de uma campanha em aberto. Para promovê-lo
              a administrador ou retirar a função SDR, confirme também a remoção
              da campanha. Reuniões, contratos e pontuações históricas serão
              preservados.
            </p>
          )}
          <label className="check">
            <input
              type="checkbox"
              name="remove_from_campaign"
              value="true"
              checked={values.remove_from_campaign}
              disabled={busy}
              onChange={(e) => change("remove_from_campaign", e.target.checked)}
              {...props("remove_from_campaign")}
            />
            Remover participação na campanha ao retirar a função SDR
          </label>
          {error("remove_from_campaign")}
        </div>
      )}
      <label className="field">
        <span>
          Justificativa (mínimo 8 caracteres) <span aria-hidden="true">*</span>
        </span>
        <input
          name="reason"
          aria-label="Justificativa (mínimo 8 caracteres)"
          value={values.reason}
          minLength={8}
          maxLength={2000}
          required
          disabled={busy}
          onChange={(e) => change("reason", e.target.value)}
          {...props("reason")}
        />
        {error("reason")}
      </label>
      <div>
        <label className="check">
          <input
            name="confirm"
            type="checkbox"
            value="true"
            checked={values.confirm}
            required
            disabled={busy}
            onChange={(e) => change("confirm", e.target.checked)}
            {...props("confirm")}
          />
          Confirmo a operação selecionada e a preservação do histórico.
        </label>
        {error("confirm")}
      </div>
      <Submit disabled={busy}>{label}</Submit>
      {feedback && (
        <p
          className={"notice" + (feedback.ok ? "" : " error")}
          role={feedback.ok ? "status" : "alert"}
          style={{ gridColumn: "1/-1" }}
        >
          {feedback.message}
        </p>
      )}
    </form>
  );
}
