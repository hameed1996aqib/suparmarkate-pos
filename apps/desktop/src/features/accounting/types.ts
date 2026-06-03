export type AccountingAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  currencyId?: string | null;
  isCash?: boolean;
  isBank?: boolean;
  isActive?: boolean;
};

export type Party = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  type: "CUSTOMER" | "SUPPLIER" | string;
  openingBalance?: string | number;
  openingType?: string;
  isActive?: boolean;
};

export type AccountBalance = {
  id: string;
  code: string;
  name: string;
  type: string;
  currencyId?: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export type PartyBalance = {
  id: string;
  name: string;
  phone?: string | null;
  type: string;
  debit: number;
  credit: number;
  balance: number;
};

export type JournalLine = {
  id: string;
  debit: string | number;
  credit: string | number;
  baseDebit?: string | number;
  baseCredit?: string | number;
  note?: string | null;
  account?: AccountingAccount;
  party?: Party | null;
};

export type JournalEntry = {
  id: string;
  entryNo: string;
  date: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  lines: JournalLine[];
};
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};
export type AccountingDashboardSummary = {
  period: {
    from: string;
    to: string;
  };
  assets: {
    cash: number;
    bank: number;
    receivable: number;
    inventory: number;
    totalAssets: number;
  };
  liabilities: {
    payable: number;
    totalLiabilities: number;
  };
  income: {
    salesRevenue: number;
    salesDiscount: number;
    netSales: number;
  };
  expenses: {
    cogs: number;
    generalExpenses: number;
    totalExpenses: number;
  };
  profit: {
    grossProfit: number;
    netProfit: number;
  };
  cashFlow: {
    cashIn: number;
    cashOut: number;
    netCashFlow: number;
  };
};

export type TrialBalanceReport = {
  rows: AccountBalance[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
};

export type ProfitLossReport = {
  period: {
    from: string;
    to: string;
  };
  salesRevenue: number;
  salesDiscount: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  generalExpenses: number;
  netProfit: number;
};
export type LedgerRow = {
  id: string;
  date: string;
  entryNo: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  debit: number;
  credit: number;
  balance: number;
  note?: string | null;
  account?: AccountingAccount | null;
  party?: Party | null;
};

export type AccountLedgerResponse = {
  account: AccountingAccount;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

export type PartyLedgerResponse = {
  party: Party;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
};
