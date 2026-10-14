import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { session } from "@/lib/session";
import { osModules, canAccessModule } from "@/lib/os-modules";
import { Empty } from "@/components/ui";
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { profile } = await session();
  const { module: id } = await params;
  const module = osModules.find(
    (m) => m.id === id && !["dashboard", "challenger"].includes(m.id),
  );
  if (!module) notFound();
  if (!canAccessModule(module.id, profile.role))
    redirect(
      "/?error=" +
        encodeURIComponent("Você não tem permissão para acessar este módulo."),
    );
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">ION OS · EVOLUÇÃO DA PLATAFORMA</p>
          <h1>{module.name}</h1>
        </div>
        <span className="badge">Em desenvolvimento</span>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>Estrutura preparada</h2>
        </div>
        <Empty>
          {module.description} Os recursos futuros ainda não estão disponíveis.
        </Empty>
        {["team", "settings"].includes(module.id) && (
          <div className="padded">
            <Link className="button" href="/admin">
              Abrir administração existente
            </Link>
          </div>
        )}
        {module.id === "crm" && (
          <div className="padded">
            <Link className="button" href="/meetings">
              Abrir reuniões existentes
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
