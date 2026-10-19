import { FormScope, ActionForm } from "@/components/action-form";
import { hasFunction } from "@/lib/access";
import Link from "next/link";
import { session } from "@/lib/session";
import { logout } from "@/app/actions";
import { LogOut, ArrowUpRight } from "lucide-react";
import { Live } from "@/components/live";
import { OSNavigation } from "@/components/os-navigation";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await session();
  return (
    <FormScope owner={profile.id}>
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <div className="shell">
        <aside>
          <Link className="wordmark" href="/">
            ION<span> / OS</span>
          </Link>
          <p className="eyebrow nav-label">AGENCY OPERATING SYSTEM</p>
          <OSNavigation profile={profile} />
          <div className="sidebar-bottom">
            <span className="avatar">{profile.name.slice(0, 1)}</span>
            <div>
              <strong>{profile.name}</strong>
              <small>
                {profile.category === "admin"
                  ? "ADMINISTRADOR"
                  : profile.category === "partner"
                    ? "PARCEIRO"
                    : "COLABORADOR"}
              </small>
            </div>
            <ActionForm action={logout}>
              <button className="icon-button" aria-label="Sair">
                <LogOut size={17} />
              </button>
            </ActionForm>
          </div>
        </aside>
        <div className="workspace">
          <header>
            <span className="muted">ION OS</span>
            <Live />
            <Link
              className="profile-link muted small"
              href="/account"
              title={profile.name}
            >
              {profile.name}
            </Link>
            {hasFunction(profile, "sdr") && (
              <Link href="/meetings/new" className="button">
                + Nova reunião <ArrowUpRight size={16} />
              </Link>
            )}
            <ActionForm action={logout} className="mobile-logout">
              <button className="icon-button" aria-label="Sair">
                <LogOut size={18} />
              </button>
            </ActionForm>
          </header>
          <main id="main-content" tabIndex={-1} className="content">
            {children}
          </main>
          <footer>
            AGÊNCIA ION <span>Agency Operating System</span>
          </footer>
        </div>
      </div>
    </FormScope>
  );
}
