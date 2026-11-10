import "dotenv/config";

export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Fail before any paid API call if a key is missing. */
export function requireEnv(names: string[]): void {
  const missing = names.filter((n) => !env(n));
  if (missing.length) {
    throw new Error(
      `Missing environment variable(s): ${missing.join(", ")}. Copy .env.example to .env and fill them in.`,
    );
  }
}
