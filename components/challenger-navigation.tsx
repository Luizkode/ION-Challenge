import Link from "next/link";
import type { CurrentRole } from "@/lib/os-modules";
export function ChallengerNavigation({ role }: { role: CurrentRole }) {
  return (
    <nav aria-label="Operação do Challenger" className="module-navigation">
      <Link href="/challenger">Campanha e rankings</Link>
      <Link href="/meetings">
        {role === "sdr" ? "Minhas reuniões" : "Reuniões"}
      </Link>
      {role !== "sdr" && <Link href="/validation">Validação de reuniões</Link>}
      <Link href="/history">Meu perfil e histórico</Link>
      {role === "admin" && (
        <Link href="/admin">Administração do Challenger</Link>
      )}
    </nav>
  );
}
