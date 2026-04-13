"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from "react-simple-maps";
import { X, Truck, ArrowRight, MapPin, Search, ChevronDown } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
const CANADA_GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const CANADA_ID = "124"; // ISO 3166-1 numeric for Canada

// FIPS → state abbreviation for click-on-state filtering
const FIPS_TO_STATE: Record<string, string> = {
  "01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE",
  "12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS",
  "21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS",
  "29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY",
  "37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC",
  "46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV",
  "55":"WI","56":"WY",
};

interface Lane {
  loadNumber: string;
  carrier: string;
  salesRep: string | null;
  origin: string;
  destination: string;
  originCoords: [number, number];
  destCoords: [number, number];
  revenue: number;
  carrierCost: number;
  margin: number;
  pickupDate: string;
  status: string;
}

interface ApiData {
  lanes: Lane[];
  carriers: { name: string; loads: number; avgCost: number; states: string[] }[];
  total: number;
}

interface Corridor {
  key: string;
  origin: string;
  destination: string;
  originCoords: [number, number];
  destCoords: [number, number];
  loads: Lane[];
  carriers: Record<string, { count: number; totalCost: number }>;
}

interface HoverInfo {
  label: string;
  sub: string;
  x: number;
  y: number;
}

type FilterMode = "none" | "city-pair" | "state" | "carrier";

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
function fmtExact(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const WEEKS_OPTIONS = [4, 8, 12, 26, 52];

function buildCorridors(lanes: Lane[]): Corridor[] {
  const map: Record<string, Corridor> = {};
  for (const l of lanes) {
    const key = `${l.origin}||${l.destination}`;
    if (!map[key]) {
      map[key] = { key, origin: l.origin, destination: l.destination, originCoords: l.originCoords, destCoords: l.destCoords, loads: [], carriers: {} };
    }
    map[key].loads.push(l);
    if (!map[key].carriers[l.carrier]) map[key].carriers[l.carrier] = { count: 0, totalCost: 0 };
    map[key].carriers[l.carrier].count += 1;
    map[key].carriers[l.carrier].totalCost += l.carrierCost;
  }
  return Object.values(map);
}

function Autocomplete({
  placeholder,
  options,
  value,
  onChange,
  color,
}: {
  placeholder: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  color: "red" | "blue";
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.length >= 1
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  const dotColor = color === "red" ? "bg-red-500" : "bg-blue-400";
  const ringColor = color === "red" ? "focus-within:ring-red-500/40" : "focus-within:ring-blue-500/40";

  return (
    <div ref={ref} className="relative flex-1">
      <div className={`flex items-center gap-2 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2 ring-1 ring-transparent ${ringColor} focus-within:ring-1`}>
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <input
          className="bg-transparent text-sm text-white placeholder-slate-600 outline-none flex-1 min-w-0"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
          onFocus={() => setOpen(true)}
        />
        {query && (
          <button onClick={() => { setQuery(""); onChange(""); setOpen(false); }} className="text-slate-600 hover:text-white flex-shrink-0">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#131c2b] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
          {filtered.map((opt) => (
            <button
              key={opt}
              className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-white/10 flex items-center gap-2"
              onMouseDown={(e) => { e.preventDefault(); setQuery(opt); onChange(opt); setOpen(false); }}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0`} />
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CarrierMapPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [weeks, setWeeks] = useState(12);

  // Filter state
  const [fromCity, setFromCity] = useState("");
  const [toCity, setToCity] = useState("");
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [carrierSearch, setCarrierSearch] = useState("");
  const [selectedCarrier, setSelectedCarrier] = useState<string | null>(null);

  // UI state
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"lanes" | "carriers">("lanes");
  const [carrierFilterOpen, setCarrierFilterOpen] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/carriers?weeks=${weeks}`);
    if (res.ok) setData(await res.json());
  }, [weeks]);

  useEffect(() => { load(); }, [load]);

  const corridors = data ? buildCorridors(data.lanes) : [];
  const maxCorridorLoads = Math.max(...corridors.map((c) => c.loads.length), 1);

  // All unique city names (from both origin and destination)
  const allCities = Array.from(new Set([
    ...corridors.map((c) => c.origin),
    ...corridors.map((c) => c.destination),
  ])).sort();

  // Determine active filter mode
  const filterMode: FilterMode =
    (fromCity || toCity) ? "city-pair" :
    selectedState ? "state" :
    selectedCarrier ? "carrier" :
    "none";

  // Compute active corridor keys
  const activeCorrKeys = new Set<string>();
  if (filterMode === "city-pair") {
    corridors.forEach((c) => {
      const fromMatch = !fromCity || c.origin === fromCity;
      const toMatch = !toCity || c.destination === toCity;
      if (fromMatch && toMatch) activeCorrKeys.add(c.key);
    });
  } else if (filterMode === "state") {
    corridors.forEach((c) => {
      const os = c.origin.split(",")[1]?.trim();
      const ds = c.destination.split(",")[1]?.trim();
      if (os === selectedState || ds === selectedState) activeCorrKeys.add(c.key);
    });
  } else if (filterMode === "carrier") {
    corridors.forEach((c) => {
      if (c.carriers[selectedCarrier!]) activeCorrKeys.add(c.key);
    });
  }

  const hasFilter = filterMode !== "none";
  const activeCorridors = hasFilter ? corridors.filter((c) => activeCorrKeys.has(c.key)) : corridors;
  const selectedLoadsCount = activeCorridors.reduce((s, c) => s + c.loads.length, 0);

  // Carrier results for active corridors
  interface CarrierResult { name: string; loads: number; avgCost: number }
  const carrierResults: CarrierResult[] = (() => {
    if (!hasFilter) return [];
    const agg: Record<string, { loads: number; totalCost: number }> = {};
    for (const corr of activeCorridors) {
      for (const [carrier, d] of Object.entries(corr.carriers)) {
        if (!agg[carrier]) agg[carrier] = { loads: 0, totalCost: 0 };
        agg[carrier].loads += d.count;
        agg[carrier].totalCost += d.totalCost;
      }
    }
    return Object.entries(agg).map(([name, d]) => ({
      name, loads: d.loads, avgCost: d.loads > 0 ? d.totalCost / d.loads : 0,
    })).sort((a, b) => b.loads - a.loads);
  })();

  // City maps for dots
  const originCities = new Map<string, { coords: [number, number]; count: number }>();
  const destCities = new Map<string, { coords: [number, number]; count: number }>();
  for (const c of corridors) {
    const oe = originCities.get(c.origin) || { coords: c.originCoords, count: 0 };
    oe.count += c.loads.length; originCities.set(c.origin, oe);
    const de = destCities.get(c.destination) || { coords: c.destCoords, count: 0 };
    de.count += c.loads.length; destCities.set(c.destination, de);
  }

  // Top lists for default sidebar
  const topCorridors = [...corridors].sort((a, b) => b.loads.length - a.loads.length).slice(0, 15);
  const topCarriers = (data?.carriers ?? []).slice(0, 15);
  const filteredCarriers = carrierSearch
    ? (data?.carriers ?? []).filter((c) => c.name.toLowerCase().includes(carrierSearch.toLowerCase())).slice(0, 12)
    : topCarriers;

  function clearAll() {
    setFromCity(""); setToCity(""); setSelectedState(null); setSelectedCarrier(null);
  }

  function handleStateClick(geo: any) {
    const fips = geo.id?.toString().padStart(2, "0");
    const state = FIPS_TO_STATE[fips];
    if (!state) return;
    // Clear city/carrier filters when selecting state
    setFromCity(""); setToCity(""); setSelectedCarrier(null);
    setSelectedState(selectedState === state ? null : state);
  }

  function handleDotClick(type: "origin" | "dest", city: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHoverInfo(null);
    setSelectedState(null); setSelectedCarrier(null);
    if (type === "origin") {
      setFromCity(fromCity === city ? "" : city);
    } else {
      setToCity(toCity === city ? "" : city);
    }
  }

  function handleDotHover(city: string, count: number, type: "origin" | "dest", e: React.MouseEvent) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverInfo({
      label: city,
      sub: `${count} load${count !== 1 ? "s" : ""} ${type === "origin" ? "picked up" : "delivered"}`,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleStateHover(geo: any, e: React.MouseEvent) {
    const fips = geo.id?.toString().padStart(2, "0");
    const state = FIPS_TO_STATE[fips];
    if (!state) return;
    const count = corridors.filter((c) => {
      const os = c.origin.split(",")[1]?.trim();
      const ds = c.destination.split(",")[1]?.trim();
      return os === state || ds === state;
    }).reduce((s, c) => s + c.loads.length, 0);
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverInfo({ label: state, sub: `${count} load${count !== 1 ? "s" : ""}`, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div className="h-screen bg-[#0a0e17] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-[#0a0e17] border-b border-white/[0.08]">
        {/* Top row */}
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <a href="/" className="text-slate-600 hover:text-slate-300 text-sm transition-colors">← Back</a>
            <span className="text-slate-800">|</span>
            <Image src="/oath-logo-white.png" alt="Oath Logistics" width={90} height={35} priority />
            <h1 className="text-base font-bold text-slate-400">Carrier Lane Map</h1>
            {data && (
              <span className="text-xs text-slate-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
                {corridors.length} corridors · {data.carriers.length} carriers
              </span>
            )}
            {hasFilter && (
              <span className="text-xs text-blue-400 bg-blue-900/30 border border-blue-800/40 px-2 py-0.5 rounded-full">
                {selectedLoadsCount} loads matched
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600 text-xs mr-1">Last</span>
            {WEEKS_OPTIONS.map((w) => (
              <button key={w} onClick={() => { setWeeks(w); clearAll(); }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${weeks === w ? "bg-blue-600 text-white" : "bg-white/[0.04] text-slate-400 hover:bg-white/10"}`}>
                {w}w
              </button>
            ))}
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-6 pb-3 flex items-center gap-3">
          {/* From / To search */}
          <Autocomplete
            placeholder="From city (e.g. Houston, TX)"
            options={allCities}
            value={fromCity}
            onChange={(v) => { setFromCity(v); setSelectedState(null); setSelectedCarrier(null); }}
            color="red"
          />
          <ArrowRight className="w-4 h-4 text-slate-700 flex-shrink-0" />
          <Autocomplete
            placeholder="To city (e.g. Chicago, IL)"
            options={allCities}
            value={toCity}
            onChange={(v) => { setToCity(v); setSelectedState(null); setSelectedCarrier(null); }}
            color="blue"
          />

          {/* Divider */}
          <div className="w-px h-6 bg-white/10 flex-shrink-0" />

          {/* Carrier search */}
          <div className="relative flex-shrink-0 w-52">
            <div className="flex items-center gap-2 bg-white/[0.05] border border-white/[0.08] rounded-lg px-3 py-2">
              <Truck className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
              <input
                className="bg-transparent text-sm text-white placeholder-slate-600 outline-none flex-1 min-w-0"
                placeholder="Filter by carrier…"
                value={carrierSearch}
                onChange={(e) => { setCarrierSearch(e.target.value); setCarrierFilterOpen(true); }}
                onFocus={() => setCarrierFilterOpen(true)}
                onBlur={() => setTimeout(() => setCarrierFilterOpen(false), 150)}
              />
              {(carrierSearch || selectedCarrier) && (
                <button onClick={() => { setCarrierSearch(""); setSelectedCarrier(null); }} className="text-slate-600 hover:text-white">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {carrierFilterOpen && filteredCarriers.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#131c2b] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
                {filteredCarriers.map((c) => (
                  <button key={c.name}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-white/10 flex items-center justify-between gap-2 ${selectedCarrier === c.name ? "bg-blue-900/30 text-blue-300" : "text-slate-200"}`}
                    onMouseDown={(e) => { e.preventDefault(); setSelectedCarrier(c.name); setCarrierSearch(c.name); setCarrierFilterOpen(false); setFromCity(""); setToCity(""); setSelectedState(null); }}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-slate-500 flex-shrink-0">{c.loads}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* State indicator */}
          {selectedState && (
            <div className="flex items-center gap-2 bg-purple-900/30 border border-purple-700/40 rounded-lg px-3 py-2 flex-shrink-0">
              <span className="text-sm text-purple-300 font-medium">{selectedState}</span>
              <button onClick={() => setSelectedState(null)} className="text-purple-600 hover:text-white">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Clear all */}
          {hasFilter && (
            <button onClick={clearAll} className="text-xs text-slate-500 hover:text-white whitespace-nowrap flex-shrink-0 transition-colors">
              Clear all
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative" ref={mapRef} onClick={(e) => { if (e.target === e.currentTarget) clearAll(); }} onMouseLeave={() => setHoverInfo(null)}>

          {/* No-filter hint */}
          {!hasFilter && data && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-[#111827]/90 border border-white/[0.08] rounded-full px-4 py-2 text-xs text-slate-400 whitespace-nowrap">
                Search above · click a <span className="text-purple-400 font-medium">state</span> · or click a <span className="text-red-400 font-medium">dot</span> to filter lanes
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="absolute top-3 right-3 z-10 bg-[#111827]/90 border border-white/[0.08] rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" /> Pickup</div>
            <div className="flex items-center gap-2 text-xs text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" /> Delivery</div>
            <div className="flex items-center gap-2 text-xs text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" /> Click state to filter</div>
          </div>

          {/* Hover tooltip */}
          {hoverInfo && (
            <div className="absolute z-20 pointer-events-none bg-[#1a2235] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl"
              style={{ left: Math.min(hoverInfo.x + 12, (mapRef.current?.clientWidth ?? 800) - 160), top: hoverInfo.y - 40 }}>
              <p className="font-semibold text-white">{hoverInfo.label}</p>
              <p className="mt-0.5 text-slate-400">{hoverInfo.sub}</p>
            </div>
          )}

          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ center: [-96, 41], scale: 700 }}
            style={{ width: "100%", height: "100%", background: "transparent" }}
          >
            {/* Canada background */}
            <Geographies geography={CANADA_GEO_URL}>
              {({ geographies }: { geographies: any[] }) =>
                geographies
                  .filter((geo: any) => geo.id === CANADA_ID)
                  .map((geo: any) => (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill="#0b1220"
                      stroke="#1e2d3d"
                      strokeWidth={0.6}
                      style={{
                        default: { outline: "none" },
                        hover: { fill: "#0f1a2a", outline: "none" },
                        pressed: { outline: "none" },
                      }}
                    />
                  ))
              }
            </Geographies>

            {/* US States — clickable */}
            <Geographies geography={GEO_URL}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo: any) => {
                  const fips = geo.id?.toString().padStart(2, "0");
                  const state = FIPS_TO_STATE[fips];
                  const isSelectedState = selectedState === state;
                  const isActiveState = filterMode === "state" && (
                    activeCorridors.some((c) => c.origin.includes(`, ${state}`) || c.destination.includes(`, ${state}`))
                  );
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={isSelectedState ? "#4c1d95" : isActiveState ? "#2e1065" : "#0f1623"}
                      stroke={isSelectedState ? "#7c3aed" : "#1e2d3d"}
                      strokeWidth={isSelectedState ? 1 : 0.6}
                      style={{
                        default: { outline: "none" },
                        hover: { fill: filterMode === "none" || filterMode === "state" ? "#1a2a3a" : "#0f1623", outline: "none", cursor: "pointer" },
                        pressed: { outline: "none" },
                      }}
                      onClick={() => handleStateClick(geo)}
                      onMouseEnter={(e: any) => handleStateHover(geo, e)}
                      onMouseLeave={() => setHoverInfo(null)}
                    />
                  );
                })
              }
            </Geographies>

            {/* Corridor lines */}
            {corridors.map((corr) => {
              const isActive = hasFilter ? activeCorrKeys.has(corr.key) : true;
              const ratio = corr.loads.length / maxCorridorLoads;
              const strokeWidth = hasFilter ? (isActive ? 1 + ratio * 4 : 0.15) : 0.4 + ratio * 2;
              const opacity = hasFilter ? (isActive ? 0.85 : 0.03) : 0.28;
              return (
                <Line key={corr.key} from={corr.originCoords} to={corr.destCoords}
                  stroke={isActive && hasFilter ? "#60a5fa" : "#3b6fa0"}
                  strokeWidth={strokeWidth} strokeLinecap="round"
                  style={{ opacity, transition: "opacity 0.15s, stroke-width 0.15s" }}
                />
              );
            })}

            {/* Delivery dots */}
            {Array.from(destCities.entries()).map(([city, { coords, count }]) => {
              const isActive = hasFilter ? activeCorridors.some((c) => c.destination === city) : true;
              const isSelected = toCity === city;
              const r = Math.min(2.5 + Math.sqrt(count) * 0.9, 10);
              return (
                <Marker key={`dest-${city}`} coordinates={coords}>
                  <circle r={isSelected ? r + 2.5 : r}
                    fill={isSelected ? "#93c5fd" : "#3b82f6"} fillOpacity={isActive ? 0.88 : 0.06}
                    stroke={isSelected ? "#fff" : "#1d4ed8"} strokeWidth={isSelected ? 1.5 : 0.6}
                    style={{ cursor: "pointer", transition: "all 0.15s" }}
                    onClick={(e) => handleDotClick("dest", city, e as unknown as React.MouseEvent)}
                    onMouseEnter={(e) => handleDotHover(city, count, "dest", e as unknown as React.MouseEvent)}
                    onMouseLeave={() => setHoverInfo(null)}
                  />
                </Marker>
              );
            })}

            {/* Pickup dots */}
            {Array.from(originCities.entries()).map(([city, { coords, count }]) => {
              const isActive = hasFilter ? activeCorridors.some((c) => c.origin === city) : true;
              const isSelected = fromCity === city;
              const r = Math.min(2.5 + Math.sqrt(count) * 0.9, 10);
              return (
                <Marker key={`orig-${city}`} coordinates={coords}>
                  <circle r={isSelected ? r + 2.5 : r}
                    fill={isSelected ? "#fca5a5" : "#ef4444"} fillOpacity={isActive ? 0.92 : 0.06}
                    stroke={isSelected ? "#fff" : "#991b1b"} strokeWidth={isSelected ? 1.5 : 0.6}
                    style={{ cursor: "pointer", transition: "all 0.15s" }}
                    onClick={(e) => handleDotClick("origin", city, e as unknown as React.MouseEvent)}
                    onMouseEnter={(e) => handleDotHover(city, count, "origin", e as unknown as React.MouseEvent)}
                    onMouseLeave={() => setHoverInfo(null)}
                  />
                </Marker>
              );
            })}
          </ComposableMap>
        </div>

        {/* Right sidebar */}
        <aside className="w-72 border-l border-white/[0.08] bg-[#0c1118] flex flex-col overflow-hidden flex-shrink-0">
          {hasFilter ? (
            /* Results panel */
            <>
              <div className="p-4 border-b border-white/[0.08] flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest font-medium">
                    {filterMode === "city-pair" ? "Lane Filter" : filterMode === "state" ? `State: ${selectedState}` : `Carrier: ${selectedCarrier}`}
                  </p>
                  <button onClick={clearAll} className="text-slate-700 hover:text-white transition-colors text-xs">Clear</button>
                </div>

                {/* Active filter summary */}
                {filterMode === "city-pair" && (
                  <div className="space-y-1">
                    {fromCity && <div className="flex items-center gap-2"><MapPin className="w-3 h-3 text-red-400" /><span className="text-sm text-white truncate">{fromCity}</span></div>}
                    {fromCity && toCity && <ArrowRight className="w-3 h-3 text-slate-700 ml-1" />}
                    {toCity && <div className="flex items-center gap-2"><MapPin className="w-3 h-3 text-blue-400" /><span className="text-sm text-white truncate">{toCity}</span></div>}
                  </div>
                )}

                <div className="mt-3 flex gap-4">
                  <div>
                    <p className="text-[10px] text-slate-700 uppercase tracking-wider">Loads</p>
                    <p className="text-xl font-bold text-white">{selectedLoadsCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-700 uppercase tracking-wider">Carriers</p>
                    <p className="text-xl font-bold text-white">{carrierResults.length}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-700 uppercase tracking-wider">Corridors</p>
                    <p className="text-xl font-bold text-white">{activeCorrKeys.size}</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {carrierResults.length === 0 ? (
                  <p className="text-slate-700 text-sm text-center mt-8">No loads found</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-[10px] text-slate-700 uppercase tracking-widest px-1 mb-1">Carriers on this lane</p>
                    {carrierResults.map((c, i) => (
                      <div key={c.name} className="bg-white/[0.03] rounded-xl px-3.5 py-3 border border-white/[0.06]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] text-slate-700 font-mono w-4 flex-shrink-0">{i + 1}</span>
                            <Truck className="w-3 h-3 text-slate-600 flex-shrink-0" />
                            <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                          </div>
                          <span className="text-xs font-bold text-emerald-400 flex-shrink-0 bg-emerald-900/20 px-2 py-0.5 rounded-full">{c.loads}x</span>
                        </div>
                        <div className="mt-1.5 ml-9 flex items-end justify-between">
                          <div>
                            <p className="text-[10px] text-slate-700">Avg Buy</p>
                            <p className="text-xs font-medium text-slate-300">{fmtExact(c.avgCost)}</p>
                          </div>
                          <Link href={`/carriers/${encodeURIComponent(c.name)}`} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                            View Profile →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Default: top lanes + top carriers */
            <>
              <div className="flex border-b border-white/[0.08] flex-shrink-0">
                <button onClick={() => setSidebarTab("lanes")}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${sidebarTab === "lanes" ? "text-white border-b-2 border-blue-500" : "text-slate-600 hover:text-slate-400"}`}>
                  Top Lanes
                </button>
                <button onClick={() => setSidebarTab("carriers")}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${sidebarTab === "carriers" ? "text-white border-b-2 border-blue-500" : "text-slate-600 hover:text-slate-400"}`}>
                  Top Carriers
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {sidebarTab === "lanes" ? (
                  <div className="p-3 flex flex-col gap-1.5">
                    {!data ? <p className="text-slate-700 text-sm text-center mt-8">Loading…</p> : topCorridors.map((corr, i) => (
                      <button key={corr.key}
                        onClick={() => { setFromCity(corr.origin); setToCity(corr.destination); setSelectedState(null); setSelectedCarrier(null); }}
                        className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] rounded-lg px-3 py-2.5 border border-white/[0.05] hover:border-white/10 transition-all">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] text-slate-700 font-mono">{i + 1}</span>
                          <span className="text-xs font-bold text-emerald-400 bg-emerald-900/20 px-1.5 py-0.5 rounded-full">{corr.loads.length} loads</span>
                        </div>
                        <div className="flex items-center gap-1.5"><MapPin className="w-2.5 h-2.5 text-red-400 flex-shrink-0" /><span className="text-xs text-slate-300 truncate">{corr.origin}</span></div>
                        <div className="flex items-center gap-1.5 mt-0.5"><ArrowRight className="w-2.5 h-2.5 text-slate-700 flex-shrink-0" /><span className="text-xs text-slate-400 truncate">{corr.destination}</span></div>
                        <p className="text-[10px] text-slate-700 mt-1">{Object.keys(corr.carriers).length} carrier{Object.keys(corr.carriers).length !== 1 ? "s" : ""}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 flex flex-col gap-1.5">
                    {!data ? <p className="text-slate-700 text-sm text-center mt-8">Loading…</p> : topCarriers.map((c, i) => (
                      <div key={c.name} className="bg-white/[0.03] hover:bg-white/[0.06] rounded-lg border border-white/[0.05] hover:border-white/10 transition-all overflow-hidden">
                        <button
                          onClick={() => { setSelectedCarrier(c.name); setCarrierSearch(c.name); setFromCity(""); setToCity(""); setSelectedState(null); }}
                          className="w-full text-left px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-[10px] text-slate-700 font-mono w-4">{i + 1}</span>
                              <Truck className="w-3 h-3 text-slate-600 flex-shrink-0" />
                              <span className="text-xs font-semibold text-slate-200 truncate">{c.name}</span>
                            </div>
                            <span className="text-xs font-bold text-slate-400 flex-shrink-0">{c.loads}</span>
                          </div>
                          <div className="mt-1 ml-9 flex gap-3">
                            <span className="text-[10px] text-slate-700">Avg {fmt(c.avgCost)}</span>
                            <span className="text-[10px] text-slate-700">{c.states.slice(0, 3).join(", ")}{c.states.length > 3 ? "…" : ""}</span>
                          </div>
                        </button>
                        <div className="border-t border-white/[0.04] px-3 py-1.5 flex justify-end">
                          <Link href={`/carriers/${encodeURIComponent(c.name)}`} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                            View Profile →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="p-3 border-t border-white/[0.06] text-center">
                <p className="text-[10px] text-slate-700">Search above · click a state · or pick a lane</p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
