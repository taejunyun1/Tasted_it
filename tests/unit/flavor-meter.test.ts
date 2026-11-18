import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FlavorMeter } from "../../app/components/ratings/FlavorMeter";

it("names the dimension and retains a readable value if native meters are unavailable", () => {
  const html = renderToStaticMarkup(createElement(FlavorMeter, { dimension: "육수 농도", value: 4 }));
  expect(html).toContain('aria-label="육수 농도 점수"');
  expect(html).toContain('min="1" max="5" value="4"');
  expect(html).toContain('>4/5</meter>');
});
