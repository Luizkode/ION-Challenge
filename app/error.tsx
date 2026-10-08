"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel padded">
      <h2>Não foi possível carregar os dados.</h2>
      <p className="muted">Verifique a conexão e a configuração do Supabase.</p>
      <button className="button" onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
