import { pathToFileURL } from "node:url";
import { brandEnv, brandEnvName, loadBrand, type Brand } from "../lib/brand.js";
import { env, requireEnv } from "../lib/env.js";

const BUFFER_API = "https://api.buffer.com";

type Service = "instagram" | "tiktok" | string;

export interface Channel {
  id: string;
  service: Service;
}

/** A brand can use its own Buffer account via BUFFER_ACCESS_TOKEN_<BRAND>; otherwise the shared token. */
export function bufferToken(brand: Brand): string | undefined {
  return brandEnv("BUFFER_ACCESS_TOKEN", brand) ?? env("BUFFER_ACCESS_TOKEN");
}

async function buffer<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!res.ok || !body || body.errors?.length) {
    const detail = body?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
    throw new Error(`Buffer API error: ${detail}`);
  }
  return body.data as T;
}

/** All channels on the Buffer account, for finding the IDs to put in BUFFER_PROFILE_IDS_<BRAND>. */
export async function listChannels(token: string): Promise<(Channel & { name: string })[]> {
  const orgs = await buffer<{ account: { organizations: { id: string }[] } }>(
    token,
    `query { account { organizations { id } } }`,
  );
  const channels: (Channel & { name: string })[] = [];
  for (const org of orgs.account.organizations) {
    const data = await buffer<{ channels: (Channel & { name: string })[] }>(
      token,
      `query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }`,
      { input: { organizationId: org.id } },
    );
    channels.push(...data.channels);
  }
  return channels;
}

/**
 * BUFFER_PROFILE_IDS_<BRAND> is a comma-separated list of channel IDs. An entry may carry
 * its service ("instagram:abc123"); otherwise the service is looked up from the account.
 * There is deliberately no shared fallback, so one brand can never post to another's accounts.
 */
export async function resolveChannels(brand: Brand): Promise<Channel[]> {
  const name = brandEnvName("BUFFER_PROFILE_IDS", brand);
  const entries = (env(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!entries.length) throw new Error(`${name} is empty`);
  const parsed = entries.map((entry) => {
    const [a, b] = entry.split(":");
    return b ? { id: b.trim(), service: a.trim().toLowerCase() } : { id: a, service: "" };
  });
  if (parsed.every((c) => c.service)) return parsed;
  const known = await listChannels(bufferToken(brand)!);
  return parsed.map((c) => {
    if (c.service) return c;
    const match = known.find((k) => k.id === c.id);
    if (!match) throw new Error(`Buffer channel ${c.id} was not found on this account`);
    return { id: c.id, service: match.service.toLowerCase() };
  });
}

/** Schedule the reel on one channel. Returns the Buffer post id. */
export async function schedulePost(
  brand: Brand,
  channel: Channel,
  text: string,
  videoUrl: string,
  dueAt: Date,
): Promise<string> {
  const input: Record<string, unknown> = {
    channelId: channel.id,
    text,
    schedulingType: "automatic", // Buffer publishes it for you, no phone notification
    mode: "customScheduled",
    dueAt: dueAt.toISOString(),
    assets: { videos: [{ url: videoUrl }] },
  };
  if (channel.service === "instagram") {
    input.metadata = { instagram: { type: "reel", shouldShareToFeed: true } };
  }
  const data = await buffer<{
    createPost: { post?: { id: string }; message?: string };
  }>(
    bufferToken(brand)!,
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input },
  );
  const id = data.createPost.post?.id;
  if (!id) throw new Error(`Buffer rejected the ${channel.service} post: ${data.createPost.message ?? "unknown error"}`);
  return id;
}

/** The next occurrence of HH:MM in `timeZone`, at least 15 minutes from now, as a UTC Date. */
export function nextPostTime(time: string, timeZone: string, now = new Date()): Date {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error(`Invalid POST_TIME "${time}"`);
  const parts = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).formatToParts(d).map((x) => [x.type, Number(x.value)]),
    );
    return p as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  };
  const offsetMs = (d: Date) => {
    const p = parts(d);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
  };
  const today = parts(now);
  for (let addDays = 0; addDays < 3; addDays++) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + addDays, hour, minute);
    let utc = wall - offsetMs(new Date(wall));
    utc = wall - offsetMs(new Date(utc)); // second pass settles daylight-saving boundaries
    if (utc - now.getTime() >= 15 * 60_000) return new Date(utc);
  }
  throw new Error("Could not compute the next post time");
}

// `npm run buffer:channels` (add `-- --brand via77` to use that brand's own Buffer token)
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--list-channels")) {
  const brandFlag = process.argv.indexOf("--brand");
  const token = brandFlag > -1 ? bufferToken(loadBrand(process.argv[brandFlag + 1])) : env("BUFFER_ACCESS_TOKEN");
  if (!token) requireEnv(["BUFFER_ACCESS_TOKEN"]);
  const channels = await listChannels(token!);
  for (const c of channels) console.log(`${c.service}:${c.id}  ${c.name}`);
  if (!channels.length) console.log("No channels found on this Buffer account.");
}
