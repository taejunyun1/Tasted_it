import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { CourseSearchError } from "../../app/components/courses/CourseSearchError";

function render(search: string) {
  const router = createMemoryRouter([{ path: "/courses", element: createElement(CourseSearchError, { search }) }], { initialEntries: ["/courses"] });
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

describe("course read recovery", () => {
  it("returns an unselected request to the setup screen without applying defaults", () => {
    const html = render("");
    expect(html).not.toContain('name="apply"');
    expect(html).not.toContain('name="time"');
    expect(html).not.toContain('name="second"');
    expect(html).not.toContain('name="radiusKm"');
    const locationOnly = render("?lat=35&lng=127");
    expect(locationOnly).not.toContain('name="apply"');
    expect(locationOnly).toContain('name="lat" value="35"');
  });

  it("keeps all supported selections in an explicit GET retry", () => {
    const html = render("?apply=1&time=lunch&mealCategory=grill&mealCategory=ramen&second=dessert&radiusKm=5&parkingMode=separate&ev=required&weather=rain&child=1&lat=35&lng=127");
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<form[^>]*action="\/courses"[^>]*method="get"/);
    for (const [name, value] of new URLSearchParams("apply=1&time=lunch&mealCategory=grill&mealCategory=ramen&second=dessert&radiusKm=5&parkingMode=separate&ev=required&weather=rain&child=1&lat=35&lng=127")) {
      expect(html).toContain(`type="hidden" name="${name}" value="${value}"`);
    }
    expect(html).toContain("다시 검색");
    expect(html).toContain("조건을 새로 선택");
  });

  it("does not carry unknown parameters or invalid coordinates into retry", () => {
    const html = render("?time=invalid&radiusKm=999&lat=0&lng=0&redirect=https://evil.test&mealCategory=%3Cscript%3E");
    expect(html).toContain('name="time" value="auto"');
    expect(html).toContain('name="radiusKm" value="3"');
    expect(html).not.toContain('name="lat"');
    expect(html).not.toContain('name="lng"');
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("script");
  });
});
