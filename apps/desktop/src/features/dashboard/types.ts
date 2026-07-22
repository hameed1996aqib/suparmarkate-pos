export type DashboardPeriod = "today" | "week" | "month" | "fourMonths";

export type DashboardSummary = {
  period: { key: DashboardPeriod; start: string; end: string };
  currency: {
    filterCurrencyId?: string | null;
    filterCode?: string | null;
    filterName?: string | null;
    baseCurrencyId?: string | null;
    baseCode: string;
    displayCode: string;
  };
  overview: {
    sales: number; purchases: number; grossProfit: number; netProfit: number;
    income: number; expenses: number; treasury: number; receivables: number;
    payables: number; inventoryValue: number; wasteValue: number;
  };
  documents: {
    sales: number; purchases: number; pendingSales: number; pendingPurchases: number;
    paidSales: number; paidPurchases: number; remainingSales: number; remainingPurchases: number;
  };
  parties: { customers: number; suppliers: number; receivables: number; payables: number };
  inventory: {
    products: number; value: number; inventoryValue: number; outOfStock: number;
    lowStock: number; highStock: number; expired: number; expiringSoon: number;
  };
  cashFlow: { moneyIn: number; moneyOut: number; net: number };
  salesByCashier: Array<{ id: string; name: string; sales: number; invoices: number }>;
  salesPurchasesTrend: Array<{ key: string; label: string; sales: number; purchases: number }>;
  salesByCategory: Array<{ name: string; sales: number; quantity: number; cogs?: number; profit?: number }>;
  topProducts: Array<{ id: string; name: string; sales: number; quantity: number }>;
  recentActivities: Array<{ id: string; action: string; entityType?: string | null; user: string; createdAt: string }>;
};

export type DashboardCurrency = {
  id: string;
  code: string;
  name: string;
  symbol?: string | null;
  isBase?: boolean;
  isActive?: boolean;
};
