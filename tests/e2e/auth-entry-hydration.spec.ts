import { expect, test } from "@playwright/test";

test.skip(Boolean(process.env.BASE_URL), "SSR hydration regression uses the isolated local fixture");
test("header authentication hrefs preserve browse query through SSR and hydration", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydration|hydrated|did not match|server rendered HTML/i.test(message.text())) errors.push(message.text());
  });
  const path = "/places?bbox=126.80,35.10,127.00,35.25&q=라멘%20가게&badge=food-ramen&badge=style-market";
  const response = await page.goto(path);
  expect(response?.ok()).toBe(true);
  const html = await response!.text();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  for (const [label, entry] of [["로그인", "/login"], ["회원가입", "/signup"]]) {
    const ssr = html.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`))?.[1];
    expect(ssr).toBeDefined();
    const href = await page.getByRole("link", { name: label, exact: true }).getAttribute("href");
    expect(href).toBe(ssr);
    const target = new URL(href!, page.url());
    expect(target.pathname).toBe(entry);
    const destination = new URL(target.searchParams.get("returnTo")!, page.url());
    expect(destination.pathname).toBe("/places");
    expect([...destination.searchParams]).toEqual([...new URL(path, page.url()).searchParams]);
  }
  expect(errors).toEqual([]);
  await page.getByRole("link", { name: "로그인", exact: true }).click();
  const destination = new URL(new URL(page.url()).searchParams.get("returnTo")!, page.url());
  expect(destination.searchParams.get("bbox")).toBe("126.80,35.10,127.00,35.25");
  expect(destination.searchParams.get("q")).toBe("라멘 가게");
  expect(destination.searchParams.getAll("badge")).toEqual(["food-ramen", "style-market"]);
});
