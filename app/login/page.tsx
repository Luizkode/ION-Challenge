export const dynamic = "force-dynamic";
import { ActionForm } from "@/components/action-form";
import { login } from "@/app/actions";
import { requestPasswordRecovery } from "@/app/recovery-actions";
import Link from "next/link";
import { configured } from "@/lib/supabase";
import { Field, Notice } from "@/components/ui";
import { Submit } from "@/components/submit";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    recovery?: string;
  }>;
}) {
  const params = await searchParams;
  const recovering = params.recovery === "1";
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
        <h2>{recovering ? "Recupere seu acesso." : "Entre no ION OS."}</h2>
        <p className="muted">
          {recovering
            ? "Informe o email da sua conta para solicitar as instruções."
            : "Acesse com sua conta da Agência ION."}
        </p>
        <Notice params={params} />
        {!configured() && (
          <p className="notice">
            Integração pendente: configure NEXT_PUBLIC_SUPABASE_URL e
            NEXT_PUBLIC_SUPABASE_ANON_KEY e aplique a migration. Nenhum dado
            demonstrativo é utilizado.
          </p>
        )}
        <ActionForm
          key={recovering ? "recovery" : "login"}
          action={recovering ? requestPasswordRecovery : login}
        >
          <Field label="Email profissional" name="email" type="email" />
          {!recovering && (
            <Field label="Senha" name="password" type="password" />
          )}
          <Submit>
            {recovering ? "Solicitar recuperação" : "Entrar no ION OS"}
          </Submit>
        </ActionForm>
        <p className="small">
          <Link href={recovering ? "/login" : "/login?recovery=1"}>
            {recovering ? "Voltar para entrar" : "Esqueci minha senha"}
          </Link>
        </p>
        <p className="small muted">
          <ShieldCheck size={14} /> Acesso restrito a usuários convidados.
          Solicite sua conta ao administrador.
        </p>
      </section>
    </main>
  );
}
