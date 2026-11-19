"use client";

import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "cmdk";
import { useCommand } from "@/contexts/CommandContext";
import { useNavigate } from "@tanstack/react-router";
import {
    LayoutDashboard,
    FileSearch,
    FileText,
    MessageSquare,
    Users,
    Settings,
    Search,
    Sparkles,
    Sun,
    Moon,
    LogOut,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";

const commands = [
    { to: "/", label: "Overview", icon: LayoutDashboard, description: "Dashboard & fleet status" },
    { to: "/triage-agent", label: "Document Analysis", icon: FileSearch, description: "Classify and triage documents" },
    { to: "/cv-generator", label: "Document Studio", icon: FileText, description: "Create and edit resumes" },
    { to: "/interview", label: "Interview Practice", icon: MessageSquare, description: "Practice with AI interviewer" },
    { to: "/networking", label: "Networking", icon: Users, description: "Manage connections" },
    { to: "/settings", label: "Settings", icon: Settings, description: "Configure workspace" },
];

export function CommandPalette() {
    const { open, setOpen } = useCommand();
    const navigate = useNavigate();
    const { theme, setTheme } = useTheme();

    const handleNavigate = (to: string) => {
        navigate({ to });
        setOpen(false);
    };

    const handleThemeToggle = () => {
        const nextTheme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
        setTheme(nextTheme);
        setOpen(false);
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate({ to: "/login" });
        setOpen(false);
    };

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
            onClick={() => setOpen(false)}
        >
            <Command
                className="w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-border bg-card shadow-playful-2xl paper-texture animate-bounce-in-stagger"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center gap-3 border-b-2 border-border px-5 py-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-playful-sm">
                        <Search className="h-5 w-5" />
                    </div>
                    <CommandInput
                        placeholder="Search workspace..."
                        className="flex-1 border-none bg-transparent px-0 text-base font-bold text-foreground outline-none placeholder:text-muted-foreground/60"
                    />
                    <kbd className="hidden h-8 rounded-xl border-2 border-border bg-muted px-3 text-xs font-bold text-muted-foreground shadow-playful-sm sm:inline-flex">
                        ⌘K
                    </kbd>
                </div>

                <CommandList className="max-h-[400px] overflow-y-auto px-3 py-3">
                    <CommandEmpty className="flex flex-col items-center justify-center py-12 text-center">
                        <Sparkles className="mb-3 h-12 w-12 text-muted-foreground/30" />
                        <p className="text-sm font-bold text-muted-foreground">No results found</p>
                        <p className="mt-1 text-xs text-muted-foreground/60">Try a different search term</p>
                    </CommandEmpty>

                    <CommandGroup heading="Navigation" className="space-y-1 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                        {commands.map((command) => {
                            const Icon = command.icon;
                            return (
                                <CommandItem
                                    key={command.to}
                                    onSelect={() => handleNavigate(command.to)}
                                    className="group flex items-center gap-3 rounded-xl border-2 border-transparent px-4 py-3 text-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle"
                                >
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-playful-sm group-hover:shadow-playful group-hover:scale-110 transition-all">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-bold">{command.label}</span>
                                        <span className="text-xs text-muted-foreground">{command.description}</span>
                                    </div>
                                </CommandItem>
                            );
                        })}
                    </CommandGroup>

                    <CommandGroup heading="Actions" className="space-y-1 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider">
                        <CommandItem
                            onSelect={handleThemeToggle}
                            className="group flex items-center gap-3 rounded-xl border-2 border-transparent px-4 py-3 text-foreground transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle"
                        >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent shadow-playful-sm group-hover:shadow-playful group-hover:scale-110 transition-all">
                                {theme === "light" ? <Sun className="h-5 w-5" /> : theme === "dark" ? <Moon className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold">Toggle Theme</span>
                                <span className="text-xs text-muted-foreground">Current: {theme}</span>
                            </div>
                        </CommandItem>
                        <CommandItem
                            onSelect={handleLogout}
                            className="group flex items-center gap-3 rounded-xl border-2 border-transparent px-4 py-3 text-foreground transition-all hover:border-destructive/30 hover:bg-destructive/10 hover:shadow-playful-sm hover:-translate-y-0.5 hover:animate-wiggle"
                        >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive shadow-playful-sm group-hover:shadow-playful group-hover:scale-110 transition-all">
                                <LogOut className="h-5 w-5" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-bold">Logout</span>
                                <span className="text-xs text-muted-foreground">Sign out of your account</span>
                            </div>
                        </CommandItem>
                    </CommandGroup>
                </CommandList>

                <div className="border-t-2 border-border px-5 py-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-4">
                            <span className="flex items-center gap-1">
                                <kbd className="h-6 rounded-lg border-2 border-border bg-muted px-2 py-1 font-bold shadow-playful-sm">↑↓</kbd>
                                <span>to navigate</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="h-6 rounded-lg border-2 border-border bg-muted px-2 py-1 font-bold shadow-playful-sm">↵</kbd>
                                <span>to select</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <kbd className="h-6 rounded-lg border-2 border-border bg-muted px-2 py-1 font-bold shadow-playful-sm">⌘T</kbd>
                                <span>theme</span>
                            </span>
                        </div>
                        <span className="flex items-center gap-1">
                            <kbd className="h-6 rounded-lg border-2 border-border bg-muted px-2 py-1 font-bold shadow-playful-sm">esc</kbd>
                            <span>to close</span>
                        </span>
                    </div>
                </div>
            </Command>
        </div>
    );
}