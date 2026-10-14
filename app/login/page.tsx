import { login } from "@/app/actions";
import { configured } from "@/lib/supabase";
import { Field, Notice } from "@/components/ui";
import { Submit } from "@/components/submit";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="login">
      <div className="login-brand">
        <div className="wordmark">
          ION<span> / OS</span>
        </div>
        <div>
          <p className="eyebrow">AGÊNCIA ION · AGENCY OPERATING SYSTEM</p>
          <h1>
            O próximo nível
            <br />é uma conquista
            <br />
            <em>coletiva.</em>
          </h1>
          <p className="muted">
            Sua agência conectada. Sua operação em um só lugar.
            <br />
            Comercial, campanhas e gestão evoluindo juntos.
          </p>
        </div>
        <p className="muted small">
          Foco no processo. Reconhecimento pelo resultado.
        </p>
      </div>
      <section className="login-form">
        <ArrowUpRight size={32} className="purple" />
        <h2>Entre no ION OS.</h2>
        <p className="muted">Acesse com sua conta da Agência ION.</p>
        <Notice params={await searchParams} />
        {!configured() && (
          <p className="notice">
            Integração pendente: configure NEXT_PUBLIC_SUPABASE_URL e
            NEXT_PUBLIC_SUPABASE_ANON_KEY e aplique a migration. Nenhum dado
            demonstrativo é utilizado.
          </p>
        )}
        <form action={login}>
          <Field label="Email profissional" name="email" type="email" />
          <Field label="Senha" name="password" type="password" />
          <Submit>Entrar no ION OS</Submit>
        </form>
        <p className="small muted">
          <ShieldCheck size={14} /> Acesso restrito a usuários convidados. Solicite
          sua conta ao administrador.
        </p>
      </section>
    </main>
  );
}
