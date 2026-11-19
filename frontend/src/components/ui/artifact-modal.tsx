import { X, Download, FileText, BookOpen, Edit3, Rocket, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { odyssey } from "@/lib/api/odyssey";

interface ArtifactModalProps {
  jobLead: {
    id: string;
    company_name: string;
    role_title: string;
    email_draft?: string;
    tailored_cv_path?: string;
    tailored_cv_data?: string;
    prep_guide?: string;
    prep_guide_data?: string;
    contact_email?: string;
  };
  onClose: () => void;
  onShipSuccess?: () => void;
}

export function ArtifactModal({ jobLead, onClose, onShipSuccess }: ArtifactModalProps) {
  const [emailDraft, setEmailDraft] = useState(jobLead.email_draft || "");
  const [isEditing, setIsEditing] = useState(false);
  const [isShipping, setIsShipping] = useState(false);
  const [isGeneratingCV, setIsGeneratingCV] = useState(false);
  const [isGeneratingPrepGuide, setIsGeneratingPrepGuide] = useState(false);
  const [localJobLead, setLocalJobLead] = useState(jobLead);

  const isBackendError = (content: string) => {
    if (!content) return false;
    const lowerContent = content.toLowerCase();
    return lowerContent.startsWith('[') && 
           (lowerContent.includes('500') || 
            lowerContent.includes('429') || 
            lowerContent.includes('error') ||
            lowerContent.includes('failed'));
  };

  const handleShip = async () => {
    setIsShipping(true);
    try {
      const response = await odyssey.jobLeads.ship(jobLead.id, jobLead.contact_email, emailDraft);
      if (response.success) {
        toast.success("🚀 Mission Accomplished!", {
          description: `Application shipped to ${jobLead.company_name}!`,
        });
        onShipSuccess?.();
        onClose();
      } else {
        toast.error("Mission Failed", {
          description: response.error || "Failed to ship application",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to ship application";
      if (errorMessage.includes("429 Rate Limit:")) {
        const creativeMessage = errorMessage.replace("429 Rate Limit: ", "");
        toast.error("Whoa, slow down! 🐢", {
          description: creativeMessage,
          duration: 8000,
        });
      } else {
        toast.error("Mission Failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsShipping(false);
    }
  };

  const handleGenerateCV = async () => {
    setIsGeneratingCV(true);
    try {
      const response = await odyssey.jobLeads.generateCV(jobLead.id);
      if (response.success) {
        toast.success("✨ CV Generated!", {
          description: "Your tailored CV is ready",
        });
        setLocalJobLead(response.data);
      } else {
        toast.error("CV Generation Failed", {
          description: "Failed to generate CV",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to generate CV";
      if (errorMessage.includes("429 Rate Limit:")) {
        const creativeMessage = errorMessage.replace("429 Rate Limit: ", "");
        toast.error("Whoa, slow down! 🐢", {
          description: creativeMessage,
          duration: 8000,
        });
      } else {
        toast.error("CV Generation Failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsGeneratingCV(false);
    }
  };

  const handleGeneratePrepGuide = async () => {
    setIsGeneratingPrepGuide(true);
    try {
      const response = await odyssey.jobLeads.generatePrepGuide(jobLead.id);
      if (response.success) {
        toast.success("📚 Prep Guide Generated!", {
          description: "Your interview prep guide is ready",
        });
        setLocalJobLead(response.data);
      } else {
        toast.error("Prep Guide Generation Failed", {
          description: "Failed to generate prep guide",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to generate prep guide";
      if (errorMessage.includes("429 Rate Limit:")) {
        const creativeMessage = errorMessage.replace("429 Rate Limit: ", "");
        toast.error("Whoa, slow down! 🐢", {
          description: creativeMessage,
          duration: 8000,
        });
      } else {
        toast.error("Prep Guide Generation Failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsGeneratingPrepGuide(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-card border-4 border-primary rounded-2xl shadow-playful-lg overflow-hidden animate-fade-in-up flex flex-col">
        
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-primary to-secondary border-b-4 border-card shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-card border-2 border-white/30" />
              <div className="w-3 h-3 rounded-full bg-card border-2 border-white/30" />
              <div className="w-3 h-3 rounded-full bg-card border-2 border-white/30" />
            </div>
            <h3 className="font-bold text-primary-foreground tracking-tight text-sm">
              📦 Asset Review: {jobLead.company_name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-card/30 hover:bg-card/50 border-2 border-white/20 hover:border-white/40 transition-all duration-200 hover:scale-110 hover:rotate-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card"
            aria-label="Close modal"
          >
            <X className="w-4 h-4 text-primary-foreground" />
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-0 flex-1">
          
          <div className="flex flex-col border-r-4 border-border bg-secondary/50 min-h-0">
            <div className="flex items-center justify-between px-4 py-3 bg-secondary border-b-4 border-border">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-primary" />
                <h4 className="font-bold text-card-foreground text-sm">📧 Email Draft</h4>
              </div>
              <button
                onClick={() => setIsEditing(!isEditing)}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg border-2 transition-all duration-200 hover:scale-105 hover:animate-wiggle ${
                  isEditing 
                    ? 'bg-secondary/20 border-secondary text-secondary-foreground' 
                    : 'bg-primary/20 border-primary text-primary-foreground'
                }`}
              >
                {isEditing ? '✓ Done' : '✏️ Edit'}
              </button>
            </div>
            
            <div className="flex-1 p-4 overflow-y-auto">
              {isBackendError(emailDraft) ? (() => {
                console.error('Backend error detected in email draft:', emailDraft);
                return (
                  <div className="flex flex-col items-center justify-center h-full p-8 border-2 border-dashed border-destructive/50 rounded-xl bg-destructive/5">
                    <Loader2 className="w-8 h-8 mb-3 text-destructive animate-spin" />
                    <p className="text-sm text-destructive font-medium mb-2">Asset generation encountered an error</p>
                    <p className="text-xs text-muted-foreground">Please try again later.</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="mt-4 px-4 py-2 text-xs font-bold rounded-lg bg-destructive/10 border-2 border-destructive/30 text-destructive hover:bg-destructive/20 transition-all duration-200 hover:scale-105"
                    >
                      Retry
                    </button>
                  </div>
                );
              })() : (
                <textarea
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  readOnly={!isEditing}
                  className={`w-full h-full min-h-[400px] p-4 bg-card/80 border-2 rounded-xl text-sm leading-relaxed resize-none transition-all duration-200 ${
                    isEditing 
                      ? 'border-secondary/50 focus:border-secondary focus:ring-2 focus:ring-secondary/20 focus:outline-none' 
                      : 'border-border text-muted-foreground'
                  }`}
                  placeholder="No email draft generated yet..."
                />
              )}
            </div>
          </div>

          <div className="flex flex-col bg-secondary/30 min-h-0">
            
            <div className="flex-1 border-b-4 border-border min-h-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-b-2 border-border shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-secondary-foreground" />
                  <h4 className="font-bold text-card-foreground text-sm">📄 Tailored CV</h4>
                </div>
                {(localJobLead.tailored_cv_data || localJobLead.tailored_cv_path) ? (
                  <button
                    onClick={() => {
                      let cvData = null;
                      if (localJobLead.tailored_cv_data) {
                        try {
                          cvData = JSON.parse(localJobLead.tailored_cv_data);
                        } catch (e) {
                          console.error('Failed to parse CV data:', e);
                        }
                      }
                      const content = cvData ? JSON.stringify(cvData, null, 2) : localJobLead.tailored_cv_path || '';
                      navigator.clipboard.writeText(content);
                      toast.success('CV data copied to clipboard');
                    }}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-secondary/20 border-2 border-secondary text-secondary-foreground transition-all duration-200 hover:scale-105 hover:animate-wiggle hover:bg-secondary/30"
                  >
                    <Download className="w-3 h-3 inline mr-1" />
                    Copy
                  </button>
                ) : (
                  <button
                    onClick={handleGenerateCV}
                    disabled={isGeneratingCV}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary/20 border-2 border-primary text-primary-foreground transition-all duration-200 hover:scale-105 hover:animate-wiggle hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingCV ? (
                      <>
                        <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        Generate
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="p-4 flex-1 overflow-y-auto">
                {(() => {
                  let cvData = null;
                  if (localJobLead.tailored_cv_data) {
                    try {
                      cvData = JSON.parse(localJobLead.tailored_cv_data);
                    } catch (e) {
                      console.error('Failed to parse CV data:', e);
                    }
                  }
                  
                  if (cvData) {
                    return (
                      <div className="space-y-4">
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-primary" />
                            <p className="text-xs font-bold text-primary">AI-Generated Summary</p>
                          </div>
                          <p className="text-sm text-card-foreground leading-relaxed">{cvData.professional_summary}</p>
                        </div>
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <p className="text-xs font-bold text-muted-foreground mb-2">🎯 Optimized Experience Bullets</p>
                          <ul className="space-y-2">
                            {cvData.optimized_bullets.map((bullet: string, index: number) => (
                              <li key={index} className="text-sm text-card-foreground leading-relaxed flex items-start gap-2">
                                <span className="text-primary font-bold">•</span>
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {cvData.error && (() => {
                          console.error('Backend error detected in CV data:', cvData.error);
                          return (
                            <div className="p-4 bg-destructive/10 border-2 border-destructive rounded-xl">
                              <p className="text-xs font-bold text-destructive mb-1">⚠️ Generation Issue</p>
                              <p className="text-sm text-destructive">
                                Asset generation encountered an error. Please try again later.
                              </p>
                              <button
                                onClick={() => window.location.reload()}
                                className="mt-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-destructive/20 border-2 border-destructive/30 text-destructive hover:bg-destructive/30 transition-all duration-200 hover:scale-105"
                              >
                                Retry
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  } else if (localJobLead.tailored_cv_path) {
                    return (
                      <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                        <p className="text-xs text-muted-foreground mb-2">📁 Generated File:</p>
                        <p className="text-sm text-secondary-foreground font-mono">{localJobLead.tailored_cv_path}</p>
                      </div>
                    );
                  } else {
                    return (
                      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">CV not generated yet</p>
                      </div>
                    );
                  }
                })()}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-b-2 border-border shrink-0">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" />
                  <h4 className="font-bold text-card-foreground text-sm">📚 Interview Prep Guide</h4>
                </div>
                {localJobLead.prep_guide_data || localJobLead.prep_guide ? (
                  <div className="text-xs text-muted-foreground opacity-50">Generated</div>
                ) : (
                  <button
                    onClick={handleGeneratePrepGuide}
                    disabled={isGeneratingPrepGuide}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary/20 border-2 border-primary text-primary-foreground transition-all duration-200 hover:scale-105 hover:animate-wiggle hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGeneratingPrepGuide ? (
                      <>
                        <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        Generate
                      </>
                    )}
                  </button>
                )}
              </div>
              <div className="p-4 flex-1 overflow-y-auto">
                {(() => {
                  let prepGuideData = null;
                  const rawGuide = localJobLead.prep_guide_data || localJobLead.prep_guide;
                  
                  if (rawGuide) {
                    try {
                      prepGuideData = JSON.parse(rawGuide);
                    } catch (e) {
                      console.error('Failed to parse prep guide data:', e);
                      return (
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <pre className="text-xs text-card-foreground whitespace-pre-wrap font-mono leading-relaxed">
                            {rawGuide}
                          </pre>
                        </div>
                      );
                    }
                  }
                  
                  if (prepGuideData) {
                    return (
                      <div className="space-y-4">
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <div className="flex items-center gap-2 mb-2">
                            <BookOpen className="w-4 h-4 text-primary" />
                            <p className="text-xs font-bold text-primary">Company Research</p>
                          </div>
                          <p className="text-sm text-card-foreground leading-relaxed">{prepGuideData.company_research}</p>
                        </div>
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <p className="text-xs font-bold text-muted-foreground mb-2">🎯 Key Themes to Study</p>
                          <ul className="space-y-2">
                            {prepGuideData.key_themes.map((theme: string, index: number) => (
                              <li key={index} className="text-sm text-card-foreground leading-relaxed flex items-start gap-2">
                                <span className="text-primary font-bold">•</span>
                                <span>{theme}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="p-4 bg-card/50 border-2 border-border rounded-xl">
                          <p className="text-xs font-bold text-muted-foreground mb-2">📚 Practice Questions</p>
                          <ul className="space-y-2">
                            {prepGuideData.practice_questions.map((question: string, index: number) => (
                              <li key={index} className="text-sm text-card-foreground leading-relaxed flex items-start gap-2">
                                <span className="text-secondary-foreground font-bold">{index + 1}.</span>
                                <span>{question}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        {prepGuideData.error && (() => {
                          console.error('Backend error detected in prep guide data:', prepGuideData.error);
                          return (
                            <div className="p-4 bg-destructive/10 border-2 border-destructive rounded-xl">
                              <p className="text-xs font-bold text-destructive mb-1">⚠️ Generation Issue</p>
                              <p className="text-sm text-destructive">
                                Asset generation encountered an error. Please try again later.
                              </p>
                              <button
                                onClick={() => window.location.reload()}
                                className="mt-2 px-3 py-1.5 text-xs font-bold rounded-lg bg-destructive/20 border-2 border-destructive/30 text-destructive hover:bg-destructive/30 transition-all duration-200 hover:scale-105"
                              >
                                Retry
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  } else {
                    return (
                      <div className="p-8 text-center border-2 border-dashed border-border rounded-xl">
                        <BookOpen className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">Prep guide not generated yet</p>
                      </div>
                    );
                  }
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-card border-t-4 border-border shrink-0">
          <div className="text-xs text-muted-foreground">
            🎮 Ready to ship to <span className="text-primary font-bold">{localJobLead.company_name}</span>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <button
              onClick={onClose}
              disabled={isShipping}
              className="px-4 sm:px-6 py-2.5 text-sm font-bold rounded-xl bg-secondary border-2 border-border text-muted-foreground transition-all duration-200 hover:scale-105 hover:border-muted-foreground hover:text-card-foreground hover:animate-wiggle disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleShip}
              disabled={isShipping}
              className="relative px-4 sm:px-6 py-2.5 text-sm font-bold rounded-xl bg-gradient-to-r from-primary to-secondary border-2 border-white/20 text-primary-foreground shadow-playful transition-all duration-200 hover:scale-105 hover:shadow-playful-lg hover:animate-wiggle hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden"
            >
              {isShipping ? (
                <>
                  <Loader2 className="w-4 h-4 inline mr-2 animate-spin" />
                  Launching...
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4 inline mr-2" />
                  Ship Application
                </>
              )}
              {isShipping && (
                <div className="absolute inset-0 bg-gradient-to-t from-primary/20 to-transparent animate-rocket-trail" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>  
  );
}


