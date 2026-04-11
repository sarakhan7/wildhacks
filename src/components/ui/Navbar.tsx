"use client";

import Link from "next/link";
import { Zap } from "lucide-react";
import { usePathname } from "next/navigation";

export function Navbar() {
  const pathname = usePathname();
  
  return (
    <header className="fixed top-0 w-full z-50 glass-strong border-b-0 border-x-0 rounded-none bg-opacity-70 h-16">
      <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-gradient-to-br from-green-400 to-cyan-500 p-1.5 rounded-lg group-hover:shadow-[0_0_15px_rgba(0,229,134,0.4)] transition-shadow">
            <Zap className="text-[#0a0e17] w-5 h-5 fill-current" />
          </div>
          <span className="font-heading font-bold text-xl tracking-tight">AuditAI</span>
        </Link>
        
        <nav className="hidden md:flex gap-8 text-sm font-medium">
          <Link href="/" className={`hover:text-[var(--accent-green)] transition-colors \${pathname === '/' ? 'text-[var(--accent-green)]' : 'text-gray-300'}`}>Home</Link>
          <Link href="/audit" className={`hover:text-[var(--accent-green)] transition-colors \${pathname === '/audit' ? 'text-[var(--accent-green)]' : 'text-gray-300'}`}>Run Audit</Link>
          <a href="#" className="text-gray-300 hover:text-[var(--accent-green)] transition-colors">Pricing</a>
        </nav>
        
        <div className="flex gap-4">
          <Link href="/audit" className="btn-primary py-2 px-5 text-sm hidden sm:block">
            Start Free Audit
          </Link>
        </div>
      </div>
    </header>
  );
}
