// Test-only entrypoint. Production wrangler.jsonc points at workers/app.ts.
import { env } from "cloudflare:workers";
import app from "../../workers/app";

const originalFetch = globalThis.fetch;
const messages = new Map<string, { html: string; expiresAt: number }>();
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== "https://api.resend.com") return originalFetch(input, init);
  if (env.RESEND_API_KEY !== "local-e2e-email-fake" || url.pathname !== "/emails") {
    throw new Error("E2E_REAL_EMAIL_DISABLED");
  }
  const message = JSON.parse(String(init?.body)) as { to: string[]; html: string };
  if (message.to.length !== 1 || !message.to[0]?.endsWith("@example.test")) throw new Error("E2E_SYNTHETIC_EMAIL_REQUIRED");
  for (const [email, saved] of messages) if (saved.expiresAt <= Date.now()) messages.delete(email);
  if (messages.size >= 32) messages.delete(messages.keys().next().value!);
  messages.set(message.to[0], { html: message.html, expiresAt: Date.now() + 300_000 });
  return Response.json({ id: crypto.randomUUID() });
}) as typeof fetch;

export default {
  ...app,
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return new Response(null, { status: 404 });
    if (url.pathname === "/__e2e/email") {
      const email = url.searchParams.get("email") ?? "";
      const message = messages.get(email); messages.delete(email);
      return Response.json(message && message.expiresAt > Date.now() ? { html: message.html } : null, {
        status: message && message.expiresAt > Date.now() ? 200 : 404,
        headers: { "Cache-Control": "no-store, private" },
      });
    }
    return app.fetch(request, bindings);
  },
} satisfies ExportedHandler<Env>;
