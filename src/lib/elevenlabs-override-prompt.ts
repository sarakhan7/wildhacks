/**
 * Full system prompt for ElevenLabs ConvAI via `override-prompt` on `<elevenlabs-convai>`.
 * Only used when `NEXT_PUBLIC_ELEVENLABS_USE_OVERRIDE_PROMPT=true` (otherwise the widget uses `dynamic-variables`).
 *
 * Enable **System prompt** overrides on the agent Security tab or ElevenLabs rejects the override.
 * @see https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides
 */

/** ElevenLabs documents ~2MB combined system prompt; stay under for UTF-8 and embed reliability. */
export const ELEVENLABS_MAX_OVERRIDE_PROMPT_CHARS = 1_800_000;

const TRUNCATION_NOTICE =
  "\n\n[Report truncated for voice session size limit. The full report is on this page.]\n";

function auditManagerPromptHeader(buildingAddress: string): string {
  const buildingLine =
    buildingAddress.length > 0
      ? buildingAddress
      : "(No building address was provided; say \"this building\" or \"the subject property.\")";

  return `You are the audit manager for this app. You help building owners understand their energy audit report. The app has embedded the full report markdown below under "--- Report". You already have that text; do not ask the user to upload, email, or attach the report.

Answer using ONLY the report in that section. If something is not in the report, say this report does not include that detail. Do not invent numbers, savings, dates, code requirements, or recommendations.

Behavior:
- Be concise and conversational; this is a voice UI. Define acronyms briefly when helpful.
- If asked about topics not covered in the report, say your scope is this report only.

Building:
${buildingLine}`;
}

/**
 * Builds the full string passed as \`override-prompt\` so the session LLM receives instructions + report.
 */
export function buildAuditManagerOverridePrompt(
  reportMarkdown: string,
  options?: { buildingAddress?: string },
): string {
  const address = options?.buildingAddress?.trim() ?? "";
  const report = reportMarkdown.trim() || "(No report text is available for this session.)";
  const header = auditManagerPromptHeader(address);
  const prefix = `${header}\n\n--- Report (markdown) ---\n`;

  const full = `${prefix}${report}`;
  if (full.length <= ELEVENLABS_MAX_OVERRIDE_PROMPT_CHARS) {
    return full;
  }

  let lo = 0;
  let hi = report.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${prefix}${report.slice(0, mid)}${TRUNCATION_NOTICE}`;
    if (candidate.length <= ELEVENLABS_MAX_OVERRIDE_PROMPT_CHARS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${prefix}${report.slice(0, lo)}${TRUNCATION_NOTICE}`;
}

export function fingerprintOverridePrompt(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
