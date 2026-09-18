/**
 * Fetches real, historical AAPLx/USDC OHLCV from GeckoTerminal for the
 * window defined in config.ts, and writes it to historical-data.json.
 * Run once per weekend chosen; the replay harness and comparison UI both
 * read the cached file rather than re-fetching, so a replay run is
 * reproducible even if GeckoTerminal's window shifts later.
 *
 * Usage: npm run replay:fetch
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  FRIDAY_CLOSE_UTC,
  GECKOTERMINAL_NETWORK,
  GECKOTERMINAL_POOL_ADDRESS,
  HistoricalCandle,
  HistoricalDataset,
  MONDAY_OPEN_UTC,
  SOURCE,
} from "./config";

const OUT_PATH = path.join(__dirname, "historical-data.json");

/**
 * Shells out to curl rather than using Node's native fetch: undici's
 * fetch implementation was failing with ETIMEDOUT against this exact host
 * in this WSL environment (likely flaky IPv6 handling), while curl
 * connects reliably -- confirmed repeatedly during this build.
 */
function fetchOhlcv(beforeTimestamp: number, limit: number): HistoricalCandle[] {
  const url = `https://api.geckoterminal.com/api/v2/networks/${GECKOTERMINAL_NETWORK}/pools/${GECKOTERMINAL_POOL_ADDRESS}/ohlcv/hour?aggregate=1&limit=${limit}&before_timestamp=${beforeTimestamp}`;
  const raw = execFileSync("curl", ["-s", "-H", "Accept: application/json", url], { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  const json: any = JSON.parse(raw);
  if (!json?.data?.attributes?.ohlcv_list) {
    throw new Error(`GeckoTerminal request did not return OHLCV data for ${url}: ${raw.slice(0, 500)}`);
  }
  const rows: [number, number, number, number, number, number][] = json.data.attributes.ohlcv_list;
  return rows
    .map(([timestamp, open, high, low, close, volumeUsd]) => ({ timestamp, open, high, low, close, volumeUsd }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function main() {
  const fridayCloseTs = Math.floor(new Date(FRIDAY_CLOSE_UTC).getTime() / 1000);
  const mondayOpenTs = Math.floor(new Date(MONDAY_OPEN_UTC).getTime() / 1000);
  // Fetch enough hourly candles to comfortably cover Friday close through
  // a bit past Monday open, then trim to the exact window.
  const beforeTimestamp = mondayOpenTs + 6 * 3600;
  const hoursSpan = Math.ceil((mondayOpenTs - fridayCloseTs) / 3600) + 12;

  console.log(`Fetching real GeckoTerminal OHLCV for pool ${GECKOTERMINAL_POOL_ADDRESS}...`);
  console.log(`Window: ${FRIDAY_CLOSE_UTC} -> ${MONDAY_OPEN_UTC} (${hoursSpan} hourly candles requested)`);

  const allCandles = fetchOhlcv(beforeTimestamp, Math.min(hoursSpan, 1000));
  const candles = allCandles.filter((c) => c.timestamp >= fridayCloseTs - 3600 && c.timestamp <= mondayOpenTs + 3600);

  if (candles.length === 0) {
    throw new Error("No candles returned for the configured window -- check config.ts's dates against the pool's actual trading history.");
  }

  const dataset: HistoricalDataset = {
    source: SOURCE,
    network: GECKOTERMINAL_NETWORK,
    poolAddress: GECKOTERMINAL_POOL_ADDRESS,
    fetchedAtUtc: new Date().toISOString(),
    fridayCloseUtc: FRIDAY_CLOSE_UTC,
    mondayOpenUtc: MONDAY_OPEN_UTC,
    candles,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(dataset, null, 2));
  console.log(`Wrote ${candles.length} real candles to ${OUT_PATH}`);
  console.log(`First: ${new Date(candles[0].timestamp * 1000).toISOString()} close=$${candles[0].close.toFixed(2)}`);
  console.log(`Last:  ${new Date(candles[candles.length - 1].timestamp * 1000).toISOString()} close=$${candles[candles.length - 1].close.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
