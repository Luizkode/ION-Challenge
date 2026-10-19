"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  usePathname,
  useSearchParams,
  unstable_rethrow,
} from "next/navigation";
import { useFormStatus } from "react-dom";
type Draft = { values: [string, string][]; at: number };
const Drafts = createContext<Map<string, Draft> | null>(null);
export function FormScope({
  owner,
  children,
}: {
  owner: string;
  children: ReactNode;
}) {
  const state = useRef({ owner, entries: new Map<string, Draft>() });
  if (state.current.owner !== owner)
    state.current = { owner, entries: new Map() };
  return (
    <Drafts.Provider value={state.current.entries}>{children}</Drafts.Provider>
  );
}
function Processing() {
  const { pending } = useFormStatus();
  return pending ? (
    <p className="form-progress small" aria-live="polite">
      Processando… Aguarde a confirmação.
    </p>
  ) : null;
}
function restore(form: HTMLFormElement, values: [string, string][]) {
  for (const control of Array.from(form.elements)) {
    if (!(
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ))
      continue;
    if (
      !control.name ||
      (control instanceof HTMLInputElement &&
        ["hidden", "password", "file"].includes(control.type))
    )
      continue;
    if (control.name === "confirm") {
      if (control instanceof HTMLInputElement) control.checked = false;
      continue;
    }
    const entries = values
      .filter(([key]) => key === control.name)
      .map(([, v]) => v);
    if (
      control instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(control.type)
    )
      control.checked = entries.includes(control.value);
    else if (entries.length) {
      const prototype =
        control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        control,
        entries[0],
      );
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  form.dataset.formDirty = "true";
  const details = form.closest("details");
  if (details) details.open = true;
}
/** Drafts stay only in this authenticated layout's memory: never storage, cookies or server logs. */
export function ActionForm({
  action,
  children,
  onSubmit,
  ...props
}: Omit<ComponentProps<"form">, "action"> & {
  action: (data: FormData) => void | Promise<void>;
}) {
  const drafts = useContext(Drafts),
    path = usePathname(),
    params = useSearchParams(),
    ref = useRef<HTMLFormElement>(null),
    locked = useRef(false),
    saved = useRef<Draft | null>(null);
  const [failure, setFailure] = useState("");
  function key(form: HTMLFormElement) {
    return (
      path +
      "|" +
      Array.from(form.elements)
        .filter((e): e is HTMLInputElement => e instanceof HTMLInputElement)
        .map(
          (e) =>
            e.name +
            (e.type === "hidden" &&
            [
              "id",
              "lead_id",
              "service_id",
              "company_id",
              "operation",
              "profile_id",
            ].includes(e.name)
              ? "=" + e.value
              : ""),
        )
        .join("|")
    );
  }
  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    locked.current = false;
    if (params.has("error")) {
      const draft = drafts?.get(key(f));
      if (draft && Date.now() - draft.at < 300000) restore(f, draft.values);
    } else if (params.has("success")) {
      drafts?.clear();
      f.dataset.formDirty = "false";
    }
  }, [params, drafts, path]);
  async function submit(data: FormData) {
    try {
      await action(data);
    } catch (error) {
      unstable_rethrow(error);
      setFailure(
        "Não foi possível concluir a operação. Verifique a conexão antes de tentar novamente. Seus campos foram preservados.",
      );
      requestAnimationFrame(() => {
        if (ref.current && saved.current)
          restore(ref.current, saved.current.values);
      });
    } finally {
      locked.current = false;
    }
  }
  return (
    <form
      {...props}
      ref={ref}
      action={submit}
      onChange={(e) => {
        e.currentTarget.dataset.formDirty = "true";
        props.onChange?.(e);
      }}
      onSubmit={(event) => {
        onSubmit?.(event);
        if (event.defaultPrevented) return;
        if (locked.current) {
          event.preventDefault();
          return;
        }
        locked.current = true;
        setFailure("");
        const f = event.currentTarget;
        const allowed = new Set(
          Array.from(f.elements)
            .filter(
              (
                c,
              ): c is
                HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
                c instanceof HTMLSelectElement ||
                c instanceof HTMLTextAreaElement ||
                (c instanceof HTMLInputElement &&
                  !["hidden", "file", "password"].includes(c.type)),
            )
            .map((c) => c.name)
            .filter((n) => n !== "confirm"),
        );
        const draft = {
          at: Date.now(),
          values: Array.from(new FormData(f)).filter(
            (pair): pair is [string, string] =>
              allowed.has(pair[0]) && typeof pair[1] === "string",
          ),
        };
        saved.current = draft;
        if (drafts) {
          if (drafts.size >= 20) drafts.clear();
          drafts.set(key(f), draft);
        }
      }}
    >
      {children}
      <Processing />
      {failure && (
        <p role="alert" className="notice error">
          {failure}
        </p>
      )}
    </form>
  );
}
