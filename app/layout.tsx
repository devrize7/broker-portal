import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Oath Logistics · Broker Portal",
  description: "Oath Logistics broker leaderboard and carrier lane map",
  openGraph: {
    title: "Oath Logistics · Broker Portal",
    description: "Live leaderboard and carrier lane map",
    siteName: "Oath Logistics",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Oath Logistics · Broker Portal",
    description: "Live leaderboard and carrier lane map",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.className} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
