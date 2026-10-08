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
          ION<span> / CHALLENGE</span>
        </div>
        <div>
          <p className="eyebrow">AGÊNCIA ION · PERFORMANCE COMERCIAL</p>
          <h1>
            O próximo nível
            <br />é uma conquista
            <br />
            <em>coletiva.</em>
          </h1>
          <p className="muted">
            Cada reunião importa. Cada ponto é conquistado.
            <br />
            Uma equipe inteira na corrida pelo iPhone 13.
          </p>
        </div>
        <p className="muted small">
          Foco no processo. Reconhecimento pelo resultado.
        </p>
      </div>
      <section className="login-form">
        <ArrowUpRight size={32} className="purple" />
        <h2>Entre na competição.</h2>
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
          <Submit>Entrar no ION Challenge</Submit>
        </form>
        <p className="small muted">
          <ShieldCheck size={14} /> Acesso restrito a colaboradores. Solicite
          sua conta ao administrador.
        </p>
      </section>
    </main>
  );
}
