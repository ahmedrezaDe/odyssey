import { createFileRoute } from "@tanstack/react-router";
import {
  Search,
  Target,
  Check,
  X,
  Loader2,
  RefreshCw,
  Eye,
  Sparkles,
  FileText,
  BookOpen,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { odyssey } from "@/lib/api/odyssey";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { type FilterCriteria } from "@/types/database.types";
import { ArtifactModal } from "@/components/ui/artifact-modal";

interface JobLead {
  id: string;
  url: string;
  company_name: string;
  role_title: string;
  match_score: number;
  status: string;
  raw_content: string;
  tech_stack: string[];
  created_at: string;
  email_draft?: string;
  tailored_cv_path?: string;
  tailored_cv_data?: string;
  prep_guide?: string;
  prep_guide_data?: string;
  crm_synced?: boolean;
  crm_id?: string;
  crm_synced_at?: string;
  applied_at?: string;
  applied_to?: string;
  contact_email?: string;
  job_location?: string;
  work_setting?: string;
}

export const Route = createFileRoute("/job-bounty")({
  head: () => ({
    meta: [
      { title: "Job Bounty — Odyssey AI" },
      { name: "description", content: "Command center for your job hunting pipeline." },
    ],
  }),
  component: JobBountyPage,
});

function JobBountyPage() {
  const [jobLeads, setJobLeads] = useState<JobLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [scouting, setScouting] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<JobLead | null>(null);
  const [viewLead, setViewLead] = useState<JobLead | null>(null);
  const [generatingAssets, setGeneratingAssets] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [minScore, setMinScore] = useState(45);
  const [s] = useLocalStorage<{ filterCriteria: FilterCriteria }>("odyssey.settings", {
    filterCriteria: {
      allowed_keywords: [],
      blocked_keywords: [
        "arbeitserlaubnis",
        "aufenthaltstitel",
        "sprachkenntnisse",
        "deutsch",
        "german fluent",
      ],
      min_match_score: 40,
    },
  });

  const fetchJobLeads = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch job leads with optional min_score filter
      const response = await odyssey.jobLeads.list(
        showAllJobs ? undefined : "new",
        showAllJobs ? undefined : minScore,
      );

      if (response.success) {
        setJobLeads(response.data);
      } else {
        console.error("Failed to fetch job leads:", response);
        toast.error("Failed to fetch job leads");
        setJobLeads([]); // Set empty array on failure to prevent crashes
      }
    } catch (error) {
      console.error("Error fetching job leads:", error);
      
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        toast.info("Authenticating... please wait", {
          description: "Your session is being refreshed automatically.",
        });
      } else {
        toast.error("Failed to fetch job leads");
      }
      
      setJobLeads([]); // Set empty array on failure to prevent crashes
    } finally {
      setLoading(false);
    }
  }, [showAllJobs, minScore]);

  useEffect(() => {
    fetchJobLeads();
  }, [showAllJobs, minScore, fetchJobLeads]);

  const handleScout = async () => {
    if (!urlInput.trim()) {
      toast.error("Please enter a URL");
      return;
    }

    setScouting(true);
    try {
      const response = await odyssey.jobLeads.process(
        urlInput,
        undefined,
        undefined,
        s.filterCriteria,
      );
      if (response.success) {
        toast.success(`Job processed! Match score: ${response.match_score}`);
        setUrlInput("");
        await fetchJobLeads();
      } else {
        // Handle improved error messages from ethical scraping
        const errorMessage = response.error || response.reason || "Failed to process job";
        toast.error(errorMessage);

        // Show suggestion if available
        if (response.suggestion) {
          toast.info(response.suggestion);
        }
      }
    } catch (error) {
      console.error("Error scouting job:", error);
      
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        toast.info("Authenticating... please wait", {
          description: "Your session is being refreshed automatically.",
        });
      } else {
        toast.error("Failed to scout job");
      }
    } finally {
      setScouting(false);
    }
  };

  const handleApprove = async (leadId: string) => {
    setProcessingId(leadId);

    try {
      console.log("Approving job lead:", leadId);
      const response = await odyssey.jobLeads.update(leadId, "approved");
      console.log("Approve response:", response);

      if (response.success) {
        toast.success("Processing Complete!", {
          description: "Job approved and assets generated successfully.",
        });

        // Fetch fresh job lead data to get updated asset status
        try {
          const freshLeadResponse = await odyssey.jobLeads.get(leadId);
          if (freshLeadResponse.success && freshLeadResponse.data) {
            const freshLead = freshLeadResponse.data;

            // Update the job lead in the main list
            setJobLeads((prevLeads) =>
              prevLeads.map((lead) => (lead.id === leadId ? freshLead : lead)),
            );

            // Update the modal state if it's currently open
            if (viewLead && viewLead.id === leadId) {
              setViewLead(freshLead);
            }
          } else {
            console.error("Failed to fetch fresh job lead data:", freshLeadResponse);
          }
        } catch (fetchError) {
          console.error("Failed to fetch fresh job lead data:", fetchError);
          // Don't fail the entire approval if fetch fails, but log it
        }
      } else {
        console.error("Approve failed:", response);
        toast.error("Failed to approve job");
      }
    } catch (error) {
      console.error("Approve error:", error);
      
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        toast.info("Authenticating... please wait", {
          description: "Your session is being refreshed automatically.",
        });
      } else {
        toast.error(
          `Failed to approve job: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (leadId: string) => {
    setProcessingId(leadId);

    try {
      console.log("Rejecting job lead:", leadId);
      const response = await odyssey.jobLeads.update(leadId, "rejected");
      console.log("Reject response:", response);

      if (response.success) {
        toast.success("Job rejected");

        // Fetch fresh job lead data to update UI
        try {
          const freshLeadResponse = await odyssey.jobLeads.get(leadId);
          if (freshLeadResponse.success && freshLeadResponse.data) {
            const freshLead = freshLeadResponse.data;

            // Update the job lead in the main list
            setJobLeads((prevLeads) =>
              prevLeads.map((lead) => (lead.id === leadId ? freshLead : lead)),
            );

            // Update the modal state if it's currently open
            if (viewLead && viewLead.id === leadId) {
              setViewLead(freshLead);
            }
          } else {
            console.error("Failed to fetch fresh job lead data:", freshLeadResponse);
          }
        } catch (fetchError) {
          console.error("Failed to fetch fresh job lead data:", fetchError);
        }
      } else {
        console.error("Reject failed:", response);
        toast.error("Failed to reject job");
      }
    } catch (error) {
      console.error("Reject error:", error);
      
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        toast.info("Authenticating... please wait", {
          description: "Your session is being refreshed automatically.",
        });
      } else {
        toast.error(
          `Failed to reject job: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleManualAssetGeneration = async (leadId: string) => {
    setGeneratingAssets(true);
    try {
      const response = await odyssey.jobLeads.update(leadId, "approved");

      if (response.success) {
        toast.success("Assets Generated!", {
          description: "Job approved and assets generated successfully.",
        });

        // Fetch fresh job lead data to update UI
        try {
          const freshLeadResponse = await odyssey.jobLeads.get(leadId);
          if (freshLeadResponse.success && freshLeadResponse.data) {
            const freshLead = freshLeadResponse.data;

            // Update the job lead in the main list
            setJobLeads((prevLeads) =>
              prevLeads.map((lead) => (lead.id === leadId ? freshLead : lead)),
            );

            // Update the modal state if it's currently open
            if (viewLead && viewLead.id === leadId) {
              setViewLead(freshLead);
            }
          } else {
            console.error("Failed to fetch fresh job lead data:", freshLeadResponse);
          }
        } catch (fetchError) {
          console.error("Failed to fetch fresh job lead data:", fetchError);
        }
      } else {
        toast.error("Failed to generate assets");
      }
    } catch (error) {
      // Handle authentication errors specifically
      if (error instanceof Error && error.message.includes("Unauthorized")) {
        toast.info("Authenticating... please wait", {
          description: "Your session is being refreshed automatically.",
        });
      } else {
        toast.error(
          `Failed to generate assets: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    } finally {
      setGeneratingAssets(false);
    }
  };

  const getMatchScoreColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    if (score >= 40) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="mx-auto flex max-w-275 flex-col gap-6 p-6 lg:p-8">
      <header className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-secondary text-primary-glow ring-1 ring-border shadow-playful">
          <Target className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Job Bounty</h1>
          <p className="text-sm text-muted-foreground">
            Command center for your job hunting pipeline
          </p>
        </div>
      </header>

      <section className="rounded-xl border-2 border-border bg-card p-5 shadow-playful">
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste Target URL..."
              className="h-11 border-2 border-border rounded-lg shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle transition-all duration-200"
              onKeyDown={(e) => e.key === "Enter" && handleScout()}
            />
          </div>
          <Button
            onClick={handleScout}
            disabled={scouting}
            className="h-11 border-2 border-primary/60 bg-primary/15 px-6 font-bold text-primary-foreground shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
          >
            {scouting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Scout
              </>
            )}
          </Button>
          <Button
            onClick={fetchJobLeads}
            disabled={loading}
            variant="outline"
            className="h-11 border-2 border-border px-4 font-bold shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-tight">Job Bounties</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{jobLeads.length} jobs</span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Min Score:</label>
              <input
                type="number"
                min="0"
                max="100"
                value={minScore}
                onChange={(e) => setMinScore(parseInt(e.target.value) || 45)}
                disabled={showAllJobs}
                className="w-16 h-8 px-2 text-xs border-2 border-border rounded-md bg-background"
              />
              <button
                onClick={() => setShowAllJobs(!showAllJobs)}
                className={`text-xs px-3 py-1.5 rounded-md border-2 font-medium transition-all ${
                  showAllJobs
                    ? "border-primary/60 bg-primary/15 text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {showAllJobs ? "Filtering: Off" : "Filtering: On"}
              </button>
            </div>
          </div>
        </div>

        {loading && jobLeads.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : jobLeads.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border bg-card/50 p-12 text-center">
            <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              No job bounties. Scout some jobs to get started!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {jobLeads.map((lead, index) => (
              <div
                key={lead.id}
                className="rounded-xl border-2 border-border bg-card p-5 shadow-playful hover:shadow-playful-lg hover:-translate-y-1 hover:animate-wiggle transition-all duration-200 animate-bounce-in-stagger cursor-pointer"
                style={{ animationDelay: `${index * 100}ms` }}
                onClick={() => setViewLead(lead)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base truncate">{lead.company_name || 'Unknown Company'}</h3>
                      {(lead.status || '') === "approved" &&
                        (lead.email_draft ||
                          lead.tailored_cv_data ||
                          lead.tailored_cv_path ||
                          lead.prep_guide_data ||
                          lead.prep_guide) && (
                          <span className="px-2 py-0.5 text-xs font-bold rounded-md bg-primary/20 border border-primary text-primary-foreground">
                            ✓ Ready
                          </span>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{lead.role_title || 'Unknown Role'}</p>
                  </div>
                  <div
                    className={`ml-2 px-2 py-1 rounded-md text-xs font-bold text-white ${getMatchScoreColor(lead.match_score || 0)} shadow-playful-sm`}
                  >
                    {lead.match_score || 0}%
                  </div>
                </div>

                {lead.tech_stack && Array.isArray(lead.tech_stack) && lead.tech_stack.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {lead.tech_stack.slice(0, 4).map((tech, index) => (
                      <span
                        key={tech || index}
                        className="px-2 py-0.5 text-xs font-medium rounded-md bg-secondary border border-border"
                      >
                        {tech || ''}
                      </span>
                    ))}
                    {lead.tech_stack.length > 4 && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-md bg-secondary border border-border">
                        +{lead.tech_stack.length - 4}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-xs text-muted-foreground line-clamp-3 mb-4">
                  {(lead.raw_content || '').substring(0, 200)}...
                </p>

                {/* View Details indicator */}
                <div className="flex items-center justify-center text-xs text-muted-foreground">
                  <ChevronRight className="w-4 h-4 mr-1" />
                  Click to view details
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Artifact Modal */}
      {selectedLead && (
        <ArtifactModal
          jobLead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onShipSuccess={() => {
            // Remove the shipped job from the board
            setJobLeads(jobLeads.filter((lead) => lead.id !== selectedLead.id));
            // Refresh the job leads to get updated status
            fetchJobLeads();
          }}
        />
      )}

      {/* Job Detail Modal */}
      {viewLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Backdrop with blur */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setViewLead(null)}
            aria-hidden="true"
          />

          {/* Modal Container */}
          <div className="relative w-full max-w-3xl sm:max-w-4xl bg-card border-4 border-primary rounded-2xl shadow-playful-lg overflow-hidden max-h-[85vh] sm:max-h-[90vh] flex flex-col animate-fade-in-up">
            {/* Window Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-primary to-secondary border-b-4 border-card shrink-0">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex gap-1.5 sm:gap-2">
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-card border-2 border-white/30" />
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-card border-2 border-white/30" />
                  <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-card border-2 border-white/30" />
                </div>
                <h3 className="font-bold text-primary-foreground tracking-tight text-sm sm:text-base">
                  Job Details
                </h3>
              </div>
              <button
                onClick={() => setViewLead(null)}
                className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-card/30 hover:bg-card/50 border-2 border-white/20 hover:border-white/40 transition-all duration-200 hover:scale-110 hover:rotate-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card"
                aria-label="Close modal"
              >
                <X className="w-4 h-4 sm:w-4 sm:h-4 text-primary-foreground" />
              </button>
            </div>

            {/* Window Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
              {/* Company & Role */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl sm:text-2xl font-bold">{viewLead.company_name || 'Unknown Company'}</h2>
                  <div
                    className={`px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-md text-xs font-bold text-white ${getMatchScoreColor(viewLead.match_score || 0)} shadow-playful-sm`}
                  >
                    {viewLead.match_score || 0}% Match
                  </div>
                </div>
                <p className="text-base sm:text-lg text-muted-foreground">{viewLead.role_title || 'Unknown Role'}</p>
                <div className="flex flex-wrap gap-2 sm:gap-4 text-sm text-muted-foreground">
                  {viewLead.job_location && (
                    <p className="flex items-center gap-1">
                      <span className="inline-block w-4 h-4" aria-hidden="true">
                        📍
                      </span>
                      {viewLead.job_location}
                    </p>
                  )}
                  {viewLead.work_setting && (
                    <p className="flex items-center gap-1">
                      <span className="inline-block w-4 h-4" aria-hidden="true">
                        💼
                      </span>
                      {viewLead.work_setting}
                    </p>
                  )}
                </div>
              </div>

              {/* Tech Stack */}
              {viewLead.tech_stack && Array.isArray(viewLead.tech_stack) && viewLead.tech_stack.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground mb-2">Tech Stack</h4>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    {viewLead.tech_stack.map((tech, index) => (
                      <span
                        key={tech || index}
                        className="px-2.5 py-1 sm:px-3 sm:py-1 text-xs sm:text-sm font-medium rounded-md bg-secondary border border-border"
                      >
                        {tech || ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Job Description */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-2">
                  Job Description
                </h4>
                <div className="p-3 sm:p-4 bg-secondary/50 border-2 border-border rounded-xl">
                  <p className="text-xs sm:text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {viewLead.raw_content || 'No description available'}
                  </p>
                </div>
              </div>

              {/* Assets Status */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3">
                  Generated Assets
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                  <div
                    className={`p-3 rounded-lg border-2 ${viewLead.email_draft ? "border-green-500/50 bg-green-500/10" : "border-border bg-secondary/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Sparkles className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Email Draft</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewLead.email_draft ? "✓ Generated" : "Not generated"}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border-2 ${viewLead.tailored_cv_data || viewLead.tailored_cv_path ? "border-green-500/50 bg-green-500/10" : "border-border bg-secondary/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Tailored CV</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewLead.tailored_cv_data || viewLead.tailored_cv_path
                        ? "✓ Generated"
                        : "Not generated"}
                    </p>
                  </div>
                  <div
                    className={`p-3 rounded-lg border-2 ${viewLead.prep_guide_data || viewLead.prep_guide ? "border-green-500/50 bg-green-500/10" : "border-border bg-secondary/30"}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium">Prep Guide</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {viewLead.prep_guide_data || viewLead.prep_guide
                        ? "✓ Generated"
                        : "Not generated"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer - Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 bg-card border-t-4 border-border shrink-0">
              <div className="text-xs text-muted-foreground">
                Status:{" "}
                <span
                  className={`font-bold ${(viewLead.status || '') === "approved" ? "text-green-600" : (viewLead.status || '') === "rejected" ? "text-red-600" : "text-muted-foreground"}`}
                >
                  {(viewLead.status || '').charAt(0).toUpperCase() + (viewLead.status || '').slice(1)}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full sm:w-auto">
                <button
                  onClick={() => setViewLead(null)}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold rounded-xl bg-secondary border-2 border-border text-muted-foreground transition-all duration-200 hover:scale-105 hover:border-muted-foreground hover:text-card-foreground active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card min-h-[44px] sm:min-h-0"
                >
                  Close
                </button>
                {(viewLead.status || '') !== "rejected" && (
                  <>
                    <Button
                      onClick={() => handleManualAssetGeneration(viewLead.id)}
                      disabled={generatingAssets}
                      className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold rounded-xl bg-primary/15 border-2 border-primary/60 text-primary-foreground shadow-playful transition-all duration-200 hover:scale-105 hover:shadow-playful active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card min-h-[44px] sm:min-h-0"
                    >
                      {generatingAssets ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 mr-2" />
                          {(viewLead.status || '') === "approved" ? "Regenerate Assets" : "Generate Assets"}
                        </>
                      )}
                    </Button>
                    {(viewLead.status || '') !== "approved" && (
                      <Button
                        onClick={() => handleApprove(viewLead.id)}
                        disabled={processingId === viewLead.id}
                        className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold rounded-xl bg-green-500/15 border-2 border-green-500/60 text-green-600 shadow-playful transition-all duration-200 hover:scale-105 hover:shadow-playful active:scale-95 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-card min-h-[44px] sm:min-h-0"
                      >
                        {processingId === viewLead.id ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Approving...
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4 mr-2" />
                            Approve
                          </>
                        )}
                      </Button>
                    )}
                  </>
                )}
                {(viewLead.status || '') === "approved" &&
                  (viewLead.email_draft ||
                    viewLead.tailored_cv_data ||
                    viewLead.tailored_cv_path ||
                    viewLead.prep_guide_data ||
                    viewLead.prep_guide) && (
                    <Button
                      onClick={() => {
                        setViewLead(null);
                        setSelectedLead(viewLead);
                      }}
                      className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold rounded-xl bg-primary/15 border-2 border-primary/60 text-primary-foreground shadow-playful transition-all duration-200 hover:scale-105 hover:shadow-playful active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card min-h-[44px] sm:min-h-0"
                    >
                      <Eye className="w-4 h-4 mr-2" />
                      Review Assets
                    </Button>
                  )}
                {(viewLead.status || '') !== "rejected" && (
                  <Button
                    onClick={() => handleReject(viewLead.id)}
                    disabled={processingId === viewLead.id}
                    variant="outline"
                    className="w-full sm:w-auto px-6 py-2.5 text-sm font-bold rounded-xl bg-red-500/15 border-2 border-red-500/60 text-red-600 shadow-playful transition-all duration-200 hover:scale-105 hover:shadow-playful active:scale-95 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-card min-h-[44px] sm:min-h-0"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
