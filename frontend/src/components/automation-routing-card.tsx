import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Webhook, Send, Database } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const urlSchema = z
  .string()
  .trim()
  .max(2048, "URL too long")
  .url("Must be a valid https URL")
  .refine((u) => /^https?:\/\//i.test(u), "Must start with http(s)://");

interface Row {
  id: "n8n" | "make";
  name: string;
  hint: string;
}

const rows: Row[] = [
  { id: "n8n", name: "n8n Webhook", hint: "https://n8n.example.com/webhook/…" },
  { id: "make", name: "Make.com Webhook", hint: "https://hook.eu1.make.com/…" },
];

function buildDummyCandidate() {
  return {
    event: "candidate.created",
    timestamp: new Date().toISOString(),
    candidate: {
      id: `cand_${Math.random().toString(36).slice(2, 10)}`,
      name: "Ada Lovelace",
      email: "ada@odyssey.local",
      role: "Senior Python Engineer",
      score: 0.92,
      tags: ["python", "ml", "backend"],
    },
    source: "odyssey.fleet_commander",
  };
}

export function AutomationRoutingCard() {
  const [crmEnabled, setCrmEnabled] = useState(false);
  const [urls, setUrls] = useState<Record<Row["id"], string>>({ n8n: "", make: "" });
  const [enabled, setEnabled] = useState<Record<Row["id"], boolean>>({ n8n: false, make: false });
  const [sending, setSending] = useState(false);

  const handleTest = async () => {
    const targets = rows.filter((r) => enabled[r.id]);
    if (targets.length === 0) {
      toast.error("No active webhook", {
        description: "Enable at least one webhook before sending a test payload.",
      });
      return;
    }

    for (const r of targets) {
      const parsed = urlSchema.safeParse(urls[r.id]);
      if (!parsed.success) {
        toast.error(`${r.name} URL is invalid`, {
          description: parsed.error.issues[0]?.message ?? "Check the webhook URL.",
        });
        return;
      }
    }

    const payload = buildDummyCandidate();
    setSending(true);
    // Simulated round-trip — no real network call
    await new Promise((res) => setTimeout(res, 700));
    setSending(false);

    toast.success("Test payload delivered", {
      description: `Mock fired to ${targets.map((t) => t.name).join(" + ")} · candidate ${payload.candidate.id}`,
    });
    if (crmEnabled) {
      setTimeout(
        () =>
          toast("CRM log written", {
            description: "External CRM mirror updated (simulated).",
          }),
        400,
      );
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-secondary text-primary-glow ring-1 ring-border">
            <Webhook className="h-4 w-4" />
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary-glow">
              // routing
            </div>
            <h2 className="text-base font-semibold tracking-tight">Automation Routing</h2>
          </div>
        </div>
      </header>

      <div className="mt-5 flex items-center justify-between rounded-sm border border-border bg-secondary/40 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 text-muted-foreground" />
          <div>
            <Label htmlFor="crm-toggle" className="text-sm font-medium">
              External CRM logging
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Mirror every fleet event into the connected CRM.
            </p>
          </div>
        </div>
        <Switch id="crm-toggle" checked={crmEnabled} onCheckedChange={setCrmEnabled} />
      </div>

      <div className="mt-4 space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`url-${r.id}`} className="text-sm font-medium">
                {r.name}
              </Label>
              <Switch
                checked={enabled[r.id]}
                onCheckedChange={(v) => setEnabled((p) => ({ ...p, [r.id]: v }))}
                aria-label={`Enable ${r.name}`}
              />
            </div>
            <Input
              id={`url-${r.id}`}
              type="url"
              inputMode="url"
              maxLength={2048}
              placeholder={r.hint}
              value={urls[r.id]}
              onChange={(e) => setUrls((p) => ({ ...p, [r.id]: e.target.value }))}
              disabled={!enabled[r.id]}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          dummy candidate payload
        </p>
        <button
          onClick={handleTest}
          disabled={sending}
          className="group inline-flex items-center gap-2 rounded-sm border border-primary/50 bg-primary/10 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary-foreground transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5 text-primary-glow" />
          {sending ? "Firing…" : "Test Payload"}
        </button>
      </div>
    </section>
  );
}
