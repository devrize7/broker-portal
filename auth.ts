import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

const ADMIN_EMAILS = new Set(["jacob@gowithoath.com"]);

const EMAIL_TO_BROKER: Record<string, string> = {
  "tom.licata@gowithoath.com": "Tom Licata",
  "james.davison@gowithoath.com": "James Davison",
  "joe.corbett@gowithoath.com": "Joe Corbett",
  "drew.ivey@gowithoath.com": "Drew Ivey",
  "grant.morse@gowithoath.com": "Grant Morse",
  "raphael.jackson@gowithoath.com": "Raphael Jackson",
  "david.gheran@gowithoath.com": "David Gheran",
  "ivan.moya@gowithoath.com": "Ivan Moya",
  "brian.pollock@gowithoath.com": "Brian Pollock",
  "alonzo.hunt@gowithoath.com": "Alonzo Hunt",
};

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
      return !!(email && (EMAIL_TO_BROKER[email] || ADMIN_EMAILS.has(email)));
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        const email = profile.email.toLowerCase();
        token.brokerName = EMAIL_TO_BROKER[email] ?? null;
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
