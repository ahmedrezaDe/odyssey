import {
    SidebarHeader,
    SidebarContent,
    SidebarFooter,
    Sidebar,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarMenuButton,
} from "@/components/ui/sidebar";
import { Link } from "@tanstack/react-router";
import { LayoutDashboard, FileText, FileSearch, MessageSquare, Users, Settings, Flame, Target, Briefcase, User } from "lucide-react";
import { useState } from "react";

const navigation = [
    { title: "Overview", href: "/", icon: LayoutDashboard },
    { title: "Job Bounty", href: "/job-bounty", icon: Briefcase },
    { title: "Document Analysis", href: "/triage-agent", icon: FileSearch },
    { title: "Document Studio", href: "/cv-generator", icon: FileText },
    { title: "Resume Roaster", href: "/roaster", icon: Flame },
    { title: "ATS Match", href: "/ats-match", icon: Target },
    { title: "Interview Practice", href: "/interview", icon: MessageSquare },
    { title: "Networking", href: "/networking", icon: Users },
    { title: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <Sidebar
            collapsible="none"
            className="w-[72px] hover:w-[240px] transition-all duration-300 ease-in-out shrink-0"
            onMouseEnter={() => setIsExpanded(true)}
            onMouseLeave={() => setIsExpanded(false)}
        >
            <SidebarHeader className="border-b-2 border-border px-4 py-4">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-playful hover:shadow-playful-lg hover:-translate-y-0.5 transition-all duration-150 hover:animate-wiggle">
                        <span className="text-sm font-bold">O</span>
                    </div>
                    <div className={`flex flex-col overflow-hidden transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                        <span className="text-sm font-bold tracking-tight whitespace-nowrap">Odyssey</span>
                    </div>
                </div>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {navigation.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild>
                                        <Link to={item.href} className="border-2 border-transparent hover:border-primary/30 hover:bg-primary/10 hover:shadow-playful-sm transition-all duration-150 hover:animate-wiggle">
                                            <item.icon className="h-4 w-4 shrink-0" />
                                            <span className={`transition-opacity duration-300 ${isExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>{item.title}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>


        </Sidebar>
    );
}