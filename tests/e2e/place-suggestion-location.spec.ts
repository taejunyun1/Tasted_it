import { expect, test } from "@playwright/test";

const MEMBER_SESSION = {
  name: "retaste_session",
  value: "qa-reviewer-member-session",
  domain: "127.0.0.1",
  path: "/",
};

async function installFakeNaverMaps(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    class LatLng {
      constructor(private readonly latitude: number, private readonly longitude: number) {}
      lat() { return this.latitude; }
      lng() { return this.longitude; }
    }
    class Map {
      destroy() {}
      constructor(_element: HTMLElement, _options: unknown) {}
    }
    class Marker {
      private position: LatLng;
      constructor(options: { position: LatLng }) { this.position = options.position; }
      getPosition() { return this.position; }
      setPosition(position: LatLng) { this.position = position; }
      setMap(_map: Map | null) {}
    }
    const maps = {
      LatLng,
      Map,
      Marker,
      Service: {
        Status: { OK: 0, ERROR: 1 },
        geocode: (_options: { query: string }, callback: (status: number, response: unknown) => void) => callback(0, {
          v2: {
            addresses: [
              {
                roadAddress: "광주광역시 동구 서석로 1",
                jibunAddress: "광주광역시 동구 서석동 1",
                x: "126.923",
                y: "35.146",
              },
            ],
          },
        }),
      },
      Event: { addListener: () => ({}), removeListener: () => {} },
    };
    (window as unknown as { naver: unknown }).naver = { maps };
  });
}

test("a member finds an address, confirms a map pin, and submits without raw coordinates", async ({ page }) => {
  await installFakeNaverMaps(page);
  await page.context().addCookies([MEMBER_SESSION]);
  await page.goto("/suggestions/new");

  await page.getByLabel("상호명").fill(`지도 제안 식당 ${Date.now()}`);
  const submit = page.getByRole("button", { name: "비공개 제안 접수" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("주소").fill("광주광역시 동구 서석로 1 (서석동)");
  await page.getByRole("button", { name: "지도에서 위치 찾기" }).click();
  await page.getByLabel(/광주광역시 동구 서석로 1/).check();
  await expect(page.getByLabel("선택한 장소 위치 지도")).toBeVisible();
  await page.getByRole("button", { name: "이 위치로 확정" }).click();

  await expect(page.locator('input[name="latitude"]')).not.toHaveValue("");
  await expect(page.locator('input[name="longitude"]')).not.toHaveValue("");
  await expect(page.locator('input[name="locationConfirmed"]')).toHaveValue("true");
  await expect(submit).toBeEnabled();
  await page.getByLabel("대표 카테고리").selectOption({ index: 1 });
  await submit.click();
    await expect(page.locator(".operation-success")).toContainText("제안을 접수했습니다.");
});

test("changing the address clears a confirmed location before a member can submit", async ({ page }) => {
  await installFakeNaverMaps(page);
  await page.context().addCookies([MEMBER_SESSION]);
  await page.goto("/suggestions/new");
  await page.getByLabel("주소").fill("광주광역시 동구 서석로 1 (서석동)");
  await page.getByRole("button", { name: "지도에서 위치 찾기" }).click();
  await page.getByLabel(/광주광역시 동구 서석로 1/).check();
  await page.getByRole("button", { name: "이 위치로 확정" }).click();
  await expect(page.locator('input[name="locationConfirmed"]')).toHaveValue("true");

  await page.getByLabel("주소").fill("광주광역시 동구 동명로 1 (동명동)");
  await expect(page.locator('input[name="latitude"]')).toHaveValue("");
  await expect(page.locator('input[name="longitude"]')).toHaveValue("");
  await expect(page.locator('input[name="locationConfirmed"]')).toHaveValue("");
  await expect(page.getByRole("button", { name: "비공개 제안 접수" })).toBeDisabled();
});
