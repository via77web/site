import { test } from "node:test";
import assert from "node:assert/strict";
import { attribute, decide, scoreReels, weightedSequence, type ReelResult } from "../src/learn.ts";
import { loadBrand } from "../src/lib/brand.ts";
import { loadMusic, pickTrack } from "../src/lib/music.ts";
import { hookRotation } from "../src/lib/queue.ts";
import { captionFor, reelId, trackedLink } from "../src/lib/tracking.ts";
import { readMetrics } from "../src/steps/post.ts";
import type { Batch } from "../src/types.ts";

const reel = (over: Partial<ReelResult>): Omit<ReelResult, "score"> => ({
  id: "r", title: "t", variant: "full", hook: "h", day: "2026-11-01", clicks: 0, enquiries: 0, deposits: 0, assumed: 0, ...over,
});

test("Buffer metric names are sorted into views, watch time, shares, reactions, comments", () => {
  assert.deepEqual(
    readMetrics([
      { type: "impressions", name: "Impressions", value: 900 },
      { type: "views", name: "Video views", value: 1200 },
      { type: "reposts", name: "Shares", value: 14 },
      { type: "reactions", name: "Likes", value: 80 },
      { type: "comments", name: "Comments", value: 6 },
      { type: "watch_time", name: "Watch time", value: 3, unit: "minutes" },
    ]),
    { views: 1200, shares: 14, reactions: 80, comments: 6, watchSeconds: 180 },
  );
});

test("leads: a reel's own link credits it; bio and DM clicks go to the latest reel at the time", () => {
  const reels = [
    { id: "a", brand: "webstar", at: Date.parse("2026-11-01T07:00:00Z") },
    { id: "b", brand: "webstar", at: Date.parse("2026-11-03T07:00:00Z") },
  ];
  const e = (type: any, reel_id: string | null, created_at: string, brand = "webstar") => ({ type, reel_id, created_at, brand, link_id: null, amount_cents: null });
  const t = attribute(reels, [
    e("click", "a", "2026-11-04T00:00:00Z"),
    e("click", null, "2026-11-02T00:00:00Z"), // bio click while only "a" was out
    e("enquiry", null, "2026-11-05T00:00:00Z"), // DM enquiry after "b"
    e("deposit", "b", "2026-11-06T00:00:00Z"),
    e("click", null, "2026-10-01T00:00:00Z"), // before any reel: dropped
    e("click", null, "2026-11-05T00:00:00Z", "via77"), // another brand: dropped
  ]);
  assert.deepEqual(t.get("a"), { clicks: 2, enquiries: 0, deposits: 0, assumed: 1 });
  assert.deepEqual(t.get("b"), { clicks: 0, enquiries: 1, deposits: 1, assumed: 1 });
});

test("scores compare reels on the signals that exist, and ignore ones nobody has", () => {
  const [a, b] = scoreReels([reel({ id: "a", clicks: 10, enquiries: 2 }), reel({ id: "b", clicks: 5, enquiries: 0 })]);
  assert.equal(a.score, 100);
  assert.equal(b.score, 25); // half the clicks, none of the enquiries, equal weight
  assert.equal(scoreReels([reel({})])[0].score, 0);
});

test("learning: top 20% of hooks win, bottom 20% retire, and never below ten active hooks", () => {
  const hooks = Array.from({ length: 15 }, (_, i) => `hook ${i}`);
  const results = scoreReels(hooks.slice(0, 10).map((hook, i) => reel({ id: `r${i}`, hook, clicks: 100 - i * 10 })));
  const l = decide(results, hooks);
  const by = (s: string) => Object.entries(l.hooks).filter(([, h]) => h.status === s).map(([k]) => k);
  assert.deepEqual(by("winner"), ["hook 0", "hook 1"]);
  assert.deepEqual(by("retired"), ["hook 8", "hook 9"]);

  // With only 11 hooks, just one may go.
  const few = decide(results, hooks.slice(0, 11));
  assert.equal(Object.values(few.hooks).filter((h) => h.status === "retired").length, 1);
  // Too few results: nothing changes.
  const early = decide(results.slice(0, 4), hooks);
  assert.ok(Object.values(early.hooks).every((h) => h.status === "active"));
  // No data at all (every score 0): a tie decides nothing.
  const flat = decide(scoreReels(hooks.slice(0, 10).map((hook, i) => reel({ id: `z${i}`, hook }))), hooks);
  assert.ok(Object.values(flat.hooks).every((h) => h.status === "active"));
  // Retired hooks stay retired next week.
  const next = decide(results.slice(0, 6), hooks, l);
  assert.equal(next.hooks["hook 9"].status, "retired");
});

test("hook rotation drops retired hooks and gives winners a second turn, apart from the first", () => {
  const hooks = ["a", "b", "c", "d", "e", "f"];
  const rot = hookRotation(hooks, { hooks: { a: { status: "winner" }, f: { status: "retired" } } });
  assert.ok(!rot.includes("f"));
  assert.equal(rot.filter((h) => h === "a").length, 2);
  assert.ok(rot.lastIndexOf("a") - rot.indexOf("a") >= 2);
  assert.deepEqual(hookRotation(hooks, undefined), hooks);
});

test("formats: an even rotation by default, favoured formats more often", () => {
  const even = weightedSequence(["full", "detail", "before-after", "interaction"], {}, 8);
  assert.deepEqual(even.slice(0, 4).sort(), ["before-after", "detail", "full", "interaction"]);
  const biased = weightedSequence(["full", "detail", "before-after", "interaction"], { detail: 1.5, full: 0.5 }, 28);
  const n = (v: string) => biased.filter((x) => x === v).length;
  assert.ok(n("detail") > n("interaction") && n("interaction") > n("full"));
  assert.ok(n("full") >= 1, "the weakest format is used less, not dropped");
});

test("tracked links and per-platform captions", () => {
  const brand = loadBrand("webstar");
  const batch = { id: "webstar-2026-11-12-crumb-co" } as Batch;
  const v: any = { id: "detail", hookSource: "Your website has 3 seconds. This one wins", script: { hook: "x" }, postText: `Concept · Bread.\n\n${brand.commentPrompt}\n\n#webdesign` };
  const at = new Date("2026-11-12T07:00:00Z");
  assert.equal(reelId(batch, v), "webstar-2026-11-12-crumb-co--detail");

  delete process.env.TRACK_BASE_URL;
  const direct = new URL(trackedLink(brand, batch, v, "tiktok", at));
  assert.equal(direct.origin + direct.pathname, brand.link);
  assert.deepEqual(
    Object.fromEntries(direct.searchParams),
    { utm_source: "tiktok", utm_medium: "reel", utm_campaign: "webstar-2026-11-12", utm_content: "detail", utm_term: "your-website-has-3-seconds-this-one-wins", r: "webstar-2026-11-12-crumb-co--detail" },
  );
  process.env.TRACK_BASE_URL = "https://x.supabase.co/functions/v1/go/";
  assert.equal(trackedLink(brand, batch, v, "youtube", at), "https://x.supabase.co/functions/v1/go/webstar-2026-11-12-crumb-co--detail?p=yt");

  // Instagram keeps the comment prompt; TikTok and YouTube get the link in its place.
  assert.ok(captionFor("instagram", brand, batch, v, at).includes("Comment WEBSITE"));
  const yt = captionFor("youtube", brand, batch, v, at);
  assert.ok(!yt.includes("Comment WEBSITE") && yt.includes("/go/webstar-2026-11-12-crumb-co--detail?p=yt") && yt.endsWith("#webdesign"));
  delete process.env.TRACK_BASE_URL;
});

test("every brand has a comment keyword and a licensed, royalty-free track in its mood", () => {
  const expected: Record<string, string> = { webstar: "WEBSITE", via77: "STORE", verrano: "QUOTE" };
  const { tracks } = loadMusic();
  assert.ok(tracks.every((t) => t.royaltyFree && t.license.length > 8));
  for (const [id, keyword] of Object.entries(expected)) {
    const brand = loadBrand(id);
    assert.equal(brand.commentKeyword, keyword);
    assert.ok(brand.commentPrompt.includes(`Comment ${keyword}`));
    const track = pickTrack(brand, 0);
    assert.ok(track && track.moods.some((m) => brand.musicMoods.includes(m)), `${id} has a track in its mood`);
  }
});
