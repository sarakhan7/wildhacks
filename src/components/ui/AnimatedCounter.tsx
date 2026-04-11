"use client";

import React, { useEffect, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

interface AnimatedCounterProps {
  from?: number;
  to: number;
  duration?: number; // seconds
  formatter?: (val: number) => string;
  className?: string;
}

export function AnimatedCounter({ 
  from = 0, 
  to, 
  duration = 2, 
  formatter = (v) => v.toFixed(0),
  className = ""
}: AnimatedCounterProps) {
  const [mounted, setMounted] = useState(false);
  
  const springValue = useSpring(from, { 
    damping: 20, 
    stiffness: 50, 
    duration: duration * 1000 
  });
  
  const displayValue = useTransform(springValue, (current) => formatter(current));

  useEffect(() => {
    setMounted(true);
    springValue.set(to);
  }, [springValue, to]);

  if (!mounted) {
    return <span className={className}>{formatter(to)}</span>;
  }

  return <motion.span className={className}>{displayValue}</motion.span>;
}
