import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const RECORD_DIR = path.join(process.cwd(), "gemini_recordings");

export function isProd(): boolean {
  const v = (process.env.PROD ?? "").trim().toLowerCase();
  if (!v) return true;
  return !["0", "false", "no", "off"].includes(v);
}

export function fixtureFilename(operation: string): string {
  return `${operation.replace(/\//g, "_").replace(/ /g, "_")}.json`;
}

export async function loadResponseText(operation: string): Promise<string> {
  const file = path.join(RECORD_DIR, fixtureFilename(operation));
  const raw = await readFile(file, "utf-8");
  const data = JSON.parse(raw) as { response_text?: unknown };
  if (typeof data.response_text !== "string") {
    throw new Error(`Fixture at ${file} must contain a string response_text`);
  }
  return data.response_text;
}

export async function saveRecording(
  operation: string,
  body: {
    model: string;
    request_summary: Record<string, unknown>;
    response_text: string;
  }
): Promise<void> {
  await mkdir(RECORD_DIR, { recursive: true });
  const envelope = {
    operation,
    model: body.model,
    recorded_at: new Date().toISOString(),
    request_summary: body.request_summary,
    response_text: body.response_text,
  };
  const file = path.join(RECORD_DIR, fixtureFilename(operation));
  await writeFile(file, JSON.stringify(envelope, null, 2), "utf-8");
}
