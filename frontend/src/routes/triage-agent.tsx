import { useCallback, useRef, useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  UploadCloud,
  Sparkles,
  Check,
  AlertCircle,
  Loader2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  WorkspaceHeader, 
  WorkspaceToolbar, 
  ToolbarSection, 
  WorkspaceContent 
} from "@/components/layout/index";
import { useWorkspaceStore, type DocumentData } from "@/stores/workspace.store";
import { processDocument } from "@/lib/api/odyssey";
import { odyssey } from "@/lib/api/odyssey";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/triage-agent")({
  head: () => ({
    meta: [
      { title: "Document Analysis — Odyssey" },
      {
        name: "description",
        content:
          "Upload and analyze documents with intelligent matching and optimization suggestions.",
      },
    ],
  }),
  component: DocumentAnalysisComponent,
});

const MAX_FILES = 8;
const MAX_BYTES = 10 * 1024 * 1024; // 10MB per file
const ACCEPTED = [".pdf", ".doc", ".docx", ".txt", ".md", ".rtf"];

const MISSING_SKILLS = ["Python", "React", "AWS", "TypeScript"];

function DocumentAnalysisComponent() {
  const [dragOver, setDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileMapRef = useRef<Map<string, File>>(new Map());
  
  const { documents, setDocuments, updateDocument, setSelectedId, selectedId, setInspectorType, setInspectorOpen } = useWorkspaceStore();

  const handleFileSelect = (id: string) => {
    setSelectedId(id);
    setInspectorType("document");
    setInspectorOpen(true);
  };

  const ingest = useCallback((list: FileList | File[]) => {
    try {
      const incoming = Array.from(list);
      const accepted: DocumentData[] = [];
      for (const f of incoming) {
        const ext = "." + f.name.split(".").pop()?.toLowerCase();
        if (!ACCEPTED.includes(ext)) {
          toast.error(`Rejected ${f.name}`, { description: `Allowed: ${ACCEPTED.join(", ")}` });
          continue;
        }
        if (f.size > MAX_BYTES) {
          toast.error(`Rejected ${f.name}`, { description: "Exceeds 10MB limit." });
          continue;
        }
        const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        fileMapRef.current.set(id, f);
        accepted.push({
          id,
          name: f.name,
          size: f.size,
          type: ext,
          status: "queued",
          uploadedAt: new Date().toISOString(),
        });
      }
      if (accepted.length === 0) return;
      if (documents.length + accepted.length > MAX_FILES) {
        toast.error("Too many files", { description: `Maximum ${MAX_FILES} files allowed.` });
        return;
      }
      setDocuments([...documents, ...accepted]);
      toast.success(`Added ${accepted.length} file${accepted.length > 1 ? "s" : ""}`);
    } catch (error) {
      console.error("File ingestion error:", error);
      toast.error("Failed to process files", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      }
      );
    }
  }, [documents]);

  const analyzeFile = async (doc: DocumentData) => {
    const file = fileMapRef.current.get(doc.id);
    if (!file) {
      toast.error("File not available for analysis");
      return;
    }

    updateDocument(doc.id, { status: "analyzing" });
    setIsProcessing(true);

    try {
      const result = await processDocument(file);
      
      updateDocument(doc.id, { 
        status: "complete",
        matchScore: result.matchScore,
        missingSkills: result.missingSkills,
        feedback: result.feedback,
      });
      
      toast.success(`Analysis complete: ${doc.name}`);
      
      // Auto-select the document and show inspector
      setSelectedId(doc.id);
      setInspectorType("document");
      setInspectorOpen(true);
      
    } catch (error) {
      console.error("Analysis failed:", error);
      updateDocument(doc.id, { status: "error" });
      toast.error(`Analysis failed: ${doc.name}`, {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const syncToProfile = async (doc: DocumentData) => {
    const file = fileMapRef.current.get(doc.id);
    if (!file) {
      toast.error("File not available for sync");
      return;
    }

    // Check if it's a PDF
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error("Only PDF files can be synced to profile");
      return;
    }

    setSyncingProfile(true);

    try {
      // Get auth headers using the same logic as other API calls
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        toast.error("Not authenticated - please log in first");
        return;
      }

      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Determine base URL from environment variable (production) or empty string (relative for dev)
      const baseUrl = import.meta.env.VITE_ODYSSEY_API_URL || '';
      const apiUrl = baseUrl ? `${baseUrl}/api/user/profile/parse` : '/api/user/profile/parse';

      // Call the backend parsing endpoint with proper auth
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          // Don't set Content-Type - let the browser set it with boundary
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to parse error response' }));
        throw new Error(errorData.detail || 'Failed to parse resume');
      }

      const result = await response.json();
      
      toast.success("Profile synced successfully!", {
        description: `Extracted ${result.parsed_data.tech_stack.length} skills from your resume`,
      });

      // Trigger a page reload to refresh profile data globally
      // This will re-fetch the profile in Settings and Document Studio
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (error) {
      console.error("Profile sync failed:", error);
      toast.error("Failed to sync profile", {
        description: error instanceof Error ? error.message : "Unknown error occurred",
      });
    } finally {
      setSyncingProfile(false);
    }
  };

// Cleanup file map when documents are removed
  useEffect(() => {
    const docIds = new Set(documents.map(d => d.id));
    
    const map = fileMapRef.current;
    for (const id of map.keys()) {
      if (!docIds.has(id)) {
        map.delete(id);
      }
    }
  }, [documents]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    ingest(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "complete":
        return <Badge className="bg-success/10 text-success hover:bg-success/20">Complete</Badge>;
      case "analyzing":
        return <Badge className="bg-warning/10 text-warning hover:bg-warning/20">Analyzing</Badge>;
      case "error":
        return <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20">Failed</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground">Queued</Badge>;
    }
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="Document Analysis"
        description="Upload and analyze documents with intelligent matching and optimization suggestions"
        actions={
          <Button 
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            Upload Documents
          </Button>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {documents.length} / {MAX_FILES} documents
          </span>
        </ToolbarSection>
        {isProcessing && (
          <ToolbarSection>
            <div className="flex items-center gap-2 text-sm text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Processing documents...</span>
            </div>
          </ToolbarSection>
        )}
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="flex h-full flex-col gap-6">
          {/* Upload Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
              dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
          >
            <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag and drop documents here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Accepted: PDF, DOC, DOCX, TXT, MD, RTF (max 10MB per file)
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED.join(",")}
              className="hidden"
              onChange={(e) => e.target.files && ingest(e.target.files)}
            />
          </div>

          {/* Documents Table */}
          {documents.length > 0 && (
            <div className="flex-1 overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => (
                    <TableRow
                      key={doc.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        selectedId === doc.id ? "bg-primary/5" : "hover:bg-muted/50"
                      )}
                      onClick={() => handleFileSelect(doc.id)}
                    >
                      <TableCell className="font-medium">{doc.name}</TableCell>
                      <TableCell>{formatSize(doc.size)}</TableCell>
                      <TableCell>{getStatusBadge(doc.status)}</TableCell>
                      <TableCell>
                        {doc.status === "complete" ? (
                          <span className="text-sm font-semibold text-primary">{doc.matchScore}%</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {doc.status === "queued" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              analyzeFile(doc);
                            }}
                            disabled={isProcessing}
                          >
                            <Sparkles className="h-3.5 w-3.5 mr-1" />
                            Analyze
                          </Button>
                        )}
                        {doc.status === "analyzing" && (
                          <span className="text-xs text-muted-foreground">Processing...</span>
                        )}
                        {doc.status === "complete" && (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-xs text-success">
                              <Check className="h-3.5 w-3.5" />
                              Done
                            </div>
                            {doc.name.toLowerCase().endsWith('.pdf') && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  syncToProfile(doc);
                                }}
                                disabled={syncingProfile}
                                className="text-xs"
                              >
                                {syncingProfile ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                    Syncing...
                                  </>
                                ) : (
                                  <>
                                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                                    Sync to Profile
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        )}
                        {doc.status === "error" && (
                          <div className="flex items-center gap-1 text-xs text-destructive">
                            <AlertCircle className="h-3.5 w-3.5" />
                            Failed
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Empty State */}
          {documents.length === 0 && (
            <div className="flex-1 flex items-center justify-center rounded-lg border border-border bg-muted/20">
              <div className="text-center">
                <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">
                  No documents uploaded yet
                </p>
              </div>
            </div>
          )}
        </div>
      </WorkspaceContent>
    </div>
  );
}