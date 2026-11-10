/** Escape text for HTML content and attributes. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Escape, then turn *phrase* into <em>phrase</em>. */
export function emphasis(text: string): string {
  return esc(text).replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export const plain = (text: string) => text.replace(/\*/g, "");

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

export function money(n: number, cur = "A$"): string {
  return cur + (n % 1 ? n.toFixed(2) : n.toLocaleString("en-AU"));
}
