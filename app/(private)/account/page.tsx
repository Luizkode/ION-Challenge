import { session } from "@/lib/session";
import { changePassword } from "@/app/actions";
import { Field, Notice } from "@/components/ui";
import { Submit } from "@/components/submit";
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { profile } = await session();
  return (
    <>
      <div className="page-title">
        <h1>Minha conta · {profile.name}</h1>
      </div>
      <Notice params={await searchParams} />
      <section className="panel padded">
        <h2>Definir senha</h2>
        <form action={changePassword} className="form-grid">
          <Field
            name="password"
            label="Nova senha (mínimo 12 caracteres)"
            type="password"
          />
          <Submit>Atualizar senha</Submit>
        </form>
      </section>
    </>
  );
}
