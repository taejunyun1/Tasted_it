import { z } from "zod";
import { inviteTokenSchema } from "./policy";

const KEY = "retaste.student.pending-invite";
const TTL = 60 * 60 * 1000;
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const pendingSchema = z.object({ token: inviteTokenSchema, expiresAt: z.number().int().positive() }).strict();

export function clearPendingInvite(storage: TabStorage) {
  try { storage.removeItem(KEY); } catch { /* Private browsing may deny storage. */ }
}

// Only this tab keeps the bearer token, for at most one hour. It never goes in
// a query string, a login redirect, localStorage, or an application log.
export function recoverPendingInvite(storage: TabStorage, hash: string, now = Date.now()): string {
  if (hash) {
    clearPendingInvite(storage);
    const parsed = inviteTokenSchema.safeParse(hash.slice(1));
    if (!parsed.success) return "";
    try { storage.setItem(KEY, JSON.stringify({ token: parsed.data, expiresAt: now + TTL })); } catch { /* Keep the current page usable without storage. */ }
    return parsed.data;
  }
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(storage.getItem(KEY) ?? "null"));
    if (parsed.success && parsed.data.expiresAt > now && parsed.data.expiresAt <= now + TTL) return parsed.data.token;
  } catch { /* Corrupt or inaccessible storage must not block the page. */ }
  clearPendingInvite(storage);
  return "";
}
