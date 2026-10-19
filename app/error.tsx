"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel padded" role="alert">
      <h2>Não foi possível carregar os dados.</h2>
      <p className="muted">
        Verifique a conexão e tente novamente. Se o problema persistir, contate
        o administrador.
      </p>
      <button className="button" onClick={reset}>
        Tentar novamente
      </button>
    </section>
  );
}
