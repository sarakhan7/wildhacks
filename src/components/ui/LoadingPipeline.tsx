"use client";

import React, { useState, useEffect } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

interface LoadingPipelineProps {
  stages: string[];
  activeStageIdx: number;
}

export function LoadingPipeline({ stages, activeStageIdx }: LoadingPipelineProps) {
  return (
    <div className="w-full max-w-sm mx-auto flex flex-col gap-4">
      {stages.map((stage, idx) => {
        const isCompleted = idx < activeStageIdx;
        const isActive = idx === activeStageIdx;
        const isPending = idx > activeStageIdx;

        return (
          <div key={stage} className={`flex items-center gap-3 transition-opacity duration-500 \${isPending ? 'opacity-40' : 'opacity-100'}`}>
            <div className="flex-shrink-0 w-6 flex justify-center">
              {isCompleted && <CheckCircle2 className="w-5 h-5 text-[var(--accent-orange)]" />}
              {isActive && <Loader2 className="w-5 h-5 text-[var(--accent-purple)] animate-spin" />}
              {isPending && <Circle className="w-5 h-5 text-[var(--text-muted)]" />}
            </div>
            <span className={`font-medium \${isActive ? 'text-[var(--accent-purple)] animate-pulse-glow' : ''} \${isCompleted ? 'text-gray-300' : ''}`}>
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
