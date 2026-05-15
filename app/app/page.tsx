import { DashboardTabs } from "@/components/dashboard-tabs";

export default function AppHome() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Your CareLedger workspace.
        </p>
      </div>
      <DashboardTabs />
    </div>
  );
}
