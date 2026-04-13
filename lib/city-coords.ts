// Static lookup for major US cities → [longitude, latitude]
// Covers the most common freight lanes. Falls back to state centroid if city not found.

const CITY_COORDS: Record<string, [number, number]> = {
  // AL
  "Birmingham, AL": [-86.8025, 33.5186],
  "Mobile, AL": [-88.0399, 30.6954],
  "Montgomery, AL": [-86.2999, 32.3668],
  "Huntsville, AL": [-86.5861, 34.7304],
  // AR
  "Little Rock, AR": [-92.2896, 34.7465],
  "Fort Smith, AR": [-94.4213, 35.3859],
  // AZ
  "Phoenix, AZ": [-112.074, 33.4484],
  "Tucson, AZ": [-110.9747, 32.2226],
  "Mesa, AZ": [-111.8315, 33.4152],
  "Tempe, AZ": [-111.9401, 33.4255],
  "Scottsdale, AZ": [-111.9261, 33.4942],
  // CA
  "Los Angeles, CA": [-118.2437, 34.0522],
  "San Francisco, CA": [-122.4194, 37.7749],
  "San Diego, CA": [-117.1611, 32.7157],
  "Sacramento, CA": [-121.4944, 38.5816],
  "Fresno, CA": [-119.7871, 36.7378],
  "Oakland, CA": [-122.2711, 37.8044],
  "Long Beach, CA": [-118.1937, 33.77],
  "Bakersfield, CA": [-119.0187, 35.3733],
  "Stockton, CA": [-121.2908, 37.9577],
  "Riverside, CA": [-117.3961, 33.9806],
  "Pomona, CA": [-117.75, 34.055],
  "Ontario, CA": [-117.6508, 34.0633],
  "Anaheim, CA": [-117.9145, 33.8366],
  "Fontana, CA": [-117.435, 34.0922],
  "Modesto, CA": [-120.9977, 37.6391],
  "San Jose, CA": [-121.8863, 37.3382],
  "Chula Vista, CA": [-117.0842, 32.6401],
  "Tracy, CA": [-121.4397, 37.7397],
  "Perris, CA": [-117.2286, 33.7825],
  // CO
  "Denver, CO": [-104.9903, 39.7392],
  "Colorado Springs, CO": [-104.8214, 38.8339],
  "Aurora, CO": [-104.8319, 39.7294],
  "Fort Collins, CO": [-105.0844, 40.5853],
  "Pueblo, CO": [-104.6091, 38.2544],
  // CT
  "Hartford, CT": [-72.6851, 41.7658],
  "Bridgeport, CT": [-73.1952, 41.1865],
  "New Haven, CT": [-72.9279, 41.3082],
  // DE
  "Wilmington, DE": [-75.5277, 39.7447],
  // FL
  "Miami, FL": [-80.1918, 25.7617],
  "Jacksonville, FL": [-81.6557, 30.3322],
  "Tampa, FL": [-82.4572, 27.9506],
  "Orlando, FL": [-81.3792, 28.5383],
  "Fort Lauderdale, FL": [-80.1373, 26.1224],
  "St. Petersburg, FL": [-82.6403, 27.773],
  "Tallahassee, FL": [-84.2807, 30.4383],
  "Gainesville, FL": [-82.3248, 29.6516],
  "Lakeland, FL": [-81.9498, 28.0395],
  "West Palm Beach, FL": [-80.0534, 26.7153],
  "Pensacola, FL": [-87.2169, 30.4213],
  "Ocala, FL": [-82.1401, 29.1872],
  "Sarasota, FL": [-82.5307, 27.3364],
  // GA
  "Atlanta, GA": [-84.388, 33.749],
  "Augusta, GA": [-81.9748, 33.4735],
  "Savannah, GA": [-81.0998, 32.0809],
  "Columbus, GA": [-84.9877, 32.4610],
  "Macon, GA": [-83.6324, 32.8407],
  // IA
  "Des Moines, IA": [-93.6091, 41.6005],
  "Cedar Rapids, IA": [-91.6441, 41.9779],
  "Davenport, IA": [-90.5776, 41.5236],
  // ID
  "Boise, ID": [-116.2023, 43.615],
  // IL
  "Chicago, IL": [-87.6298, 41.8781],
  "Aurora, IL": [-88.3201, 41.7606],
  "Rockford, IL": [-89.094, 42.2711],
  "Joliet, IL": [-88.0817, 41.525],
  "Springfield, IL": [-89.6501, 39.7817],
  "Peoria, IL": [-89.5890, 40.6936],
  "Elgin, IL": [-88.2826, 42.0354],
  "Waukegan, IL": [-87.8448, 42.3636],
  "Naperville, IL": [-88.1535, 41.7508],
  "Cicero, IL": [-87.7540, 41.8456],
  // IN
  "Indianapolis, IN": [-86.1581, 39.7684],
  "Fort Wayne, IN": [-85.1394, 41.0793],
  "Evansville, IN": [-87.5711, 37.9716],
  "South Bend, IN": [-86.2520, 41.6764],
  "Gary, IN": [-87.3464, 41.5934],
  // KS
  "Wichita, KS": [-97.3301, 37.6872],
  "Kansas City, KS": [-94.6275, 39.1141],
  "Topeka, KS": [-95.6890, 39.0489],
  // KY
  "Louisville, KY": [-85.7585, 38.2527],
  "Lexington, KY": [-84.4947, 38.0406],
  // LA
  "New Orleans, LA": [-90.0715, 29.9511],
  "Baton Rouge, LA": [-91.1403, 30.4515],
  "Shreveport, LA": [-93.7502, 32.5252],
  "Lafayette, LA": [-92.0198, 30.2241],
  // MA
  "Boston, MA": [-71.0589, 42.3601],
  "Worcester, MA": [-71.8023, 42.2626],
  "Springfield, MA": [-72.5898, 42.1015],
  // MD
  "Baltimore, MD": [-76.6122, 39.2904],
  // ME
  "Portland, ME": [-70.2553, 43.6591],
  // MI
  "Detroit, MI": [-83.0458, 42.3314],
  "Grand Rapids, MI": [-85.6681, 42.9634],
  "Warren, MI": [-83.0277, 42.5145],
  "Sterling Heights, MI": [-83.0302, 42.5803],
  "Lansing, MI": [-84.5555, 42.7325],
  "Flint, MI": [-83.6875, 43.0125],
  // MN
  "Minneapolis, MN": [-93.2650, 44.9778],
  "St. Paul, MN": [-93.0900, 44.9537],
  "Rochester, MN": [-92.4802, 44.0121],
  "Duluth, MN": [-92.1005, 46.7867],
  // MO
  "Kansas City, MO": [-94.5786, 39.0997],
  "St. Louis, MO": [-90.1994, 38.6270],
  "Springfield, MO": [-93.2923, 37.2153],
  "Columbia, MO": [-92.3341, 38.9517],
  // MS
  "Jackson, MS": [-90.1848, 32.2988],
  "Gulfport, MS": [-89.0928, 30.3674],
  // MT
  "Billings, MT": [-108.501, 45.7833],
  "Great Falls, MT": [-111.3008, 47.5002],
  // NC
  "Charlotte, NC": [-80.8431, 35.2271],
  "Raleigh, NC": [-78.6382, 35.7796],
  "Greensboro, NC": [-79.7910, 36.0726],
  "Durham, NC": [-78.8986, 35.994],
  "Winston-Salem, NC": [-80.2442, 36.0999],
  "Fayetteville, NC": [-78.8784, 35.0527],
  // ND
  "Fargo, ND": [-96.7898, 46.8772],
  // NE
  "Omaha, NE": [-95.9345, 41.2565],
  "Lincoln, NE": [-96.6852, 40.8136],
  // NJ
  "Newark, NJ": [-74.1724, 40.7357],
  "Jersey City, NJ": [-74.0776, 40.7282],
  "Paterson, NJ": [-74.1774, 40.9168],
  "Elizabeth, NJ": [-74.2121, 40.6640],
  // NM
  "Albuquerque, NM": [-106.6504, 35.0844],
  "Las Cruces, NM": [-106.7893, 32.3199],
  // NV
  "Las Vegas, NV": [-115.1398, 36.1699],
  "Reno, NV": [-119.8138, 39.5296],
  "Henderson, NV": [-114.9817, 36.0397],
  // NY
  "New York, NY": [-74.006, 40.7128],
  "Buffalo, NY": [-78.8784, 42.8864],
  "Rochester, NY": [-77.6109, 43.155],
  "Yonkers, NY": [-73.8988, 40.9312],
  "Syracuse, NY": [-76.1474, 43.0481],
  "Albany, NY": [-73.7562, 42.6526],
  // OH
  "Columbus, OH": [-82.9988, 39.9612],
  "Cleveland, OH": [-81.6944, 41.4993],
  "Cincinnati, OH": [-84.512, 39.1031],
  "Toledo, OH": [-83.5552, 41.6528],
  "Akron, OH": [-81.5190, 41.0814],
  "Dayton, OH": [-84.1916, 39.7589],
  "Youngstown, OH": [-80.6495, 41.0998],
  // OK
  "Oklahoma City, OK": [-97.5164, 35.4676],
  "Tulsa, OK": [-95.9928, 36.154],
  // OR
  "Portland, OR": [-122.6765, 45.5231],
  "Eugene, OR": [-123.0868, 44.0521],
  "Salem, OR": [-123.0351, 44.9429],
  // PA
  "Philadelphia, PA": [-75.1652, 39.9526],
  "Pittsburgh, PA": [-79.9959, 40.4406],
  "Allentown, PA": [-75.4902, 40.6084],
  "Erie, PA": [-80.0851, 42.1292],
  "Reading, PA": [-75.9269, 40.3356],
  "Scranton, PA": [-75.6624, 41.4090],
  "York, PA": [-76.7277, 39.9626],
  "Harrisburg, PA": [-76.8844, 40.2732],
  // RI
  "Providence, RI": [-71.4128, 41.824],
  // SC
  "Columbia, SC": [-81.0348, 34.0007],
  "Charleston, SC": [-79.9311, 32.7765],
  "Greenville, SC": [-82.394, 34.8526],
  // SD
  "Sioux Falls, SD": [-96.7003, 43.5446],
  // TN
  "Nashville, TN": [-86.7816, 36.1627],
  "Memphis, TN": [-90.0490, 35.1495],
  "Knoxville, TN": [-83.9207, 35.9606],
  "Chattanooga, TN": [-85.3097, 35.0456],
  // TX
  "Houston, TX": [-95.3698, 29.7604],
  "San Antonio, TX": [-98.4936, 29.4241],
  "Dallas, TX": [-96.797, 32.7767],
  "Austin, TX": [-97.7431, 30.2672],
  "Fort Worth, TX": [-97.3208, 32.7555],
  "El Paso, TX": [-106.4850, 31.7619],
  "Arlington, TX": [-97.1081, 32.7357],
  "Corpus Christi, TX": [-97.3964, 27.8006],
  "Plano, TX": [-96.6989, 33.0198],
  "Laredo, TX": [-99.5075, 27.5036],
  "Lubbock, TX": [-101.8552, 33.5779],
  "Garland, TX": [-96.6389, 32.9126],
  "Irving, TX": [-96.9489, 32.8141],
  "Amarillo, TX": [-101.8313, 35.222],
  "McKinney, TX": [-96.6397, 33.1972],
  "Brownsville, TX": [-97.4975, 25.9017],
  "Wichita Falls, TX": [-98.4934, 33.9137],
  "Midland, TX": [-102.0779, 31.9974],
  "Odessa, TX": [-102.3677, 31.8457],
  "Killeen, TX": [-97.7278, 31.1171],
  "Pasadena, TX": [-95.2091, 29.6911],
  "Waco, TX": [-97.1467, 31.5493],
  "McAllen, TX": [-98.2300, 26.2034],
  "Beaumont, TX": [-94.1018, 30.086],
  "Tyler, TX": [-95.3010, 32.3513],
  "League City, TX": [-95.0949, 29.5075],
  "Abilene, TX": [-99.7331, 32.4487],
  "Richardson, TX": [-96.7299, 32.9483],
  "Frisco, TX": [-96.8225, 33.1507],
  // UT
  "Salt Lake City, UT": [-111.891, 40.7608],
  "West Valley City, UT": [-112.0011, 40.6916],
  "Provo, UT": [-111.6585, 40.2338],
  // VA
  "Virginia Beach, VA": [-76.0301, 36.8529],
  "Norfolk, VA": [-76.2859, 36.8508],
  "Chesapeake, VA": [-76.2875, 36.7682],
  "Richmond, VA": [-77.4360, 37.5407],
  "Newport News, VA": [-76.5228, 37.0871],
  // VT
  "Burlington, VT": [-73.2121, 44.4759],
  // WA
  "Seattle, WA": [-122.3321, 47.6062],
  "Spokane, WA": [-117.426, 47.6588],
  "Tacoma, WA": [-122.4443, 47.2529],
  "Vancouver, WA": [-122.6615, 45.6387],
  "Bellevue, WA": [-122.2015, 47.6101],
  "Kent, WA": [-122.2348, 47.3809],
  // WI
  "Milwaukee, WI": [-87.9065, 43.0389],
  "Madison, WI": [-89.4012, 43.0731],
  "Green Bay, WI": [-88.0198, 44.5133],
  // WV
  "Charleston, WV": [-81.6326, 38.3498],
  // WY
  "Cheyenne, WY": [-104.8202, 41.14],

  // Canada — Ontario
  "Toronto, ON": [-79.3832, 43.6532],
  "Ottawa, ON": [-75.6972, 45.4215],
  "Mississauga, ON": [-79.6441, 43.589],
  "Brampton, ON": [-79.7624, 43.7315],
  "Hamilton, ON": [-79.8711, 43.2557],
  "London, ON": [-81.2453, 42.9849],
  "Kitchener, ON": [-80.4927, 43.4516],
  "Windsor, ON": [-83.0364, 42.3149],
  "Guelph, ON": [-80.2482, 43.5448],
  "Cambridge, ON": [-80.3126, 43.3616],
  "Concord, ON": [-79.4901, 43.7928],
  "Fort Erie, ON": [-78.9301, 42.906],
  "Oldcastle, ON": [-82.9781, 42.2564],
  // Canada — Quebec
  "Montreal, QC": [-73.5673, 45.5017],
  "Quebec City, QC": [-71.2075, 46.8139],
  "Laval, QC": [-73.692, 45.6066],
  "Anjou, QC": [-73.5541, 45.6066],
  "Varennes, QC": [-73.4334, 45.6834],
  "Richmond, QC": [-72.1469, 45.6625],
  // Canada — Alberta
  "Calgary, AB": [-114.0719, 51.0447],
  "Edmonton, AB": [-113.4909, 53.5461],
  "Nisku, AB": [-113.5183, 53.3266],
  // Canada — British Columbia
  "Vancouver, BC": [-123.1216, 49.2827],
  "Surrey, BC": [-122.8491, 49.1913],
  // Canada — Manitoba
  "Winnipeg, MB": [-97.1384, 49.8951],
  // Canada — Saskatchewan
  "Saskatoon, SK": [-106.6702, 52.1332],
  "Regina, SK": [-104.6189, 50.4452],
};

// State centroids as fallback
const STATE_COORDS: Record<string, [number, number]> = {
  AL: [-86.8, 32.8],  AR: [-92.4, 34.8],  AZ: [-111.9, 34.3],
  CA: [-119.4, 37.2], CO: [-105.5, 39.0], CT: [-72.7, 41.6],
  DE: [-75.5, 39.0],  FL: [-81.5, 27.8],  GA: [-83.4, 32.7],
  IA: [-93.1, 42.0],  ID: [-114.5, 44.4], IL: [-89.2, 40.6],
  IN: [-86.3, 40.3],  KS: [-98.4, 38.5],  KY: [-85.3, 37.5],
  LA: [-91.8, 31.2],  MA: [-71.5, 42.2],  MD: [-76.8, 39.1],
  ME: [-69.4, 44.7],  MI: [-84.5, 44.3],  MN: [-94.6, 46.4],
  MO: [-92.3, 38.5],  MS: [-89.7, 32.7],  MT: [-110.5, 46.9],
  NC: [-79.4, 35.6],  ND: [-100.5, 47.5], NE: [-99.9, 41.5],
  NH: [-71.6, 43.7],  NJ: [-74.4, 40.1],  NM: [-106.1, 34.5],
  NV: [-116.4, 38.5], NY: [-75.5, 42.9],  OH: [-82.9, 40.4],
  OK: [-97.5, 35.5],  OR: [-120.5, 44.0], PA: [-77.2, 40.9],
  RI: [-71.5, 41.7],  SC: [-80.9, 33.8],  SD: [-100.3, 44.4],
  TN: [-86.7, 35.9],  TX: [-99.3, 31.5],  UT: [-111.1, 39.3],
  VA: [-78.7, 37.8],  VT: [-72.7, 44.0],  WA: [-120.7, 47.5],
  WI: [-89.6, 44.5],  WV: [-80.6, 38.6],  WY: [-107.6, 43.0],
  // Canadian provinces
  ON: [-80.0, 44.0],  QC: [-72.0, 46.5],  BC: [-123.0, 49.3],
  AB: [-114.0, 51.5], MB: [-97.1, 50.0],  SK: [-106.0, 51.0],
  NS: [-63.6, 44.7],  NB: [-66.5, 46.5],  PE: [-63.1, 46.2],
  NL: [-55.7, 48.5],
};

/**
 * Parse "City, ST" and return [longitude, latitude] or null if unknown.
 * Falls back to state centroid if city not found.
 */
export function cityToCoords(cityState: string): [number, number] | null {
  if (!cityState) return null;

  // Normalize: "dallas, tx" → "Dallas, TX"
  const parts = cityState.split(",").map((s) => s.trim());
  if (parts.length < 2) return null;

  const city = parts[0].replace(/\b\w/g, (c) => c.toUpperCase());
  const state = parts[1].toUpperCase();
  const key = `${city}, ${state}`;

  if (CITY_COORDS[key]) return CITY_COORDS[key];

  // Try case-insensitive fallback against known keys
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (k.toLowerCase() === lower) return v;
  }

  // Fall back to state centroid
  return STATE_COORDS[state] ?? null;
}
