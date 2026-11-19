import { Search, Bell, PanelLeft, LogOut, Settings, Sun, Moon, Monitor } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useCommand } from "@/contexts/CommandContext";
import { supabase } from "@/lib/supabase";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";

interface Props {
  showSidebarTrigger?: boolean;
}

export function AppTopBar({ showSidebarTrigger = true }: Props) {
  const { setOpen } = useCommand();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  const handleSettings = () => {
    navigate({ to: "/identity" });
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 bg-background/95 px-6 backdrop-blur">
      {/* LEFT: SidebarTrigger */}
      <div className="flex items-center gap-3">
        {showSidebarTrigger && <SidebarTrigger />}
      </div>

      {/* RIGHT: Search and Utilities */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hidden md:flex h-9 w-64 items-center justify-start rounded-xl border-2 border-border bg-muted/40 px-4 text-sm font-bold text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-playful-sm hover:-translate-y-0.5"
        >
          <Search className="mr-2 h-4 w-4" />
          <span>Search... (⌘K)</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-accent hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle transition-all">
              {theme === 'light' && <Sun className="h-4 w-4" />}
              {theme === 'dark' && <Moon className="h-4 w-4" />}
              {theme === 'system' && <Monitor className="h-4 w-4" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun className="mr-2 h-4 w-4" />
              Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor className="mr-2 h-4 w-4" />
              System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-accent hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle transition-all">
          <Bell className="h-4 w-4" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Avatar className="h-9 w-9 border-2 border-border cursor-pointer shadow-playful-sm hover:shadow-playful hover:-translate-y-0.5 transition-all">
              <AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-bold">AR</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleSettings}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Log Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}