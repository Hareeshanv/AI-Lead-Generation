import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "AI Lead Generation Engine | Enterprise Autonomous SaaS",
  description: "Autonomous AI system for lead discovery, enrichment, verification, scoring, and automated outreach.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="font-sans min-h-screen bg-background text-foreground antialiased overflow-x-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
