import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/ui/Navbar";
import { AuditProvider } from "@/context/AuditContext";

export const metadata: Metadata = {
  title: "AuditAI",
  description: "Free AI-driven commercial building energy audits with benchmarking, anomaly detection, and prioritized savings recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full text-[var(--text-primary)]">
        <AuditProvider>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <div className="flex-1">{children}</div>
          </div>
        </AuditProvider>
      </body>
    </html>
  );
}
