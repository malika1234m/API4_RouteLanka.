/** Calls to the RouteLanka API (proxied on the same origin at /api). */
import type { Role } from "@routelanka/domain";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The role a screen acts as, from its path. The /preview frame loads each screen at its own path. */
export function roleForPath(path = typeof window === "undefined" ? "" : window.location.pathname): Role | undefined {
  if (path.startsWith("/dispatch")) return "dispatcher";
  if (path.startsWith("/dock")) return "loader";
  if (path.startsWith("/driver")) return "driver";
  if (path.startsWith("/store")) return "store";
  return undefined;
}

export async function api<T = unknown>(path: string, body?: unknown, role = roleForPath()): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(role ? { "x-rl-role": role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}
