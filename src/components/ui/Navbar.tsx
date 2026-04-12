"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const marketingLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Report", href: "/report?demo=1" },
];

export function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <header className="pointer-events-none fixed inset-x-0 top-5 z-50 px-4 sm:px-6">
      <div className="pointer-events-auto mx-auto flex w-full max-w-[980px] items-center gap-4 glass-nav px-5 py-3 sm:px-7">
        <Link href="/" className="shrink-0 font-heading text-[1.15rem] font-extrabold tracking-[-0.05em]">
          <span className="text-navy">Audit</span>
          <span className="text-mid-navy">AI</span>
        </Link>

        <div className="hidden items-center gap-2 font-mono text-[0.68rem] text-[var(--text-muted)] md:flex">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-success dot-pulse" />
          <span>live · 3 buildings analyzed today</span>
        </div>

        <div className="hidden flex-1 items-center justify-end gap-6 md:flex">
          {marketingLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--text-muted)] transition-colors hover:text-navy"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {!isHome && (
            <Link href="/" className="hidden text-sm text-[var(--text-muted)] transition-colors hover:text-navy sm:inline-flex">
              Home
            </Link>
          )}
          <Link href="/audit" className="btn-primary px-5 py-3 text-sm">
            {pathname === "/audit" ? "Continue audit" : "Start audit"}
          </Link>
        </div>
      </div>
    </header>
  );
}
