export const ADMIN_EMAILS = new Set([
  "jacob@gowithoath.com",
  "kevin.mccaig@gowithoath.com",
  "brett@gowithoath.com",
  "scott.monroe@gowithoath.com",
]);

export function isPortalAdminEmail(email: string | null | undefined): boolean {
  return ADMIN_EMAILS.has((email ?? "").trim().toLowerCase());
}
