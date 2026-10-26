import { defineConfig } from "vitest/config";
import path from "node:path";

// Week-boundary tests assert behavior under UTC, which is the zone Vercel
// uses. Set before workers spawn so `Date` local getters match that zone.
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
