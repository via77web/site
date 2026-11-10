import fs from "node:fs";
import { brandEnv, type Brand } from "../lib/brand.js";
import { env } from "../lib/env.js";
import { mediaDuration, run } from "../lib/exec.js";
import type { WordTiming } from "../types.js";

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** ElevenLabs returns per-character timings; captions need per-word. */
export function alignmentToWords(a: Alignment): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { word: "", start: a.character_start_times_seconds[i], end: 0 };
    current.word += ch;
    current.end = a.character_end_times_seconds[i];
  });
  if (current) words.push(current);
  return words;
}

export async function synthesizeVoice(
  text: string,
  outFile: string,
  brand: Brand,
): Promise<{ words: WordTiming[]; duration: number }> {
  const voiceId = brandEnv("ELEVENLABS_VOICE_ID", brand)!;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": env("ELEVENLABS_API_KEY")!, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: env("ELEVENLABS_MODEL_ID") ?? "eleven_multilingual_v2",
        voice_settings: {
          stability: brand.voice.stability,
          similarity_boost: brand.voice.similarityBoost,
          style: brand.voice.style,
          speed: brand.voice.speed,
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs returned ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    audio_base64: string;
    alignment: Alignment | null;
    normalized_alignment?: Alignment | null;
  };
  const alignment = data.alignment ?? data.normalized_alignment;
  if (!data.audio_base64 || !alignment) {
    throw new Error("ElevenLabs response had no audio or no word timestamps");
  }
  fs.writeFileSync(outFile, Buffer.from(data.audio_base64, "base64"));
  return { words: alignmentToWords(alignment), duration: await mediaDuration(outFile) };
}

/** Silent track with evenly paced word timings for --mock runs. */
export async function mockVoice(
  text: string,
  outFile: string,
  brand: Brand,
): Promise<{ words: WordTiming[]; duration: number }> {
  const tokens = text.trim().split(/\s+/);
  const perWord = 0.37 / brand.voice.speed;
  const words = tokens.map((word, i) => ({ word, start: i * perWord, end: (i + 1) * perWord - 0.04 }));
  const duration = tokens.length * perWord + 0.3;
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", duration.toFixed(2), "-c:a", "libmp3lame", "-b:a", "64k", outFile,
  ]);
  return { words, duration };
}
