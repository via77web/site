import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDecision, parseDecision } from "../src/approve.ts";
import { activeCampaign, loadCalendar, localDate, slotsFor, zonedTime } from "../src/lib/calendar.ts";
import { assignSlots } from "../src/schedule.ts";
import { postText } from "../src/reels.ts";
import { directionContrastProblems, loadDirections } from "../library/index.ts";
import { specProblems } from "../library/spec.ts";
import onepage from "../library/examples/onepage.json" with { type: "json" };
import store from "../library/examples/store.json" with { type: "json" };
import type { Batch, VariantScript } from "../src/types.ts";

const TZ = "Australia/Melbourne";
const cal = loadCalendar();

test("every design direction passes WCAG AA for its text pairs", () => {
  assert.deepEqual(loadDirections().flatMap(directionContrastProblems), []);
});

test("example specs are valid", () => {
  assert.deepEqual(specProblems(onepage as any, "onepage"), []);
  assert.deepEqual(specProblems(store as any, "store"), []);
});

test("slots: WEBSTAR at 12pm and 6pm, VIA77 at 7pm, Melbourne time across daylight saving", () => {
  const from = new Date("2026-11-10T00:00:00Z"); // 11am AEDT
  const web = slotsFor(cal, "webstar", from, 1).map((d) => d.toISOString());
  assert.deepEqual(web.slice(0, 3), ["2026-11-10T01:00:00.000Z", "2026-11-10T07:00:00.000Z", "2026-11-11T01:00:00.000Z"]);
  const winter = slotsFor(cal, "via77", new Date("2026-06-10T00:00:00Z"), 0).map((d) => d.toISOString());
  assert.deepEqual(winter, ["2026-06-10T09:00:00.000Z"]); // 7pm AEST = UTC+10
});

test("campaigns: Black Friday in late November, New Year wraps past 1 January, none in March", () => {
  assert.equal(activeCampaign(cal, "webstar", zonedTime(2026, 11, 20, "10:00", TZ))?.id, "black-friday");
  assert.equal(activeCampaign(cal, "via77", zonedTime(2027, 1, 5, "10:00", TZ))?.id, "new-year");
  assert.equal(activeCampaign(cal, "via77", zonedTime(2026, 12, 31, "10:00", TZ))?.id, "new-year");
  assert.equal(activeCampaign(cal, "via77", zonedTime(2026, 12, 10, "10:00", TZ))?.id, "christmas");
  assert.equal(activeCampaign(cal, "webstar", zonedTime(2026, 6, 15, "10:00", TZ))?.id, "eofy");
  assert.equal(activeCampaign(cal, "webstar", zonedTime(2026, 3, 15, "10:00", TZ)), undefined);
});

test("scheduling: a site never posts twice in a day or twice in a row", () => {
  const slots = slotsFor(cal, "webstar", new Date("2026-11-10T00:00:00Z"), 5);
  const v = ["full", "detail", "before-after", "interaction"] as const;
  const candidates = [...v.map((variant) => ({ batch: "A", variant })), ...v.map((variant) => ({ batch: "B", variant }))];
  const placed = assignSlots(slots, [], candidates, TZ);
  assert.equal(placed.length, 8);
  for (let i = 1; i < placed.length; i++) assert.notEqual(placed[i].batch, placed[i - 1].batch, "back-to-back");
  const days = new Map<string, number>();
  for (const p of placed) {
    const k = `${p.batch}-${localDate(p.at, TZ)}`;
    days.set(k, (days.get(k) ?? 0) + 1);
  }
  assert.ok([...days.values()].every((n) => n === 1), "same site twice in a day");
});

test("scheduling: one site alone still gets all its reels out, one per day", () => {
  const slots = slotsFor(cal, "webstar", new Date("2026-11-10T00:00:00Z"), 7);
  const v = ["full", "detail", "before-after", "interaction"] as const;
  const placed = assignSlots(slots, [], v.map((variant) => ({ batch: "A", variant })), TZ);
  assert.equal(placed.length, 4);
  assert.equal(new Set(placed.map((p) => localDate(p.at, TZ))).size, 4);
});

test("scheduling: the tail of a batch is not stranded once other sites run out", () => {
  const slots = slotsFor(cal, "webstar", new Date("2026-11-10T00:00:00Z"), 10);
  const v = ["full", "detail", "before-after", "interaction"] as const;
  const candidates = [...v.map((variant) => ({ batch: "A", variant })), ...v.slice(0, 2).map((variant) => ({ batch: "B", variant }))];
  assert.equal(assignSlots(slots, [], candidates, TZ).length, 6);
});

test("approval commands", () => {
  assert.deepEqual(parseDecision("/approve all"), { action: "approve", variants: [] });
  assert.deepEqual(parseDecision("Looks good!\n/approve full, detail"), { action: "approve", variants: ["full", "detail"] });
  assert.deepEqual(parseDecision("/reject"), { action: "reject", variants: [] });
  assert.equal(parseDecision("/approve fulll"), null);
  assert.equal(parseDecision("nice work"), null);

  const batch = {
    variants: (["full", "detail", "before-after", "interaction"] as const).map((id) => ({ id, status: "awaiting" })),
  } as unknown as Batch;
  applyDecision(batch, { action: "approve", variants: ["full", "interaction"] });
  assert.deepEqual(batch.variants.map((v) => v.status), ["approved", "rejected", "rejected", "approved"]);
  assert.ok(batch.decidedAt);
});

test("concept sites are labelled in every caption", () => {
  const s = { postCaption: "Bread worth getting up for.", hashtags: ["webdesign", "WebDesign"] } as VariantScript;
  assert.equal(postText(s, true), "Concept · Bread worth getting up for.\n\n#webdesign");
  assert.equal(postText({ ...s, postCaption: "Concept store for a bakery." }, true).startsWith("Concept store"), true);
  assert.equal(postText(s, false).startsWith("Bread"), true);
});
