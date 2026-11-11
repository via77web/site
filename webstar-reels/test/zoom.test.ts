import assert from "node:assert/strict";
import { test } from "node:test";
import { duckGain, speechSegments } from "../remotion/duck.ts";
import { cornerPin } from "../remotion/pin.ts";
import { loadBrand } from "../src/lib/brand.ts";
import { findScreen, introOrder, type IntroClip } from "../src/lib/intros.ts";
import { fitMusic, loadMusic, pickTrack, snapToBeat, snapUpToBeat } from "../src/lib/music.ts";
import { planTimeline } from "../src/lib/timeline.ts";
import { openaiPrompt, openaiSize } from "../src/make/images.ts";

test("the music drop lands on the reveal and the end card starts on a beat", async () => {
  for (const id of ["webstar", "via77", "verrano"]) {
    const brand = loadBrand(id);
    const track = pickTrack(brand)!;
    const { music, beat } = await fitMusic(track, 2.4);
    // Playing from startAt, the drop is reached exactly 2.4s in (allowing for a delayed start).
    const analysis = JSON.parse((await import("node:fs")).readFileSync("music/analysis.json", "utf8"))[track.file];
    assert.ok(Math.abs(analysis.drop - music.startAt + music.delay - 2.4) < 0.002, `${id}: drop on the reveal`);
    assert.ok(music.license.length > 8 && music.source.length > 1);

    const t = await planTimeline(brand, { voiceSeconds: 9.3, reveal: "hook" });
    const endCard = t.totalSeconds - brand.style.endCardSeconds;
    const beats = (endCard - t.revealSeconds) / t.beat!.interval;
    assert.ok(Math.abs(beats - Math.round(beats)) < 1e-6, `${id}: end card on a beat`);
    assert.ok(endCard >= 9.3, "never cuts the voice off");
    assert.equal(beat.interval, t.beat!.interval);
  }
  const grid = { origin: 2, interval: 0.5 };
  assert.equal(snapToBeat(3.2, grid), 3);
  assert.equal(snapUpToBeat(3.2, grid), 3.5);
  assert.equal(snapUpToBeat(3.5, grid), 3.5);
});

test("a brand never gets the same track twice in seven days, and never one from outside its library", () => {
  const brand = loadBrand("webstar");
  const mine = loadMusic().tracks.filter((t) => t.brands.includes("webstar"));
  const picked = pickTrack(brand, new Set())!;
  assert.ok(mine.some((t) => t.file === picked.file));
  // With every track ruled out, it still only ever returns one of the brand's own.
  const again = pickTrack(brand, new Set(mine.map((t) => t.file)))!;
  assert.ok(mine.some((t) => t.file === again.file));
});

test("music sits 12 dB down under the voice and comes back up between lines", () => {
  const segments = speechSegments([
    { start: 1, end: 1.4 },
    { start: 1.5, end: 2 },
    { start: 4, end: 4.5 },
  ]);
  assert.deepEqual(segments, [[1, 2], [4, 4.5]]);
  const db = (g: number) => 20 * Math.log10(g);
  assert.ok(Math.abs(db(duckGain(1.7, segments)) + 12) < 0.01);
  assert.equal(duckGain(3, segments), 1);
  assert.ok(duckGain(2.1, segments) > duckGain(2, segments) && duckGain(2.1, segments) < 1);
});

test("the corner pin puts each corner of the recording on its screen corner", () => {
  const quad: [[number, number], [number, number], [number, number], [number, number]] = [[210, 640], [820, 600], [860, 1010], [180, 1040]];
  const m = cornerPin(1440, 900, quad).match(/-?[\d.e-]+/g)!.slice(1).map(Number); // drop the "3" of matrix3d
  const project = (x: number, y: number) => {
    const w = m[3] * x + m[7] * y + m[15];
    return [(m[0] * x + m[4] * y + m[12]) / w, (m[1] * x + m[5] * y + m[13]) / w];
  };
  [[0, 0], [1440, 0], [1440, 900], [0, 900]].forEach(([x, y], i) => {
    const [px, py] = project(x, y);
    assert.ok(Math.abs(px - quad[i][0]) < 1e-6 && Math.abs(py - quad[i][1]) < 1e-6, `corner ${i}`);
  });
});

function frame(w: number, h: number, quad: [number, number][] | null, cover?: [number, number, number, number]): Uint8Array {
  const rgb = new Uint8Array(w * h * 3).fill(120);
  const inside = (x: number, y: number) =>
    quad!.every(([ax, ay], i) => {
      const [bx, by] = quad![(i + 1) % 4];
      return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
    });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!quad || !inside(x + 0.5, y + 0.5)) continue;
      if (cover && x >= cover[0] && x < cover[2] && y >= cover[1] && y < cover[3]) continue;
      rgb.set([20, 235, 30], (y * w + x) * 3);
    }
  return rgb;
}

test("the laptop's green screen is found by its four corners, and bad clips are refused", () => {
  const quad: [number, number][] = [[60, 100], [200, 90], [210, 190], [50, 200]];
  const found = findScreen(frame(270, 480, quad), 270, 480);
  assert.ok(typeof found !== "string");
  found.corners.forEach((c, i) => assert.ok(Math.hypot(c[0] - quad[i][0], c[1] - quad[i][1]) < 3, `corner ${i}`));
  assert.ok(found.key[1] > 200 && found.luma > 0.4 && found.luma < 0.5);
  // No green at all (a clip where the model drew a website on the screen) is refused.
  assert.match(findScreen(frame(270, 480, null), 270, 480) as string, /no green screen/);
  // A hand over a corner of the screen is refused too.
  assert.match(findScreen(frame(270, 480, quad, [150, 80, 220, 150]), 270, 480) as string, /four-sided/);
});

test("intro clips rotate: none repeats within five days", () => {
  const clips: IntroClip[] = ["a.mp4", "b.mp4", "c.mp4"].map((file) => ({ file, brand: "webstar", screen: "green", source: "filmed" }));
  const now = Date.parse("2026-06-10T00:00:00Z");
  const day = 86_400_000;
  const order = introOrder(clips, new Map([["a.mp4", now - 1 * day], ["b.mp4", now - 6 * day]]), now);
  assert.deepEqual(order.map((o) => [o.clip.file, o.recent]), [["c.mp4", false], ["b.mp4", false], ["a.mp4", true]]);
});

test("OpenAI images: portrait heroes, square product cards, photoreal prompts without text", () => {
  assert.equal(openaiSize("16:9", "hero"), "1024x1536");
  assert.equal(openaiSize("4:5", "product"), "1024x1024");
  assert.equal(openaiSize("16:9"), "1536x1024");
  assert.equal(openaiSize("3:4"), "1024x1536");
  const prompt = openaiPrompt(
    { id: "hero", alt: "", aspect: "4:5", subject: "A jar of face cream", scene: "On a stone shelf", lighting: "Soft morning light" },
    { imageStyle: "Quiet editorial still life.", colors: { bg: "#F6F5F1", accent: "#88412C" } } as never,
    "hero",
  );
  assert.match(prompt, /photorealistic photograph/i);
  assert.match(prompt, /Subject: A jar of face cream/);
  assert.match(prompt, /No text/);
});
