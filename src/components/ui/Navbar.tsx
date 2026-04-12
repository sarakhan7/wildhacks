import Link from "next/link";

import { NavbarActions } from "@/components/ui/NavbarActions";

const marketingLinks = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
];

export function Navbar() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-5 z-50 px-4 sm:px-6">
      <div className="pointer-events-auto mx-auto flex w-full max-w-[980px] items-center gap-4 glass-nav px-5 py-3 sm:px-7">
        <Link href="/" className="shrink-0 font-heading text-[1.15rem] font-extrabold tracking-[-0.05em]">
          <span className="text-navy">Audit</span>
          <span className="text-mid-navy">AI</span>
        </Link>

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

        <NavbarActions />
      </div>
    </header>
  );
}
