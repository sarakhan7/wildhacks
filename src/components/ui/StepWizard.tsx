"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";

interface StepWizardProps {
  steps: string[];
  currentStepIndex: number;
  onStepChange?: (index: number) => void;
  children: React.ReactNode[];
}

export function StepWizard({ steps, currentStepIndex, onStepChange, children }: StepWizardProps) {
  // Guarantee we don't index out of bounds
  const activeContent = children[currentStepIndex] || children[0];

  return (
    <div className="w-full">
      {/* Stepper Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center relative">
          {/* Connecting line */}
          <div className="absolute top-1/2 left-0 w-full h-[2px] -translate-y-1/2 bg-[var(--bg-tertiary)] z-0 rounded">
            <motion.div 
              className="h-full bg-[var(--accent-green)]"
              initial={{ width: "0%" }}
              animate={{ width: `\${(currentStepIndex / (steps.length - 1)) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />
          </div>

          {/* Step dots */}
          {steps.map((step, idx) => {
            const isCompleted = idx < currentStepIndex;
            const isActive = idx === currentStepIndex;
            
            return (
              <div 
                key={step} 
                className="relative z-10 flex flex-col items-center"
              >
                <button
                  onClick={() => {
                    // Only allow clicking completed or next valid steps if onStepChange provided
                    if (onStepChange && idx <= currentStepIndex) onStepChange(idx);
                  }}
                  disabled={!onStepChange || idx > currentStepIndex}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all duration-300
                    \${isActive ? 'border-[var(--accent-green)] bg-[var(--bg-primary)] text-[var(--accent-green)] shadow-[0_0_15px_rgba(0,229,134,0.3)]' : 
                      isCompleted ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-[#0a0e17]' : 
                      'bg-[var(--bg-secondary)] border-[var(--bg-tertiary)] text-[var(--text-muted)]'}
                  `}
                >
                  {isCompleted ? <Check className="w-5 h-5" /> : idx + 1}
                </button>
                <div className={`absolute top-12 whitespace-nowrap text-xs font-medium \${isActive ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>
                  {step}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="mt-14 relative min-h-[400px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStepIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {activeContent}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
