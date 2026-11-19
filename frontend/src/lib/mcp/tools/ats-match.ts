import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

const STOPWORDS = new Set("a an the and or but if then of in on for to with from by at as is are was were be been being have has had do does did this that these those i you we they it not no s t can will just should now into about above below over under more most less many much some any all your our their".split(" "));

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function tf(tokens: string[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const t of tokens) c[t] = (c[t] ?? 0) + 1;
  const total = tokens.length || 1;
  for (const k of Object.keys(c)) c[k] /= total;
  return c;
}

function cosine(a: Record<string, number>, b: Record<string, number>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) { dot += (a[k] ?? 0) * (b[k] ?? 0); }
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export default defineTool({
  name: "ats_match",
  title: "ATS Resume/JD Match",
  description: "Score a resume against a job description using TF-IDF cosine similarity. Returns match score (0–100), matched keywords, and top missing gaps.",
  inputSchema: {
    resume: z.string().min(20).max(50_000).describe("Full resume text."),
    jd: z.string().min(20).max(50_000).describe("Full job description text."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ resume, jd }) => {
    const rTok = tokenize(resume);
    const jTok = tokenize(jd);
    const score = Math.round(cosine(tf(rTok), tf(jTok)) * 1000) / 10;
    const rSet = new Set(rTok);
    const jCounts: Record<string, number> = {};
    for (const t of jTok) jCounts[t] = (jCounts[t] ?? 0) + 1;
    const gaps = Object.keys(jCounts).filter(w => !rSet.has(w)).sort((a, b) => jCounts[b] - jCounts[a]).slice(0, 15);
    const matched = [...new Set(jTok.filter(t => rSet.has(t)))].slice(0, 25);
    return {
      content: [{ type: "text", text: `Match score: ${score}%\nMatched: ${matched.join(", ")}\nTop gaps: ${gaps.join(", ")}` }],
      structuredContent: { score, matched, gaps },
    };
  },
});
