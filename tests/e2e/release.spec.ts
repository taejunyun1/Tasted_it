import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("public legal documents are reachable without signing in", async ({ page, baseURL }, testInfo) => {
  const startedAt = Date.now();
  const network: Array<{ path: string; status: number; type: string; elapsedMs: number }> = [];
  const failures: Array<{ path: string; type: string; elapsedMs: number }> = [];
  const errors: string[] = [];
  const publicPath = (value: string) => {
    const url = new URL(value);
    if (url.origin !== new URL(baseURL!).origin) return null;
    return ["/", "/privacy", "/privacy.data", "/terms", "/terms.data", "/__manifest", "/@vite/client", "/app/root.tsx", "/app/entry.client.tsx", "/app/routes/privacy.tsx", "/app/routes/terms.tsx"].includes(url.pathname)
      ? url.pathname : null;
  };
  const errorCode = (message: string) => /hydration|hydrated|did not match/i.test(message) ? "HYDRATION"
    : /dynamically imported|module script|import.*fail/i.test(message) ? "MODULE_IMPORT"
    : /fetch|network|ERR_/i.test(message) ? "NETWORK" : "OTHER";
  page.on("response", response => {
    const path = publicPath(response.url());
    if (path && network.length < 100) network.push({ path, status: response.status(), type: response.request().resourceType(), elapsedMs: Date.now() - startedAt });
  });
  page.on("requestfailed", request => {
    const path = publicPath(request.url());
    if (path && failures.length < 100) failures.push({ path, type: request.resourceType(), elapsedMs: Date.now() - startedAt });
  });
  page.on("pageerror", error => { if (errors.length < 30) errors.push(errorCode(error.message)); });
  page.on("console", message => { if (message.type() === "error" && errors.length < 30) errors.push(errorCode(message.text())); });
  try {
    await page.goto("/");
    await page.getByRole("link", { name: "개인정보 처리방침" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { name: "Re:Taste 개인정보 처리방침" })).toBeVisible();

    await page.getByRole("link", { name: "이용약관" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { name: "Re:Taste 이용약관" })).toBeVisible();
  } catch (error) {
    // This anonymous public case records metadata only, never the trace, cookies,
    // query strings, request bodies, loader values or raw error messages.
    try {
      const state = await page.evaluate(() => {
        const router = (window as unknown as { __reactRouterDataRouter?: { state?: {
          initialized?: boolean; navigation?: { state?: string; location?: { pathname?: string } };
          location?: { pathname?: string }; matches?: Array<{ route: { id: string } }>;
          errors?: Record<string, { status?: unknown }>; loaderData?: Record<string, unknown>;
        } } }).__reactRouterDataRouter?.state;
        return {
          pathname: location.pathname, readyState: document.readyState, visibilityState: document.visibilityState,
          title: document.title.slice(0, 150), mainCount: document.querySelectorAll("main").length,
          headings: [...document.querySelectorAll("h1")].slice(0, 5).map(node => (node.textContent ?? "").slice(0, 150)),
          router: router ? { initialized: router.initialized, navigation: router.navigation?.state,
            location: router.location?.pathname, destination: router.navigation?.location?.pathname,
            matches: router.matches?.map(match => match.route.id), loaderKeys: Object.keys(router.loaderData ?? {}),
            errors: Object.entries(router.errors ?? {}).map(([routeId, value]) => ({ routeId, status: Number.isInteger(value?.status) ? value.status : null })),
          } : null,
        };
      });
      const path = testInfo.outputPath("public-legal-diagnostic.json");
      await writeFile(path, JSON.stringify({ elapsedMs: Date.now() - startedAt, state, network, failures, errors }, null, 2));
      await testInfo.attach("public-legal-diagnostic", { path, contentType: "application/json" });
    } catch { /* Diagnostic collection must preserve the original assertion failure. */ }
    throw error;
  }
});

test("login exposes both legal documents", async ({ page }) => {
  await page.goto("/login");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "개인정보 처리방침" })).toBeVisible();
  await expect(main.getByRole("link", { name: "이용약관" })).toBeVisible();
});
