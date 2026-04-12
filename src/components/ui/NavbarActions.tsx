"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAudit } from "@/context/AuditContext";

export function NavbarActions() {
  const pathname = usePathname();
  const { auditId } = useAudit();
  const auditInProgress = Boolean(auditId);
  const auditCtaLabel =
    pathname === "/audit" && auditInProgress ? "Continue audit" : "Start audit";

  return (
    <div className="ml-auto flex items-center gap-3">
      <Link href="/audit" className="btn-primary px-5 py-3 text-sm">
        {auditCtaLabel}
      </Link>
    </div>
  );
}
