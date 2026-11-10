import { test } from "node:test";
import assert from "node:assert/strict";
import { fillInput, loadAiConfig, videoModel } from "../src/ai/config.ts";
import { flickerScores } from "../src/ai/qc.ts";
import { loadBrand } from "../src/lib/brand.ts";

test("ai.json loads and every preset has a price and a prompt slot", () => {
  const cfg = loadAiConfig();
  assert.ok(videoModel(cfg).id);
  for (const [name, m] of Object.entries(cfg.videoModels)) {
    assert.ok(m.usdPerSecond > 0, `${name} price`);
    assert.ok(JSON.stringify(m.input).includes("{prompt}") && JSON.stringify(m.input).includes("{image}"), `${name} input`);
  }
});

test("input templates are filled, including nested lists", () => {
  const out = fillInput({ prompt: "{prompt}", image_urls: ["{image}"], duration: 5, note: "a {prompt} b" }, { prompt: "P", image: "data:x" });
  assert.deepEqual(out, { prompt: "P", image_urls: ["data:x"], duration: 5, note: "a P b" });
});

test("flicker score: a smooth move passes, an oscillating one fails, a hard cut shows as a jump", () => {
  const { maxFlicker, maxJump } = loadAiConfig().qc;
  const smooth = Array.from({ length: 150 }, (_, i) => 100 + i * 0.1 + Math.sin(i / 40) * 3);
  const flicker = smooth.map((v, i) => v + (i % 2 ? 4 : -4));
  const cut = smooth.map((v, i) => (i > 75 ? v + 40 : v));
  assert.ok(flickerScores(smooth).flicker < maxFlicker && flickerScores(smooth).jump < maxJump);
  assert.ok(flickerScores(flicker).flicker > maxFlicker);
  assert.ok(flickerScores(cut).jump > maxJump);
});

test("Verrano AI settings: label, disclosure and call to action", () => {
  const ai = loadBrand("verrano").ai!;
  assert.equal(ai.label, "Visualisation");
  assert.equal(ai.disclosure, "AI visualisation of a Verrano finish.");
  assert.match(ai.cta, /^Send us a photo of your space — we'll show you the result/);
  assert.ok(ai.finishes.length >= 2);
});
