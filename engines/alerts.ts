/**
 * engines/alerts.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine de alertas proativos.
 *
 * Detecta automaticamente situações que merecem atenção imediata do
 * controlador — sem que ele precise procurar nos dados.
 *
 * Tipos de alerta:
 *   DUE_DATE      Vencimentos críticos (≤3 dias) e próximos (4–7 dias)
 *   LOW_BALANCE   Saldo projetado negativo em algum dia do período
 *   CONCENTRATION Concentração excessiva em um único fornecedor (>30% das saídas)
 *   DEVIATION     Desvio previsto×realizado acima do threshold (padrão 15%)
 *   ANOMALY       Transação com valor muito acima da média do fornecedor (>3σ)
 *   UNMATCHED     Alta taxa de não-conciliação (>25% do valor previsto)
 *
 * Uso:
 *   const alerts = detectAlerts({ transactions, realized, manualValues, today });
 *   const critical = alerts.filter(a => a.severity === 'critical');
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction, TransactionType, ManualValues } from '../types';
import { parseDate, formatCurrency, formatInteger, calcInitialBalance, getStartDate, BANKS_MAPPING } from '../utils/finance';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertType =
  | 'DUE_DATE'
  | 'LOW_BALANCE'
  | 'CONCENTRATION'
  | 'DEVIATION'
  | 'ANOMALY'
  | 'UNMATCHED';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  /** Valor monetário afetado (para ordenação por impacto). */
  impactValue: number;
  /** Transações relacionadas (para drill-down). */
  relatedTransactionIds: string[];
  /** Timestamp de geração. */
  generatedAt: Date;
  /** Metadados extras por tipo. */
  meta?: Record<string, unknown>;
}

// ─── Configuração ──────────────────────────────────────────────────────────

const CONFIG = {
  /** Dias restantes para considerar vencimento crítico. */
  dueDateCriticalDays: 3,
  /** Dias restantes para considerar vencimento próximo. */
  dueDateWarningDays:  7,
  /** Percentual de concentração que dispara alerta (0–1). */
  concentrationThreshold: 0.30,
  /** Desvio previsto×realizado que dispara alerta (0–1). */
  deviationThreshold: 0.15,
  /** Multiplicador de desvio-padrão para detecção de anomalia. */
  anomalyStdDevMultiplier: 3,
  /** Percentual de valor não-conciliado que dispara alerta (0–1). */
  unmatchedThreshold: 0.25,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _alertCounter = 0;
function makeId(type: AlertType): string {
  return `alert_${type}_${++_alertCounter}_${Date.now()}`;
}

function daysUntil(dateStr: string, today: Date): number {
  const ts = parseDate(dateStr);
  if (!ts) return Infinity;
  const todayMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((ts - todayMs) / (1000 * 60 * 60 * 24));
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// ─── Detectores individuais ───────────────────────────────────────────────────

/**
 * Detecta vencimentos críticos e próximos.
 * Agrupa por urgência e apresenta o total em risco.
 */
function detectDueDates(
  transactions: Transaction[],
  today: Date,
): Alert[] {
  const alerts: Alert[] = [];

  const payables = transactions.filter(t =>
    t.type === TransactionType.PAYABLE && t.status === 'PREVISTO'
  );

  const criticalItems: Transaction[] = [];
  const warningItems:  Transaction[] = [];

  for (const t of payables) {
    const days = daysUntil(t.date, today);
    if (days >= 0 && days <= CONFIG.dueDateCriticalDays) criticalItems.push(t);
    else if (days > CONFIG.dueDateCriticalDays && days <= CONFIG.dueDateWarningDays) warningItems.push(t);
  }

  if (criticalItems.length > 0) {
    const total = criticalItems.reduce((s, t) => s + (Number(t.value) || 0), 0);
    alerts.push({
      id:                   makeId('DUE_DATE'),
      type:                 'DUE_DATE',
      severity:             'critical',
      title:                `${criticalItems.length} vencimento(s) em até ${CONFIG.dueDateCriticalDays} dias`,
      description:          `${formatCurrency(total)} em pagamentos vencem nos próximos ${CONFIG.dueDateCriticalDays} dias. Confirmar liquidez disponível.`,
      impactValue:          total,
      relatedTransactionIds: criticalItems.map(t => t.id),
      generatedAt:          new Date(),
      meta: { days: CONFIG.dueDateCriticalDays, count: criticalItems.length },
    });
  }

  if (warningItems.length > 0) {
    const total = warningItems.reduce((s, t) => s + (Number(t.value) || 0), 0);
    alerts.push({
      id:                   makeId('DUE_DATE'),
      type:                 'DUE_DATE',
      severity:             'warning',
      title:                `${warningItems.length} vencimento(s) em ${CONFIG.dueDateCriticalDays + 1}–${CONFIG.dueDateWarningDays} dias`,
      description:          `${formatCurrency(total)} em pagamentos vencem na próxima semana. Planejamento de caixa recomendado.`,
      impactValue:          total,
      relatedTransactionIds: warningItems.map(t => t.id),
      generatedAt:          new Date(),
      meta: { days: CONFIG.dueDateWarningDays, count: warningItems.length },
    });
  }

  return alerts;
}

/**
 * Detecta projeção de saldo negativo.
 * Simula o saldo dia a dia e dispara alerta no primeiro dia negativo.
 */
function detectLowBalance(
  transactions: Transaction[],
  manualValues: ManualValues,
  today: Date,
): Alert[] {
  const alerts: Alert[] = [];

  if (!transactions.length) return alerts;

  const startDate = getStartDate(transactions);
  if (!startDate) return alerts;

  // Calcular saldo inicial consolidado (todas as empresas)
  const uniqueCompanies = Array.from(new Set(
    transactions.map(t => t.companyCode ?? '').filter(Boolean)
  ));
  const initialBalance = uniqueCompanies.reduce(
    (sum, cId) => sum + calcInitialBalance(cId, startDate, manualValues), 0
  );

  // Ordenar transações cronologicamente
  const sorted = [...transactions].sort(
    (a, b) => parseDate(a.date) - parseDate(b.date)
  );

  // Agrupar por dia
  const byDate: Record<string, { inflow: number; outflow: number }> = {};
  for (const t of sorted) {
    if (!byDate[t.date]) byDate[t.date] = { inflow: 0, outflow: 0 };
    const val = Number(t.value) || 0;
    if (t.type === TransactionType.RECEIVABLE)  byDate[t.date].inflow  += val;
    if (t.type === TransactionType.PAYABLE)     byDate[t.date].outflow += val;
    if (t.type === TransactionType.APPLICATION) byDate[t.date].outflow += val;
  }

  // Simular saldo acumulado
  let balance = initialBalance;
  let firstNegativeDate: string | null = null;
  let firstNegativeBalance = 0;

  for (const [date, flows] of Object.entries(byDate).sort(
    ([a], [b]) => parseDate(a) - parseDate(b)
  )) {
    balance += flows.inflow - flows.outflow;
    const daysAhead = daysUntil(date, today);
    if (balance < 0 && daysAhead >= 0 && !firstNegativeDate) {
      firstNegativeDate    = date;
      firstNegativeBalance = balance;
    }
  }

  if (firstNegativeDate) {
    alerts.push({
      id:                    makeId('LOW_BALANCE'),
      type:                  'LOW_BALANCE',
      severity:              'critical',
      title:                 `Saldo projetado negativo em ${firstNegativeDate}`,
      description:           `Projeção indica saldo de ${formatCurrency(firstNegativeBalance)} nessa data. Revisar liberações de caixa ou antecipar recebimentos.`,
      impactValue:           Math.abs(firstNegativeBalance),
      relatedTransactionIds: [],
      generatedAt:           new Date(),
      meta: { date: firstNegativeDate, balance: firstNegativeBalance },
    });
  }

  return alerts;
}

/**
 * Detecta concentração excessiva em um único fornecedor.
 * Alta concentração = risco operacional se o relacionamento for rompido.
 */
function detectConcentration(transactions: Transaction[]): Alert[] {
  const alerts: Alert[] = [];

  const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
  const total    = payables.reduce((s, t) => s + (Number(t.value) || 0), 0);
  if (!total) return alerts;

  const bySupplier: Record<string, { value: number; ids: string[]; name: string }> = {};

  for (const t of payables) {
    const key  = t.supplierCode ?? t.supplier ?? t.description ?? 'N/D';
    const name = t.supplier ?? t.description ?? key;
    if (!bySupplier[key]) bySupplier[key] = { value: 0, ids: [], name };
    bySupplier[key].value += Number(t.value) || 0;
    bySupplier[key].ids.push(t.id);
  }

  for (const [, data] of Object.entries(bySupplier)) {
    const pct = data.value / total;
    if (pct >= CONFIG.concentrationThreshold) {
      alerts.push({
        id:                    makeId('CONCENTRATION'),
        type:                  'CONCENTRATION',
        severity:              pct >= 0.50 ? 'critical' : 'warning',
        title:                 `Concentração: ${data.name} representa ${(pct * 100).toFixed(1)}% das saídas`,
        description:           `${formatCurrency(data.value)} de ${formatCurrency(total)} total. Dependência elevada de um único credor.`,
        impactValue:           data.value,
        relatedTransactionIds: data.ids,
        generatedAt:           new Date(),
        meta: { supplier: data.name, percent: pct },
      });
    }
  }

  return alerts;
}

/**
 * Detecta desvio significativo entre previsto e realizado.
 */
function detectDeviation(
  transactions: Transaction[],
  realized: Transaction[],
): Alert[] {
  const alerts: Alert[] = [];
  if (!realized.length) return alerts;

  const plannedTotal  = transactions
    .filter(t => t.type === TransactionType.PAYABLE)
    .reduce((s, t) => s + (Number(t.value) || 0), 0);

  const realizedTotal = realized
    .filter(t => t.type === TransactionType.PAYABLE)
    .reduce((s, t) => s + (Number(t.value) || 0), 0);

  if (!plannedTotal) return alerts;

  const diff    = Math.abs(realizedTotal - plannedTotal);
  const diffPct = diff / plannedTotal;

  if (diffPct >= CONFIG.deviationThreshold) {
    const over = realizedTotal > plannedTotal;
    alerts.push({
      id:                    makeId('DEVIATION'),
      type:                  'DEVIATION',
      severity:              diffPct >= 0.30 ? 'critical' : 'warning',
      title:                 `Desvio de ${(diffPct * 100).toFixed(1)}% previsto×realizado`,
      description:           `Realizado ${over ? 'excedeu' : 'ficou abaixo do'} previsto em ${formatCurrency(diff)}. ${over ? 'Pagamentos não planejados ou antecipações.' : 'Pagamentos adiados ou não confirmados.'}`,
      impactValue:           diff,
      relatedTransactionIds: [],
      generatedAt:           new Date(),
      meta: { planned: plannedTotal, realized: realizedTotal, diffPct },
    });
  }

  return alerts;
}

/**
 * Detecta transações anomalas por fornecedor (valor muito acima da média histórica).
 */
function detectAnomalies(transactions: Transaction[]): Alert[] {
  const alerts: Alert[] = [];

  const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
  const bySupplier: Record<string, { values: number[]; ids: string[]; name: string }> = {};

  for (const t of payables) {
    const key  = t.supplierCode ?? t.supplier ?? 'N/D';
    const name = t.supplier ?? key;
    if (!bySupplier[key]) bySupplier[key] = { values: [], ids: [], name };
    bySupplier[key].values.push(Number(t.value) || 0);
    bySupplier[key].ids.push(t.id);
  }

  for (const [, data] of Object.entries(bySupplier)) {
    const n = data.values.length;
    if (n < 3) continue; // Precisa de histórico mínimo (o próprio valor + 2 outros)

    // Estatística "deixa-um-de-fora": para cada lançamento, a média e o desvio
    // são calculados com os OUTROS lançamentos do fornecedor, sem incluir o
    // próprio valor testado. Assim um valor muito alto não infla a própria base
    // e mascara a detecção. Sum/sumSq totais permitem fazer isso em O(n).
    const sum   = data.values.reduce((s, v) => s + v, 0);
    const sumSq = data.values.reduce((s, v) => s + v * v, 0);

    for (let i = 0; i < n; i++) {
      const v  = data.values[i];
      const m  = n - 1;                       // nº de "outros" lançamentos
      if (m < 2) continue;                    // precisa de ao menos 2 para comparar
      const mean = (sum - v) / m;             // média dos demais
      const variance = Math.max(0, (sumSq - v * v) / m - mean * mean);
      const sd = Math.sqrt(variance);
      if (!sd || mean <= 0) continue;
      const threshold = mean + CONFIG.anomalyStdDevMultiplier * sd;
      if (v <= threshold) continue;

      alerts.push({
        id:                    makeId('ANOMALY'),
        type:                  'ANOMALY',
        severity:              'warning',
        title:                 `Valor anômalo: ${data.name}`,
        description:           `${formatCurrency(v)} está ${((v / mean - 1) * 100).toFixed(0)}% acima da média dos demais lançamentos deste fornecedor (${formatCurrency(mean)}), com base em ${n} lançamentos no sistema.`,
        impactValue:           v,
        relatedTransactionIds: [data.ids[i]],
        generatedAt:           new Date(),
        meta: { mean, stdDev: sd, threshold, value: v },
      });
    }
  }

  return alerts;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export interface DetectAlertsInput {
  transactions:         Transaction[];
  realizedTransactions?: Transaction[];
  manualValues?:        ManualValues;
  /** Data de referência. Default: hoje. */
  today?:               Date;
}

/**
 * Executa todos os detectores e retorna a lista unificada de alertas,
 * ordenada por severidade (critical → warning → info) e impacto financeiro.
 */
export function detectAlerts({
  transactions,
  realizedTransactions = [],
  manualValues = {},
  today = new Date(),
}: DetectAlertsInput): Alert[] {
  const allAlerts: Alert[] = [
    ...detectDueDates(transactions, today),
    ...detectLowBalance(transactions, manualValues, today),
    ...detectConcentration(transactions),
    ...detectDeviation(transactions, realizedTransactions),
    ...detectAnomalies(transactions),
  ];

  const severityOrder: Record<AlertSeverity, number> = {
    critical: 0, warning: 1, info: 2,
  };

  return allAlerts.sort((a, b) => {
    const sv = severityOrder[a.severity] - severityOrder[b.severity];
    if (sv !== 0) return sv;
    return b.impactValue - a.impactValue; // maior impacto primeiro
  });
}

/** Conta alertas por severidade. Útil para badges na sidebar. */
export function alertCount(alerts: Alert[]): Record<AlertSeverity, number> {
  return alerts.reduce(
    (acc, a) => { acc[a.severity]++; return acc; },
    { critical: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>
  );
}

/** Filtra alertas por tipo. */
export function filterByType(alerts: Alert[], type: AlertType): Alert[] {
  return alerts.filter(a => a.type === type);
}

/** Retorna cor Tailwind para a severidade. */
export function alertSeverityColor(severity: AlertSeverity): {
  bg: string; border: string; text: string; icon: string;
} {
  switch (severity) {
    case 'critical': return { bg: 'bg-rose-950/40',  border: 'border-rose-800/60',   text: 'text-rose-300',   icon: 'text-rose-400' };
    case 'warning':  return { bg: 'bg-amber-950/40', border: 'border-amber-800/60',  text: 'text-amber-300',  icon: 'text-amber-400' };
    case 'info':     return { bg: 'bg-blue-950/40',  border: 'border-blue-800/60',   text: 'text-blue-300',   icon: 'text-blue-400' };
  }
}
