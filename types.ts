/**
 * types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Contratos de tipo centrais do projeto DFC.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── ENUMS DE NAVEGAÇÃO ───────────────────────────────────────────────────────

export enum ViewMode {
  RESUMO_FINANCEIRO      = 'resumo_financeiro',
  DASHBOARD_PAYABLES     = 'dashboard_payables',
  DASHBOARD_RECEIVABLES  = 'dashboard_receivables',
  DASHBOARD_DFC          = 'dashboard_dfc',
  DASHBOARD_BY_COMPANY   = 'dashboard_company',
  DASHBOARD_DAILY_GAZETA = 'dashboard_daily_gazeta',
  DASHBOARD_BASE_DFC     = 'dashboard_base_dfc',
  DASHBOARD_FC_DIARIO    = 'dashboard_fc_diario',
  DATA_ENTRY             = 'entry',
  APRESENTACAO_EXEC      = 'apresentacao_exec',
  ALERTS_VIEW            = 'alerts_view',
  FORECAST_VIEW          = 'forecast_view',
  AUDIT_VIEW             = 'audit_view',
}

/**
 * ViewType interno do Dashboard.
 *
 * ANTES: prop `viewType` era uma string literal solta —
 *   'PAYABLES' | 'RECEIVABLES' | 'DAILY' | 'DFC' | 'REALIZED' | 'BASE_DFC' | 'FC_DIARIO'
 *
 * AGORA: enum tipado, derivado do ViewMode no App.tsx via VIEW_MODE_TO_DASHBOARD_VIEW.
 * Isso elimina o mapeamento manual e os possíveis typos silenciosos.
 */
export enum DashboardViewType {
  PAYABLES    = 'PAYABLES',
  RECEIVABLES = 'RECEIVABLES',
  DAILY       = 'DAILY',
  DFC         = 'DFC',
  REALIZED    = 'REALIZED',
  BASE_DFC    = 'BASE_DFC',
  FC_DIARIO   = 'FC_DIARIO',
}

/**
 * Mapeamento canônico de ViewMode → DashboardViewType.
 * Fonte única — antes estava inline no JSX do App.tsx como ternário aninhado.
 */
export const VIEW_MODE_TO_DASHBOARD_VIEW: Partial<Record<ViewMode, DashboardViewType>> = {
  [ViewMode.DASHBOARD_DAILY_GAZETA]: DashboardViewType.DAILY,
  [ViewMode.DASHBOARD_BY_COMPANY]:   DashboardViewType.REALIZED,
  [ViewMode.DASHBOARD_PAYABLES]:     DashboardViewType.PAYABLES,
  [ViewMode.DASHBOARD_RECEIVABLES]:  DashboardViewType.RECEIVABLES,
  [ViewMode.DASHBOARD_BASE_DFC]:     DashboardViewType.BASE_DFC,
  [ViewMode.DASHBOARD_FC_DIARIO]:    DashboardViewType.FC_DIARIO,
  [ViewMode.DASHBOARD_DFC]:          DashboardViewType.DFC,
};

// ─── ENUMS DE TRANSAÇÃO ───────────────────────────────────────────────────────

export enum TransactionType {
  PAYABLE     = 'PAYABLE',
  RECEIVABLE  = 'RECEIVABLE',
  APPLICATION = 'APPLICATION',
  CALENDAR    = 'CALENDAR',
  FLOW_TYPE   = 'FLOW_TYPE',
}

// ─── INTERFACES DE DADOS ──────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  date: string;            // DT PREVISÃO LIQUIDACAO — formatos: dd/mm/yyyy, yyyy-mm-dd
  description: string;
  supplier?: string;
  supplierCode?: string;
  companyCode?: string;    // EMPRESA (ID numérico como string, ex: '1', '14')
  value: number;           // VL CONSIDERADO — sempre positivo; sinal controlado por type
  type: TransactionType;
  status: 'PREVISTO' | 'REALIZADO' | 'CANCELADO';
  category: string;
  businessUnit: string;

  // Recebimentos
  customer?: string;
  customerCode?: string;
  portfolio?: string;

  // Campos estendidos
  businessUnitCode?: string;
  investmentDescription?: string;
  species?: string;
  establishment?: string;
  series?: string;
  documentNumber?: string;
  installment?: string;
  flowTypeCode?: string;
  flowTypeLevel2?: string;

  // Datas adicionais
  liquidationDate?: string;
  emissionDate?: string;
  dueDate?: string;

  // Valores adicionais
  balanceTitleValue?: number;
  originalTitleValue?: number;

  costCenter?: string;
  accountCode?: string;
  accountName?: string;

  // Status de verificação do Calendário (obrigações recorrentes):
  // 'OK' = já presente nos pagamentos importados; 'GERADO' = pagamento gerado pelo sistema.
  calendarStatus?: 'OK' | 'GERADO';
  // Quando calendarStatus === 'OK': o valor real (ou soma, no caso de
  // Comissão) se afasta da média do calendário em mais de 30%. Sinaliza
  // pra revisão, sem invalidar o match.
  calendarValueDivergence?: boolean;

  // Em um PAYABLE gerado pelo Calendário: id da obrigação recorrente que o originou.
  // Usado para reconciliar (remover o gerado quando o pagamento real é importado).
  generatedFromCalendarId?: string;
}

export interface FinancialSummary {
  totalInflow: number;
  totalOutflow: number;
  totalInvested: number;
  totalRealizedOutflow?: number;
  balance: number;
}

export interface AuditItem {
  code: string;
  planned: number;
  actual: number;
  diff: number;
  type: 'CONCILIADO' | 'ABERTO' | 'SURPRESA';
}

export interface AIAnalysisResult {
  summary: string;
  risks: string[];
  opportunities: string[];
  lastUpdated: string;
}

/**
 * Mapa de valores manuais inseridos pelo usuário (saldos iniciais, resgates).
 * As chaves devem ser geradas EXCLUSIVAMENTE via utils/finance.ts:
 *   keyInitialBalance / keyBankInitialBalance / keyResgate / keyBankResgate
 */
export type ManualValues = Record<string, number>;

export interface CompanyOption {
  value: string;
  label: string;
}

// ─── RE-EXPORTAÇÕES DA FASE 3 ──────────────────────────────────────────────
// ExecutiveAnalysis estende AIAnalysisResult com os campos ricos do Claude.
// Importar de services/claudeService.ts — aqui só para conveniência de tipos.
export type { ExecutiveAnalysis } from './services/claudeService';
