"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";

interface LoadingPipelineProps {
  stages: string[];
  activeStageIdx: number;
}

export function LoadingPipeline({ stages, activeStageIdx }: LoadingPipelineProps) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
      {stages.map((stage, index) => {
        const isCompleted = index < activeStageIdx;
        const isActive = index === activeStageIdx;
        const isPending = index > activeStageIdx;

        return (
          <div
            key={stage}
            className={[
              "flex items-center gap-3 rounded-full border px-4 py-3 transition-opacity",
              isPending ? "border-white/40 bg-white/14 opacity-55" : "border-white/70 bg-white/24 opacity-100",
            ].join(" ")}
          >
            <div className="flex w-6 flex-shrink-0 justify-center">
              {isCompleted && <CheckCircle2 className="h-5 w-5 text-success" />}
              {isActive && <Loader2 className="h-5 w-5 animate-spin text-mid-navy" />}
              {isPending && <Circle className="h-5 w-5 text-[var(--text-muted)]" />}
            </div>
            <span
              className={[
                "text-sm font-medium",
                isActive ? "animate-pulse-glow text-navy" : "",
                isCompleted ? "text-navy" : "",
                isPending ? "text-[var(--text-muted)]" : "",
              ].join(" ")}
            >
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
