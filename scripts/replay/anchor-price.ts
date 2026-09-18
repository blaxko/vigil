/**
 * The two functions every replay script actually calls -- never read
 * config.ts's Pyth- or Gecko-specific fields directly, go through these,
 * so the SOURCE switch in config.ts is genuinely the only edit needed to
 * swap data sources.
 */
import * as fs from "fs";
import * as path from "path";
import {
  HistoricalDataset,
  MONDAY_OPEN_UTC,
  FRIDAY_CLOSE_UTC,
  PYTH_FRIDAY_CLOSE_PRICE_USD,
  PYTH_MONDAY_OPEN_PRICE_USD,
  SOURCE,
} from "./config";

function loadDataset(): HistoricalDataset {
  const p = path.join(__dirname, "historical-data.json");
  if (!fs.existsSync(p)) {
    throw new Error("scripts/replay/historical-data.json not found -- run `npm run replay:fetch` first.");
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function nearestCandleClose(dataset: HistoricalDataset, targetUtc: string): number {
  const targetTs = Math.floor(new Date(targetUtc).getTime() / 1000);
  let best = dataset.candles[0];
  for (const c of dataset.candles) {
    if (Math.abs(c.timestamp - targetTs) < Math.abs(best.timestamp - targetTs)) best = c;
  }
  return best.close;
}

export function getFridayCloseAnchorUsd(): number {
  if (SOURCE === "pyth-benchmarks") {
    if (PYTH_FRIDAY_CLOSE_PRICE_USD === null) {
      throw new Error("config.ts: SOURCE is 'pyth-benchmarks' but PYTH_FRIDAY_CLOSE_PRICE_USD is not set.");
    }
    return PYTH_FRIDAY_CLOSE_PRICE_USD;
  }
  return nearestCandleClose(loadDataset(), FRIDAY_CLOSE_UTC);
}

export function getMondayReopenAnchorUsd(): number {
  if (SOURCE === "pyth-benchmarks") {
    if (PYTH_MONDAY_OPEN_PRICE_USD === null) {
      throw new Error("config.ts: SOURCE is 'pyth-benchmarks' but PYTH_MONDAY_OPEN_PRICE_USD is not set.");
    }
    return PYTH_MONDAY_OPEN_PRICE_USD;
  }
  return nearestCandleClose(loadDataset(), MONDAY_OPEN_UTC);
}

/** One line describing where the anchor prices actually came from, for
 * on-screen/README disclosure -- always in sync with SOURCE. */
export function anchorSourceDisclosure(): string {
  if (SOURCE === "pyth-benchmarks") {
    return "Anchor prices sourced from Pyth Benchmarks (real historical equity feed).";
  }
  return (
    "Anchor prices derived from real GeckoTerminal AAPLx/USDC on-chain trading data " +
    "at the NYSE close/open boundary (Pyth Benchmarks' historical API was unavailable " +
    "without an API key at build time -- see scripts/replay/config.ts for the full " +
    "disclosure and the one-line swap to real Pyth data)."
  );
}
