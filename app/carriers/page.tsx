"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Line,
} from "react-simple-maps";
import { X, Truck, ArrowRight, MapPin, BarChart2 } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

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

interface HoverDot {
  type: "pickup" | "delivery";
  city: string;
  count: number;
  x: number;
  y: number;
}

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

export default function CarrierMapPage() {
  const [data, setData] = useState<ApiData | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null);
  const [selectedDest, setSelectedDest] = useState<string | null>(null);
  const [hoverDot, setHoverDot] = useState<HoverDot | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"lanes" | "carriers">("lanes");
  const mapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/carriers?weeks=${weeks}`);
    if (res.ok) setData(await res.json());
  }, [weeks]);

  useEffect(() => { load(); }, [load]);

  const corridors = data ? buildCorridors(data.lanes) : [];
  const maxCorridorLoads = Math.max(...corridors.map((c) => c.loads.length), 1);

  const hasSelection = !!(selectedOrigin || selectedDest);
  const hasLanePair = !!(selectedOrigin && selectedDest);

  // Active corridors based on selection
  const activeCorrKeys = new Set<string>();
  if (selectedOrigin && selectedDest) {
    corridors.forEach((c) => { if (c.origin === selectedOrigin && c.destination === selectedDest) activeCorrKeys.add(c.key); });
  } else if (selectedOrigin) {
    corridors.forEach((c) => { if (c.origin === selectedOrigin) activeCorrKeys.add(c.key); });
  } else if (selectedDest) {
    corridors.forEach((c) => { if (c.destination === selectedDest) activeCorrKeys.add(c.key); });
  }

  // Carrier results for selected corridors
  interface CarrierResult { name: string; loads: number; avgCost: number; corridors: number }
  const carrierResults: CarrierResult[] = (() => {
    if (!hasSelection) return [];
    const agg: Record<string, { loads: number; totalCost: number; corridors: Set<string> }> = {};
    for (const corr of corridors.filter((c) => activeCorrKeys.has(c.key))) {
      for (const [carrier, d] of Object.entries(corr.carriers)) {
        if (!agg[carrier]) agg[carrier] = { loads: 0, totalCost: 0, corridors: new Set() };
        agg[carrier].loads += d.count;
        agg[carrier].totalCost += d.totalCost;
        agg[carrier].corridors.add(corr.key);
      }
    }
    return Object.entries(agg).map(([name, d]) => ({
      name, loads: d.loads, avgCost: d.loads > 0 ? d.totalCost / d.loads : 0, corridors: d.corridors.size,
    })).sort((a, b) => b.loads - a.loads);
  })();

  // Top corridors (for default sidebar)
  const topCorridors = [...corridors].sort((a, b) => b.loads.length - a.loads.length).slice(0, 15);

  // Top carriers overall (for default sidebar)
  const topCarriers = (data?.carriers ?? []).slice(0, 15);

  // City maps
  const originCities = new Map<string, { coords: [number, number]; count: number }>();
  const destCities = new Map<string, { coords: [number, number]; count: number }>();
  for (const c of corridors) {
    const oe = originCities.get(c.origin) || { coords: c.originCoords, count: 0 };
    oe.count += c.loads.length; originCities.set(c.origin, oe);
    const de = destCities.get(c.destination) || { coords: c.destCoords, count: 0 };
    de.count += c.loads.length; destCities.set(c.destination, de);
  }

  function handleOriginClick(city: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHoverDot(null);
    if (selectedOrigin === city) { setSelectedOrigin(null); setSelectedDest(null); }
    else { setSelectedOrigin(city); setSelectedDest(null); }
  }

  function handleDestClick(city: string, e: React.MouseEvent) {
    e.stopPropagation();
    setHoverDot(null);
    if (selectedDest === city) setSelectedDest(null);
    else setSelectedDest(city);
  }

  function handleOriginHover(city: string, count: number, e: React.MouseEvent) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverDot({ type: "pickup", city, count, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleDestHover(city: string, count: number, e: React.MouseEvent) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoverDot({ type: "delivery", city, count, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function clearSelection() { setSelectedOrigin(null); setSelectedDest(null); }

  const selectedLoadsCount = corridors.filter((c) => activeCorrKeys.has(c.key)).reduce((s, c) => s + c.loads.length, 0);

  return (
    <div className="h-screen bg-[#0a0e17] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-white/[0.08] flex-shrink-0 bg-[#0a0e17]">
        <div className="flex items-center gap-3">
          <a href="/" className="text-slate-600 hover:text-slate-300 text-sm transition-colors">← Back</a>
          <span className="text-slate-800">|</span>
          <h1 className="text-base font-bold">Carrier Lane Map</h1>
          {data && (
            <span className="text-xs text-slate-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
              {corridors.length} corridors · {data.carriers.length} carriers
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-600 text-xs mr-1">Last</span>
          {WEEKS_OPTIONS.map((w) => (
            <button
              key={w}
              onClick={() => { setWeeks(w); clearSelection(); }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${weeks === w ? "bg-blue-600 text-white" : "bg-white/[0.04] text-slate-400 hover:bg-white/10"}`}
            >
              {w}w
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative" ref={mapRef} onClick={clearSelection} onMouseLeave={() => setHoverDot(null)}>
          {/* Legend */}
          <div className="absolute top-3 right-3 z-10 bg-[#111827]/90 border border-white/[0.08] rounded-xl px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" /> Pickup (click to filter)
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400 flex-shrink-0" /> Delivery
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-6 border-t-2 border-slate-600 flex-shrink-0" /> Lane (thickness = volume)
            </div>
          </div>

          {/* No-selection hint */}
          {!hasSelection && data && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className="bg-[#111827]/90 border border-white/[0.08] rounded-full px-4 py-2 text-xs text-slate-400 whitespace-nowrap">
                Click a <span className="text-red-400 font-medium">red</span> dot → then a <span className="text-blue-400 font-medium">blue</span> dot to find carriers on that lane
              </div>
            </div>
          )}

          {/* Hover tooltip */}
          {hoverDot && (
            <div
              className="absolute z-20 pointer-events-none bg-[#1a2235] border border-white/10 rounded-lg px-3 py-2 text-xs shadow-xl"
              style={{ left: hoverDot.x + 12, top: hoverDot.y - 32 }}
            >
              <p className="font-semibold text-white">{hoverDot.city}</p>
              <p className={`mt-0.5 ${hoverDot.type === "pickup" ? "text-red-400" : "text-blue-400"}`}>
                {hoverDot.type === "pickup" ? "📦" : "🏁"} {hoverDot.count} load{hoverDot.count !== 1 ? "s" : ""}
              </p>
            </div>
          )}

          <ComposableMap
            projection="geoAlbersUsa"
            style={{ width: "100%", height: "100%", background: "transparent" }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo: any) => (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill="#0f1623"
                    stroke="#1e2d3d"
                    strokeWidth={0.6}
                    style={{ default: { outline: "none" }, hover: { fill: "#141d2e", outline: "none" }, pressed: { outline: "none" } }}
                  />
                ))
              }
            </Geographies>

            {/* Corridor lines */}
            {corridors.map((corr) => {
              const isActive = hasSelection ? activeCorrKeys.has(corr.key) : true;
              const ratio = corr.loads.length / maxCorridorLoads;
              const strokeWidth = hasSelection
                ? isActive ? 1 + ratio * 3.5 : 0.2
                : 0.4 + ratio * 2;
              const opacity = hasSelection ? (isActive ? 0.8 : 0.04) : 0.3;
              return (
                <Line
                  key={corr.key}
                  from={corr.originCoords}
                  to={corr.destCoords}
                  stroke={isActive && hasSelection ? "#60a5fa" : "#3b6fa0"}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  style={{ opacity, transition: "opacity 0.2s, stroke-width 0.2s" }}
                />
              );
            })}

            {/* Delivery dots */}
            {Array.from(destCities.entries()).map(([city, { coords, count }]) => {
              const isActive = hasSelection
                ? (selectedOrigin ? corridors.some((c) => activeCorrKeys.has(c.key) && c.destination === city) : selectedDest === city)
                : true;
              const isSelected = selectedDest === city;
              const r = Math.min(2.5 + Math.sqrt(count) * 0.9, 10);
              return (
                <Marker key={`dest-${city}`} coordinates={coords}>
                  <circle
                    r={isSelected ? r + 2.5 : r}
                    fill={isSelected ? "#93c5fd" : "#3b82f6"}
                    fillOpacity={isActive ? 0.88 : 0.08}
                    stroke={isSelected ? "#ffffffcc" : "#1d4ed8"}
                    strokeWidth={isSelected ? 1.5 : 0.6}
                    style={{ cursor: "pointer", transition: "all 0.15s" }}
                    onClick={(e) => handleDestClick(city, e as unknown as React.MouseEvent)}
                    onMouseEnter={(e) => handleDestHover(city, count, e as unknown as React.MouseEvent)}
                    onMouseLeave={() => setHoverDot(null)}
                  />
                </Marker>
              );
            })}

            {/* Pickup dots */}
            {Array.from(originCities.entries()).map(([city, { coords, count }]) => {
              const isActive = hasSelection
                ? (selectedOrigin === city || corridors.some((c) => activeCorrKeys.has(c.key) && c.origin === city))
                : true;
              const isSelected = selectedOrigin === city;
              const r = Math.min(2.5 + Math.sqrt(count) * 0.9, 10);
              return (
                <Marker key={`orig-${city}`} coordinates={coords}>
                  <circle
                    r={isSelected ? r + 2.5 : r}
                    fill={isSelected ? "#fca5a5" : "#ef4444"}
                    fillOpacity={isActive ? 0.92 : 0.08}
                    stroke={isSelected ? "#ffffffcc" : "#991b1b"}
                    strokeWidth={isSelected ? 1.5 : 0.6}
                    style={{ cursor: "pointer", transition: "all 0.15s" }}
                    onClick={(e) => handleOriginClick(city, e as unknown as React.MouseEvent)}
                    onMouseEnter={(e) => handleOriginHover(city, count, e as unknown as React.MouseEvent)}
                    onMouseLeave={() => setHoverDot(null)}
                  />
                </Marker>
              );
            })}
          </ComposableMap>
        </div>

        {/* Right sidebar */}
        <aside className="w-72 border-l border-white/[0.08] bg-[#0c1118] flex flex-col overflow-hidden flex-shrink-0">

          {/* Selection state */}
          {hasSelection ? (
            <>
              {/* Lane header */}
              <div className="p-4 border-b border-white/[0.08] flex-shrink-0">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[10px] text-slate-600 uppercase tracking-widest font-medium">
                    {hasLanePair ? "Lane Filter" : selectedOrigin ? "Departing From" : "Arriving To"}
                  </p>
                  <button onClick={clearSelection} className="text-slate-700 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {selectedOrigin && (
                  <div className="flex items-center gap-2 mb-1.5">
                    <MapPin className="w-3 h-3 text-red-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-white truncate">{selectedOrigin}</span>
                    <button onClick={() => { setSelectedOrigin(null); setSelectedDest(null); }} className="ml-auto text-slate-700 hover:text-red-400 transition-colors flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {hasLanePair && <div className="ml-1 mb-1.5 text-slate-700"><ArrowRight className="w-3 h-3" /></div>}
                {selectedDest ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3 h-3 text-blue-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-white truncate">{selectedDest}</span>
                    <button onClick={() => setSelectedDest(null)} className="ml-auto text-slate-700 hover:text-blue-400 transition-colors flex-shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : selectedOrigin ? (
                  <p className="text-xs text-slate-700 ml-4 italic">Click a blue dot to set destination…</p>
                ) : null}

                <div className="mt-3 flex gap-4">
                  <div>
                    <p className="text-[10px] text-slate-700 uppercase tracking-wider">Loads</p>
                    <p className="text-lg font-bold text-white">{selectedLoadsCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-700 uppercase tracking-wider">Carriers</p>
                    <p className="text-lg font-bold text-white">{carrierResults.length}</p>
                  </div>
                </div>
              </div>

              {/* Carrier results */}
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
                            <span className="text-xs text-slate-700 font-mono w-4 flex-shrink-0">{i + 1}</span>
                            <Truck className="w-3 h-3 text-slate-600 flex-shrink-0" />
                            <span className="text-sm font-semibold text-white truncate">{c.name}</span>
                          </div>
                          <span className="text-xs font-bold text-emerald-400 flex-shrink-0 bg-emerald-900/20 px-2 py-0.5 rounded-full">
                            {c.loads}x
                          </span>
                        </div>
                        <div className="mt-1.5 flex gap-4 ml-9">
                          <div>
                            <p className="text-[10px] text-slate-700">Avg Buy</p>
                            <p className="text-xs font-medium text-slate-300">{fmtExact(c.avgCost)}</p>
                          </div>
                          {!hasLanePair && c.corridors > 1 && (
                            <div>
                              <p className="text-[10px] text-slate-700">Routes</p>
                              <p className="text-xs font-medium text-slate-300">{c.corridors}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Default sidebar: top lanes + top carriers */
            <>
              <div className="flex border-b border-white/[0.08] flex-shrink-0">
                <button
                  onClick={() => setSidebarTab("lanes")}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${sidebarTab === "lanes" ? "text-white border-b-2 border-blue-500" : "text-slate-600 hover:text-slate-400"}`}
                >
                  Top Lanes
                </button>
                <button
                  onClick={() => setSidebarTab("carriers")}
                  className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${sidebarTab === "carriers" ? "text-white border-b-2 border-blue-500" : "text-slate-600 hover:text-slate-400"}`}
                >
                  Top Carriers
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {sidebarTab === "lanes" ? (
                  <div className="p-3 flex flex-col gap-1.5">
                    {!data ? (
                      <p className="text-slate-700 text-sm text-center mt-8">Loading…</p>
                    ) : topCorridors.map((corr, i) => (
                      <button
                        key={corr.key}
                        onClick={() => { setSelectedOrigin(corr.origin); setSelectedDest(corr.destination); }}
                        className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] rounded-lg px-3 py-2.5 border border-white/[0.05] hover:border-white/10 transition-all group"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] text-slate-700 font-mono">{i + 1}</span>
                          <span className="text-xs font-bold text-emerald-400 bg-emerald-900/20 px-1.5 py-0.5 rounded-full">
                            {corr.loads.length} loads
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-2.5 h-2.5 text-red-400 flex-shrink-0" />
                          <span className="text-xs text-slate-300 truncate">{corr.origin}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <ArrowRight className="w-2.5 h-2.5 text-slate-700 flex-shrink-0" />
                          <span className="text-xs text-slate-400 truncate">{corr.destination}</span>
                        </div>
                        <div className="mt-1.5">
                          <p className="text-[10px] text-slate-700">{Object.keys(corr.carriers).length} carrier{Object.keys(corr.carriers).length !== 1 ? "s" : ""}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 flex flex-col gap-1.5">
                    {!data ? (
                      <p className="text-slate-700 text-sm text-center mt-8">Loading…</p>
                    ) : topCarriers.map((c, i) => (
                      <div key={c.name} className="bg-white/[0.03] rounded-lg px-3 py-2.5 border border-white/[0.05]">
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
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3 border-t border-white/[0.06] text-center">
                <p className="text-[10px] text-slate-700">Click a lane above or a dot on the map to filter</p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
