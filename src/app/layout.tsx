import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/ui/Navbar";
import { AuditProvider } from "@/context/AuditContext";

const interBody = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const outfitHeading = Outfit({
  variable: "--font-geist-mono", 
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AuditAI | Fast Automated Energy Audits",
  description: "Get a commercial building energy audit in under 10 minutes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`\${interBody.variable} \${outfitHeading.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col relative text-[#f1f5f9]">
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
