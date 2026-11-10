import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./brand.js";

export const LOG_DIR = path.join(ROOT, "logs");

let logFile: string | undefined;
const errors: string[] = [];

/** Start logging this run to logs/<YYYY-MM-DD>-<job>.log (appending, so reruns stay in one file). */
export function startLog(job: string): string {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
  logFile = path.join(LOG_DIR, `${day}-${job}.log`);
  log(`===== ${job} started (pid ${process.pid}) =====`);
  return logFile;
}

export function currentLogFile(): string | undefined {
  return logFile;
}

/** Errors logged during this run, for the end-of-run notification. */
export function loggedErrors(): string[] {
  return [...errors];
}

function write(level: string, message: string): void {
  const stamp = new Date().toISOString();
  const line = `${stamp} ${level} ${message}`;
  (level === "ERROR" ? console.error : console.log)(message);
  if (logFile) fs.appendFileSync(logFile, line + "\n");
}

export const log = (message: string) => write("INFO", message);
export const warn = (message: string) => write("WARN", message);
export function logError(message: string): void {
  errors.push(message);
  write("ERROR", message);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run a step, retrying it once if it fails. Both attempts are logged with timings;
 * the second failure is thrown to the caller.
 */
export async function step<T>(label: string, fn: () => Promise<T>, { retryDelayMs = 20_000 } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    try {
      const result = await fn();
      log(`✓ ${label} (${((Date.now() - started) / 1000).toFixed(1)}s${attempt > 1 ? ", on retry" : ""})`);
      return result;
    } catch (error) {
      if (attempt >= 2) {
        logError(`✗ ${label} failed twice: ${errorText(error)}`);
        throw error;
      }
      warn(`! ${label} failed, retrying once in ${retryDelayMs / 1000}s: ${errorText(error)}`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}
