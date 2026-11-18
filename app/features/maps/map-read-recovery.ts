import { isRouteErrorResponse } from "react-router";

export type MapReadFailure = { mapReadFailed: true; status: number; mapReadPath: string };
export type MapReadSnapshot<T> = { scope: string; data: T; path: string };

export function keepMapShell(input: { currentUrl: URL; nextUrl: URL; formMethod?: string; actionStatus?: number; actionResult?: unknown }): boolean {
  if (input.formMethod && input.formMethod.toUpperCase() !== "GET") return false;
  if (input.actionStatus !== undefined || input.actionResult !== undefined) return false;
  return input.currentUrl.origin === input.nextUrl.origin
    && input.currentUrl.pathname === input.nextUrl.pathname
    && (input.nextUrl.pathname === "/" || /^\/maps\/[^/]+$/.test(input.nextUrl.pathname))
    && input.currentUrl.search !== input.nextUrl.search;
}

export function mapReadPath(value: string): string {
  const url = new URL(value, "https://retaste.invalid");
  if (url.pathname.endsWith(".data")) url.pathname = url.pathname.slice(0, -5) || "/";
  url.searchParams.delete("_routes");
  url.searchParams.sort();
  return `${url.pathname}${url.search}`;
}

export function mapReadStatus(error: unknown): number {
  return error instanceof Response || isRouteErrorResponse(error) ? error.status : 503;
}

function rethrowNonTransient(error: unknown, request: Request) {
  if (request.signal.aborted || error instanceof Error && error.name === "AbortError") throw error;
  const status = mapReadStatus(error);
  // Authentication, permissions, missing routes and validation keep router semantics.
  if (status >= 300 && status < 500) throw error;
  return status;
}

export async function readMapData<T extends object>(request: Request, load: () => Promise<T>): Promise<(T & { mapReadPath: string }) | MapReadFailure> {
  try {
    const data = await load();
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { ...data, mapReadPath: mapReadPath(request.url) };
  } catch (error) {
    return { mapReadFailed: true, status: rethrowNonTransient(error, request), mapReadPath: mapReadPath(request.url) };
  }
}

export async function readMapResource<T>(request: Request, load: () => Promise<T>) {
  try {
    const data = await load();
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    return data;
  } catch (error) {
    rethrowNonTransient(error, request);
    const token = new URL(request.url).searchParams.get("requestToken") ?? "";
    return { ok: false as const, requestToken: /^[A-Za-z0-9_-]{8,64}$/.test(token) ? token : "",
      message: "추천을 다시 불러오지 못했어요. 기존 결과를 유지합니다." };
  }
}

export function isMapReadFailure(value: unknown): value is MapReadFailure {
  return Boolean(value && typeof value === "object" && "mapReadFailed" in value && value.mapReadFailed === true);
}

export function reconcileMapRead<T extends object>(previous: MapReadSnapshot<T> | null, incoming: T | MapReadFailure, scope: string, path: string, allowIncoming = true) {
  const snapshot = previous?.scope === scope ? previous : null;
  if (!allowIncoming) return { snapshot: null, data: null, failed: true };
  if (isMapReadFailure(incoming)) return { snapshot, data: snapshot?.data ?? null, failed: true };
  if ("mapReadPath" in incoming && incoming.mapReadPath !== path) return { snapshot, data: snapshot?.data ?? null, failed: true };
  const next = { scope, data: incoming, path };
  return { snapshot: next, data: incoming, failed: false };
}
