import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env } from "./env.js";

/**
 * Structured generation for scripts, captions, site specs and briefs.
 *
 * LLM=claude-code (default): runs Claude Code headless (`claude -p`) with a JSON schema, so it
 *   bills to your Claude subscription. Needs `claude` installed and logged in (`claude` → /login).
 * LLM=api: the Anthropic API with ANTHROPIC_API_KEY, billed per token.
 */
export interface GenerateOptions<T> {
  /** Short name for logs. */
  label: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  /** Rules the schema can't express. Return feedback; empty means the result is usable. */
  check?: (value: T) => string[];
  /** Validation rounds (Claude sees the problems each time). Default 3. */
  rounds?: number;
  /** Let Claude Code read files (e.g. photos) in this folder with its Read tool. Claude Code backend only. */
  readDir?: string;
}

/** Claude's subscription usage limit was reached. Retrying straight away can't help. */
export class UsageLimitError extends Error {
  constructor(detail: string) {
    super(`Claude usage limit reached (${detail.trim()}). Run this again after the limit resets.`);
    this.name = "UsageLimitError";
  }
}

const LIMIT = /hit your .{0,40}limit|usage limit|rate limit reached|limit reached/i;

export const llmBackend = () => (env("LLM") ?? "claude-code") as "claude-code" | "api";

const CLAUDE_TIMEOUT_MS = 20 * 60_000;

/** Empty folder to run `claude` in, so no project CLAUDE.md or settings leak into the prompt. */
function sandboxDir(): string {
  const dir = path.join(os.tmpdir(), "webstar-reels-claude");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function viaClaudeCode(system: string, prompt: string, jsonSchema: object, effort?: string, readDir?: string): Promise<unknown> {
  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", JSON.stringify(jsonSchema),
    "--system-prompt", system,
    // No tools at all, unless the task needs to look at files, and then only Read.
    ...(readDir ? ["--tools", "Read", "--allowedTools", "Read"] : ["--tools", ""]),
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  if (effort) args.push("--effort", effort);
  if (env("CLAUDE_CODE_MODEL")) args.push("--model", env("CLAUDE_CODE_MODEL")!);

  // An API key in the environment would take priority over the subscription login. Never --bare:
  // bare mode ignores the subscription and only accepts API keys.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;

  const bin = env("CLAUDE_BIN") ?? "claude";
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd: readDir ?? sandboxDir(), env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude -p timed out after ${CLAUDE_TIMEOUT_MS / 60_000} minutes`));
    }, CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not run "${bin}": ${e.message}. Install Claude Code and log in, or set LLM=api.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 || stdout.trim().startsWith("{")) resolve(stdout);
      else if (LIMIT.test(stderr + stdout)) reject(new UsageLimitError((stderr || stdout).trim().slice(-120)));
      else reject(new Error(`claude -p exited with ${code}: ${(stderr || stdout).trim().slice(-600)}`));
    });
    child.stdin.end(prompt);
  });

  let result: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
  try {
    result = JSON.parse(out);
  } catch {
    throw new Error(`claude -p returned something that isn't JSON: ${out.slice(0, 300)}`);
  }
  if (result.structured_output === undefined && LIMIT.test(String(result.result ?? ""))) {
    throw new UsageLimitError(String(result.result).slice(0, 120));
  }
  if (result.is_error || (result.subtype && result.subtype !== "success")) {
    throw new Error(`claude -p failed (${result.subtype ?? "error"}): ${String(result.result ?? "").slice(0, 400)}`);
  }
  if (result.structured_output !== undefined) return result.structured_output;
  try {
    return JSON.parse(result.result ?? "");
  } catch {
    throw new Error(`claude -p returned no structured output: ${String(result.result ?? "").slice(0, 300)}`);
  }
}

async function viaApi<T>(system: string, prompt: string, schema: z.ZodType<T>, effort?: string): Promise<unknown> {
  const client = new Anthropic();
  const stream = client.beta.messages.stream({
    model: env("CLAUDE_MODEL") ?? "claude-opus-5-5",
    max_tokens: 64000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { ...(effort ? { effort: effort as "high" } : {}), format: betaZodOutputFormat(schema as z.ZodType) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined: ${response.stop_details?.explanation ?? "no reason given"}`);
  }
  if (!response.parsed_output) throw new Error(`No parseable output (stop_reason: ${response.stop_reason})`);
  return response.parsed_output;
}

export async function generate<T>(o: GenerateOptions<T>): Promise<T> {
  const backend = llmBackend();
  const jsonSchema = z.toJSONSchema(o.schema as z.ZodType, { target: "draft-7" });
  let prompt = o.prompt;
  let problems: string[] = [];

  for (let round = 1; round <= (o.rounds ?? 3); round++) {
    const raw =
      backend === "api"
        ? await viaApi(o.system, prompt, o.schema, o.effort)
        : await viaClaudeCode(o.system, prompt, jsonSchema, o.effort, o.readDir);
    const parsed = o.schema.safeParse(raw);
    problems = parsed.success ? (o.check?.(parsed.data) ?? []) : [z.prettifyError(parsed.error)];
    if (parsed.success && !problems.length) return parsed.data;
    // Each call is stateless, so the previous answer and its problems travel in the next prompt.
    prompt = `${o.prompt}

Your previous answer:
${JSON.stringify(raw)}

It has these problems:
${problems.map((p) => `- ${p}`).join("\n")}

Fix them and return the complete answer again.`;
  }
  throw new Error(`${o.label}: no usable result after ${o.rounds ?? 3} rounds: ${problems.join(" ")}`);
}
