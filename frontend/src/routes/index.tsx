import { createFileRoute } from "@tanstack/react-router";
import { Target, Rocket, TrendingUp, Loader2, Package, BarChart3, Activity } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { odyssey } from "@/lib/api/odyssey";
import type { StatsData } from "@/lib/api/odyssey";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center — Odyssey" },
      { name: "description", content: "Real-time job hunting funnel and activity dashboard." },
      { property: "og:title", content: "Command Center — Odyssey" },
      { property: "og:description", content: "Real-time job hunting funnel and activity dashboard." },
    ],
  }),
  component: CommandCenter,
});

function CommandCenter() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await odyssey.stats.get();
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      toast.error("Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const funnelData = stats ? [
    { stage: "Scouted", count: stats.status_counts.new + stats.status_counts.approved + stats.status_counts.applied + stats.status_counts.interview + stats.status_counts.rejected },
    { stage: "Approved", count: stats.status_counts.approved },
    { stage: "Applied", count: stats.status_counts.applied },
    { stage: "Interview", count: stats.status_counts.interview },
  ] : [];

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <Target className="h-16 w-16 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No data available yet. Start scouting jobs!</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎮 Command Center</h1>
          <p className="text-sm text-muted-foreground">Real-time job hunting funnel and activity</p>
        </div>
        <button
          onClick={fetchStats}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-secondary border-2 border-border text-muted-foreground shadow-playful-sm hover:shadow-playful hover:scale-105 hover:animate-wiggle transition-all duration-200"
        >
          <Activity className="w-4 h-4 inline mr-2" />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-bounce-in-stagger">
        <div className="animate-bounce-in-stagger-1">
          <KPICard
            icon={Target}
            label="Total Bounties Scouted"
            value={stats.total_scraped}
            color="primary"
          />
        </div>
        <div className="animate-bounce-in-stagger-2">
          <KPICard
            icon={Package}
            label="Current Pipeline"
            value={stats.pipeline_count}
            color="secondary"
          />
        </div>
        <div className="animate-bounce-in-stagger-3">
          <KPICard
            icon={TrendingUp}
            label="Success Rate"
            value={`${stats.success_rate}%`}
            color="accent"
          />
        </div>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 animate-bounce-in-stagger-4">
        {/* Funnel Chart */}
        <div className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful">
          <h3 className="text-lg font-bold tracking-tight mb-4">📊 Job Funnel</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="stage" stroke="var(--color-muted-foreground)" />
              <YAxis stroke="var(--color-muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "2px solid var(--color-border)",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Bar
                dataKey="count"
                fill="oklch(0.65 0.18 25)"
                radius={[8, 8, 0, 0]}
                style={{ filter: "drop-shadow(2px 2px 0px var(--color-border))" }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Progress */}
        <div className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful">
          <h3 className="text-lg font-bold tracking-tight mb-4">🚀 Applications Sent (30 Days)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats.monthly_progress}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" stroke="var(--color-muted-foreground)" />
              <YAxis stroke="var(--color-muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  border: "2px solid var(--color-border)",
                  borderRadius: "8px",
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="applications"
                stroke="oklch(0.55 0.15 180)"
                strokeWidth={3}
                dot={{ fill: "oklch(0.55 0.15 180)", r: 6, strokeWidth: 2 }}
                activeDot={{ r: 8, stroke: "oklch(0.55 0.15 180)", strokeWidth: 2 }}
                style={{ filter: "drop-shadow(2px 2px 0px var(--color-border))" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Status Breakdown */}
      <section className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful animate-bounce-in-stagger-5">
        <h3 className="text-lg font-bold tracking-tight mb-4">📋 Status Breakdown</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatusBadge label="New" count={stats.status_counts.new} color="primary" />
          <StatusBadge label="Approved" count={stats.status_counts.approved} color="secondary" />
          <StatusBadge label="Applied" count={stats.status_counts.applied} color="accent" />
          <StatusBadge label="Interview" count={stats.status_counts.interview} color="success" />
          <StatusBadge label="Rejected" count={stats.status_counts.rejected} color="destructive" />
        </div>
      </section>
    </div>
  );
}

function KPICard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="paper-texture rounded-xl border-2 border-border bg-card p-6 shadow-playful hover:shadow-playful-lg hover:-translate-y-1 hover:animate-wiggle transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-2">{label}</p>
          <p className="text-3xl font-bold text-primary">{value}</p>
        </div>
        <div className="p-3 rounded-lg bg-primary/20">
          <Icon className="w-6 h-6 text-primary" />
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ label, count, color }: { label: string; count: number; color: string }) {
  const colorMap: Record<string, string> = {
    primary: "text-primary",
    secondary: "text-secondary-foreground",
    accent: "text-accent-foreground",
    success: "text-success",
    destructive: "text-destructive-foreground",
  };
  
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-border bg-secondary/50 hover:scale-105 hover:animate-wiggle transition-all duration-200">
      <span className="text-sm font-bold text-muted-foreground">{label}</span>
      <span className={`text-2xl font-bold ${colorMap[color] || "text-primary"}`}>{count}</span>
    </div>
  );
}
