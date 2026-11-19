import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

const WEAK_VERBS = new Set(["helped", "worked", "did", "made", "responsible", "tasked", "involved", "assisted"]);
const BUZZWORDS = new Set(["synergy", "rockstar", "ninja", "guru", "leverage", "go-getter", "results-driven"]);

function issuesFor(line: string): string[] {
  const words = line.toLowerCase().split(/\s+/);
  const out: string[] = [];
  if (words.some(w => WEAK_VERBS.has(w))) out.push("weak verb");
  if (words.some(w => BUZZWORDS.has(w))) out.push("buzzword");
  if (!/\d/.test(line)) out.push("no quantification");
  if (words.length < 6) out.push("too short");
  return out;
}

export default defineTool({
  name: "roast_resume",
  title: "Roast Resume",
  description: "Analyse resume bullets for weak verbs, buzzwords, missing quantification, and terseness. Returns a critique with flagged bullets.",
  inputSchema: {
    resume: z.string().min(20).max(50_000).describe("Resume text — bullets separated by newlines."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ resume }) => {
    const lines = resume.split("\n").map(l => l.replace(/^[•\-*\s\t]+/, "").trim()).filter(Boolean);
    const flawed = lines.map(text => ({ text, issues: issuesFor(text) })).filter(b => b.issues.length > 0);
    const verdict = flawed.length > lines.length / 2 ? "Brutal — most bullets need rework." : "Solid foundation, needs sharpening.";
    const summary = `${verdict}\n${flawed.length}/${lines.length} bullets flagged.\n\n` +
      flawed.slice(0, 10).map(b => `• ${b.text}\n  → ${b.issues.join(", ")}`).join("\n");
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { critique: verdict, flawed_bullets: flawed, total: lines.length },
    };
  },
});
