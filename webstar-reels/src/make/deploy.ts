import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../lib/env.js";

const API = "https://api.vercel.com";
const SKIP = new Set(["spec.json"]);

async function vercel<T>(method: string, route: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const team = env("VERCEL_TEAM_ID");
  const url = `${API}${route}${team ? `${route.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${env("VERCEL_TOKEN")}`, ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vercel ${method} ${route} returned ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Deploy a built site folder as a Vercel preview deployment and return its URL.
 * One Vercel project per brand (VERCEL_PROJECT_<BRAND>, default "<brand>-concepts").
 */
export async function deployPreview(dir: string, project: string): Promise<string> {
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(dir).filter((f) => !SKIP.has(path.relative(dir, f)));

  const manifest = [];
  for (const file of files) {
    const data = fs.readFileSync(file);
    const sha = crypto.createHash("sha1").update(data).digest("hex");
    await vercel("POST", "/v2/files", data, {
      "content-type": "application/octet-stream",
      "x-vercel-digest": sha,
      "content-length": String(data.length),
    });
    manifest.push({ file: path.relative(dir, file).split(path.sep).join("/"), sha, size: data.length });
  }

  const created = await vercel<{ id: string; url: string }>(
    "POST",
    "/v13/deployments?skipAutoDetectionConfirmation=1",
    JSON.stringify({
      name: project,
      files: manifest,
      projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
    }),
    { "content-type": "application/json" },
  );

  for (let i = 0; i < 60; i++) {
    const d = await vercel<{ readyState: string; url: string; errorMessage?: string }>("GET", `/v13/deployments/${created.id}`);
    if (d.readyState === "READY") return `https://${d.url}`;
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") {
      throw new Error(`Vercel deployment ${created.id} failed: ${d.errorMessage ?? d.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Vercel deployment ${created.id} was not ready after 3 minutes`);
}
