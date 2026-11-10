import { z } from "zod";
import type { Brand } from "../lib/brand.js";
import { generate, llmBackend } from "../lib/llm.js";
import { log, step, warn } from "../lib/log.js";
import { libraryDir, loadLibrary, saveLibrary } from "./library.js";

const BATCH = 8;

const TagSchema = z.object({
  images: z.array(
    z.object({
      file: z.string(),
      description: z.string().describe("One plain sentence on what the photo shows"),
      spaces: z.array(z.string()).describe("Spaces shown, from: cabinets, tea room, meeting room, reception, doors, lifts, bathroom, desks, retail, walls"),
      role: z.enum(["before", "after", "neither"]).describe("Is this clearly a before photo (worn, dated) or an after photo (freshly finished)?"),
      quality: z.enum(["good", "soft", "poor"]).describe("good: sharp and well lit; soft: usable but not crisp; poor: blurry, cluttered or badly lit"),
    }),
  ),
});

/**
 * Have Claude look at every photo in the library and add a description, spaces, a before/after
 * role and a quality grade. Runs on Claude Code (it reads the image files with its Read tool).
 * Photos graded "poor" are left out of reels.
 */
export async function tagLibrary(brand: Brand, { all = false } = {}): Promise<void> {
  if (llmBackend() !== "claude-code") {
    warn("Photo tagging needs the Claude Code backend (it reads the image files); skipped.");
    return;
  }
  const lib = loadLibrary(brand);
  const todo = lib.images.filter((i) => all || !i.description);
  log(`tagging ${todo.length} photos`);
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const result = await step(`tag photos ${i + 1}-${i + chunk.length}`, () =>
      generate({
        label: "photo tags",
        schema: TagSchema,
        system: `You catalogue project photos for ${brand.name}. ${brand.about}`,
        prompt: `Open each of these image files with the Read tool and describe it. Use the context given; never guess a specific finish or product name.

${chunk.map((img) => `- ${img.file} (from ${img.page}; alt "${img.alt}"; heading "${img.heading}")`).join("\n")}

Return one entry per file, using the file path exactly as given.`,
        effort: "low",
        readDir: libraryDir(brand),
        check: (r) => chunk.filter((c) => !r.images.some((x) => x.file === c.file)).map((c) => `Missing entry for ${c.file}`),
      }),
    );
    for (const tag of result.images) {
      const img = lib.images.find((x) => x.file === tag.file);
      if (!img) continue;
      img.description = tag.description;
      img.quality = tag.quality;
      img.spaces = [...new Set([...img.spaces, ...tag.spaces])];
      if (!img.role && tag.role !== "neither") img.role = tag.role;
    }
    saveLibrary(brand, lib);
  }
  const poor = lib.images.filter((i) => i.quality === "poor").length;
  log(`tagged; ${poor} photo(s) graded poor and left out of reels`);
}
