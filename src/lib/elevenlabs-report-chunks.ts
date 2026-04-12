/**
 * Splits report markdown for ElevenLabs Agents `dynamic-variables` (report_part_1 …).
 *
 * ElevenLabs documents a 2MB maximum system prompt (instructions + KB + injected variables).
 * @see https://elevenlabs.io/docs/agents-platform/customization/llm
 */

export const ELEVENLABS_REPORT_PART_COUNT = 6;

/**
 * Exact JSON keys sent on `dynamic-variables` (snake_case). The agent system prompt must use
 * `{{report_part_1}}` … `{{report_part_6}}` and `{{building_address}}` with these same names (case-sensitive).
 */
export const ELEVENLABS_DYNAMIC_VARIABLE_KEYS = [
  "report_part_1",
  "report_part_2",
  "report_part_3",
  "report_part_4",
  "report_part_5",
  "report_part_6",
  "building_address",
] as const;

export const ELEVENLABS_MAX_CHARS_PER_REPORT_PART = 250_000;

export const ELEVENLABS_WIDGET_MAX_DYNAMIC_VARIABLES_JSON_CHARS = 250_000;

function partKey(index: number): `report_part_${number}` {
  return `report_part_${index}`;
}

export function buildElevenLabsReportDynamicVariables(
  markdown: string,
  options?: { buildingAddress?: string },
): Record<string, string> {
  const vars: Record<string, string> = {};
  const address = options?.buildingAddress?.trim();
  vars.building_address = address ?? "";

  const cleaned = markdown.trim() || "(No report text is available for this session.)";
  let remaining = cleaned;

  for (let i = 1; i <= ELEVENLABS_REPORT_PART_COUNT; i++) {
    const key = partKey(i);
    if (remaining.length === 0) {
      vars[key] = "";
      continue;
    }

    if (remaining.length <= ELEVENLABS_MAX_CHARS_PER_REPORT_PART) {
      vars[key] = remaining;
      remaining = "";
      continue;
    }

    let take = ELEVENLABS_MAX_CHARS_PER_REPORT_PART;
    const head = remaining.slice(0, take);
    const breakAt = head.lastIndexOf("\n\n");
    if (breakAt > ELEVENLABS_MAX_CHARS_PER_REPORT_PART * 0.45) {
      take = breakAt;
    }

    vars[key] = remaining.slice(0, take);
    remaining = remaining.slice(take).trimStart();
  }

  if (remaining.length > 0) {
    const lastKey = partKey(ELEVENLABS_REPORT_PART_COUNT);
    const notice = `\n\n[Report truncated: ${remaining.length.toLocaleString()} additional characters were not sent. Increase report_part slots in the agent or shorten the report.]`;
    const capped = vars[lastKey] ?? "";
    vars[lastKey] = capped.length + notice.length > ELEVENLABS_MAX_CHARS_PER_REPORT_PART
      ? capped.slice(0, Math.max(0, ELEVENLABS_MAX_CHARS_PER_REPORT_PART - notice.length)) + notice
      : capped + notice;
  }

  return vars;
}

export function fitDynamicVariablesForWebWidget(
  vars: Record<string, string>,
  maxJsonChars: number = ELEVENLABS_WIDGET_MAX_DYNAMIC_VARIABLES_JSON_CHARS,
): Record<string, string> {
  const v: Record<string, string> = { ...vars };
  const NOTICE =
    "[Report truncated for voice widget payload limit. The full report is on this page.]\n\n";

  const size = () => JSON.stringify(v).length;
  if (size() <= maxJsonChars) {
    return v;
  }

  for (let p = ELEVENLABS_REPORT_PART_COUNT; p >= 2; p--) {
    v[partKey(p)] = "";
    if (size() <= maxJsonChars) {
      return v;
    }
  }

  const k1 = partKey(1);
  const full = v[k1] ?? "";

  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    v[k1] = full.slice(0, mid);
    if (size() <= maxJsonChars) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  v[k1] = full.slice(0, lo);
  if (size() <= maxJsonChars) {
    return v;
  }

  lo = 0;
  hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    v[k1] = NOTICE + full.slice(0, mid);
    if (size() <= maxJsonChars) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  v[k1] = NOTICE + full.slice(0, lo);
  if (size() <= maxJsonChars) {
    return v;
  }

  v[k1] = NOTICE;
  return v;
}

export function fingerprintDynamicVariablesJson(json: string): string {
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
