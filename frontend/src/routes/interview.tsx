import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Volume2, Pause, Sparkles, Send, CheckCircle, AlertCircle, Loader2, Briefcase, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isSpeechSupported, speak, stopSpeaking } from "@/lib/speech";
import { odyssey } from "@/lib/api/odyssey";
import { WorkspaceHeader, WorkspaceToolbar, ToolbarSection, WorkspaceContent } from "@/components/layout/index";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/interview")({
  head: () => ({
    meta: [
      { title: "Interview Practice — Odyssey" },
      { name: "description", content: "Practice interview questions with AI-powered feedback." },
    ],
  }),
  component: InterviewPracticeComponent,
});

interface FeedbackEntry {
  id: string;
  question: string;
  answer: string;
  feedback: string;
  improvement_suggestion: string;
  score: number;
  timestamp: Date;
  rating: "good" | "needs-improvement";
}

function InterviewPracticeComponent() {
  const [questions, setQuestions] = useState<string[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answer, setAnswer] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [showJobInput, setShowJobInput] = useState(false);
  const [approvedJobs, setApprovedJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [showJobDropdown, setShowJobDropdown] = useState(false);
  const supported = isSpeechSupported();
  const backendConfigured = odyssey.configured();

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
    setJobDescription(job.raw_content || "");
    setShowJobDropdown(false);
    toast.success("Job description loaded", {
      description: `Selected: ${job.company_name} - ${job.role_title}`,
    });
  };

  const handleReadAloud = async () => {
    if (!supported) {
      toast.error("Browser TTS not supported here");
      return;
    }
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    
    setIsSpeaking(true);
    
    // Try backend TTS first if configured
    if (backendConfigured) {
      try {
        const audioBlob = await odyssey.interview.speak(questions[currentQuestion]);
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.onended = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          // Fall back to browser TTS
          speak(questions[currentQuestion], {
            onEnd: () => setIsSpeaking(false),
            onError: () => setIsSpeaking(false),
          });
        };
        audio.play();
        return;
      } catch (error) {
        console.error("Backend TTS failed, falling back to browser:", error);
        // Fall back to browser TTS
      }
    }
    
    // Browser TTS fallback
    speak(questions[currentQuestion], {
      onEnd: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  const generateQuestions = async () => {
    if (!jobDescription.trim()) {
      toast.error("Please enter a job description");
      return;
    }

    setIsGenerating(true);
    try {
      const result = await odyssey.interview.generate(jobDescription, 8);
      setQuestions(result.questions);
      setCurrentQuestion(0);
      setShowJobInput(false);
      toast.success(`Generated ${result.questions.length} questions`);
    } catch (error) {
      console.error("Question generation failed:", error);
      toast.error("Failed to generate questions", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmitAnswer = async () => {
    if (answer.trim().length < 20) {
      toast.error("Please provide a more detailed answer");
      return;
    }

    setIsSubmitting(true);

    try {
      // Call the live evaluation endpoint
      const evaluation = await odyssey.interview.evaluate(
        questions[currentQuestion],
        answer,
        jobDescription || "No job description provided"
      );

      const newFeedback: FeedbackEntry = {
        id: Date.now().toString(),
        question: questions[currentQuestion],
        answer: answer,
        feedback: evaluation.feedback,
        improvement_suggestion: evaluation.improvement_suggestion,
        score: evaluation.score,
        timestamp: new Date(),
        rating: evaluation.score >= 7 ? "good" : "needs-improvement",
      };

      setFeedbackHistory((prev) => [newFeedback, ...prev]);
      setAnswer("");
      setCurrentQuestion((prev) => (prev + 1) % questions.length);

      toast.success("Answer evaluated", {
        description: `Score: ${evaluation.score}/10 - ${evaluation.score >= 7 ? "Great job!" : "Keep practicing!"}`,
      });
    } catch (error) {
      console.error("Evaluation failed:", error);
      
      // Check for rate limit error with creative message
      const errorMessage = error instanceof Error ? error.message : "Unable to evaluate answer";
      if (errorMessage.includes("429 Rate Limit:")) {
        const creativeMessage = errorMessage.replace("429 Rate Limit: ", "");
        toast.error("Whoa, slow down! 🐢", {
          description: creativeMessage,
          duration: 8000,
        });
      } else {
        toast.error("Evaluation failed", {
          description: errorMessage,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextQuestion = () => {
    setCurrentQuestion((prev) => (prev + 1) % questions.length);
    setAnswer("");
  };

  const previousQuestion = () => {
    setCurrentQuestion((prev) => (prev - 1 + questions.length) % questions.length);
    setAnswer("");
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="Interview Practice"
        description="Practice interview questions with AI-powered feedback"
        actions={
          <div className="flex items-center gap-2">
            {backendConfigured && (
              <Button
                onClick={() => setShowJobInput(!showJobInput)}
                variant={showJobInput ? "default" : "outline"}
                size="sm"
                className={`inline-flex items-center gap-1.5 ${showJobInput ? 'bg-teal-500 text-white border-teal-500 hover:bg-teal-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {showJobInput ? "Cancel" : "Custom Questions"}
              </Button>
            )}
            {!showJobInput && (
              <Button
                onClick={() => {
                  if (jobDescription.trim()) {
                    generateQuestions();
                  } else {
                    toast.error("Please enter a job description first");
                    setShowJobInput(true);
                  }
                }}
                variant="outline"
                size="sm"
                className="inline-flex items-center gap-1.5 border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                Reset Questions
              </Button>
            )}
          </div>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {questions.length > 0 ? `Question ${currentQuestion + 1} of ${questions.length}` : "No questions"}
          </span>
        </ToolbarSection>
        {backendConfigured && (
          <ToolbarSection>
            <span className="text-xs text-muted-foreground">
              {backendConfigured ? "Backend: Connected" : "Backend: Local"}
            </span>
          </ToolbarSection>
        )}
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="flex h-full flex-col gap-6">
          {/* Job Description Input */}
          {showJobInput && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Generate Custom Questions</h3>
                
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">or paste manually below</span>
                  
                  {/* Select Saved Job Dropdown */}
                  <div className="relative">
                  <button
                    onClick={() => setShowJobDropdown(!showJobDropdown)}
                    disabled={loadingJobs}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 border-2 border-teal-500 rounded-lg text-teal-700 font-medium hover:bg-teal-100 transition-all duration-200"
                  >
                    <Briefcase className="h-4 w-4" />
                    {loadingJobs ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Select Saved Job
                        <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </button>
                  
                  {showJobDropdown && approvedJobs.length > 0 && (
                    <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-64 overflow-y-auto">
                      {approvedJobs.map((job) => (
                        <button
                          key={job.id}
                          onClick={() => handleSelectJob(job)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <div className="font-medium text-gray-900 text-sm">{job.company_name}</div>
                          <div className="text-xs text-gray-500">{job.role_title}</div>
                          <div className="text-xs text-teal-600 mt-1">Match: {job.match_score}%</div>
                        </button>
                      ))}
                      {approvedJobs.length === 0 && (
                        <div className="px-4 py-3 text-sm text-gray-500 text-center">
                          No approved jobs found
                        </div>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>
              
              <Textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste job description here to generate tailored interview questions (or select from saved jobs above)..."
                className="min-h-30 mb-3 border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={() => setShowJobInput(false)}
                  variant="outline"
                  size="sm"
                  className="border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </Button>
                <Button
                  onClick={generateQuestions}
                  disabled={isGenerating || !jobDescription.trim()}
                  size="sm"
                  className="bg-teal-500 text-white hover:bg-teal-600 border-2 border-teal-500"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      Generate Questions
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
          
          {/* Question Card */}
          {questions.length > 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold mb-2 text-gray-900">Current Question</h3>
                  <p className="text-base leading-relaxed text-gray-900">
                    {questions[currentQuestion]}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  onClick={handleReadAloud}
                  disabled={!supported}
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1.5 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  {isSpeaking ? <Pause className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  {isSpeaking ? "Pause" : "Read Aloud"}
                </Button>
                <Button
                  onClick={previousQuestion}
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1.5 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Previous
                </Button>
                <Button
                  onClick={nextQuestion}
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-1.5 border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Next
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Sparkles className="h-12 w-12 text-gray-400/50 mx-auto mb-4" />
                  <p className="text-sm text-gray-500">
                    No questions generated yet. Click "Custom Questions" to generate questions from a job description.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Answer Input */}
          {questions.length > 0 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Your Answer</h3>
                <span className="text-xs text-gray-500">
                  {answer.length} characters
                </span>
              </div>
              <Textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer here..."
                className="flex-1 resize-none border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <div className="flex items-center justify-end">
                <Button
                  onClick={handleSubmitAnswer}
                  disabled={isSubmitting || answer.trim().length < 20}
                  className="inline-flex items-center gap-1.5 bg-teal-500 text-white hover:bg-teal-600 border-2 border-teal-500"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      AI is analyzing your response...
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5 mr-1.5" />
                      Submit Answer
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Feedback History */}
          {feedbackHistory.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold mb-4">Feedback History</h3>
              <div className="space-y-3">
                {feedbackHistory.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "rounded-lg border p-4",
                      entry.rating === "good"
                        ? "border-success/30 bg-success/5"
                        : "border-warning/30 bg-warning/5"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {entry.rating === "good" ? (
                        <CheckCircle className="h-4 w-4 text-success mt-0.5" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-warning mt-0.5" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-muted-foreground">
                            {entry.timestamp.toLocaleString()}
                          </p>
                          <div className={cn(
                            "px-2 py-0.5 rounded-md text-xs font-bold",
                            entry.score >= 7 ? "bg-success/20 text-success" : "bg-warning/20 text-warning"
                          )}>
                            {entry.score}/10
                          </div>
                        </div>
                        <p className="text-sm font-medium mb-2 line-clamp-2">
                          Q: {entry.question}
                        </p>
                        <div className="rounded-sm bg-background p-3 mb-2">
                          <p className="text-sm text-foreground">{entry.feedback}</p>
                        </div>
                        {entry.improvement_suggestion && (
                          <div className="rounded-sm bg-secondary/50 p-3">
                            <p className="text-xs text-muted-foreground mb-1">💡 Improvement:</p>
                            <p className="text-sm text-foreground">{entry.improvement_suggestion}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </WorkspaceContent>
    </div>
  );
}