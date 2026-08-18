import { describe, expect, it } from "vitest";

import { isWithdrawnEmail, withdrawnEmailFor } from "../../app/features/auth/withdraw";

describe("withdraw helpers", () => {
  it("reserves the withdrawn email namespace", () => {
    const email = withdrawnEmailFor("11111111-1111-4111-8111-111111111111");
    expect(email).toBe("withdrawn.11111111-1111-4111-8111-111111111111@invalid.local");
    expect(isWithdrawnEmail(email)).toBe(true);
    expect(isWithdrawnEmail("member@example.com")).toBe(false);
    expect(isWithdrawnEmail("withdrawn.user@example.com")).toBe(false);
  });
});
