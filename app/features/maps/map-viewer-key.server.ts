import { readSessionId } from "../auth/session.server";
import { readGuestSessionId } from "../onboarding/guest-session.server";

// Display-cache partition only. This digest never authorizes a request.
export async function mapViewerKey(request: Request, user: { id: string; role: string } | null): Promise<string> {
  const identity = user
    ? ["member", user.id, user.role, readSessionId(request)]
    : ["guest", readGuestSessionId(request)];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(identity)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
