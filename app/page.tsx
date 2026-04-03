import Link from "next/link";
import Image from "next/image";
import { BarChart3, Map } from "lucide-react";

export default function BrokerHome() {
  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center mb-4 flex flex-col items-center">
        <Image src="/oath-logo-white.png" alt="Oath Logistics" width={200} height={79} priority />
        <p className="text-slate-500 mt-3 uppercase text-xs tracking-widest">Broker Portal</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl">
        <Link
          href="/leaderboard"
          className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
        >
          <BarChart3 className="w-10 h-10 text-emerald-400 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <p className="text-lg font-semibold">Weekly Leaderboard</p>
            <p className="text-slate-400 text-sm mt-1">Live standings for the current week</p>
          </div>
        </Link>

        <Link
          href="/carriers"
          className="flex flex-col items-center gap-4 p-8 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
        >
          <Map className="w-10 h-10 text-blue-400 group-hover:scale-110 transition-transform" />
          <div className="text-center">
            <p className="text-lg font-semibold">Carrier Lane Map</p>
            <p className="text-slate-400 text-sm mt-1">Where we move freight and who we run with</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
