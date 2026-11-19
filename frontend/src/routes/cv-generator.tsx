import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Download, Plus, Edit3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  WorkspaceHeader,
  WorkspaceToolbar,
  ToolbarSection,
  WorkspaceContent,
} from "@/components/layout/index";
import { useWorkspaceStore, type TemplateData } from "@/stores/workspace.store";
import { odyssey } from "@/lib/api/odyssey";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/cv-generator")({
  head: () => ({
    meta: [
      { title: "Document Studio — Odyssey" },
      {
        name: "description",
        content: "Compose polished candidate documents from structured data.",
      },
    ],
  }),
  component: DocumentStudioComponent,
});

interface Template {
  id: string;
  name: string;
  type: "resume" | "cover-letter" | "portfolio";
  lastModified: string;
}

const TEMPLATES: Template[] = [
  {
    id: "1",
    name: "ATS-Optimized Resume",
    type: "resume",
    lastModified: "2024-01-15T00:00:00.000Z",
  },
];

interface TailoredCVData {
  professional_summary?: string;
  optimized_bullets?: string[];
  error?: string;
}

interface DocumentContent {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  languages: string;
  summary: string;
  experience: string;
  education: string;
  skills: string;
}

interface PersonalInfo {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  languages?: string | string[];
}

interface EducationEntry {
  degree?: string;
  institution?: string;
}

interface ExperienceEntry {
  role?: string;
  company?: string;
  duration?: string;
}

interface ProfilePreferences {
  profile_name?: string;
  location?: string;
  languages?: string | string[];
  education?: EducationEntry[];
  experience?: ExperienceEntry[];
}

interface UserProfile {
  personal_info?: PersonalInfo;
  preferences?: ProfilePreferences;
  resume_text?: string;
  tech_stack?: string[] | string;
}

function DocumentStudioComponent() {
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(TEMPLATES[0] || null);
  const { setTemplates, setSelectedId, setInspectorType } = useWorkspaceStore();
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [selectedJobLead, setSelectedJobLead] = useState<Record<string, unknown> | null>(null);
  const [tailoredCVData, setTailoredCVData] = useState<TailoredCVData | null>(null);

  useEffect(() => {
    const templateData: TemplateData[] = TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      lastModified: t.lastModified,
    }));
    setTemplates(templateData);
  }, [setTemplates]);

  // Load user profile on mount
  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    setLoadingProfile(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return;
      }

      const response = await odyssey.userProfile.get();
      if (response && response.success && response.data) {
        setProfile(response.data);
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      // Don't show error toast - profile might not exist yet
    } finally {
      setLoadingProfile(false);
    }
  };

  const [documentContent, setDocumentContent] = useState<DocumentContent>({
    name: "",
    title: "",
    email: "",
    phone: "",
    location: "",
    languages: "",
    summary: "",
    experience: "",
    education: "",
    skills: "",
  });

  // Hydrate document content with profile data when available
  useEffect(() => {
    if (profile) {
      const personalInfo = profile.personal_info || {};
      const profileName =
        personalInfo.name ||
        profile.preferences?.profile_name ||
        profile.resume_text?.split("\n")[0] ||
        "";
      const profileLocation = personalInfo.location || profile.preferences?.location || "";
      const profileLanguages = personalInfo.languages || profile.preferences?.languages || [];

      // Handle education array (from preferences or personal_info)
      const educationArray = profile.preferences?.education || [];
      const educationText =
        educationArray.length > 0
          ? educationArray
              .map(
                (edu: EducationEntry) =>
                  `${edu.degree}${edu.institution ? ` at ${edu.institution}` : ""}`,
              )
              .join("\n")
          : "";

      // Handle tech stack array
      const techStackArray = profile.tech_stack || [];
      const skillsText = Array.isArray(techStackArray)
        ? techStackArray.join(", ")
        : typeof techStackArray === "string"
          ? techStackArray
          : "";

      // Handle experience array (from preferences)
      const experienceArray = profile.preferences?.experience || [];
      const experienceText =
        experienceArray.length > 0
          ? experienceArray
              .map(
                (exp: ExperienceEntry) =>
                  `${exp.role} at ${exp.company}${exp.duration ? ` (${exp.duration})` : ""}`,
              )
              .join("\n")
          : "";

      setDocumentContent({
        name: profileName,
        title: personalInfo.title || "",
        email: personalInfo.email || "",
        phone: personalInfo.phone || "",
        location: profileLocation,
        languages: Array.isArray(profileLanguages) ? profileLanguages.join(", ") : profileLanguages,
        summary: profile.resume_text || "",
        experience: experienceText,
        education: educationText,
        skills: skillsText,
      });
    }
  }, [profile]);

  // Apply tailored CV data when a job lead is selected
  useEffect(() => {
    if (selectedJobLead && tailoredCVData && !tailoredCVData.error) {
      setDocumentContent((prev) => ({
        ...prev,
        summary: tailoredCVData.professional_summary || prev.summary,
        experience: tailoredCVData.optimized_bullets?.join("\n") || prev.experience,
      }));
    }
  }, [selectedJobLead, tailoredCVData]);

  const handleLoadJobLead = async (jobLeadId: string) => {
    try {
      const response = await odyssey.jobLeads.get(jobLeadId);
      if (response.success && response.data) {
        setSelectedJobLead(response.data);
        if (response.data.tailored_cv_data) {
          try {
            const parsed = JSON.parse(response.data.tailored_cv_data);
            setTailoredCVData(parsed);
          } catch (e) {
            console.error("Failed to parse tailored CV data:", e);
            setTailoredCVData(null);
          }
        } else {
          setTailoredCVData(null);
        }
        toast.success("Job lead loaded", {
          description: "Tailored CV data applied to document.",
        });
      }
    } catch (error) {
      toast.error("Failed to load job lead");
    }
  };

  const handleResetToProfile = () => {
    setSelectedJobLead(null);
    setTailoredCVData(null);
    if (profile) {
      const personalInfo = profile.personal_info || {};
      const profileName =
        personalInfo.name ||
        profile.preferences?.profile_name ||
        profile.resume_text?.split("\n")[0] ||
        "";
      const profileLocation = personalInfo.location || profile.preferences?.location || "";
      const profileLanguages = personalInfo.languages || profile.preferences?.languages || [];

      const educationArray = profile.preferences?.education || [];
      const educationText =
        educationArray.length > 0
          ? educationArray
              .map(
                (edu: EducationEntry) =>
                  `${edu.degree}${edu.institution ? ` at ${edu.institution}` : ""}`,
              )
              .join("\n")
          : "";

      const techStackArray = profile.tech_stack || [];
      const skillsText = Array.isArray(techStackArray)
        ? techStackArray.join(", ")
        : typeof techStackArray === "string"
          ? techStackArray
          : "";

      const experienceArray = profile.preferences?.experience || [];
      const experienceText =
        experienceArray.length > 0
          ? experienceArray
              .map(
                (exp: ExperienceEntry) =>
                  `${exp.role} at ${exp.company}${exp.duration ? ` (${exp.duration})` : ""}`,
              )
              .join("\n")
          : "";

      setDocumentContent({
        name: profileName,
        title: personalInfo.title || "",
        email: personalInfo.email || "",
        phone: personalInfo.phone || "",
        location: profileLocation,
        languages: Array.isArray(profileLanguages) ? profileLanguages.join(", ") : profileLanguages,
        summary: profile.resume_text || "",
        experience: experienceText,
        education: educationText,
        skills: skillsText,
      });
    }
    toast.success("Reset to profile data");
  };

  const handleExportPDF = () => {
    // Validate required fields
    if (!documentContent.name) {
      toast.error("Missing required field", {
        description: "Please add your name before exporting.",
      });
      return;
    }

    toast.success("Exporting PDF", {
      description: "Your document is being prepared for download.",
    });

    // Generate dynamic filename with user's name
    const sanitizedName = documentContent.name.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `${sanitizedName}_CV_ATS_Optimized.pdf`;

    // Create ATS-optimized printable content
    const printContent = `
      <html>
        <head>
          <title>${documentContent.name} - CV</title>
          <style>
            body { 
              font-family: Arial, Helvetica, sans-serif; 
              max-width: 650px; 
              margin: 0 auto; 
              padding: 40px 50px; 
              color: #000000;
              line-height: 1.5;
            }
            h1 { 
              font-size: 18pt; 
              font-weight: bold; 
              margin: 0 0 5px 0; 
              color: #000000;
            }
            .contact-line { 
              font-size: 11pt; 
              margin: 0 0 20px 0; 
              color: #000000;
            }
            h2 { 
              font-size: 12pt; 
              font-weight: bold; 
              margin: 20px 0 10px 0; 
              text-transform: uppercase; 
              border-bottom: 1px solid #000000;
              padding-bottom: 5px;
              color: #000000;
            }
            p { 
              font-size: 11pt; 
              margin: 0 0 10px 0; 
              color: #000000;
            }
            .skills-section { 
              margin: 20px 0; 
            }
            .skills-grid { 
              display: flex; 
              flex-wrap: wrap; 
              gap: 10px; 
            }
            .skill-item { 
              font-size: 11pt; 
            }
            ul { 
              margin: 0 0 10px 20px; 
              padding: 0;
            }
            li { 
              font-size: 11pt; 
              margin: 0 0 5px 0; 
              color: #000000;
            }
          </style>
        </head>
        <body>
          <h1>${documentContent.name}</h1>
          <div class="contact-line">
            ${documentContent.email ? documentContent.email : ""}${documentContent.email && documentContent.phone ? " | " : ""}${documentContent.phone ? documentContent.phone : ""}${(documentContent.email || documentContent.phone) && documentContent.location ? " | " : ""}${documentContent.location ? documentContent.location : ""}${(documentContent.email || documentContent.phone || documentContent.location) && documentContent.languages ? " | " : ""}${documentContent.languages ? documentContent.languages : ""}
          </div>
          
          ${
            documentContent.summary
              ? `
          <h2>Professional Summary</h2>
          <p>${documentContent.summary}</p>
          `
              : ""
          }
          
          ${
            documentContent.experience
              ? `
          <h2>Work Experience</h2>
          <p>${documentContent.experience.replace(/\n/g, "<br>")}</p>
          `
              : ""
          }
          
          ${
            documentContent.education
              ? `
          <h2>Education</h2>
          <p>${documentContent.education.replace(/\n/g, "<br>")}</p>
          `
              : ""
          }
          
          ${
            documentContent.skills
              ? `
          <h2>Technical Skills</h2>
          <div class="skills-section">
            <div class="skills-grid">
              ${documentContent.skills
                .split(",")
                .map((skill) => `<span class="skill-item">${skill.trim()}</span>`)
                .join("")}
            </div>
          </div>
          `
              : ""
          }
        </body>
      </html>
    `;

    // Create a temporary iframe for printing
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();

      // Trigger print dialog
      setTimeout(() => {
        printWindow.print();
        toast.success("PDF Downloaded", {
          description: "Your document has been exported successfully.",
        });
      }, 500);
    } else {
      toast.error("Failed to open print window");
    }
  };

  const handleFieldChange = (field: keyof DocumentContent, value: string) => {
    setDocumentContent((prev) => ({ ...prev, [field]: value }));
  };

  const getEmptyStateMessage = (field: string) => {
    const messages: Record<string, string> = {
      name: "Add your name in Settings",
      title: "Add your professional title in Settings",
      email: "Add your email in Settings",
      phone: "Add your phone number in Settings",
      location: "Add your location in Settings",
      languages: "Add your languages in Settings",
      summary: "Add your professional summary in Settings",
      experience: "Add your work experience in Settings",
      education: "Add your education in Settings",
      skills: "Add your technical skills in Settings",
    };
    return messages[field] || "";
  };

  const renderField = (
    field: keyof DocumentContent,
    label: string,
    placeholder: string,
    isTextArea = false,
  ) => {
    const value = documentContent[field];
    const isEmpty = !value || value.trim() === "";

    return (
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-900 mb-2">
          {label}
        </h3>
        {isTextArea ? (
          <textarea
            value={value}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            className="w-full text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-900 placeholder:text-gray-400/50 resize-none"
            rows={field === "summary" ? 3 : field === "experience" ? 5 : 2}
            placeholder={placeholder}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => handleFieldChange(field, e.target.value)}
            className="w-full text-sm bg-transparent border-none outline-none focus:ring-0 text-gray-900 placeholder:text-gray-400/50"
            placeholder={placeholder}
          />
        )}
        {isEmpty && (
          <p className="mt-1 text-xs text-muted-foreground italic">{getEmptyStateMessage(field)}</p>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader
        title="Document Studio"
        description="Compose polished candidate documents from structured data"
        actions={
          <button
            onClick={handleResetToProfile}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/30"
          >
            <Edit3 className="h-3.5 w-3.5" />
            Reset to Profile
          </button>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {TEMPLATES.length} template available
          </span>
        </ToolbarSection>
        <ToolbarSection>
          <button
            onClick={() => {
              // Load job lead (for demo - in production, this would be a dropdown or selection)
              toast.info("Load Job Lead", {
                description: "Select a job lead from Job Bounty to apply tailored CV data.",
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/80"
          >
            <FileText className="h-3.5 w-3.5" />
            Load Job Lead
          </button>
        </ToolbarSection>
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
          {/* LEFT PANEL - Templates & Assets */}
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold tracking-tight">Templates & Assets</h2>

            <div className="flex-1 space-y-2 overflow-y-auto">
              {TEMPLATES.map((template) => (
                <div
                  key={template.id}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setSelectedId(template.id);
                    setInspectorType("template");
                  }}
                  className={cn(
                    "group flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                    selectedTemplate?.id === template.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-secondary/30",
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-medium truncate">{template.name}</h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toast.success("Template loaded", {
                            description: "You can now edit the document canvas.",
                          });
                          setSelectedTemplate(template);
                          setSelectedId(template.id);
                          setInspectorType("template");
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary rounded"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground capitalize">
                      {template.type.replace("-", " ")}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Last modified: {new Date(template.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Profile Assets
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Work History</span>
                  <span className="text-xs text-primary">
                    {profile?.preferences?.experience?.length || 0} entries
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Education</span>
                  <span className="text-xs text-primary">
                    {profile?.preferences?.education?.length || 0} entries
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Skills</span>
                  <span className="text-xs text-primary">
                    {profile?.tech_stack?.length || 0} skills
                  </span>
                </div>
              </div>
              {selectedJobLead && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Active Job Lead</span>
                    <span className="text-xs text-primary truncate max-w-[150px]">
                      {String(selectedJobLead.company_name || "")}
                    </span>
                  </div>
                  {tailoredCVData && !tailoredCVData.error && (
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Tailored Data</span>
                      <span className="text-xs text-green-600">Applied</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL - ATS-Optimized Document Canvas */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Document Canvas (ATS-Optimized)
              </h2>
              <button
                onClick={handleExportPDF}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/30"
              >
                <Download className="h-3.5 w-3.5" />
                Export PDF
              </button>
            </div>

            <div className="flex-1 rounded-lg border border-border bg-background p-8 overflow-y-auto">
              {loadingProfile ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading your profile data...</p>
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-2xl space-y-6">
                  {/* Header - ATS Compliant */}
                  <div className="border-b border-border pb-6">
                    {renderField("name", "Name", "Your Name")}
                    {renderField("title", "Professional Title", "Professional Title")}
                    <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      {renderField("email", "Email", "email@example.com")}
                      <span>•</span>
                      {renderField("phone", "Phone", "(555) 123-4567")}
                      <span>•</span>
                      {renderField("location", "Location", "City, Country")}
                      <span>•</span>
                      {renderField("languages", "Languages", "English, German")}
                    </div>
                  </div>

                  {/* Professional Summary */}
                  {renderField(
                    "summary",
                    "Professional Summary",
                    "Write a brief professional summary...",
                    true,
                  )}

                  {/* Work Experience */}
                  {renderField(
                    "experience",
                    "Work Experience",
                    "List your work experience...",
                    true,
                  )}

                  {/* Education */}
                  {renderField("education", "Education", "Your education details...", true)}

                  {/* Technical Skills */}
                  {renderField("skills", "Technical Skills", "List your technical skills...", true)}

                  {/* Profile Experience Preview (UI only, not exported) */}
                  {profile?.preferences?.experience &&
                    profile.preferences.experience.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-dashed border-border">
                        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-900 mb-2">
                          Experience from Profile (Preview Only)
                        </h3>
                        <div className="space-y-2">
                          {profile.preferences.experience.map(
                            (exp: ExperienceEntry, idx: number) => (
                              <div
                                key={idx}
                                className="text-sm text-gray-700 bg-gray-50 p-2 rounded"
                              >
                                <div className="font-medium">{exp.role}</div>
                                <div className="text-xs text-gray-500">
                                  {exp.company} {exp.duration ? `• ${exp.duration}` : ""}
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      </WorkspaceContent>
    </div>
  );
}
