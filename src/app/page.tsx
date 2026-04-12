import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { AuditTerminal } from "@/components/site/AuditTerminal";

const stats = [
  { value: "$15K–$50K", label: "Traditional audit cost" },
  { value: "6 months", label: "Typical timeline" },
  { value: "10 min · Free", label: "AuditAI" },
];

const steps = [
  {
    num: "01",
    tag: "upload",
    title: "Upload your bills",
    desc: "Drop 12 months of electric and gas bills. AuditAI extracts the key data automatically.",
  },
  {
    num: "02",
    tag: "profile",
    title: "Describe your building",
    desc: "Building type, square footage, operating hours, and major systems. The full setup takes a few minutes.",
  },
  {
    num: "03",
    tag: "analyze",
    title: "AI runs the audit",
    desc: "Weather normalization, peer benchmarking, anomaly detection, and ECM ranking run in one pipeline.",
  },
  {
    num: "04",
    tag: "report",
    title: "Get your report",
    desc: "Receive a prioritized list of upgrades with estimated savings, payback, and next-step guidance.",
  },
];

const features = [
  {
    num: "01",
    tag: "extraction",
    title: "Bill parsing",
    desc: "Read PDFs and bill images to pull kWh, therms, peak demand, and total cost month by month.",
  },
  {
    num: "02",
    tag: "regression",
    title: "Weather analysis",
    desc: "Separate heating, cooling, and baseload consumption using weather-aware normalization.",
  },
  {
    num: "03",
    tag: "benchmarking",
    title: "Peer comparison",
    desc: "See how the building stacks up against comparable properties in the same climate band.",
  },
  {
    num: "04",
    tag: "anomalies",
    title: "Anomaly detection",
    desc: "Spot unexplained usage spikes that may signal billing issues or underperforming equipment.",
  },
  {
    num: "05",
    tag: "upgrades",
    title: "Upgrade modeling",
    desc: "Review prioritized ECMs with estimated annual savings, payback, complexity, and NPV.",
  },
  {
    num: "06",
    tag: "report",
    title: "Full audit report",
    desc: "Open a presentation-ready report with executive summary, charts, and implementation guidance.",
  },
];

const terminalLines = [
  { label: "Building", value: "350 Fifth Ave", valueClassName: "text-emerald-400" },
  { label: "Type", value: "Office · Class A", valueClassName: "text-emerald-400" },
  { label: "EUI", value: "89.4 kBtu/ft²", valueClassName: "text-emerald-400" },
  { label: "Rank", value: "73rd percentile", valueClassName: "text-emerald-400" },
  { label: "", value: "" },
  { label: "⚠ Anomaly", value: "March 2022 · +18% unexplained", valueClassName: "text-red-400" },
  { label: "✓ Upgrades", value: "4 upgrades found", valueClassName: "text-emerald-400" },
  { label: "", value: "" },
  { label: "01", value: "LED retrofit · saves $12k/yr" },
  { label: "02", value: "VFD on AHU-3 · saves $28k/yr" },
  { label: "03", value: "Roof insulation · saves $18k/yr" },
  { label: "", value: "" },
  { label: "Total savings", value: "$62,000/yr", valueClassName: "text-sky-300" },
];

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <section className="relative min-h-screen overflow-hidden">
        <div className="hero-cloud left-[-4%] top-[10%] h-[16rem] w-[24rem] opacity-60" />
        <div className="hero-cloud right-[6%] top-[9%] h-[14rem] w-[22rem] opacity-45" />
        <div className="hero-cloud left-[24%] top-[28%] h-[11rem] w-[19rem] opacity-40" />
        <div className="hero-cloud right-[24%] top-[18%] h-[13rem] w-[21rem] opacity-35" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[134px]">
          <Image
            src="/city-skyline.png"
            alt="City skyline backdrop"
            fill
            priority
            className="object-cover object-center"
            sizes="100vw"
          />
          <div className="city-overlay absolute inset-0" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl flex-col px-6 pb-20 pt-20 sm:pt-24">
          <div className="grid flex-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)] lg:items-center">
            <div className="max-w-3xl pt-0 lg:pt-10">
              <h1 className="display-title max-w-4xl text-white [text-shadow:0_6px_32px_rgba(0,0,0,0.28)]">
                Your building
                <br />
                is wasting
                <br />
                <span className="block font-main text-[0.84em] font-light italic tracking-[-0.06em] text-light-blue">
                  $47,000 a year.
                </span>
              </h1>

              <p className="mt-7 max-w-2xl text-lg font-light leading-relaxed text-white/72">
                Upload 12 months of utility bills. Get a full prioritized energy audit with savings estimates
                automatically. No engineer. No invoice.
              </p>

              <div className="mt-10 flex flex-wrap gap-4">
                <Link
                  href="/report?demo=1"
                  className="btn-secondary border-white/35 bg-white/12 px-8 py-4 text-[1rem] text-white hover:bg-white/20"
                >
                  Run the live demo <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-center lg:justify-end lg:pt-10">
              <AuditTerminal lines={terminalLines} title="350 Fifth Ave · audit complete" />
            </div>
          </div>

          <div className="mt-10 grid gap-4 pb-6 md:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="glass-strong rounded-[1.9rem] px-8 py-10 text-center">
                <div className="font-heading text-[2rem] font-extrabold tracking-[-0.05em] text-navy">{stat.value}</div>
                <div className="mt-2 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="absolute bottom-9 right-8 z-10 hidden flex-col items-center gap-2 lg:flex">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.28em] text-white/45">scroll</span>
          <div className="relative h-9 w-px bg-white/22">
            <div className="scroll-dot absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-white/65" />
          </div>
        </div>
      </section>

      <section id="how-it-works" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <span className="eyebrow">How it works</span>
          <h2 className="section-title mt-4 text-navy">
            Four steps.
            <span className="block text-mid-navy">Zero effort.</span>
          </h2>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {steps.map((step) => (
            <div key={step.num} className="glass rounded-[1.7rem] p-7 transition-transform duration-200 hover:-translate-y-1">
              <div className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-mid-navy/70">
                {step.num} · {step.tag}
              </div>
              <h3 className="mt-3 font-heading text-[1.35rem] font-bold uppercase tracking-[-0.04em] text-navy">
                {step.title}
              </h3>
              <p className="mt-3 text-[0.98rem] leading-7 text-[var(--text-secondary)]">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-10 pb-24">
        <div className="text-center">
          <span className="eyebrow">What you get</span>
          <h2 className="section-title mt-4 text-navy">
            Everything.
            <span className="block text-mid-navy">Automated.</span>
          </h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.num} className="glass rounded-[1.7rem] p-7 transition-transform duration-200 hover:-translate-y-1">
              <div className="font-mono text-[0.72rem] uppercase tracking-[0.16em] text-mid-navy/70">
                {feature.num} · {feature.tag}
              </div>
              <h3 className="mt-3 font-heading text-[1.18rem] font-bold uppercase tracking-[-0.04em] text-navy">
                {feature.title}
              </h3>
              <p className="mt-3 text-[0.95rem] leading-7 text-[var(--text-secondary)]">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative overflow-hidden bg-[var(--gradient-footer)]">
        <div className="mx-auto max-w-5xl px-6 py-20 text-center text-white">
          <h2 className="section-title text-navy">
            Stop guessing.
            <span className="block text-mid-navy">Start saving.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg font-light leading-8 text-navy">
            Upload your bills and let AuditAI do the rest.
          </p>
          <div className="mt-16 font-mono text-[0.72rem] uppercase tracking-[0.16em] text-mid-navy">
            © 2026 AuditAI · Free automated energy audits
          </div>
        </div>
      </section>
    </main>
  );
}
