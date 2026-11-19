import { FileText, Sparkles, AlertCircle, Check, Edit3, Clock } from "lucide-react";
import { useWorkspaceStore, type TemplateData } from "@/stores/workspace.store";

export function Inspector() {
    const { selectedId, documents, templates, inspectorType, inspectorOpen } = useWorkspaceStore();
    const selectedDocument = Array.isArray(documents) ? documents.find(doc => doc.id === selectedId) : undefined;
    const selectedTemplate = Array.isArray(templates) ? templates.find(t => t.id === selectedId) : undefined;

    const getStatusPill = (status: string) => {
        switch (status) {
            case "queued":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                        Queued
                    </span>
                );
            case "analyzing":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        Analyzing
                    </span>
                );
            case "complete":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-success">
                        <Check className="h-3 w-3" />
                        Complete
                    </span>
                );
            case "error":
                return (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        Error
                    </span>
                );
            default:
                return null;
        }
    };

    const renderTemplateDetails = (template: TemplateData) => (
        <div className="flex flex-col gap-4">
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">{template.name}</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{template.type.replace("-", " ")}</span>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold">Last Modified</h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(template.lastModified).toLocaleDateString()}</span>
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold">Template Actions</h3>
                <button className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                    <Edit3 className="h-4 w-4" />
                    Edit Template
                </button>
                <button className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-secondary">
                    <FileText className="h-4 w-4" />
                    Duplicate
                </button>
            </div>
        </div>
    );

    const renderDocumentDetails = () => (
        <div className="flex flex-col gap-4">
            <div className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">
                    {selectedDocument?.name}
                </h3>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{selectedDocument?.type}</span>
                    <span>•</span>
                    <span>{((selectedDocument?.size || 0) / 1024).toFixed(1)} KB</span>
                </div>
                {selectedDocument && getStatusPill(selectedDocument.status)}
            </div>

            {selectedDocument?.matchScore !== undefined && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Match Score</h3>
                        <span className="text-2xl font-bold text-primary">
                            {selectedDocument.matchScore}%
                        </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${selectedDocument.matchScore}%` }}
                        />
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <h3 className="text-sm font-semibold">Missing Skills</h3>
                <div className="flex flex-wrap gap-2">
                    {selectedDocument?.missingSkills && selectedDocument.missingSkills.length > 0 ? (
                        selectedDocument.missingSkills.map((skill) => (
                            <span
                                key={skill}
                                className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                            >
                                <AlertCircle className="h-3 w-3" />
                                {skill}
                            </span>
                        ))
                    ) : (
                        <span className="text-xs text-muted-foreground">No missing skills identified</span>
                    )}
                </div>
            </div>

            <div className="space-y-2">
                <h3 className="text-sm font-semibold">Analysis Feedback</h3>
                <div className="rounded-md border border-border bg-secondary/30 p-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        {selectedDocument?.feedback || "No feedback available"}
                    </p>
                </div>
            </div>

            {selectedDocument?.status === "complete" && (
                <button
                    className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                    <Sparkles className="h-4 w-4" />
                    Optimize Document
                </button>
            )}
        </div>
    );

    return (
        <aside
            className={`
                w-[340px]
                border-l
                border-border
                bg-card/30
                flex-col
                ${inspectorOpen ? 'flex' : 'hidden'}
            `}
        >
            <div className="border-b border-border p-4">
                <h2 className="text-sm font-semibold">
                    {inspectorType === "template" ? "Template Details" : "Document Details"}
                </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {inspectorType === "template" && selectedTemplate ? (
                    renderTemplateDetails(selectedTemplate)
                ) : inspectorType === "document" && selectedDocument ? (
                    renderDocumentDetails()
                ) : (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-center">
                            <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                            <p className="mt-3 text-sm text-muted-foreground">
                                Select an item to view details
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground/70">
                                Click on a document or template to see detailed information
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </aside>
    );
}