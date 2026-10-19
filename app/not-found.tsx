import Link from "next/link";
export default function NotFound() {
  return (
    <main className="content">
      <section className="panel padded">
        <p className="eyebrow">ION OS · 404</p>
        <h1>Página não encontrada</h1>
        <p className="muted">
          O endereço pode estar incorreto ou o registro não está disponível para
          sua conta.
        </p>
        <div className="crm-actions">
          <Link href="/" className="button">
            Voltar ao início
          </Link>
        </div>
      </section>
    </main>
  );
}
