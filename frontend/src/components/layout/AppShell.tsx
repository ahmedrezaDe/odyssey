import { ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppTopBar } from "./AppTopBar";
import { Workspace } from "./Workspace";
import { Inspector } from "./Inspector";
import { ActivityStrip } from "./ActivityStrip";
import { CommandProvider } from "@/contexts/CommandContext";
import { CommandPalette } from "@/components/command/CommandPalette";
import { useCommandHotkeys } from "@/hooks/useCommandHotkeys";

interface Props {
  children: ReactNode;
}

function ShellContent({ children }: Props) {
  useCommandHotkeys();
  const location = useLocation();

  // Only render Inspector on routes that utilize it
  const showInspector = ['/triage-agent', '/cv-generator'].includes(location.pathname);

  return (
    <>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopBar />

        <div className="flex min-h-0 flex-1">
          <Workspace>{children}</Workspace>
          {showInspector && <Inspector />}
        </div>

        <ActivityStrip />
      </div>

      {/* Global overlays */}
      <CommandPalette />
    </>
  );
}

export function AppShell({ children }: Props) {
  return (
    <SidebarProvider defaultOpen>
      <CommandProvider>
        <div className="flex h-screen w-screen overflow-hidden bg-background">
          <ShellContent>{children}</ShellContent>
        </div>
      </CommandProvider>
    </SidebarProvider>
  );
}