"use client";

import Link from "next/link";
import { ArrowRight, Building2, Zap, Clock, Banknote, ShieldCheck, MapIcon, LineChart } from "lucide-react";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/GlassCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* Hero Section */}
      <section className="relative px-6 pt-24 pb-32 max-w-7xl mx-auto w-full flex flex-col items-center justify-center min-h-[85vh] text-center">
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-strong mb-8 border-[var(--border-accent)] text-sm font-medium text-[var(--accent-orange)]">
            <Zap className="w-4 h-4" /> 
            Automated ASHRAE Level II Diagnostics
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight font-main leading-tight">
            Commercial building energy audits in <span className="text-gradient drop-shadow-lg">10 minutes.</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-[var(--text-secondary)] mb-12 max-w-3xl mx-auto font-light leading-relaxed">
            Stop waiting months for a $15,000 engineering report. AuditAI uses utility data, weather patterns, and AI to identify instant ROI opportunities for free.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link href="/audit" className="btn-primary text-lg px-8 py-4 flex items-center gap-2 w-full sm:w-auto justify-center group">
              Start Free Audit
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <span className="text-sm text-[var(--text-muted)] sm:ml-4">No credit card • Free for mid-size buildings (~50k sqft)</span>
          </div>
        </motion.div>

        {/* Stats Section */}
        <motion.div 
          className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <GlassCard className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[var(--text-muted)] text-sm font-medium uppercase tracking-wider mb-2">Traditional Cost</h3>
            <div className="text-4xl font-main font-semibold flex items-baseline">
              $<AnimatedCounter from={0} to={15} duration={1.5} />k <span className="text-2xl ml-1 text-[var(--text-secondary)]">- $50k+</span>
            </div>
          </GlassCard>

          <GlassCard className="flex flex-col items-center justify-center text-center relative overflow-hidden" strong glow>
            <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-orange-dim)] to-[var(--accent-purple-dim)] opacity-30" />
            <h3 className="text-[var(--accent-orange)] text-sm font-semibold uppercase tracking-wider mb-2 z-10">AuditAI Cost</h3>
            <div className="text-5xl font-main font-bold text-[var(--text-primary)] z-10">
              $<AnimatedCounter from={100} to={0} duration={2} />
            </div>
            <div className="text-xs text-[var(--accent-orange)] mt-2 font-medium bg-[var(--accent-orange-dim)] px-2 py-1 rounded-full z-10">100% Free Forever</div>
          </GlassCard>

          <GlassCard className="flex flex-col items-center justify-center text-center">
            <h3 className="text-[var(--text-muted)] text-sm font-medium uppercase tracking-wider mb-2">Turnaround</h3>
            <div className="text-4xl font-main font-semibold">
              <AnimatedCounter from={0} to={10} duration={1.5} /> <span className="text-xl text-[var(--text-secondary)]">min</span>
            </div>
          </GlassCard>
        </motion.div>
      </section>

      {/* How it Works / Pipeline Section */}
      <section className="bg-[var(--bg-secondary)]/50 py-24 border-y border-[var(--border-subtle)] relative backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-main font-bold mb-4">The Pipeline</h2>
            <p className="text-[var(--text-secondary)] text-lg">Rigorous data analysis meets agentic reasoning.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <StepCard 
              icon={<Building2 />} 
              step="1"
              title="Building Profile"
              desc="Enter basic characteristics, location, and operating hours."
            />
            <StepCard 
              icon={<MapIcon />} 
              step="2"
              title="Geospatial Context"
              desc="We map against EPA benchmarks and local climate zones."
            />
            <StepCard 
              icon={<Banknote />} 
              step="3"
              title="OCR Extraction"
              desc="Upload bills. Our vision model parses consumption and peak demand."
            />
            <StepCard 
              icon={<LineChart />} 
              step="4"
              title="Diagnostic Report"
              desc="Statistical engine runs. AI PE generates prioritized ECMs with ROI."
            />
          </div>
        </div>
      </section>

    </main>
  );
}

function StepCard({ icon, title, desc, step }: { icon: React.ReactNode, title: string, desc: string, step: string }) {
  return (
    <div className="relative p-6 rounded-xl glass hover:shadow-glow-purple transition-shadow group overflow-hidden">
      <div className="absolute -right-4 -top-4 text-9xl font-main font-black text-white/5 group-hover:text-[var(--accent-purple)]/10 transition-colors select-none pointer-events-none">
        {step}
      </div>
      <div className="w-12 h-12 bg-[#1b1b1b] rounded-lg flex items-center justify-center mb-6 text-[var(--accent-purple)] border border-white/5 shadow-lg group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-xl font-medium mb-3 font-main relative z-10">{title}</h3>
      <p className="text-[var(--text-muted)] text-sm leading-relaxed relative z-10">
        {desc}
      </p>
    </div>
  );
}
