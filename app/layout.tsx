import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ION Challenge",
  description: "A corrida pelo iPhone 13. Agência ION.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
