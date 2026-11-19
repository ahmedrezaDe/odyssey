import { useState } from "react";
import { Download, Lock, Unlock, Plus, X, Sliders, Cpu, Bot, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// ─────────────────────────────────────────────────────────────
// AgentConstraintMatrix — mirrors LLM_CONTEXT.md §2.1 exactly.
// ─────────────────────────────────────────────────────────────
export type AgentRole =
  | "triage" | "cv" | "email" | "roaster"
  | "ats" | "interview" | "networking" | "market";

export type ModelProvider = "groq" | "openai" | "elevenlabs";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AgentConstraintMatrix {
  agent_id: string;
  role: AgentRole;
  model: {
    provider: ModelProvider;
    name: string;
    temperature: number;
    max_tokens: number;
  };
  constraints: {
    max_runtime_ms: number;
    max_body_bytes: number;
    allowed_tools: string[];
    forbidden_tokens: string[];
  };
  io: {
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  };
  telemetry: {
    log_level: LogLevel;
    emit_events: boolean;
  };
}

const ROLES: AgentRole[] = [
  "triage", "cv", "email", "roaster",
  "ats", "interview", "networking", "market",
];

const ROLE_META: Record<AgentRole, { label: string; tools: string[]; hint: string; icon: typeof Bot }> = {
  triage:     { label: "Job Analyzer",   tools: ["ats_match"],                          hint: "Resume intake + classification", icon: Sparkles },
  cv:         { label: "CV Generator",  tools: [],                                     hint: "Template-driven CV rendering", icon: Cpu },
  email:      { label: "Email Listener", tools: [],                                  hint: "IMAP IDLE inbound parsing", icon: Bot },
  roaster:    { label: "Resume Critic", tools: ["roast_resume"],                       hint: "Rule-based bullet critique", icon: Sliders },
  ats:        { label: "ATS Matcher",   tools: ["ats_match"],                          hint: "TF-IDF resume ↔ JD scoring", icon: Cpu },
  interview:  { label: "Interview Prep", tools: ["generate_interview_questions"],       hint: "JD → questions + TTS", icon: Bot },
  networking: { label: "Networking AI", tools: ["draft_networking_email"],             hint: "Outbound email drafts", icon: Sparkles },
  market:     { label: "Market Watcher", tools: [],                                     hint: "RSS/news watchlist polling", icon: Bot },
};

function defaultConfig(role: AgentRole): AgentConstraintMatrix {
  return {
    agent_id: `odyssey-${role}`,
    role,
    model: {
      provider: role === "interview" ? "elevenlabs" : "groq",
      name: role === "interview" ? "eleven_turbo_v2" : "llama-3.1-70b-versatile",
      temperature: 0.4,
      max_tokens: 2048,
    },
    constraints: {
      max_runtime_ms: 30_000,
      max_body_bytes: 262_144,
      allowed_tools: [...ROLE_META[role].tools],
      forbidden_tokens: [],
    },
    io: { input_schema: {}, output_schema: {} },
    telemetry: { log_level: "info", emit_events: true },
  };
}

const DEFAULT_MATRIX: Record<AgentRole, AgentConstraintMatrix> = ROLES.reduce(
  (acc, r) => ({ ...acc, [r]: defaultConfig(r) }),
  {} as Record<AgentRole, AgentConstraintMatrix>,
);
const DEFAULT_LOCKS: Record<AgentRole, boolean> = ROLES.reduce(
  (acc, r) => ({ ...acc, [r]: false }),
  {} as Record<AgentRole, boolean>,
);

function download(cfg: AgentConstraintMatrix) {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `odyssey-agent-${cfg.role}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success(`Downloaded odyssey-agent-${cfg.role}.json`);
}

function downloadAll(matrix: Record<AgentRole, AgentConstraintMatrix>) {
  const bundle = { version: 1, exportedAt: new Date().toISOString(), agents: matrix };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `odyssey-agents-bundle-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success("Downloaded full agent bundle");
}

export function AgentConstraintPanel() {
  const [matrix, setMatrix] = useLocalStorage<Record<AgentRole, AgentConstraintMatrix>>(
    "odyssey.agents", DEFAULT_MATRIX,
  );
  const [locks, setLocks] = useLocalStorage<Record<AgentRole, boolean>>(
    "odyssey.agents.locks", DEFAULT_LOCKS,
  );
  const [active, setActive] = useState<AgentRole>("triage");
  const cfg = matrix[active] ?? defaultConfig(active);
  const locked = locks[active] ?? false;

  const patch = (updater: (c: AgentConstraintMatrix) => AgentConstraintMatrix) => {
    if (locked) { toast("Unlock this agent to edit"); return; }
    setMatrix((prev) => ({ ...prev, [active]: updater(prev[active] ?? defaultConfig(active)) }));
  };

  const toggleLock = () =>
    setLocks((prev) => ({ ...prev, [active]: !(prev[active] ?? false) }));

  const resetOne = () => {
    if (locked) { toast("Unlock first"); return; }
    setMatrix((prev) => ({ ...prev, [active]: defaultConfig(active) }));
    toast(`Reset ${active} to defaults`);
  };

  const getReasoningStyle = (temp: number) => {
    if (temp < 0.3) return "Analytical";
    if (temp < 0.6) return "Balanced";
    return "Creative";
  };

  const getResponseDetail = (tokens: number) => {
    if (tokens < 1000) return "Concise";
    if (tokens < 3000) return "Standard";
    return "Comprehensive";
  };

  return (
    <div className="space-y-6">
      {/* Role Selection */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ROLES.map((r) => {
          const Icon = ROLE_META[r].icon;
          return (
            <button
              key={r}
              onClick={() => setActive(r)}
              className={`relative p-4 rounded-xl border transition-all duration-300 ${
                active === r
                  ? "bg-white shadow-sm border-b-2 border-teal-500 text-gray-900"
                  : "bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              {locks[r] && (
                <div className="absolute top-2 right-2">
                  <Lock className="h-3 w-3 text-gray-400" />
                </div>
              )}
              <Icon className={`h-6 w-6 ${active === r ? "text-teal-600" : "text-gray-400"}`} />
              <div className={`mt-2 text-sm font-medium ${active === r ? "text-gray-900" : "text-gray-500"}`}>
                {ROLE_META[r].label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Configuration Panel */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{ROLE_META[active].label}</h3>
            <p className="text-sm text-gray-500">{ROLE_META[active].hint}</p>
          </div>
          <button
            onClick={() => downloadAll(matrix)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-50 border-2 border-teal-500 rounded-lg text-teal-700 text-sm font-medium hover:bg-teal-100 transition-all duration-300"
          >
            <Download className="h-4 w-4" />
            Export Agent Matrix
          </button>
        </div>

        {/* User-Friendly Controls */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Reasoning Style */}
            <div className="space-y-3">
              <Label className="text-sm font-medium text-gray-700">Reasoning Style</Label>
              <div className="space-y-2">
                <input
                  type="range" min={0} max={1} step={0.05}
                  value={cfg.model.temperature}
                  onChange={(e) =>
                    patch((c) => ({ ...c, model: { ...c.model, temperature: Number(e.target.value) } }))
                  }
                  disabled={locked}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600 disabled:opacity-50"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Analytical</span>
                  <span className="text-teal-600 font-medium">{getReasoningStyle(cfg.model.temperature)}</span>
                  <span>Creative</span>
                </div>
              </div>
            </div>

            {/* Response Detail */}
            <div className="space-y-3">
              <Label className="text-sm font-medium text-gray-700">Response Detail</Label>
              <div className="space-y-2">
                <input
                  type="range" min={256} max={8192} step={256}
                  value={cfg.model.max_tokens}
                  onChange={(e) =>
                    patch((c) => ({ ...c, model: { ...c.model, max_tokens: Math.max(256, Math.min(8192, Number(e.target.value) || 256)) } }))
                  }
                  disabled={locked}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600 disabled:opacity-50"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Concise</span>
                  <span className="text-teal-600 font-medium">{getResponseDetail(cfg.model.max_tokens)}</span>
                  <span>Comprehensive</span>
                </div>
              </div>
            </div>
          </div>

          {/* Model Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">AI Provider</Label>
              <select
                value={cfg.model.provider}
                onChange={(e) =>
                  patch((c) => ({ ...c, model: { ...c.model, provider: e.target.value as ModelProvider } }))
                }
                disabled={locked}
                className="h-12 w-full bg-white border-gray-200 rounded-xl text-gray-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
              >
                <option value="groq">Groq (Fast Inference)</option>
                <option value="openai">OpenAI (GPT Models)</option>
                <option value="elevenlabs">ElevenLabs (Voice)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Model Name</Label>
              <Input
                value={cfg.model.name}
                onChange={(e) => patch((c) => ({ ...c, model: { ...c.model, name: e.target.value } }))}
                disabled={locked}
                className="h-12 bg-white border-gray-200 rounded-xl text-gray-900 placeholder:text-gray-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
              />
            </div>
          </div>

          {/* Advanced Technical Settings */}
          <details className="bg-gray-50 border border-gray-200 rounded-xl">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors">
              Advanced Technical Settings
            </summary>
            <div className="p-4 space-y-4 border-t border-gray-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-600">Max Runtime (ms)</Label>
                  <Input
                    type="number" min={100} step={100}
                    value={cfg.constraints.max_runtime_ms}
                    onChange={(e) =>
                      patch((c) => ({ ...c, constraints: { ...c.constraints, max_runtime_ms: Math.max(100, Number(e.target.value) || 100) } }))
                    }
                    disabled={locked}
                    className="h-10 bg-white border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-600">Max Body Bytes</Label>
                  <Input
                    type="number" min={1024}
                    value={cfg.constraints.max_body_bytes}
                    onChange={(e) =>
                      patch((c) => ({ ...c, constraints: { ...c.constraints, max_body_bytes: Math.max(1024, Number(e.target.value) || 1024) } }))
                    }
                    disabled={locked}
                    className="h-10 bg-white border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-600">Log Level</Label>
                  <select
                    value={cfg.telemetry.log_level}
                    onChange={(e) =>
                      patch((c) => ({ ...c, telemetry: { ...c.telemetry, log_level: e.target.value as LogLevel } }))
                    }
                    disabled={locked}
                    className="h-10 w-full bg-white border-gray-200 rounded-lg text-gray-900 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 text-sm"
                  >
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warn">Warning</option>
                    <option value="error">Error</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-gray-600">Agent ID</Label>
                  <Input
                    value={cfg.agent_id}
                    onChange={(e) => patch((c) => ({ ...c, agent_id: e.target.value }))}
                    disabled={locked}
                    className="h-10 bg-white border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="emit"
                  type="checkbox"
                  checked={cfg.telemetry.emit_events}
                  onChange={(e) =>
                    patch((c) => ({ ...c, telemetry: { ...c.telemetry, emit_events: e.target.checked } }))
                  }
                  disabled={locked}
                  className="h-4 w-4 accent-teal-600 disabled:opacity-50"
                />
                <label htmlFor="emit" className="text-xs font-medium text-gray-700">
                  Emit telemetry events
                </label>
              </div>

              {/* Token arrays */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <StringArray
                  label="Allowed Tools"
                  values={cfg.constraints.allowed_tools}
                  disabled={locked}
                  placeholder="mcp_tool_name"
                  onChange={(next) =>
                    patch((c) => ({ ...c, constraints: { ...c.constraints, allowed_tools: next } }))
                  }
                />
                <StringArray
                  label="Forbidden Tokens (regex)"
                  values={cfg.constraints.forbidden_tokens}
                  disabled={locked}
                  placeholder="^(password|secret)$"
                  mono
                  onChange={(next) =>
                    patch((c) => ({ ...c, constraints: { ...c.constraints, forbidden_tokens: next } }))
                  }
                />
              </div>
            </div>
          </details>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={() => download(cfg)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download Config
            </button>
            <button
              onClick={toggleLock}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
                locked
                  ? "bg-orange-50 border-orange-300 text-orange-700"
                  : "bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
              {locked ? "Locked" : "Unlocked"}
            </button>
            <button
              onClick={resetOne}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
            >
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StringArray({
  label, values, onChange, disabled, placeholder, mono,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) { toast("Already added"); return; }
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-gray-600">{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          disabled={disabled}
          placeholder={placeholder}
          className="h-10 bg-white border-gray-200 rounded-lg text-gray-900 placeholder:text-gray-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 disabled:opacity-50 text-sm"
        />
        <button
          onClick={add}
          disabled={disabled}
          className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-300 bg-gray-100 text-gray-700 hover:border-teal-500 hover:text-teal-600 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.length === 0 && (
          <span className="text-xs text-gray-500 italic">No items added</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-gray-300 bg-gray-50 text-gray-700 text-xs"
          >
            {v}
            {!disabled && (
              <button
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="text-gray-500 hover:text-red-600 transition-colors"
                aria-label={`Remove ${v}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}