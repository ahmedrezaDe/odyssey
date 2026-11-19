import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { Flame, Wand2, ClipboardCopy, Sparkles, Loader2, Briefcase, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { roastResume, fixBullet, type RoastReport } from "@/lib/text-analysis";
import { odyssey } from "@/lib/api/odyssey";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";
import { WorkspaceHeader, WorkspaceToolbar, ToolbarSection, WorkspaceContent } from "@/components/layout/index";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/roaster")({
  head: () => ({
    meta: [
      { title: "Resume Roaster — Odyssey System" },
      { name: "description", content: "Brutal in-browser resume critique and rewrite system." },
    ],
  }),
  component: Roaster,
});

function Roaster() {
  const [text, setText] = useLocalStorage<string>("odyssey.roaster.text", "");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [backendReport, setBackendReport] = useState<any>(null);
  const backendConfigured = odyssey.configured();
  const [approvedJobs, setApprovedJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  
  const report: RoastReport | null = useMemo(
    () => (text.trim().length > 40 && !backendConfigured ? roastResume(text) : null),
    [text, backendConfigured],
  );

  const [fixed, setFixed] = useState<Record<number, string>>({});

  // Fetch approved job bounties on mount
  useEffect(() => {
    fetchApprovedJobs();
  }, []);

  const fetchApprovedJobs = async () => {
    setLoadingJobs(true);
    try {
      const response = await odyssey.jobLeads.list("approved");
      if (response.success) {
        setApprovedJobs(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch approved jobs:", error);
      // Don't show error toast - this is optional functionality
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleSelectJob = (job: any) => {
    setText(job.raw_content || "");
    setShowJobDropdown(false);
    toast.success("Job description loaded", {
      description: `Selected: ${job.company_name} - ${job.role_title}`,
    });
  };
  
  const analyzeWithBackend = async () => {
    if (!text.trim()) {
      toast.error("Please enter resume text first");
      return;
    }
    
    setIsAnalyzing(true);
    try {
      const result = await odyssey.roaster.analyze(text);
      setBackendReport(result);
      toast.success("AI analysis complete");
    } catch (error) {
      console.error("Backend analysis failed:", error);
      toast.error("Backend analysis failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const doFix = (i: number, line: string) => {
    setFixed((p) => ({ ...p, [i]: fixBullet(line) }));
  };
  
  const fixAll = async () => {
    if (!report) return;
    const map: Record<number, string> = {};
    report.issues.forEach((it, i) => (map[i] = fixBullet(it.line)));
    setFixed(map);
    toast.success(`Optimized ${report.issues.length} bullet${report.issues.length === 1 ? "" : "s"}`);
  };
  
  const fixAllBackend = async () => {
    if (!backendReport || !backendReport.flawed_bullets) return;
    
    try {
      const flawedBullets = backendReport.flawed_bullets.map((b: any) => b.text);
      const result = await odyssey.roaster.fix(flawedBullets);
      
      // Update fixed state with backend results
      const map: Record<number, string> = {};
      result.fixed_bullets.forEach((bullet: string, i: number) => {
        map[i] = bullet;
      });
      setFixed(map);
      toast.success(`Optimized ${result.fixed_bullets.length} bullet${result.fixed_bullets.length === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("Backend fix failed:", error);
      toast.error("Optimization failed", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };
  
  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    toast("Copied");
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="Resume Roaster"
        description={backendConfigured ? "AI-powered resume critique and rewrite system" : "Brutal in-browser resume critique and rewrite system"}
        actions={
          <div className="flex items-center gap-2">
            {backendConfigured && (
              <Button
                onClick={analyzeWithBackend}
                disabled={isAnalyzing || !text.trim()}
                size="sm"
                className="inline-flex items-center gap-1.5 bg-teal-500 text-white hover:bg-teal-600 border-2 border-teal-500"
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
            {!backendConfigured && report && report.issues.length > 0 && (
              <Button
                onClick={fixAll}
                size="sm"
                className="inline-flex items-center gap-1.5 bg-teal-500 text-white hover:bg-teal-600 border-2 border-teal-500"
              >
                <Wand2 className="h-3.5 w-3.5" /> Optimize All
              </Button>
            )}
            {backendConfigured && backendReport && backendReport.flawed_bullets && backendReport.flawed_bullets.length > 0 && (
              <Button
                onClick={fixAllBackend}
                size="sm"
                className="inline-flex items-center gap-1.5 bg-teal-500 text-white hover:bg-teal-600 border-2 border-teal-500"
              >
                <Wand2 className="h-3.5 w-3.5" /> Optimize All
              </Button>
            )}
          </div>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {backendConfigured 
              ? (backendReport ? `AI Analysis - ${backendReport.flawed_bullets?.length || 0} issues found` : "Click 'Analyze' to start")
              : (report ? `Score: ${report.score}/100` : "Paste resume bullets to analyze")
            }
          </span>
        </ToolbarSection>
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 rounded-md border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-gray-900">Resume Body</h2>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-gray-500">
                    {text.length} chars
                  </span>
                  
                  <span className="text-xs text-gray-500">or paste manually below</span>
                  
                  {/* Select Saved Job Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowJobDropdown(!showJobDropdown)}
                      disabled={loadingJobs}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-teal-50 border-2 border-teal-500 rounded-lg text-teal-700 font-medium hover:bg-teal-100 transition-all duration-200 text-xs"
                    >
                      <Briefcase className="h-3.5 w-3.5" />
                      {loadingJobs ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          Select Job
                          <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </button>
                    
                    {showJobDropdown && approvedJobs.length > 0 && (
                      <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-56 overflow-y-auto">
                        {approvedJobs.map((job) => (
                          <button
                            key={job.id}
                            onClick={() => handleSelectJob(job)}
                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                          >
                            <div className="font-medium text-gray-900 text-xs">{job.company_name}</div>
                            <div className="text-[11px] text-gray-500">{job.role_title}</div>
                            <div className="text-[11px] text-teal-600 mt-0.5">Match: {job.match_score}%</div>
                          </button>
                        ))}
                        {approvedJobs.length === 0 && (
                          <div className="px-3 py-2.5 text-xs text-gray-500 text-center">
                            No approved jobs found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-4">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"Paste job description or resume bullets here (one per line):\n• Helped the team build a database\n• Responsible for cross-functional initiatives"}
                  className="min-h-[260px] w-full resize-y rounded-sm border border-gray-200 bg-white px-3 py-2 font-mono text-[12.5px] leading-relaxed text-gray-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                  spellCheck={false}
                />
                <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
                  <div className="flex items-center gap-4">
                    <div className="font-mono text-[10px] font-semibold tracking-tight text-gray-600">
                      Optimization Details
                    </div>
                    {report ? (
                      <>
                        <div
                          className={cn(
                            "inline-block rounded-sm px-2.5 py-1 font-mono text-[11px] font-semibold tracking-tight",
                            report.verdict === "STRONG" && "bg-emerald-100 text-emerald-700",
                            report.verdict === "SHORTLIST" && "bg-yellow-100 text-yellow-700",
                            report.verdict === "RAW" && "bg-red-100 text-red-700",
                            report.verdict === "HARD PASS" && "bg-red-200 text-red-800",
                          )}
                        >
                          {report.verdict}
                        </div>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-2xl font-semibold text-gray-900">{report.score}</span>
                          <span className="text-xs font-semibold tracking-tight text-gray-500">/ 100</span>
                        </div>
                      </>
                    ) : (
                      <span className="text-sm text-gray-500">
                        Paste at least a few bullets to get analysis.
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <div className="font-mono text-[10px] font-semibold tracking-tight text-teal-600">
                      Status
                    </div>
                    <span>Ready</span>
                  </div>
                </div>
              </div>
            </div>

            {report && !backendConfigured && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold tracking-tight text-gray-900">
                    Requires Review ({report.issues.length})
                  </h3>
                </div>
                <div className="flex flex-col gap-3">
                  {report.issues.length === 0 ? (
                    <p className="font-mono text-xs text-emerald-600">No major issues detected</p>
                  ) : (
                    report.issues.map((it, i) => (
                      <div key={i} className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[13px] leading-snug text-gray-900">{it.line}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {it.reasons.map((r) => (
                            <span
                              key={r}
                              className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-red-700"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                        {fixed[i] ? (
                          <div className="mt-3 rounded-sm border border-emerald-300 bg-emerald-50 p-2.5">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-mono text-[10px] font-semibold tracking-tight text-emerald-700">
                                Optimized Version
                              </span>
                              <button
                                onClick={() => copy(fixed[i])}
                                className="rounded-sm p-1 text-gray-500 hover:text-gray-900"
                                aria-label="Copy"
                              >
                                <ClipboardCopy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-[13px] text-gray-900">{fixed[i]}</p>
                          </div>
                        ) : (
                          <button
                            onClick={() => doFix(i, it.line)}
                            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:underline"
                          >
                            <Wand2 className="h-3 w-3" /> optimize
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
            
            {backendReport && backendConfigured && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold tracking-tight text-gray-900">
                    AI Analysis Results ({backendReport.flawed_bullets?.length || 0})
                  </h3>
                </div>
                <div className="flex flex-col gap-3">
                  {backendReport.critique && (
                    <div className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                      <p className="text-sm font-semibold mb-2 text-gray-900">Overall Critique</p>
                      <p className="text-[13px] leading-snug text-gray-900">{backendReport.critique}</p>
                    </div>
                  )}
                  {backendReport.flawed_bullets && backendReport.flawed_bullets.length > 0 ? (
                    backendReport.flawed_bullets.map((it: any, i: number) => (
                      <div key={i} className="rounded-sm border border-gray-200 bg-gray-50 p-3">
                        <p className="text-[13px] leading-snug text-gray-900">{it.text}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {it.issues && it.issues.map((r: string) => (
                            <span
                              key={r}
                              className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-red-700"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                        {fixed[i] ? (
                          <div className="mt-3 rounded-sm border border-emerald-300 bg-emerald-50 p-2.5">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-mono text-[10px] font-semibold tracking-tight text-emerald-700">
                                Optimized Version
                              </span>
                              <button
                                onClick={() => copy(fixed[i])}
                                className="rounded-sm p-1 text-gray-500 hover:text-gray-900"
                                aria-label="Copy"
                              >
                                <ClipboardCopy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <p className="text-[13px] text-gray-900">{fixed[i]}</p>
                          </div>
                        ) : (
                          <button
                            onClick={() => doFix(i, it.text)}
                            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:underline"
                          >
                            <Wand2 className="h-3 w-3" /> optimize
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="font-mono text-xs text-emerald-600">No major issues detected by AI</p>
                  )}
                </div>
              </>
            )}
          </div>

          <aside className="flex flex-col gap-3">
            <div className="rounded-md border border-gray-200 bg-white p-5 shadow-sm">
              <div className="font-mono text-[10px] font-semibold tracking-tight text-gray-600">
                Details
              </div>
              {report && !backendConfigured ? (
                <>
                  <p className="mt-2 text-sm text-gray-900">{report.summary}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 font-mono text-[11px]">
                    <Stat k="lines" v={report.stats.lines} />
                    <Stat k="avg words" v={report.stats.avgWords} />
                    <Stat k="weak verbs" v={report.stats.weakVerbs} />
                    <Stat k="buzzwords" v={report.stats.buzzwords} />
                    <Stat k="quantified" v={report.stats.quantified} />
                  </dl>
                </>
              ) : backendReport && backendConfigured ? (
                <>
                  <p className="mt-2 text-sm text-gray-900">
                    {backendReport.critique || "AI-powered resume analysis complete"}
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 font-mono text-[11px]">
                    <Stat k="issues found" v={backendReport.flawed_bullets?.length || 0} />
                    <Stat k="analysis type" v="AI-powered" />
                  </dl>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  {backendConfigured ? "Click 'Analyze' to see details." : "Paste at least a few bullets to see details."}
                </p>
              )}
            </div>
          </aside>
        </div>
      </WorkspaceContent>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900">{v}</span>
    </div>
  );
}
