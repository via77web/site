import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { dropTrailingPhrase } from "../remotion/captions.js";
import { reelSeconds } from "../remotion/timing.js";
import { ROOT, brandEnvName, listBrandIds, loadBrand, type Brand } from "./lib/brand.js";
import { requireEnv } from "./lib/env.js";
import {
  MAX_ATTEMPTS, dayNumber, hookForDay, loadSites, nextPending, saveSites, slugify,
} from "./lib/queue.js";
import { bufferToken, nextPostTime, resolveChannels, schedulePost } from "./steps/post.js";
import { publishVideo } from "./steps/publish.js";
import { openSite } from "./steps/record.js";
import { renderReel } from "./steps/render.js";
import { mockScript, writeScript } from "./steps/script.js";
import { mockVoice, synthesizeVoice } from "./steps/voice.js";
import type { Site } from "./types.js";

const { values: flags } = parseArgs({
  options: {
    brand: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    url: { type: "string" },
    name: { type: "string" },
    niche: { type: "string" },
  },
});
const dryRun = flags["dry-run"];
const mock = flags.mock;

type Outcome = "done" | "idle" | "failed";

/** Make and schedule the next reel for one brand. Never throws: a failure is recorded and reported. */
async function runBrand(brandId: string): Promise<Outcome> {
  let brand: Brand;
  let sites: Site[];
  try {
    brand = loadBrand(brandId);
    sites = loadSites(brand);
  } catch (error) {
    console.error(`[${brandId}] Failed: ${error instanceof Error ? error.message : error}`);
    return "failed";
  }
  const log = (msg: string) => console.log(`[${brand.id}] ${msg}`);

  // --url renders a one-off reel for any site without touching the queue.
  const site: Site | undefined = flags.url
    ? sites.find((s) => s.url === flags.url) ?? {
        url: flags.url,
        name: flags.name ?? new URL(flags.url).hostname,
        niche: flags.niche ?? "business",
        status: "pending",
      }
    : nextPending(sites);
  if (!site) {
    log(`Nothing to do: no site in brands/${brand.id}/sites.json has status "pending".`);
    return "idle";
  }
  const queued = sites.includes(site);

  // Check every key before spending anything. A missing key is a setup problem, not a failed
  // attempt on this site, so it does not count towards MAX_ATTEMPTS.
  try {
    if (!mock) requireEnv(["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", brandEnvName("ELEVENLABS_VOICE_ID", brand)]);
    if (!dryRun) {
      requireEnv([brandEnvName("BUFFER_PROFILE_IDS", brand)]);
      if (!bufferToken(brand)) requireEnv(["BUFFER_ACCESS_TOKEN"]);
    }
  } catch (error) {
    console.error(`[${brand.id}] Failed: ${error instanceof Error ? error.message : error}`);
    return "failed";
  }

  try {
    const day = site.day ?? dayNumber(sites);
    const tag = `${brand.id}-day-${String(day).padStart(3, "0")}-${slugify(site.name)}`;
    const workDir = path.join(ROOT, "out", brand.id, tag);
    fs.mkdirSync(workDir, { recursive: true });
    const file = (name: string) => path.join(workDir, name);
    const { style, scroll } = brand;

    log(`Day ${day}: ${site.name} (${site.url})${dryRun ? " [dry run]" : ""}${mock ? " [mock]" : ""}`);

    log("1/5 Opening site");
    const session = await openSite(site.url);
    let script, voice, total;
    try {
      log("2/5 Writing script");
      const hook = hookForDay(brand, day, site);
      script = mock ? mockScript(brand, site, hook) : await writeScript(brand, site, day, hook, session.pageInfo);
      fs.writeFileSync(file("script.json"), JSON.stringify(script, null, 2));
      log(`   hook: ${script.hook}`);

      log("3/5 Generating voiceover");
      voice = mock
        ? await mockVoice(script.voiceover, file("voice.mp3"), brand)
        : await synthesizeVoice(script.voiceover, file("voice.mp3"), brand);
      fs.writeFileSync(file("words.json"), JSON.stringify(voice.words, null, 2));

      // Record last, at the exact reel length, so the scroll fits the voiceover with no speed change.
      total = reelSeconds(voice.duration, scroll.seconds, style.endCardSeconds);
      log(`4/5 Recording ${(total - style.endCardSeconds).toFixed(1)}s scroll`);
      await session.record(file("recording.mp4"), {
        duration: total,
        heroHold: Math.max(scroll.heroHold, style.hookSeconds),
        sectionHold: scroll.sectionHold,
        footerHold: style.endCardSeconds,
      });
    } finally {
      await session.close();
    }

    log(`5/5 Rendering ${total.toFixed(1)}s reel`);
    const reelFile = file(`${tag}.mp4`);
    const shown = brand.captionSpokenCta
      ? { words: voice.words, captions: script.captions }
      : dropTrailingPhrase(voice.words, script.captions, brand.spokenCta);
    await renderReel(
      {
        brand,
        recordingFile: file("recording.mp4"),
        voiceFile: file("voice.mp3"),
        totalSeconds: total,
        hook: script.hook,
        captions: shown.captions,
        words: shown.words,
      },
      reelFile,
    );
    log(`Reel: ${path.relative(process.cwd(), reelFile)}`);

    const postText = `${script.postCaption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}`;
    fs.writeFileSync(file("caption.txt"), postText + "\n");

    if (dryRun) {
      log("Dry run: not posting. Caption that would be used:\n" + postText);
      return "done";
    }
    if (!queued) throw new Error("--url for a site that is not in the brand's sites.json only works with --dry-run");

    const dueAt = nextPostTime(brand.post.time, brand.post.timezone);
    const channels = await resolveChannels(brand);
    log(`Scheduling for ${dueAt.toISOString()} on ${channels.map((c) => c.service).join(", ")}`);
    const videoUrl = await publishVideo(reelFile, tag, brand);

    // Save after each channel so a retry never double-posts one that already went through.
    site.day = day;
    site.videoUrl = videoUrl;
    site.posts ??= {};
    for (const channel of channels) {
      if (site.posts[channel.id]) continue;
      site.posts[channel.id] = await schedulePost(brand, channel, postText, videoUrl, dueAt);
      saveSites(brand, sites);
      log(`   scheduled on ${channel.service}: ${site.posts[channel.id]}`);
    }
    site.status = "posted";
    site.scheduledFor = dueAt.toISOString();
    site.postedAt = new Date().toISOString();
    delete site.lastError;
    saveSites(brand, sites);
    log("Done.");
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun && queued) {
      // Stay "pending" so tomorrow's run retries; give up after MAX_ATTEMPTS so the queue keeps moving.
      site.attempts = (site.attempts ?? 0) + 1;
      site.lastError = message;
      if (site.attempts >= MAX_ATTEMPTS) site.status = "failed";
      saveSites(brand, sites);
    }
    console.error(`[${brand.id}] Failed: ${message}`);
    return "failed";
  }
}

if (mock && !dryRun) throw new Error("--mock produces a silent placeholder reel, so it only runs with --dry-run");
if (flags.url && !flags.brand) throw new Error("--url needs --brand so the reel knows which look and voice to use");

// One reel per brand. Brands run one after another and independently: if one fails, the rest still post.
const brandIds = flags.brand ? flags.brand.split(",").map((b) => b.trim()).filter(Boolean) : listBrandIds();
const outcomes: Record<string, Outcome> = {};
for (const id of brandIds) outcomes[id] = await runBrand(id);

console.log("\nSummary: " + Object.entries(outcomes).map(([id, o]) => `${id} ${o}`).join(", "));
process.exit(Object.values(outcomes).includes("failed") ? 1 : 0);
