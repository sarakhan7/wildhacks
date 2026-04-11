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
  const baseClass = strong ? "glass-strong" : "glass";
  const glowClass = glow ? "glow-border" : "";
  
  return (
    <motion.div 
      className={`\${baseClass} \${glowClass} p-6 \${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
