import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadDirections } from "../library/index.ts";
import { renderOnePage } from "../library/layouts/onepage.ts";
import onepage from "../library/examples/onepage.json" with { type: "json" };
import { loadBrand } from "../src/lib/brand.ts";
import { briefProblems, toDirection, type MoodBrief } from "../src/refs/analyse.ts";
import { findReferences } from "../src/refs/resolve.ts";
import { prepareReferences } from "../src/refs/sync.ts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "refs-test-"));
const webstar = loadBrand("webstar");
const png = (file: string, color: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=64x96`, "-frames:v", "1", file]);
};

before(() => (process.env.REFERENCES_DIR = ROOT));
after(() => {
  delete process.env.REFERENCES_DIR;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

test("references: project folder, then the brand's moodboard, then nothing (and a folder to fill)", async () => {
  const none = await findReferences(webstar, "A dog groomer in Geelong");
  assert.equal(none.count, 0);
  assert.ok(fs.existsSync(path.join(ROOT, "a-dog-groomer-in-geelong")), "creates the folder to drop images into");

  png(path.join(ROOT, "webstar", "mood.png"), "red");
  const brand = await findReferences(webstar, "A dog groomer in Geelong");
  assert.deepEqual([brand.from, brand.count, brand.project], ["brand", 1, "webstar"]);

  png(path.join(ROOT, "a-dog-groomer-in-geelong", "pin.png"), "blue");
  fs.writeFileSync(path.join(ROOT, "a-dog-groomer-in-geelong", "brief.md"), "not an image");
  const own = await findReferences(webstar, "A dog groomer in Geelong");
  assert.deepEqual([own.from, own.count], ["project", 1]);

  const named = await findReferences(webstar, "anything", "webstar");
  assert.deepEqual([named.from, named.count], ["named", 1]);
});

test("references: the hash changes when an image is added", async () => {
  const dir = path.join(ROOT, "hash");
  png(path.join(dir, "a.png"), "green");
  const one = await prepareReferences(dir, "hash-test");
  png(path.join(dir, "b.png"), "yellow");
  const two = await prepareReferences(dir, "hash-test");
  assert.equal(one.count, 1);
  assert.equal(two.count, 2);
  assert.notEqual(one.hash, two.hash);
  fs.rmSync(two.cacheDir, { recursive: true, force: true });
});

const brief = (over: Partial<MoodBrief["direction"]> = {}): MoodBrief =>
  ({
    feel: "Calm.",
    emotion: ["calm"],
    layoutPatterns: [],
    grid: "",
    spacing: "",
    typeStyle: "",
    palette: [],
    imageryStyle: "",
    motionCues: [],
    standoutComponents: [],
    direction: {
      name: "Quiet Clay",
      mood: "Soft.",
      colors: { bg: "#F6F5F1", bg2: "#ECEAE3", ink: "#20221F", muted: "#5E6159", accent: "#88412C", accentInk: "#F6F5F1" },
      displayFont: "Fraunces",
      displayWeight: 500,
      bodyFont: "Inter",
      displayCase: "none",
      displayTracking: "-0.01em",
      radius: 12,
      motionScale: 1.2,
      primaryEase: "build",
      signatureMoves: [],
      imageStyle: "Soft daylight.",
      ...over,
    },
    components: { nav: "pill", hero: "type", services: "list", gallery: "strip", cta: "band", standouts: ["badge"] },
    componentsToBuild: [],
  }) as MoodBrief;

test("a derived direction must use allowed fonts, real weights and readable colours", () => {
  assert.deepEqual(briefProblems(brief(), webstar, "onepage", "t"), []);
  assert.match(briefProblems(brief({ displayFont: "Helvetica Neue" }), webstar, "onepage", "t").join(" "), /not in the allowed font list/);
  assert.match(briefProblems(brief({ displayWeight: 900 }), webstar, "onepage", "t").join(" "), /no weight 900/);
  assert.match(briefProblems(brief({ bodyFont: "Caveat" }), webstar, "onepage", "t").join(" "), /body font/);
  const pale = brief();
  pale.direction.colors.muted = "#C9C8C2";
  assert.match(briefProblems(pale, webstar, "onepage", "t").join(" "), /muted on bg/);
});

test("the component recipe changes the page that is built", () => {
  const d = toDirection(brief(), webstar, "onepage", "t");
  assert.equal(d.id, "ref-t");
  const images = Object.fromEntries((onepage as any).images.map((i: any) => [i.id, `img/${i.id}.svg`]));
  const custom = renderOnePage(onepage as any, d, { brandName: "WEBSTAR", images }).files["index.html"];
  for (const cls of ["nav--pill", "hero--type", "svc-list", "gal--strip", "cta-band", 'class="badge"']) assert.ok(custom.includes(cls), cls);
  assert.ok(!custom.includes('class="tabs"'));

  const plain = renderOnePage(onepage as any, loadDirections().find((x) => x.id === "sunny-bold")!, { brandName: "WEBSTAR", images }).files["index.html"];
  assert.ok(plain.includes('class="tabs"') && !plain.includes("nav--pill"));
});
