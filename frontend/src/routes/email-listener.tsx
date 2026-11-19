import { createFileRoute } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import { ActivityFeed } from "@/components/activity-feed";
import { useFleetSimulator } from "@/hooks/use-fleet-simulator";
import { WorkspaceHeader, WorkspaceToolbar, ToolbarSection, WorkspaceContent } from "@/components/layout/index";

export const Route = createFileRoute("/email-listener")({
  head: () => ({
    meta: [
      { title: "Inbound Gateway — Odyssey" },
      { name: "description", content: "Persistent inbound mail channel that forwards messages into the document intake pipeline." },
    ],
  }),
  component: InboundGateway,
});

function InboundGateway() {
  const { lines } = useFleetSimulator();
  return (
    <div className="flex h-full w-full flex-col gap-6">
      <WorkspaceHeader 
        title="Inbound Gateway"
        description="Persistent inbound mail channel that forwards messages into the document intake pipeline"
      />
      <WorkspaceToolbar>
        <ToolbarSection>
          <span className="text-sm text-muted-foreground">
            Gateway Active · Queue: 0
          </span>
        </ToolbarSection>
      </WorkspaceToolbar>
      <WorkspaceContent>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-sm font-semibold tracking-tight text-muted-foreground">Pipeline Status</div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-success ring-2 ring-background" />
              <span className="text-sm font-medium text-foreground">Active</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Gateway is operational and processing incoming messages.
            </p>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-sm font-semibold tracking-tight text-muted-foreground">Queue Depth</div>
            <div className="mt-3 text-2xl font-semibold text-foreground">0</div>
            <p className="mt-2 text-xs text-muted-foreground">
              No messages currently awaiting processing.
            </p>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-sm font-semibold tracking-tight text-muted-foreground">Model Size</div>
            <div className="mt-3 text-2xl font-semibold text-foreground">4.2 MB</div>
            <p className="mt-2 text-xs text-muted-foreground">
              Categorization model loaded and ready.
            </p>
          </div>
        </div>

        <ActivityFeed items={lines} title="Gateway Activity" className="h-[560px]" />
      </WorkspaceContent>
    </div>
  );
}
