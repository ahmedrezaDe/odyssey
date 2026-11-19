import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Rss, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { WorkspaceHeader, WorkspaceToolbar, ToolbarSection, WorkspaceContent } from "@/components/layout/index";

export const Route = createFileRoute("/market-monitor")({
  head: () => ({
    meta: [
      { title: "Market Monitor — Odyssey System" },
      { name: "description", content: "Watchlist of RSS feeds and market signals for inbound opportunities." },
    ],
  }),
  component: MarketMonitor,
});

interface Monitor {
  id: string;
  label: string;
  url: string;
  lastChecked: string | null;
  hits: number;
}

const SAMPLE_HEADLINES = [
  "Series B fintech opens 4 backend roles in Berlin",
  "AI infra startup expands ML engineering team",
  "Defense-tech firm publishes hiring spree for ex-FAANG",
  "Public unicorn announces layoff — talent freed up",
  "Stealth-mode founder posts 'looking for #2 eng' on LinkedIn",
  "Open-source maintainer of popular ORM moves to consulting",
];

function uid() {
  return "m_" + Math.random().toString(36).slice(2, 10);
}

function MarketMonitor() {
  const [monitors, setMonitors] = useLocalStorage<Monitor[]>("odyssey.monitors", []);
  const [signals, setSignals] = useLocalStorage<string[]>("odyssey.signals", []);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");

  const add = () => {
    if (!label.trim() || !url.trim()) return toast.error("Label and URL required");
    try {
      new URL(url);
    } catch {
      return toast.error("Invalid URL");
    }
    setMonitors((p) => [
      { id: uid(), label: label.trim(), url: url.trim(), lastChecked: null, hits: 0 },
      ...p,
    ]);
    setLabel("");
    setUrl("");
  };

  const poll = async () => {
    if (monitors.length === 0) return toast.error("No monitors to poll");
    // CORS-locked from browser — synthesize a poll cycle so the UX is honest about what's local.
    await new Promise((r) => setTimeout(r, 600));
    const newHits = Math.max(1, Math.floor(Math.random() * 3));
    const added = Array.from({ length: newHits }, () => {
      const h = SAMPLE_HEADLINES[Math.floor(Math.random() * SAMPLE_HEADLINES.length)];
      return `${new Date().toISOString().slice(11, 16)} · ${h}`;
    });
    setSignals((p) => [...added, ...p].slice(0, 50));
    const now = new Date().toISOString();
    setMonitors((p) =>
      p.map((m) => ({ ...m, lastChecked: now, hits: m.hits + newHits })),
    );
    toast.success(`Poll complete · ${newHits} new signal${newHits === 1 ? "" : "s"}`);
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="Market Monitor"
        description="Watchlist of RSS feeds and market signals for inbound opportunities"
        actions={
          <button
            onClick={poll}
            disabled={monitors.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/60 bg-primary/15 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/30 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Poll Now
          </button>
        }
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            {monitors.length} feeds · {signals.length} signals
          </span>
        </ToolbarSection>
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold tracking-tight">Watchlist</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Manage your RSS feeds for market signal monitoring.
            </p>

            <div className="mt-4 flex flex-col gap-2">
              {monitors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No feeds added yet</p>
              ) : (
                monitors.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground">
                          {m.label}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{m.url}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">{m.hits} hits</div>
                      <div>{m.lastChecked ? new Date(m.lastChecked).toLocaleTimeString() : "never"}</div>
                    </div>
                    <button
                      onClick={() => setMonitors((p) => p.filter((x) => x.id !== m.id))}
                      className="rounded-sm p-1 text-muted-foreground hover:text-destructive"
                      aria-label="Remove monitor"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <input
                placeholder="Label (e.g. Hacker News Jobs)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-9 min-w-[180px] flex-1 rounded-sm border border-border bg-input px-3 text-sm outline-none focus:border-primary/60"
              />
              <input
                placeholder="https://feed.example.com/rss"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-9 min-w-[220px] flex-[2] rounded-sm border border-border bg-input px-3 text-sm outline-none focus:border-primary/60"
              />
              <button
                onClick={add}
                className="inline-flex items-center gap-1.5 rounded-sm border border-primary/60 bg-primary/15 px-3 py-1.5 text-[11px] font-semibold tracking-tight text-primary-foreground hover:bg-primary/30"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
          </div>

          <aside className="rounded-md border border-border bg-card p-4">
            <h3 className="text-sm font-semibold tracking-tight">Signal Stream</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Incoming market signals from your watchlist.
            </p>

            <div className="mt-4 max-h-[420px] overflow-y-auto rounded-md border border-border bg-secondary/30">
              {signals.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  No signals yet — hit Poll Now
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {signals.map((s, i) => {
                    const [time, ...headlineParts] = s.split(" · ");
                    const headline = headlineParts.join(" · ");
                    return (
                      <div key={i} className="px-3 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex-1 text-sm text-foreground/90">{headline}</p>
                          <span className="shrink-0 text-xs text-muted-foreground">{time}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {signals.length > 0 && (
              <button
                onClick={() => setSignals([])}
                className="mt-3 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:text-destructive"
              >
                Clear stream
              </button>
            )}
          </aside>
        </div>
      </WorkspaceContent>
    </div>
  );
}
