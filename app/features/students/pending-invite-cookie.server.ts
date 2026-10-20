import { EncryptJWT, jwtDecrypt } from "jose";
import { z } from "zod";
import { inviteTokenSchema, seatCodeSchema } from "./policy";

const TTL = 3600;
const ISSUER = "retaste:student-invite:v1";
const payloadSchema = z.object({ token: inviteTokenSchema, seatCode: seatCodeSchema, iat: z.number().int(), exp: z.number().int() });
type PendingInvite = { token: string; seatCode: z.infer<typeof seatCodeSchema>; expiresAt: string };
function cookieName(url: string) { return new URL(url).protocol === "https:" ? "__Host-retaste_student_invite" : "retaste_student_invite"; }
function attributes(url: string, maxAge: number) {
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(url).protocol === "https:" ? "; Secure" : ""}`;
}
async function key(secret: string) {
  if (!secret) throw new Error("STUDENT_INVITE_COOKIE_UNAVAILABLE");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ISSUER}\0${secret}`)));
}
export function clearPendingInviteCookie(url: string) { return `${cookieName(url)}=; ${attributes(url, 0)}`; }
export async function pendingInviteCookie(invite: PendingInvite, secret: string, url: string, now = new Date()) {
  const token = inviteTokenSchema.parse(invite.token); const seatCode = seatCodeSchema.parse(invite.seatCode);
  const issued = Math.floor(now.getTime() / 1000);
  const expires = Math.min(issued + TTL, Math.floor(Date.parse(invite.expiresAt) / 1000));
  if (!Number.isFinite(expires) || expires <= issued) throw new Error("STUDENT_INVITE_INVALID");
  const value = await new EncryptJWT({ token, seatCode }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER).setAudience(new URL(url).origin).setIssuedAt(issued).setExpirationTime(expires).encrypt(await key(secret));
  return `${cookieName(url)}=${value}; ${attributes(url, expires - issued)}`;
}
export async function readPendingInviteCookie(request: Request, secret: string, now = new Date()) {
  try {
    const name = `${cookieName(request.url)}=`;
    const values = (request.headers.get("Cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(name));
    if (values.length !== 1) return null;
    const value = values[0]!.slice(name.length);
    if (value.length > 2048) return null;
    const { payload } = await jwtDecrypt(value, await key(secret), { issuer: ISSUER, audience: new URL(request.url).origin, currentDate: now, keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success || parsed.data.iat > Math.floor(now.getTime() / 1000) || parsed.data.exp - parsed.data.iat > TTL) return null;
    return { token: parsed.data.token, seatCode: parsed.data.seatCode };
  } catch { return null; }
}
