import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface Props {
  name: string;
  icon: LucideIcon;
  status: "idle" | "online" | "working";
  metric: string;
  metricLabel: string;
}

export function AgentStatusCard({ name, icon: Icon, status, metric, metricLabel }: Props) {
  const dot =
    status === "online"
      ? "bg-success"
      : status === "working"
        ? "bg-primary-glow"
        : "bg-muted-foreground/60";

  const statusText =
    status === "online" ? "Online" : status === "working" ? "Active" : "Standby";

  const iconBgClasses = cn(
    "flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-border/60",
    status === "online" && "bg-success/10 text-success",
    status === "working" && "bg-primary-glow/10 text-primary-glow",
    status === "idle" && "bg-muted/70 text-muted-foreground"
  );

  return (
    <div className="group relative overflow-hidden rounded-xl border-2 border-border bg-card p-4 transition-all hover:shadow-playful-lg hover:-translate-y-1 hover:animate-wiggle duration-150 shadow-playful h-32 paper-texture">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={iconBgClasses}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground">{name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
              {statusText}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="font-mono text-2xl font-bold tracking-tight text-foreground">
          {metric}
        </span>
        <span className="text-[11px] text-muted-foreground">{metricLabel}</span>
      </div>
    </div>
  );
}
