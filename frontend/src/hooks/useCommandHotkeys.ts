"use client";

import { useEffect } from "react";
import { useCommand } from "@/contexts/CommandContext";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import { useTheme } from "./use-theme";

export function useCommandHotkeys() {
  const { toggle } = useCommand();
  const navigate = useNavigate();
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Command/Ctrl + K: Toggle command palette
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }

      // Command/Ctrl + G: Go to home
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        navigate({ to: "/" });
      }

      // Command/Ctrl + S: Go to settings
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        navigate({ to: "/settings" });
      }

      // Command/Ctrl + T: Toggle theme
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
        setTheme(nextTheme);
      }

      // Command/Ctrl + Shift + L: Logout
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        supabase.auth.signOut();
        navigate({ to: "/login" });
      }

      // Escape: Close modals/command palette
      if (e.key === "Escape") {
        // Command palette handles this internally
        // Could add additional modal closing logic here
      }
    };

    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [toggle, navigate, setTheme, theme]);
}

export const keyboardShortcuts = [
  {
    keys: ["⌘", "K"],
    description: "Toggle command palette",
  },
  {
    keys: ["⌘", "⇧", "G"],
    description: "Go to home",
  },
  {
    keys: ["⌘", "S"],
    description: "Go to settings",
  },
  {
    keys: ["⌘", "T"],
    description: "Toggle theme",
  },
  {
    keys: ["⌘", "⇧", "L"],
    description: "Logout",
  },
  {
    keys: ["Esc"],
    description: "Close modal/command palette",
  },
];