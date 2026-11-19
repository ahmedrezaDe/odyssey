import { create } from 'zustand';

export interface DocumentData {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  status: "queued" | "analyzing" | "complete" | "error";
  matchScore?: number;
  missingSkills?: string[];
  feedback?: string;
}

export interface TemplateData {
  id: string;
  name: string;
  type: "resume" | "cover-letter" | "portfolio";
  lastModified: string;
}

interface WorkspaceState {
  // UI State
  inspectorOpen: boolean;
  selectedId: string | null;
  inspectorType: "document" | "template" | null;
  
  // Document Data
  documents: DocumentData[];
  
  // Template Data
  templates: TemplateData[];
  
  // Actions
  setInspectorOpen: (open: boolean) => void;
  setSelectedId: (id: string | null) => void;
  setInspectorType: (type: "document" | "template" | null) => void;
  toggleInspector: () => void;
  setDocuments: (docs: DocumentData[]) => void;
  updateDocument: (id: string, updates: Partial<DocumentData>) => void;
  setTemplates: (templates: TemplateData[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  inspectorOpen: false,
  selectedId: null,
  inspectorType: null,
  documents: [],
  templates: [],
  
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  setSelectedId: (id) => set({ selectedId: id }),
  setInspectorType: (type) => set({ inspectorType: type }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setDocuments: (docs) => set({ documents: docs }),
  updateDocument: (id, updates) => set((state) => ({
    documents: state.documents.map(doc => 
      doc.id === id ? { ...doc, ...updates } : doc
    )
  })),
  setTemplates: (templates) => set({ templates: templates }),
}));