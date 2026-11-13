import { expect, test } from "@playwright/test";

// CST U03/T01: changing the representation must not change the search or selection.
test("category view switches retain search, bounds and selected place", async ({ page }, testInfo) => {
  const query = new URLSearchParams({
    q: "라멘",
    bbox: "126.90,35.14,126.93,35.16",
    selected: "sample-place-1",
    view: "map",
  });
  await page.goto(`/maps/ramen-detail?${query}`);
  const cards = page.locator(".result-panel .place-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-selected", "true");
  const initialPlaces = await cards.evaluateAll((nodes) => nodes.map((node) => node.id));
  const tabs = page.getByRole("navigation", { name: "보기 방식" });

  for (const view of ["list", "map"] as const) {
    const label = view === "list" ? "목록" : "지도";
    const link = tabs.getByRole("link", { name: label, exact: true });
    const target = new URL(await link.getAttribute("href") ?? "", page.url());
    expect(target.searchParams.get("q")).toBe(query.get("q"));
    expect(target.searchParams.get("bbox")).toBe(query.get("bbox"));
    expect(target.searchParams.get("selected")).toBe(query.get("selected"));
    expect(target.searchParams.getAll("view")).toEqual([view]);
    await link.click();
    await expect(page.locator(".explore-split")).toHaveAttribute("data-view", view);
    await expect(page.getByRole("textbox", { name: "동네 또는 가게" })).toHaveValue("라멘");
    await expect(cards).toHaveCount(initialPlaces.length);
    expect(await cards.evaluateAll((nodes) => nodes.map((node) => node.id))).toEqual(initialPlaces);
    await expect(cards.first()).toHaveAttribute("data-selected", "true");
    const current = new URL(page.url());
    for (const key of ["q", "bbox", "selected"]) {
      expect(current.searchParams.get(key)).toBe(query.get(key));
    }
    await page.screenshot({ path: testInfo.outputPath(`category-${view}.png`), fullPage: true });
  }
  await page.reload();
  await expect(cards.first()).toHaveAttribute("data-selected", "true");
  await expect(cards).toHaveCount(1);
});
