import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

const TEMPLATES = [
  "Walk me through a project where you used {kw}.",
  "What's your approach to debugging a flaky {kw} workflow?",
  "How would you scale {kw} to 10× current load?",
  "Describe a tradeoff you made involving {kw}.",
  "What's the most counterintuitive thing you've learned about {kw}?",
];

const STOPWORDS = new Set("a an the and or but if then of in on for to with from by at as is are was were be been being have has had do does did this that these those i you we they it not no s t can will just should now into about above below over under more most less many much some any all your our their".split(" "));

export default defineTool({
  name: "generate_interview_questions",
  title: "Generate Interview Questions",
  description: "Generate technical interview questions derived from the top keywords of a job description.",
  inputSchema: {
    job_description: z.string().min(20).max(20_000).describe("Job description text."),
    count: z.number().int().min(1).max(25).default(8).describe("How many questions to produce."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: ({ job_description, count }) => {
    const tokens = (job_description.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => t.length > 2 && !STOPWORDS.has(t));
    const counts: Record<string, number> = {};
    for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1;
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, count);
    const questions = top.map((kw, i) => TEMPLATES[i % TEMPLATES.length].replace("{kw}", kw));
    return {
      content: [{ type: "text", text: questions.map((q, i) => `${i + 1}. ${q}`).join("\n") }],
      structuredContent: { questions },
    };
  },
});
