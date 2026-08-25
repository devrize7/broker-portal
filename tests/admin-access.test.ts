import { describe, expect, it } from "vitest";
import { isPortalAdminEmail } from "@/lib/admin-access";

describe("portal admin identity boundary", () => {
  it.each([
    "jacob@gowithoath.com",
    "kevin.mccaig@gowithoath.com",
    "brett@gowithoath.com",
    "scott.monroe@gowithoath.com",
    // Casing and stray whitespace must not decide an admin boundary.
    "Scott.Monroe@gowithoath.com",
    "  scott.monroe@gowithoath.com  ",
  ])("allows %s", (email) => {
    expect(isPortalAdminEmail(email)).toBe(true);
  });

  it.each([
    "tom.licata@gowithoath.com",
    "broker@gowithoath.com",
    "kevin.mccaig@gowithoath.com.attacker.example",
    "scott.monroe@gowithoath.com.attacker.example",
    "scott.monroe@example.com",
    "",
  ])("denies %s", (email) => {
    expect(isPortalAdminEmail(email)).toBe(false);
  });
});
