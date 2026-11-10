import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { reelSeconds, END_CARD_SECONDS } from "../remotion/timing.js";
import { env, requireEnv } from "./lib/env.js";
import {
  MAX_ATTEMPTS, ROOT, dayNumber, hookForDay, loadSites, nextPending, saveSites, slugify,
} from "./lib/queue.js";
import { nextPostTime, resolveChannels, schedulePost } from "./steps/post.js";
import { publishVideo } from "./steps/publish.js";
import { openSite } from "./steps/record.js";
import { renderReel } from "./steps/render.js";
import { mockScript, writeScript } from "./steps/script.js";
import { mockVoice, synthesizeVoice } from "./steps/voice.js";
import type { Site } from "./types.js";

const { values: flags } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    mock: { type: "boolean", default: false },
    url: { type: "string" },
    name: { type: "string" },
    niche: { type: "string" },
  },
});
const dryRun = flags["dry-run"];
const mock = flags.mock;

if (mock && !dryRun) throw new Error("--mock produces a silent placeholder reel, so it only runs with --dry-run");

const sites = loadSites();
// --url renders a one-off reel for any site without touching the queue (dry-run only).
const adHoc = flags.url && !sites.some((s) => s.url === flags.url);
if (adHoc && !dryRun) throw new Error("--url for a site that is not in sites.json only works with --dry-run");

const site: Site | undefined = flags.url
  ? sites.find((s) => s.url === flags.url) ?? {
      url: flags.url,
      name: flags.name ?? new URL(flags.url).hostname,
      niche: flags.niche ?? "business",
      status: "pending",
    }
  : nextPending(sites);

if (!site) {
  console.log('Nothing to do: no site in sites.json has status "pending".');
  process.exit(0);
}

if (!mock) requireEnv(["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]);
if (!dryRun) requireEnv(["BUFFER_ACCESS_TOKEN", "BUFFER_PROFILE_IDS"]);

const day = site.day ?? dayNumber(sites);
const tag = `day-${String(day).padStart(3, "0")}-${slugify(site.name)}`;
const workDir = path.join(ROOT, "out", tag);
fs.mkdirSync(workDir, { recursive: true });
const file = (name: string) => path.join(workDir, name);

console.log(`Day ${day}: ${site.name} (${site.url})${dryRun ? " [dry run]" : ""}${mock ? " [mock]" : ""}`);

try {
  console.log("1/5 Opening site");
  const session = await openSite(site.url);
  let script, voice, total;
  try {
    console.log("2/5 Writing script");
    const hook = hookForDay(day, site);
    script = mock ? mockScript(site, hook) : await writeScript(site, day, hook, session.pageInfo);
    fs.writeFileSync(file("script.json"), JSON.stringify(script, null, 2));
    console.log(`   hook: ${script.hook}`);

    console.log("3/5 Generating voiceover");
    voice = mock
      ? await mockVoice(script.voiceover, file("voice.mp3"))
      : await synthesizeVoice(script.voiceover, file("voice.mp3"));
    fs.writeFileSync(file("words.json"), JSON.stringify(voice.words, null, 2));

    // Record last, at the exact reel length, so the scroll fits the voiceover with no speed change.
    total = reelSeconds(voice.duration);
    console.log(`4/5 Recording ${total.toFixed(1)}s scroll`);
    await session.record(file("recording.mp4"), { duration: total, footerHold: END_CARD_SECONDS });
  } finally {
    await session.close();
  }

  console.log("5/5 Rendering reel");
  const reelFile = file(`${tag}.mp4`);
  await renderReel(
    {
      recordingFile: file("recording.mp4"),
      recordingDuration: total,
      voiceFile: file("voice.mp3"),
      voiceDuration: voice.duration,
      hook: script.hook,
      captions: script.captions,
      words: voice.words,
      cta: script.cta,
    },
    reelFile,
  );
  console.log(`Reel: ${path.relative(process.cwd(), reelFile)}`);

  const postText = `${script.postCaption}\n\n${script.hashtags.map((h) => `#${h}`).join(" ")}`;
  fs.writeFileSync(file("caption.txt"), postText + "\n");

  if (dryRun) {
    console.log("Dry run: not posting. Caption that would be used:\n" + postText);
  } else {
    const dueAt = nextPostTime(env("POST_TIME"), env("POST_TIMEZONE"));
    const channels = await resolveChannels();
    console.log(`Scheduling for ${dueAt.toISOString()} on ${channels.map((c) => c.service).join(", ")}`);
    const videoUrl = await publishVideo(reelFile, tag);

    // Save after each channel so a retry never double-posts one that already went through.
    site.day = day;
    site.videoUrl = videoUrl;
    site.posts ??= {};
    for (const channel of channels) {
      if (site.posts[channel.id]) continue;
      site.posts[channel.id] = await schedulePost(channel, postText, videoUrl, dueAt);
      saveSites(sites);
      console.log(`   scheduled on ${channel.service}: ${site.posts[channel.id]}`);
    }
    site.status = "posted";
    site.scheduledFor = dueAt.toISOString();
    site.postedAt = new Date().toISOString();
    delete site.lastError;
    saveSites(sites);
    console.log("Done.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!dryRun) {
    // Stay "pending" so tomorrow's run retries; give up after MAX_ATTEMPTS so the queue keeps moving.
    site.attempts = (site.attempts ?? 0) + 1;
    site.lastError = message;
    if (site.attempts >= MAX_ATTEMPTS) site.status = "failed";
    saveSites(sites);
  }
  console.error(`Failed: ${message}`);
  process.exit(1);
}
