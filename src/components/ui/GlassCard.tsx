"use client";

import React from "react";
import { motion, HTMLMotionProps } from "framer-motion";

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  className?: string;
  strong?: boolean;
  glow?: boolean;
}

export function GlassCard({ children, className = "", strong = false, glow = false, ...rest }: GlassCardProps) {
  const classes = [strong ? "glass-strong" : "glass", glow ? "glow-border" : "", "p-6", className]
    .filter(Boolean)
    .join(" ");

  return (
    <motion.div
      className={classes}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
