"use client";

import { signIn } from "next-auth/react";
import Image from "next/image";
import { useState } from "react";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    await signIn("microsoft-entra-id", { callbackUrl: "/" });
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] flex items-center justify-center">
      <div className="w-full max-w-sm px-8 py-10 rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col items-center gap-8">
        <Image
          src="/oath-logo-white.png"
          alt="Oath Logistics"
          width={140}
          height={55}
          priority
        />
        <div className="text-center">
          <h1 className="text-white text-xl font-bold">Broker Portal</h1>
          <p className="text-slate-500 text-sm mt-1">
            Sign in with your Oath email to view your dashboard
          </p>
        </div>
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-5 py-3 rounded-xl bg-white text-gray-800 font-semibold text-sm hover:bg-gray-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {/* Microsoft icon */}
          <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          {loading ? "Signing in…" : "Sign in with Microsoft"}
        </button>
        <p className="text-slate-700 text-xs text-center">
          Access is restricted to Oath Logistics brokers
        </p>
      </div>
    </div>
  );
}
