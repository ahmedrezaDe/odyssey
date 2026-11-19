import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Target, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { atsMatch } from "@/lib/text-analysis";
import { odyssey } from "@/lib/api/odyssey";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { WorkspaceHeader, WorkspaceToolbar, ToolbarSection, WorkspaceContent } from "@/components/layout/index";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/ats-match")({
  head: () => ({
    meta: [
      { title: "ATS Match — Odyssey System" },
      { name: "description", content: "Score your resume against a job description with in-browser TF-IDF." },
    ],
  }),
  component: AtsMatch,
});

function AtsMatch() {
  const [jd, setJd] = useLocalStorage<string>("odyssey.ats.jd", "");
  const [cv, setCv] = useLocalStorage<string>("odyssey.ats.cv", "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [backendResult, setBackendResult] = useState<any>(null);
  const backendConfigured = odyssey.configured();

  const result = useMemo(
    () => (jd.trim().length > 40 && cv.trim().length > 40 && !backendConfigured ? atsMatch(jd, cv) : null),
    [jd, cv, backendConfigured],
  );

  const analyzeWithBackend = async () => {
    if (!jd.trim() || !cv.trim()) {
      toast.error("Please enter both job description and resume");
      return;
    }

    setIsAnalyzing(true);
    try {
      const result = await odyssey.ats.match(cv, jd);
      const totalKeywords = result.matched.length + result.gaps.length;
      const trueScore = totalKeywords > 0 ? Math.round((result.matched.length / totalKeywords) * 100) : 0;
      setBackendResult({
        ...result,
        score: trueScore
      });
      toast.success("Analysis complete");
    } catch (error) {
      console.error("Backend analysis failed:", error);
      toast.error("Backend analysis failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const currentResult = backendConfigured ? backendResult : result;
  const pct = currentResult ? currentResult.score : 0;
  const tone = pct >= 70 ? "success" : pct >= 45 ? "warning" : "destructive";

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="ATS Match"
        description={backendConfigured ? "Score your resume against a job description with AI" : "Score your resume against a job description with in-browser TF-IDF"}
        actions={
          <div className="flex items-center gap-2">
            {backendConfigured && (
              <Button
                onClick={analyzeWithBackend}
                disabled={isAnalyzing || !jd.trim() || !cv.trim()}
                size="sm"
                className="inline-flex items-center gap-1.5"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Analyze
                  </>
                )}
              </Button>
            )}
          </div>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {currentResult ? `Match Score: ${pct}%` : "Enter job description and resume"}
          </span>
        </ToolbarSection>
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="rounded-md border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Pane label="Job Description" value={jd} onChange={setJd} placeholder="Paste the full JD here…" />
            <Pane label="Your Resume" value={cv} onChange={setCv} placeholder="Paste your resume text…" />
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-6">
          {isAnalyzing ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
              <div className="flex flex-col items-center justify-center">
                <Skeleton className="h-24 w-24 rounded-full" />
                <Skeleton className="mt-4 h-8 w-32" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-32 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-32 w-full rounded-md" />
                </div>
              </div>
            </div>
          ) : !currentResult ? (
            <p className="font-mono text-xs text-muted-foreground">
              {backendConfigured ? "Click 'Analyze' to compute match" : "Paste both fields above to compute a match"}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
              <div>
                <div className="font-mono text-[10px] font-semibold tracking-tight text-muted-foreground">
                  Match Score
                </div>
                <div className={cn("mt-2 font-mono text-6xl font-semibold", `text-${tone}`)}>
                  {pct}
                  <span className="text-2xl text-muted-foreground">%</span>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn("h-full transition-all", `bg-${tone}`)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <KeywordList 
                  title="Matched Keywords" 
                  tone="success" 
                  tokens={currentResult.matched || []} 
                />
                <KeywordList 
                  title="Missing Keywords" 
                  tone="destructive" 
                  tokens={currentResult.gaps || currentResult.missing || []} 
                />
              </div>
            </div>
          )}
        </div>
      </WorkspaceContent>
    </div>
  );
}

function Pane({
  label, value, onChange, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{label}</h2>
        <span className="font-mono text-[10px] text-muted-foreground">{value.length}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-[300px] resize-y rounded-sm border border-border bg-input px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground outline-none focus:border-primary/60"
      />
    </div>
  );
}

function KeywordList({ title, tone, tokens }: { title: string; tone: "success" | "destructive"; tokens: string[] }) {
  return (
    <div className={cn(
      "rounded-md border p-4",
      tone === "success" ? "bg-success/10 border-success/20" : "bg-destructive/10 border-destructive/20"
    )}>
      <div className={cn("mb-2 font-mono text-[10px] font-semibold tracking-tight", `text-${tone}`)}>
        {title} ({tokens.length})
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tokens.length === 0 ? (
          <span className="font-mono text-[11px] text-muted-foreground">—</span>
        ) : (
          tokens.map((t) => (
            <span
              key={t}
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[11px]",
                tone === "success"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              {t}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
