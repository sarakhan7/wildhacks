import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/ui/Navbar";
import { AuditProvider } from "@/context/AuditContext";

export const metadata: Metadata = {
  title: "AuditAI \u2014 Free Automated Energy Audit",
  description: "Upload 12 months of utility bills and get a full prioritized energy audit with ROI estimates in under 10 minutes. No engineer required.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased font-main">
      <body className="min-h-full flex flex-col relative text-[var(--text-primary)]">
        <div className="gradient-mesh" />
        <AuditProvider>
          <Navbar />
          <div className="flex-1 mt-16 flex flex-col">
            {children}
          </div>
        </AuditProvider>
      </body>
    </html>
  );
}
