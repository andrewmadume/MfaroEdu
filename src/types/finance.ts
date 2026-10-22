export interface FinanceSettings {
  id: string;
  currency: string;
  decimal_places: number;
  version: number;
}
export interface FinanceOption {
  id: string;
  name: string;
  archived?: boolean;
}
export interface FeeCategory extends FinanceOption {
  version: number;
  archived: boolean;
}
export interface FeeStructure extends FeeCategory {
  category_id: string;
  academic_year_id: string;
  grade_id: string | null;
  amount_minor: string;
}
export interface FinanceSetup {
  settings: FinanceSettings | null;
  locked: boolean;
  categories: FeeCategory[];
  fees: FeeStructure[];
  years: FinanceOption[];
  grades: FinanceOption[];
}
export interface FinanceLearner {
  id: string;
  name: string;
  admission_number: string;
  archived: boolean;
}
export interface FinanceDocument {
  school: string;
  address: string | null;
  learner: string;
  admission: string;
  year: string;
  currency: string;
  decimal_places: number;
  invoice_number?: string;
  items: {
    description: string;
    category: string;
    quantity: number;
    unit_minor: string;
    total_minor: string;
  }[];
}
export interface FinanceEntry {
  id: string;
  kind: string;
  amount_minor: string;
  number: string;
  posted_on: string;
  method: string | null;
  reference: string | null;
  reason: string | null;
  original_entry_id: string | null;
  reversed: boolean;
  document: FinanceDocument;
}
export interface FinanceInvoice {
  id: string;
  number: string;
  issued_on: string;
  due_on: string;
  status: string;
  version: number;
  document: FinanceDocument;
  gross_minor: string;
  balance_minor: string;
  entries: FinanceEntry[];
}
export interface FinanceAccount {
  settings: FinanceSettings | null;
  rows: FinanceInvoice[];
  count: number;
  balance_minor: string;
}
export interface FinanceStatement {
  as_at: string;
  settings: FinanceSettings | null;
  rows: {
    id: string;
    number: string;
    kind: string;
    posted_on: string;
    amount_minor: string;
    running_minor: string;
    invoice_number: string;
  }[];
  count: number;
  opening_minor: string;
  closing_minor: string;
}
export interface FinanceReport {
  settings: FinanceSettings | null;
  billed_minor: string;
  collected_minor: string;
  concessions_minor: string;
  outstanding_minor: string;
}
