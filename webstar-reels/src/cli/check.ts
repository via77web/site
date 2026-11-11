/** npm run check [-- --live]: is this Mac ready to run the jobs? --live also makes one tiny Claude Code call. */
import { imageKeyName, imageProvider } from "../make/images.js";
import { loadIntroIndex } from "../lib/intros.js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { z } from "zod";
import { brandEnvName, listBrandIds, loadBrand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { generate, llmBackend } from "../lib/llm.js";
import { loadMusic } from "../lib/music.js";
import { referencesRoot } from "../refs/sync.js";
import { leadsEnabled } from "../steps/leads.js";
import { hasLibrary, loadLibrary } from "../stills/library.js";

const live = process.argv.includes("--live");
let problems = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string) => (problems++, console.log(`  ✗ ${m}`));
const note = (m: string) => console.log(`  · ${m}`);
const cmd = (c: string, args: string[] = ["--version"]) => spawnSync(c, args, { encoding: "utf8" });

console.log("Tools");
const major = Number(process.versions.node.split(".")[0]);
major >= 20 ? ok(`node ${process.versions.node}`) : bad(`node ${process.versions.node}; need 20+`);
for (const t of ["ffmpeg", "ffprobe"]) cmd(t, ["-version"]).status === 0 ? ok(t) : bad(`${t} missing (brew install ffmpeg)`);
const gh = cmd("gh", ["auth", "status"]);
gh.status === 0 ? ok("gh logged in") : bad("gh missing or not logged in (brew install gh; gh auth login)");
if (process.platform === "darwin") cmd("which", ["terminal-notifier"]).status === 0 ? ok("terminal-notifier") : note("terminal-notifier not installed: notifications won't open the review page when clicked (brew install terminal-notifier)");

console.log("Claude");
if (llmBackend() === "claude-code") {
  const v = cmd(env("CLAUDE_BIN") ?? "claude");
  v.status === 0 ? ok(`Claude Code ${v.stdout.trim()} (runs on your subscription)`) : bad("claude not found (npm install -g @anthropic-ai/claude-code, then run claude and /login)");
  if (env("ANTHROPIC_API_KEY")) note("ANTHROPIC_API_KEY is set; it is removed for Claude Code calls so they use your subscription");
  if (live) {
    try {
      const r = await generate({ label: "check", schema: z.object({ ok: z.boolean() }), system: "Reply with ok true.", prompt: "Are you there?", effort: "low", rounds: 1 });
      r.ok ? ok("claude -p answered on your subscription") : bad("claude -p answered unexpectedly");
    } catch (error) {
      bad(`claude -p failed: ${error instanceof Error ? error.message : error}`);
    }
  }
} else {
  env("ANTHROPIC_API_KEY") ? ok("LLM=api with ANTHROPIC_API_KEY (billed per token)") : bad("LLM=api but ANTHROPIC_API_KEY is empty");
}

console.log("Keys");
for (const k of ["ELEVENLABS_API_KEY", "BUFFER_ACCESS_TOKEN", "GITHUB_REPOSITORY"]) env(k) ? ok(k) : bad(`${k} is empty`);
{
  const key = imageKeyName(imageProvider());
  env(key) ? ok(`${key} (site images via ${imageProvider()})`) : note(`${key} empty: generated sites use placeholder images`);
}
env("VERCEL_TOKEN") ? ok("VERCEL_TOKEN") : note("VERCEL_TOKEN empty: generated sites get no preview link");
env("FAL_KEY") ? ok("FAL_KEY (AI visualisation reels)") : note("FAL_KEY empty: no AI visualisation reels; those days use real footage");
env("RESEND_API_KEY") && env("NOTIFY_EMAIL") ? ok("email notifications") : note("no email notifications (optional)");
env("NTFY_TOPIC") ? ok("phone notifications via ntfy") : note("no phone notifications (optional NTFY_TOPIC)");

console.log("Leads and music");
leadsEnabled() ? ok("lead tracking (Supabase)") : note("SUPABASE_URL / SUPABASE_SERVICE_KEY empty: no click, enquiry or deposit tracking (docs/lead-tracking.md)");
env("TRACK_BASE_URL") ? ok("TRACK_BASE_URL (short tracked links)") : note("TRACK_BASE_URL empty: tracked links go straight to the site with UTM tags");
{
  const { tracks, unlisted } = loadMusic();
  ok(`${tracks.length} licensed music track(s)`);
  if (unlisted.length) note(`ignored, not in music/library.json: ${unlisted.join(", ")}`);
  for (const id of listBrandIds()) if (!tracks.some((t) => t.brands.includes(id))) note(`${id} has no licensed track: its reels will have voice only`);
}

console.log("Laptop-zoom intros");
for (const id of listBrandIds()) {
  const n = loadIntroIndex().filter((c) => c.brand === id).length;
  n ? ok(`${id}: ${n} intro clip(s) (\`npm run intros\` checks them)`) : note(`${id} has no intro clips: no laptop-zoom reels (see intros/README.md)`);
}

console.log("References");
{
  const root = referencesRoot();
  let real = "";
  try {
    real = fs.realpathSync(root);
  } catch {
    /* missing */
  }
  if (!real) note("references/ doesn't exist yet (scripts/setup-mac.sh links it to iCloud Drive)");
  else if (real.includes("com~apple~CloudDocs")) ok("references/ syncs with iCloud Drive");
  else note("references/ is a local folder, not synced with iCloud Drive");
}

console.log("Brands");
for (const id of listBrandIds()) {
  const brand = loadBrand(id);
  for (const base of ["ELEVENLABS_VOICE_ID", "BUFFER_PROFILE_IDS"]) env(brandEnvName(base, brand)) ? ok(brandEnvName(base, brand)) : bad(`${brandEnvName(base, brand)} is empty`);
  if (brand.content === "library") {
    if (!hasLibrary(brand)) bad(`${brand.name} has no photo library yet (npm run library:crawl -- --brand ${id})`);
    else {
      const lib = loadLibrary(brand);
      ok(`${brand.name} library: ${lib.images.length} photos, ${lib.pairs.length} before/after pairs, ${lib.materials.length} materials, ${lib.skipped.length} skipped`);
    }
  }
}

if (process.platform === "darwin") {
  console.log("Schedule");
  const uid = process.getuid?.();
  for (const job of ["weekly", "daily"]) {
    cmd("launchctl", ["print", `gui/${uid}/com.webstar-reels.${job}`]).status === 0 ? ok(`launchd job ${job}`) : bad(`launchd job ${job} not loaded (scripts/setup-mac.sh)`);
  }
  const sched = cmd("pmset", ["-g", "sched"]).stdout;
  /wake/i.test(sched) ? ok("wake schedule set (pmset)") : bad("no wake schedule (scripts/setup-mac.sh sets it)");
}

console.log(problems ? `\n${problems} problem(s) to fix.` : "\nAll set.");
process.exit(problems ? 1 : 0);
