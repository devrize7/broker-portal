import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { ScorecardControls } from "./scorecard-controls";

export default async function ScorecardAdminPage() {
  const session = await auth();
  const isAdmin = (session?.user as { isAdmin?: boolean } | undefined)?.isAdmin === true;
  if (!isAdmin) notFound();

  return (
    <main className="min-h-screen bg-[#0a0e17] px-5 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to Broker Portal
        </Link>
        <div className="mb-8 mt-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">Admin only</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Weekly Broker Scorecard</h1>
          <p className="mt-3 max-w-2xl text-slate-400">Review the broker email and control its scheduled delivery from one place.</p>
        </div>
        <ScorecardControls />
      </div>
    </main>
  );
}
