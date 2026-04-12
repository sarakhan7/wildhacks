"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Split-panel intro: two dark curtains cover the screen, the logo appears
 * centered at the vertical seam, then the left panel flies left and the
 * right panel flies right — revealing the page beneath.
 *
 * Plays once per session (sessionStorage). Total duration ~2.3 s.
 */

export const INTRO_SESSION_KEY = "auditai_intro_seen";
const EASE = [0.76, 0, 0.24, 1] as const;

function PanelLogo() {
  return (
    <p
      className="select-none font-heading font-extrabold tracking-[-0.07em] leading-none"
      style={{ fontSize: "clamp(2.8rem, 7vw, 4.6rem)" }}
      aria-hidden
    >
      <span style={{ color: "#ffffff" }}>Audit</span>
      <span style={{ color: "#aad8f2" }}>AI</span>
    </p>
  );
}

interface IntroOverlayProps {
  /** Fires when the panels begin splitting — hero content should animate in now. */
  onSplitting?: () => void;
  /** Fires when the overlay is fully gone — typewriter etc. can start now. */
  onDone?: () => void;
}

export function IntroOverlay({ onSplitting, onDone }: IntroOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [splitting, setSplitting] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(INTRO_SESSION_KEY)) return;
    sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    setVisible(true);

    const t1 = setTimeout(() => { setSplitting(true); onSplitting?.(); }, 1620);
    const t2 = setTimeout(() => { setVisible(false); onDone?.(); }, 2450);
    return () => [t1, t2].forEach(clearTimeout);
  }, [onSplitting, onDone]);

  useEffect(() => {
    document.body.style.overflow = visible ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [visible]);

  const panelStyle = { background: "#07101d" } as const;
  const dotGrid = {
    backgroundImage:
      "radial-gradient(rgba(170,216,242,0.10) 1px, transparent 1px)",
    backgroundSize: "28px 28px",
  } as const;

  return (
    <AnimatePresence>
      {visible && (
        <div
          key="intro"
          className="pointer-events-none fixed inset-0 z-[9999]"
          aria-hidden
        >
          {/* ── LEFT PANEL ────────────────────────────── */}
          <motion.div
            className="absolute inset-y-0 left-0 overflow-hidden"
            style={{ ...panelStyle, width: "50vw" }}
            animate={splitting ? { y: "-100%" } : { y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            {/* dot grid */}
            <div className="absolute inset-0" style={dotGrid} />

            {/* radial glow at seam (right edge) */}
            <div
              className="absolute inset-y-0 right-0 w-48 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 100% 60% at 100% 50%, rgba(74,159,212,0.2) 0%, transparent 70%)",
              }}
            />

            {/* left half of logo: logo centre sits at panel right edge */}
            <motion.div
              className="absolute inset-y-0 right-0 flex items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div style={{ transform: "translateX(50%)" }}>
                <PanelLogo />
              </div>
            </motion.div>
          </motion.div>

          {/* ── RIGHT PANEL ───────────────────────────── */}
          <motion.div
            className="absolute inset-y-0 right-0 overflow-hidden"
            style={{ ...panelStyle, width: "50vw" }}
            animate={splitting ? { y: "100%" } : { y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
          >
            {/* dot grid */}
            <div className="absolute inset-0" style={dotGrid} />

            {/* radial glow at seam (left edge) */}
            <div
              className="absolute inset-y-0 left-0 w-48 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 100% 60% at 0% 50%, rgba(74,159,212,0.2) 0%, transparent 70%)",
              }}
            />

            {/* right half of logo: logo centre sits at panel left edge */}
            <motion.div
              className="absolute inset-y-0 left-0 flex items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              <div style={{ transform: "translateX(-50%)" }}>
                <PanelLogo />
              </div>
            </motion.div>
          </motion.div>

          {/* ── SEAM GLOW LINE at 50 vw ───────────────── */}
          <motion.div
            className="absolute inset-y-0"
            style={{
              left: "50vw",
              width: 1,
              background:
                "linear-gradient(180deg, transparent, rgba(170,216,242,0.55) 20%, rgba(170,216,242,0.55) 80%, transparent)",
              transform: "translateX(-0.5px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: splitting ? 0 : 1 }}
            transition={{ duration: 0.25, delay: splitting ? 0 : 0.4 }}
          />
        </div>
      )}
    </AnimatePresence>
  );
}
