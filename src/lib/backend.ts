import "server-only";

export function getBackendBaseUrl() {
  return process.env.AUDITAI_BACKEND_URL || "http://127.0.0.1:8000";
}

export async function proxyToBackend(path: string, init?: RequestInit) {
  const url = `${getBackendBaseUrl()}${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backend unavailable";
    return new Response(JSON.stringify({ error: `Audit backend request failed: ${message}` }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
