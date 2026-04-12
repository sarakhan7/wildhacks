"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildAuditManagerOverridePrompt } from "@/lib/elevenlabs-override-prompt";
import {
  buildElevenLabsReportDynamicVariables,
  fitDynamicVariablesForWebWidget
} from "@/lib/elevenlabs-report-chunks";

type Props = {
  reportMarkdown: string;
  buildingAddress?: string;
  /** Changes when audit identity changes; included in Convai remount key. */
  sessionKey?: string;
};

/** When `true`, sends `override-prompt` (requires System prompt overrides in ElevenLabs Security). Default uses `dynamic-variables` only. */
function useOverridePromptFromEnv(): boolean {
  return process.env.NEXT_PUBLIC_ELEVENLABS_USE_OVERRIDE_PROMPT === "true";
}

const PLACEMENT_OPTIONS = [
  "top-left",
  "top",
  "top-right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

function widgetPlacementFromEnv(): (typeof PLACEMENT_OPTIONS)[number] {
  const raw = process.env.NEXT_PUBLIC_ELEVENLABS_WIDGET_PLACEMENT?.trim() ?? "bottom-left";
  return (PLACEMENT_OPTIONS as readonly string[]).includes(raw) ? (raw as (typeof PLACEMENT_OPTIONS)[number]) : "bottom-left";
}

export function AuditManagerWidget({ reportMarkdown, buildingAddress, sessionKey = "default" }: Props) {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim();
  const widgetPlacement = useMemo(() => widgetPlacementFromEnv(), []);
  const usePromptOverride = useOverridePromptFromEnv();
  const [embedLoaded, setEmbedLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const hasReportText = reportMarkdown.trim().length > 0;

  useEffect(() => {
    if (!agentId) {
      return;
    }
    let cancelled = false;
    void import("@elevenlabs/convai-widget-embed")
      .then(() => {
        if (!cancelled) {
          setEmbedLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setLoadError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const dynamicVariablesJson = useMemo(() => {
    if (usePromptOverride) {
      return "";
    }
    const vars = buildElevenLabsReportDynamicVariables(reportMarkdown, {
      buildingAddress,
    });
    const fitted = fitDynamicVariablesForWebWidget(vars);
    return JSON.stringify(fitted);
  }, [usePromptOverride, reportMarkdown, buildingAddress]);

  const overridePrompt = useMemo(() => {
    if (!usePromptOverride) {
      return "";
    }
    return buildAuditManagerOverridePrompt(reportMarkdown, { buildingAddress });
  }, [usePromptOverride, reportMarkdown, buildingAddress]);

  if (!agentId) {
    return (
      <div className="rounded-[1.25rem] border border-white/50 bg-white/30 px-4 py-3 text-center text-xs leading-relaxed text-[var(--text-muted)]">
        Add <span className="font-mono">NEXT_PUBLIC_ELEVENLABS_AGENT_ID</span> to enable the audit manager voice assistant.
      </div>
    );
  }

  return (
    <div className="audit-manager-stack space-y-1">
      <div className="flex flex-col items-center gap-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-[var(--text-primary)]">
          Audit Manager
        </h3>
        <p className="text-center text-xs leading-relaxed text-[var(--text-secondary)]">
          Ask questions about this audit.
        </p>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="btn-primary w-full mt-2"
        >
          {isOpen ? "Close Assistant" : "Start Chat"}
        </button>
      </div>
      {!hasReportText && (
        <div className="rounded-[1.25rem] border border-[rgba(180,120,40,0.35)] bg-[rgba(180,120,40,0.08)] px-3 py-2 text-center text-xs leading-relaxed text-[var(--text-secondary)]">
          No report markdown is in this session, so the assistant only receives a short placeholder. Complete an audit and
          open this page from results, or use{" "}
          <span className="font-mono">?demo=1</span> for sample text.
        </div>
      )}
      {loadError && (
        <div className="rounded-[1.25rem] border border-[rgba(160,40,40,0.25)] bg-[rgba(160,40,40,0.07)] px-3 py-2 text-center text-xs text-[var(--accent-red)]">
          Could not load the voice widget: {loadError}
        </div>
      )}
      {!embedLoaded && !loadError && (
        <div className="rounded-[1.25rem] border border-white/50 bg-white/30 px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          Loading assistant…
        </div>
      )}
      {embedLoaded && isOpen && (
        <AuditManagerWidgetRenderer
          agentId={agentId}
          usePromptOverride={usePromptOverride}
          overridePrompt={overridePrompt}
          dynamicVariablesJson={dynamicVariablesJson}
        />
      )}
    </div>
  );
}

function AuditManagerWidgetRenderer({
  agentId,
  usePromptOverride,
  overridePrompt,
  dynamicVariablesJson,
}: {
  agentId: string;
  usePromptOverride: boolean;
  overridePrompt: string;
  dynamicVariablesJson: string;
}) {
  const convaiSlotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = convaiSlotRef.current;
    if (!container) return;

    container.innerHTML = "";

    const host = document.createElement("elevenlabs-convai");
    host.setAttribute("agent-id", agentId);
    host.setAttribute("variant", "full");

    if (usePromptOverride) {
      host.setAttribute("override-prompt", overridePrompt);
    } else {
      host.setAttribute("dynamic-variables", dynamicVariablesJson);
    }

    container.appendChild(host);

    return () => {
      container.innerHTML = "";
    };
  }, [agentId, usePromptOverride, overridePrompt, dynamicVariablesJson]);

  return (
    <div
      ref={convaiSlotRef}
      className="fixed bottom-6 right-6 z-[9999] w-[380px] h-[600px] rounded-[1.5rem] shadow-2xl border border-black/10 dark:border-white/20 bg-white/95 dark:bg-black/95 backdrop-blur-xl overflow-hidden print:hidden animate-in slide-in-from-bottom-5 fade-in duration-300"
    />
  );
}