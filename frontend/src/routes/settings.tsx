import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon, Download, Trash2, CheckCircle, XCircle, Plus, X, ChevronDown, ChevronUp, Sparkles, Shield, Zap, Layers, Cpu, Globe, Database, Sliders, Bot, Code, Save, Loader2, Keyboard } from "lucide-react";
import { toast } from "sonner";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AgentConstraintPanel } from "@/components/agent-constraint-panel";
import { odyssey } from "@/lib/api/odyssey";
import { supabase } from "@/lib/supabase";
import { useEffect, useState, useRef } from "react";
import { type FilterCriteria } from "@/types/database.types";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts";


interface SettingsState {
  apiBaseUrl: string;
  corsAllow: string;
  defaultVoice: "system" | "elevenlabs";
  filterCriteria: FilterCriteria;
}

const DEFAULTS: SettingsState = {
  apiBaseUrl: "",
  corsAllow: "*",
  defaultVoice: "system",
  filterCriteria: {
    allowed_keywords: [],
    blocked_keywords: ["arbeitserlaubnis", "aufenthaltstitel", "sprachkenntnisse", "deutsch", "german fluent"],
    min_match_score: 40,
    profile_name: "",
    location: "",
    tech_stack: [],
  },
};


export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Command Center — Odyssey AI" },
      { name: "description", content: "Your AI-powered job hunting command center" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [s, setS, reset] = useLocalStorage<SettingsState>("odyssey.settings", {
    ...DEFAULTS,
    apiBaseUrl: "", // Will be overridden by env var if available
  });

  // Profile data state
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  // Prioritize environment variable for API URL (only if user hasn't manually set a different value)
  useEffect(() => {
    const envApiUrl = import.meta.env.VITE_ODYSSEY_API_URL;
    if (envApiUrl && (!s.apiBaseUrl || s.apiBaseUrl === "")) {
      setS((prev) => ({ ...prev, apiBaseUrl: envApiUrl }));
    }
  }, []);

  // Ensure filterCriteria is always defined
  useEffect(() => {
    if (!s.filterCriteria) {
      setS((prev) => ({ ...prev, filterCriteria: DEFAULTS.filterCriteria }));
    }
  }, [s.filterCriteria]);

  // Load user profile from backend
  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    setLoadingProfile(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return;
      }

      setUserId(user.id);

      const response = await odyssey.userProfile.get();
      if (response && response.success && response.data) {
        setProfile(response.data);
        // Sync filterCriteria with profile data
        setS((prev) => ({
          ...prev,
          filterCriteria: {
            ...prev.filterCriteria,
            profile_name: response.data.preferences?.profile_name || prev.filterCriteria.profile_name,
            location: response.data.preferences?.location || prev.filterCriteria.location,
            tech_stack: response.data.tech_stack || prev.filterCriteria.tech_stack,
          }
        }));
      }
    } catch (error) {
      console.error("Failed to load profile:", error);
      // Don't show error toast - profile might not exist yet
    } finally {
      setLoadingProfile(false);
    }
  };

  const saveProfile = async () => {
    if (!userId) {
      toast.error("Not authenticated");
      return;
    }

    setSavingProfile(true);
    try {
      const response = await odyssey.userProfile.upsert({
        user_id: userId,
        resume_text: profile?.resume_text || "",
        tech_stack: s.filterCriteria?.tech_stack || [],
        preferences: {
          ...profile?.preferences,
          profile_name: s.filterCriteria?.profile_name || "",
          location: s.filterCriteria?.location || "",
        },
      });

      if (response.success) {
        toast.success("Profile saved successfully!");
        setProfile(response.data);
      } else {
        toast.error("Failed to save profile");
      }
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Error saving profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const [backendStatus, setBackendStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [activeTab, setActiveTab] = useState<"identity" | "workflows" | "advanced">("identity");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    const checkConnection = async () => {
      try {
        await odyssey.fleet.health();
        setBackendStatus("connected");
      } catch (error) {
        console.error("Backend health check failed:", error);
        setBackendStatus("disconnected");
      }
    };
    checkConnection();
  }, [s.apiBaseUrl]);

  const exportAll = () => {
    const dump: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("odyssey.")) {
        try {
          dump[k] = JSON.parse(localStorage.getItem(k) ?? "null");
        } catch {
          dump[k] = localStorage.getItem(k);
        }
      }
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `odyssey-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    toast.success("Exported all local data");
  };

  const wipe = () => {
    if (!confirm("Wipe all Odyssey data from this browser?")) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("odyssey.")) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
    reset();
    toast("All local data wiped");
  };

  const update = <K extends keyof SettingsState>(k: K, v: SettingsState[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const updateFilter = <K extends keyof FilterCriteria>(k: K, v: FilterCriteria[K]) =>
    setS((p) => ({ ...p, filterCriteria: { ...p.filterCriteria, [k]: v } }));

  return (
    <div className="min-h-screen">
      <div className="relative max-w-7xl mx-auto p-6 lg:p-8">
        {/* Header */}
        <header className="mb-8 animate-bounce-in-stagger-1">
          <div className="flex items-center gap-4 mb-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-secondary text-primary-glow ring-1 ring-border shadow-playful">
              <SettingsIcon className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                ⚙️ Command Center
              </h1>
              <p className="text-sm text-muted-foreground mt-1">Configure your AI-powered job hunting operations</p>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-3 mt-4">
            {backendStatus === "checking" && (
              <div className="flex items-center gap-2 px-4 py-2 bg-card border-2 border-border rounded-lg shadow-playful-sm">
                <div className="h-2 w-2 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-xs text-muted-foreground font-medium">Checking connection...</span>
              </div>
            )}
            {backendStatus === "connected" && (
              <div className="flex items-center gap-2 px-4 py-2 bg-success/20 border-2 border-success rounded-lg shadow-playful-sm">
                <CheckCircle className="h-4 w-4 text-success" />
                <span className="text-xs text-success font-bold">Systems Online</span>
              </div>
            )}
            {backendStatus === "disconnected" && (
              <div className="flex items-center gap-2 px-4 py-2 bg-destructive/20 border-2 border-destructive rounded-lg shadow-playful-sm">
                <XCircle className="h-4 w-4 text-destructive" />
                <span className="text-xs text-destructive font-bold">Connection Lost</span>
              </div>
            )}
          </div>
        </header>

        {/* Navigation Tabs */}
        <div className="flex gap-2 mb-8 animate-bounce-in-stagger-2">
          {[
            { id: "identity" as const, icon: Shield, label: "Identity & Filters" },
            { id: "workflows" as const, icon: Bot, label: "AI Workflows" },
            { id: "advanced" as const, icon: Code, label: "Advanced" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-card border-2 border-primary text-primary shadow-playful hover:shadow-playful-lg hover:-translate-y-0.5 hover:animate-wiggle"
                  : "bg-card border-2 border-border text-muted-foreground hover:border-primary/60 hover:bg-primary/15 hover:text-primary hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="space-y-6">
          {activeTab === "identity" && (
            <>
              {/* Profile Information */}
              <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-3">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-primary ring-1 ring-border">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight">Profile Information</h2>
                      <p className="text-sm text-muted-foreground">Your professional identity for AI-powered matching</p>
                    </div>
                  </div>
                  <Button
                    onClick={saveProfile}
                    disabled={savingProfile || loadingProfile}
                    className="h-10 border-2 border-primary bg-primary/15 font-bold text-primary shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
                  >
                    {savingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" />
                        Save Profile
                      </>
                    )}
                  </Button>
                </div>

                {loadingProfile ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-foreground">Full Name</Label>
                      <Input
                        value={s.filterCriteria?.profile_name || ""}
                        onChange={(e) => updateFilter("profile_name", e.target.value)}
                        placeholder="John Doe"
                        className="h-12 border-2 border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-playful-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-foreground">Location</Label>
                      <Input
                        value={s.filterCriteria?.location || ""}
                        onChange={(e) => updateFilter("location", e.target.value)}
                        placeholder="San Francisco, CA"
                        className="h-12 border-2 border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-playful-sm"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <Label className="text-sm font-bold text-foreground">Tech Stack</Label>
                      <TagInput
                        tags={s.filterCriteria?.tech_stack || []}
                        onChange={(tags) => updateFilter("tech_stack", tags)}
                        placeholder="Add technology (e.g., React, Python)"
                      />
                    </div>
                  </div>
                )}
              </section>

              {/* Scraping Filters */}
              <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-4">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground ring-1 ring-border">
                    <Layers className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Scraping Filters</h2>
                    <p className="text-sm text-muted-foreground">Control which jobs get captured during automated scraping</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-sm font-bold text-foreground">Target Keywords (must include)</Label>
                    <TagInput
                      tags={s.filterCriteria?.allowed_keywords || []}
                      onChange={(tags) => updateFilter("allowed_keywords", tags)}
                      placeholder="Add keyword (e.g., Remote, Senior)"
                      variant="success"
                    />
                    <p className="text-xs text-muted-foreground">Jobs must contain at least one of these keywords</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-bold text-foreground">Blocked Keywords (auto-reject)</Label>
                    <TagInput
                      tags={s.filterCriteria?.blocked_keywords || []}
                      onChange={(tags) => updateFilter("blocked_keywords", tags)}
                      placeholder="Add keyword to block (e.g., Entry-level)"
                      variant="danger"
                    />
                    <p className="text-xs text-muted-foreground">Jobs containing these will be automatically rejected</p>
                  </div>

                  <div className="space-y-3">
                    <Label className="text-sm font-bold text-foreground">Minimum Match Score: {s.filterCriteria?.min_match_score || 40}%</Label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={s.filterCriteria?.min_match_score || 40}
                      onChange={(e) => updateFilter("min_match_score", parseInt(e.target.value))}
                      className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>More inclusive</span>
                      <span>Stricter matching</span>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeTab === "workflows" && (
            <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-3">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground ring-1 ring-border">
                  <Cpu className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Active AI Workflows</h2>
                  <p className="text-sm text-muted-foreground">Configure your autonomous AI agents and their behavior</p>
                </div>
              </div>

              <AgentConstraintPanel />
            </section>
          )}

          {activeTab === "advanced" && (
            <>
              {/* Advanced Settings */}
              <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-3">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/20 text-warning ring-1 ring-border">
                    <Code className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Advanced Developer Settings</h2>
                    <p className="text-sm text-muted-foreground">Technical configuration for integration and debugging</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-foreground">API Base URL</Label>
                      <Input
                        value={s.apiBaseUrl}
                        onChange={(e) => update("apiBaseUrl", e.target.value)}
                        placeholder="http://localhost:8000"
                        className="h-12 border-2 border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:border-warning focus:ring-2 focus:ring-warning/20 shadow-playful-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-foreground">CORS Allow Origins</Label>
                      <Input
                        value={s.corsAllow}
                        onChange={(e) => update("corsAllow", e.target.value)}
                        placeholder="* or https://app.example.com"
                        className="h-12 border-2 border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:border-warning focus:ring-2 focus:ring-warning/20 shadow-playful-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-foreground">Default Voice</Label>
                      <select
                        value={s.defaultVoice}
                        onChange={(e) => update("defaultVoice", e.target.value as SettingsState["defaultVoice"])}
                        className="h-12 w-full border-2 border-border rounded-xl bg-background text-foreground focus:border-warning focus:ring-2 focus:ring-warning/20 shadow-playful-sm"
                      >
                        <option value="system">System (Web Speech)</option>
                        <option value="elevenlabs">ElevenLabs (requires key)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              {/* Keyboard Shortcuts */}
              <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20 text-accent ring-1 ring-border">
                    <Keyboard className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Keyboard Shortcuts</h2>
                    <p className="text-sm text-muted-foreground">Power user shortcuts for quick navigation</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <KeyboardShortcutsDialog />
                </div>
              </section>

              {/* Data Management */}
              <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-4">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/20 text-primary ring-1 ring-border">
                    <Database className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">Data Management</h2>
                    <p className="text-sm text-muted-foreground">Export your configuration or reset local data</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={exportAll}
                    className="flex items-center gap-2 px-6 py-3 bg-primary/15 border-2 border-primary rounded-xl text-primary font-bold shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
                  >
                    <Download className="h-4 w-4" />
                    Export Agent Matrix
                  </button>
                  <button
                    onClick={wipe}
                    className="flex items-center gap-2 px-6 py-3 bg-destructive/15 border-2 border-destructive rounded-xl text-destructive font-bold shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 hover:animate-wiggle active:scale-95 transition-all duration-200"
                  >
                    <Trash2 className="h-4 w-4" />
                    Wipe Local Data
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TagInput({ 
  tags, 
  onChange, 
  placeholder, 
  variant = "default" 
}: { 
  tags: string[]; 
  onChange: (tags: string[]) => void; 
  placeholder: string;
  variant?: "default" | "success" | "danger";
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput("");
    }
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter(tag => tag !== tagToRemove));
  };

  const variantStyles = {
    default: "bg-secondary border-border text-secondary-foreground",
    success: "bg-success/20 border-success text-success",
    danger: "bg-destructive/20 border-destructive text-destructive",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 text-sm font-bold shadow-playful-sm ${variantStyles[variant]}`}
          >
            {tag}
            <button
              onClick={() => removeTag(tag)}
              className="hover:opacity-70 transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-sm text-muted-foreground italic">No tags added yet</span>
        )}
      </div>
      <Input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-12 border-2 border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-playful-sm"
      />
    </div>
  );
}

