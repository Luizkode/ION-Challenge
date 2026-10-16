import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ION OS | Agência ION",
  description:
    "Agency Operating System da Agência ION. Operação e campanhas em uma única plataforma.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
