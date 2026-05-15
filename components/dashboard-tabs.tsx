"use client";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

const TABS = [
  {
    value: "bills",
    label: "Bills",
    description: "Facility invoices, due dates, payment status.",
  },
  {
    value: "expenses",
    label: "Expenses",
    description: "Out-of-pocket costs and how they split across family members.",
  },
  {
    value: "documents",
    label: "Documents",
    description: "Powers of attorney, insurance, statements, agreements.",
  },
  {
    value: "visits",
    label: "Visits",
    description: "A running log of in-person and phone check-ins.",
  },
] as const;

export function DashboardTabs() {
  return (
    <Tabs defaultValue="bills" className="w-full">
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <div className="rounded-lg border border-dashed p-10 text-center">
            <h2 className="text-lg font-medium">{tab.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab.description}
            </p>
            <p className="mt-4 text-xs text-muted-foreground">
              Coming soon.
            </p>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
