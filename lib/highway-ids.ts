/**
 * Maps carrier names (exactly as they appear in the Load table) to their
 * Highway.com profile ID (the number at the end of the URL).
 *
 * Example URL: https://highway.com/broker/carriers/3860770
 * Add entry:   "CARRIER NAME": "3860770"
 */
export const HIGHWAY_IDS: Record<string, string> = {
  // Add carriers here as you look them up:
  // "ACE TRANSPORTATION INC": "1234567",
};

export function highwayUrl(carrierName: string): string | null {
  const id = HIGHWAY_IDS[carrierName];
  return id ? `https://highway.com/broker/carriers/${id}` : null;
}
