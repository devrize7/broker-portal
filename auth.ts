import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { getRoster } from "@/lib/roster";

const ADMIN_EMAILS = new Set([
  "jacob@gowithoath.com",
  "kevin.mccaig@gowithoath.com",
  "brett@gowithoath.com",
]);

/**
 * Resolve a broker name from a login email via the roster feed (lowercased
 * emails, ACTIVE brokers only — deactivating a broker disables their login,
 * matching the old EMAIL_TO_BROKER behavior). Only called during actual
 * sign-in (profile present), never on per-request token decode. getRoster()
 * never throws — it falls back to the baked-in seed on any feed outage, so a
 * transient error can never lock the whole team out.
 */
async function brokerForEmail(email: string): Promise<string | null> {
  const roster = await getRoster();
  return roster.emailToBroker.get(email) ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0`,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const email = (profile?.email ?? "").toLowerCase();
      if (!email) return false;
      if (ADMIN_EMAILS.has(email)) return true;
      return (await brokerForEmail(email)) !== null;
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        const email = profile.email.toLowerCase();
        token.brokerName = await brokerForEmail(email);
        token.isAdmin = ADMIN_EMAILS.has(email);
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { brokerName?: string | null; isAdmin?: boolean }).brokerName =
          (token.brokerName as string | null) ?? null;
        (session.user as { brokerName?: string | null; isAdmin?: boolean }).isAdmin =
          (token.isAdmin as boolean) ?? false;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
