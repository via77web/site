import fs from "node:fs";
import path from "node:path";
import { LOG_DIR, log } from "../lib/log.js";
import type { AiCost } from "../types.js";

const FILE = path.join(LOG_DIR, "ai-costs.csv");
const HEADER = "time,brand,reel,kind,model,request_id,seconds,usd,result,reason\n";

/** Append one generation to logs/ai-costs.csv. Rejected clips are logged too: they still cost money. */
export function logCost(brand: string, reel: string, c: AiCost): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, HEADER);
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  fs.appendFileSync(
    FILE,
    [new Date().toISOString(), brand, reel, c.kind, c.model, c.requestId, c.seconds ?? "", c.usd.toFixed(3), c.result, c.reason ?? ""].map(cell).join(",") + "\n",
  );
  log(`   cost: ${c.kind} ${c.model} $${c.usd.toFixed(2)} (${c.result}${c.reason ? `: ${c.reason}` : ""})`);
}

/** Estimated spend over the last `days` days, from the cost log. */
export function spentUsd(days = 7): number {
  if (!fs.existsSync(FILE)) return 0;
  const since = Date.now() - days * 86_400_000;
  return fs
    .readFileSync(FILE, "utf8")
    .split("\n")
    .slice(1)
    .map((line) => line.match(/"((?:[^"]|"")*)"/g)?.map((c) => c.slice(1, -1)))
    .filter((c): c is string[] => !!c && Date.parse(c[0]) >= since)
    .reduce((sum, c) => sum + (Number(c[7]) || 0), 0);
}
