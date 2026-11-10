import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ROOT } from "./brand.js";

const mmdd = z.string().regex(/^\d{2}-\d{2}$/, "expected MM-DD");
const time = z.string().regex(/^\d{1,2}:\d{2}$/, "expected HH:MM");

const CalendarSchema = z.object({
  timezone: z.string(),
  brands: z.record(
    z.string(),
    z.object({
      /** Local posting times, every day. */
      slots: z.array(time).min(1),
      /** Days of the week to post on (0 = Sunday). Default: every day. */
      days: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
      /** Site brands: when the queue runs dry, the weekly job makes concept sites from campaign or backlog briefs. */
      autoMake: z.boolean().default(true),
    }),
  ),
  campaigns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** Inclusive local date range. May wrap past New Year (e.g. 12-26 to 01-15). */
      from: mmdd,
      to: mmdd,
      angle: z.string(),
      hashtags: z.array(z.string()).default([]),
      hooks: z.record(z.string(), z.array(z.string())).default({}),
      briefs: z.record(z.string(), z.array(z.string())).default({}),
    }),
  ),
});

export type Calendar = z.infer<typeof CalendarSchema>;
export type Campaign = Calendar["campaigns"][number];

export function loadCalendar(): Calendar {
  const parsed = CalendarSchema.safeParse(JSON.parse(fs.readFileSync(path.join(ROOT, "calendar.json"), "utf8")));
  if (!parsed.success) throw new Error(`calendar.json is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

type Parts = Record<"year" | "month" | "day" | "hour" | "minute" | "second" | "weekday", number>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(d: Date, timeZone: string): Parts {
  const raw = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(raw.year),
    month: Number(raw.month),
    day: Number(raw.day),
    hour: Number(raw.hour),
    minute: Number(raw.minute),
    second: Number(raw.second),
    weekday: WEEKDAYS.indexOf(String(raw.weekday).slice(0, 3)),
  };
}

/** UTC instant of a wall-clock time in `timeZone`. Handles daylight saving. */
export function zonedTime(year: number, month: number, day: number, hhmm: string, timeZone: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at: number) => {
    const p = zonedParts(new Date(at), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
  };
  let utc = wall - offset(wall);
  utc = wall - offset(utc); // second pass settles daylight-saving boundaries
  return new Date(utc);
}

/** YYYY-MM-DD in `timeZone`. */
export function localDate(d: Date, timeZone: string): string {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Every posting slot for a brand from `from` (plus a 15 minute safety margin) for `days` days. */
export function slotsFor(cal: Calendar, brandId: string, from: Date, days: number): Date[] {
  const cfg = cal.brands[brandId];
  if (!cfg) throw new Error(`calendar.json has no slots for brand "${brandId}"`);
  const earliest = from.getTime() + 15 * 60_000;
  const start = zonedParts(from, cal.timezone);
  const slots: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const noon = zonedTime(start.year, start.month, start.day + i, "12:00", cal.timezone);
    const p = zonedParts(noon, cal.timezone);
    if (!cfg.days.includes(p.weekday)) continue;
    for (const t of [...cfg.slots].sort()) {
      const at = zonedTime(p.year, p.month, p.day, t, cal.timezone);
      if (at.getTime() >= earliest) slots.push(at);
    }
  }
  return slots;
}

/** The campaign running on `date` for a brand, if any. The first match in calendar.json wins. */
export function activeCampaign(cal: Calendar, brandId: string, date = new Date()): Campaign | undefined {
  const p = zonedParts(date, cal.timezone);
  const today = `${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return cal.campaigns.find((c) => {
    const inRange = c.from <= c.to ? today >= c.from && today <= c.to : today >= c.from || today <= c.to;
    return inRange && ((c.hooks[brandId]?.length ?? 0) > 0 || (c.briefs[brandId]?.length ?? 0) > 0);
  });
}
