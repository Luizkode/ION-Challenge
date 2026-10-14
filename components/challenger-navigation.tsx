import Link from "next/link";
import { hasFunction, type Access } from "@/lib/access";
export function ChallengerNavigation({ profile }: { profile: Access }) {
  return (
    <nav aria-label="Operação do Challenger" className="module-navigation">
      <Link href="/challenger">Campanha e rankings</Link>
      <Link href="/meetings">
        {hasFunction(profile, "sdr") ? "Minhas reuniões" : "Reuniões"}
      </Link>
      {(profile.category === "admin" || hasFunction(profile, "closer")) && (
        <Link href="/validation">Validação de reuniões</Link>
      )}
      <Link href="/history">Meu perfil e histórico</Link>
      {profile.category === "admin" && (
        <Link href="/admin">Administração do Challenger</Link>
      )}
    </nav>
  );
}
