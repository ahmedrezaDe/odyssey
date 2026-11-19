// Pure-TS text analysis utilities: tokenizer, TF-IDF cosine, simple ATS keyword
// extraction, and a rule-based "roaster" + "fixer". Runs entirely in the browser
// — no Python backend required.

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","for","of","to","in","on",
  "at","by","with","from","as","is","are","was","were","be","been","being","am",
  "this","that","these","those","it","its","i","we","you","they","he","she",
  "our","your","their","my","me","us","them","do","does","did","done","have",
  "has","had","will","would","should","could","can","may","might","must","not",
  "no","yes","so","than","too","very","just","also","more","most","much","some",
  "any","all","each","every","such","into","over","about","across","through",
  "during","before","after","above","below","up","down","out","off","again",
  "further","once","here","there","when","where","why","how","what","which",
  "who","whom","whose","because","while","both","either","neither","nor","own",
  "same","other","another","work","working","worked","experience","skills",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  // length-normalize
  const len = tokens.length || 1;
  for (const [k, v] of tf) tf.set(k, v / len);
  return tf;
}

function idf(corpus: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of corpus) {
    const seen = new Set(doc);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = corpus.length;
  const out = new Map<string, number>();
  for (const [t, d] of df) out.set(t, Math.log((n + 1) / (d + 1)) + 1);
  return out;
}

function tfidfVector(tokens: string[], idfMap: Map<string, number>) {
  const tf = termFreq(tokens);
  const v = new Map<string, number>();
  for (const [t, f] of tf) v.set(t, f * (idfMap.get(t) ?? 1));
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [k, v] of a) {
    const bv = b.get(k);
    if (bv) dot += v * bv;
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export interface MatchResult {
  score: number; // 0..1
  matched: string[];
  missing: string[];
}

export function atsMatch(jobDescription: string, resume: string): MatchResult {
  const jdTokens = tokenize(jobDescription);
  const cvTokens = tokenize(resume);
  const idfMap = idf([jdTokens, cvTokens]);
  const jdVec = tfidfVector(jdTokens, idfMap);
  const cvVec = tfidfVector(cvTokens, idfMap);
  const score = cosine(jdVec, cvVec);

  // Top JD keywords (by tf-idf weight), bucketed
  const ranked = [...jdVec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const cvSet = new Set(cvTokens);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const [t] of ranked) (cvSet.has(t) ? matched : missing).push(t);
  return { score, matched, missing };
}

// --- Roaster --------------------------------------------------------------

const WEAK_VERBS = [
  "helped","worked","assisted","participated","supported","involved","handled",
  "responsible","duties","tasked","contributed",
];
const BUZZWORDS = [
  "synergize","synergized","synergy","leverage","leveraged","stakeholder",
  "stakeholders","cross-functional","value-add","results-driven","go-getter",
  "team player","hard worker","detail-oriented","passionate","ninja","rockstar",
  "guru","disruptive","innovative","dynamic","proactive",
];

export interface RoastIssue {
  line: string;
  reasons: string[];
}

export interface RoastReport {
  verdict: "HARD PASS" | "RAW" | "SHORTLIST" | "STRONG";
  score: number; // 0..100
  summary: string;
  issues: RoastIssue[];
  stats: {
    lines: number;
    weakVerbs: number;
    buzzwords: number;
    quantified: number;
    avgWords: number;
  };
}

const NUMERIC_RE = /\b\d{1,3}(\.\d+)?%?\b|\$\d|\b\d{2,}\b/;

export function roastResume(text: string): RoastReport {
  const rawLines = text
    .split(/\r?\n|•|·|—|- /)
    .map((l) => l.trim())
    .filter((l) => l.length > 6);

  const issues: RoastIssue[] = [];
  let weakVerbs = 0, buzzwords = 0, quantified = 0, totalWords = 0;

  for (const line of rawLines) {
    const reasons: string[] = [];
    const lower = line.toLowerCase();
    const words = lower.split(/\s+/);
    totalWords += words.length;

    const weakHit = WEAK_VERBS.filter((w) => words.includes(w));
    if (weakHit.length) {
      weakVerbs += weakHit.length;
      reasons.push(`weak verbs: ${weakHit.join(", ")}`);
    }
    const buzzHit = BUZZWORDS.filter((b) => lower.includes(b));
    if (buzzHit.length) {
      buzzwords += buzzHit.length;
      reasons.push(`buzzwords: ${buzzHit.join(", ")}`);
    }
    if (NUMERIC_RE.test(line)) quantified += 1;
    else if (words.length > 4) reasons.push("no measurable outcome");

    if (words.length > 32) reasons.push("too long — trim to one sharp sentence");
    if (reasons.length) issues.push({ line, reasons });
  }

  const lines = rawLines.length || 1;
  const avgWords = totalWords / lines;
  const quantRate = quantified / lines;
  const noiseRate = (weakVerbs + buzzwords) / lines;

  // Score: reward quantified bullets, penalize noise and bloated lines
  let score = 60 + quantRate * 35 - noiseRate * 25 - Math.max(0, avgWords - 18);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const verdict =
    score >= 80 ? "STRONG" : score >= 60 ? "SHORTLIST" : score >= 40 ? "RAW" : "HARD PASS";

  const summary =
    verdict === "STRONG"
      ? "Crisp, measurable, and confident. Ship this."
      : verdict === "SHORTLIST"
        ? "Decent bones. Cut the filler and quantify two more bullets."
        : verdict === "RAW"
          ? "Reads like a job description, not a person. Lead with impact and numbers."
          : "Buzzword soup. Rewrite from scratch with shipped outcomes and metrics.";

  return {
    verdict,
    score,
    summary,
    issues: issues.slice(0, 12),
    stats: { lines, weakVerbs, buzzwords, quantified, avgWords: Math.round(avgWords) },
  };
}

const VERB_SWAP: Record<string, string> = {
  helped: "Engineered",
  worked: "Delivered",
  assisted: "Drove",
  participated: "Led",
  supported: "Owned",
  involved: "Architected",
  handled: "Operated",
  contributed: "Shipped",
  responsible: "Owned",
};

export function fixBullet(line: string): string {
  let out = line.trim();
  const lower = out.toLowerCase();

  for (const [bad, good] of Object.entries(VERB_SWAP)) {
    const re = new RegExp(`\\b${bad}\\b`, "i");
    if (re.test(out)) {
      out = out.replace(re, good);
      break;
    }
  }
  for (const b of BUZZWORDS) {
    const re = new RegExp(`\\b${b}\\b`, "gi");
    out = out.replace(re, "").replace(/\s+/g, " ").trim();
  }

  if (!NUMERIC_RE.test(out)) {
    const bump = Math.floor(20 + Math.random() * 60);
    out = `${out.replace(/[.!]$/, "")}, reducing latency by ${bump}% across production traffic`;
  }
  if (!/^[A-Z]/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
  // Detect leading verb; if none of swaps matched, prepend a strong one
  if (!/^(Engineered|Delivered|Drove|Led|Owned|Architected|Operated|Shipped|Built|Designed|Launched|Scaled)/.test(out)) {
    out = `Engineered ${out.charAt(0).toLowerCase() + out.slice(1)}`;
  }
  return out;
}

// --- Interview question generator (template) ------------------------------
export function generateInterviewQuestions(jd: string, n = 6): string[] {
  const keys = [...tokenize(jd)].slice(0, 40);
  const pickN = (count: number) => {
    const out: string[] = [];
    const pool = [...keys];
    while (out.length < count && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  };
  const k = pickN(n);
  const templates = [
    (t: string) => `Walk me through a project where ${t} was the core technical risk. How did you de-risk it?`,
    (t: string) => `Describe a failure mode you've seen in ${t} systems and the production fix you shipped.`,
    (t: string) => `If we asked you to onboard onto our ${t} stack in week one, what would your first PR look like?`,
    (t: string) => `Where does ${t} typically break at scale, and how have you instrumented it?`,
    (t: string) => `Compare two approaches to ${t} you've used. Why did you pick one over the other?`,
    (t: string) => `Tell me about a time you owned ${t} end-to-end — from design doc to on-call.`,
  ];
  return k.slice(0, n).map((t, i) => templates[i % templates.length](t));
}
