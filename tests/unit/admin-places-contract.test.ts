import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/routes/admin-places.tsx", "utf8");

describe("admin places markup", () => {
  it("does not render the admin email on the place list screen", () => {
    expect(source).toContain("requireAdmin");
    expect(source).not.toContain("user.email");
    expect(source).not.toContain("loaderData.user");
  });
});
