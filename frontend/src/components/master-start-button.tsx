import { Play, Pause, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FleetStatus = "idle" | "initializing" | "running";

interface Props {
  status: FleetStatus;
  onToggle: () => void;
  startLabel?: string;
  stopLabel?: string;
}

export function MasterStartButton({
  status,
  onToggle,
  startLabel = "Start Workflows",
  stopLabel = "Pause Workflows",
}: Props) {
  const label =
    status === "idle" ? startLabel : status === "initializing" ? "Starting…" : stopLabel;
  const running = status === "running";

  return (
    <button
      onClick={onToggle}
      className={cn(
        "group inline-flex items-center gap-2.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-all",
        "border backdrop-blur-md",
        running
          ? "border-border/60 bg-secondary/60 text-foreground hover:bg-secondary"
          : "border-primary/50 bg-gradient-to-b from-primary to-[color-mix(in_oklab,var(--primary)_75%,black)] text-primary-foreground shadow-[0_1px_0_0_color-mix(in_oklab,white_10%,transparent)_inset,0_8px_24px_-12px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:from-primary-glow",
      )}
    >
      {status === "initializing" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : running ? (
        <Pause className="h-4 w-4" />
      ) : (
        <Play className="h-4 w-4" />
      )}
      <span>{label}</span>
    </button>
  );
}
