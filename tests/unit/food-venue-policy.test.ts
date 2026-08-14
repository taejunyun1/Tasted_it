import { describe, expect, it } from "vitest";

import { classifyFoodVenue } from "../../app/features/places/food-venue-policy";

describe("food venue policy", () => {
  it.each(["GS25 동명점", "CU 광주상무점", "세븐일레븐 금남점", "동명 PC방", "도자기공방 물레", "빛고을 공예방"])(
    "excludes non-food venue %s",
    (businessName) => {
      expect(classifyFoodVenue({ businessName, businessSubtype: "일반음식점" }))
        .toMatchObject({ decision: "EXCLUDE", category: "NOT_RESTAURANT" });
    },
  );

  it.each(["마라공방", "떡볶이공방", "왕가네 치킨호프", "Curry Universe"])("allows food business %s", (businessName) => {
    expect(classifyFoodVenue({ businessName, businessSubtype: "일반음식점" })).toEqual({ decision: "ALLOW" });
  });
});
