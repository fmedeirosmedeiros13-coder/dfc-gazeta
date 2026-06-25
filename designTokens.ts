/**
 * utils/designTokens.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Sistema de design tokens para o projeto DFC.
 *
 * PROBLEMA QUE RESOLVE:
 *   Antes, cores financeiras estavam espalhadas como strings hardcoded em
 *   ~40 lugares diferentes no projeto:
 *     'text-emerald-400'  → entrada de caixa
 *     'text-rose-400'     → saída de caixa
 *     'text-blue-400'     → investimento
 *     'text-amber-400'    → previsto/neutro
 *   Sem consistência: alguns componentes usavam 'text-green-400',
 *   outros 'text-emerald-500'. Sem padrão documentado.
 *
 * AGORA:
 *   • Cores financeiras têm semântica nomeada e são centralizadas aqui
 *   • Escala de ênfase (subtle → default → strong) para cada cor
 *   • Helper functions retornam as classes Tailwind corretas
 *   • Zero hardcode nos componentes — todos importam daqui
 *
 * PALETA SEMÂNTICA:
 *   inflow      → emerald  (entrada de caixa)
 *   outflow     → rose     (saída de caixa)
 *   investment  → blue     (aplicações financeiras)
 *   neutral     → amber    (previsto, alertas)
 *   balance     → slate    (saldo, neutro)
 *   critical    → rose 800 (alertas críticos)
 *   warning     → amber 600 (alertas de atenção)
 *   info        → blue 400  (informativo)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Paleta semântica financeira ──────────────────────────────────────────────

export const FINANCIAL_COLORS = {
  inflow: {
    subtle:  'text-emerald-500',
    default: 'text-emerald-400',
    strong:  'text-emerald-300',
    bg:      'bg-emerald-900/20',
    border:  'border-emerald-800/50',
    dot:     'bg-emerald-500',
    badge:   'bg-emerald-900/40 text-emerald-300 border border-emerald-800/50',
  },
  outflow: {
    subtle:  'text-rose-500',
    default: 'text-rose-400',
    strong:  'text-rose-300',
    bg:      'bg-rose-900/20',
    border:  'border-rose-800/50',
    dot:     'bg-rose-500',
    badge:   'bg-rose-900/40 text-rose-300 border border-rose-800/50',
  },
  investment: {
    subtle:  'text-blue-500',
    default: 'text-blue-400',
    strong:  'text-blue-300',
    bg:      'bg-blue-900/20',
    border:  'border-blue-800/50',
    dot:     'bg-blue-500',
    badge:   'bg-blue-900/40 text-blue-300 border border-blue-800/50',
  },
  neutral: {
    subtle:  'text-amber-500',
    default: 'text-amber-400',
    strong:  'text-amber-300',
    bg:      'bg-amber-900/20',
    border:  'border-amber-800/50',
    dot:     'bg-amber-500',
    badge:   'bg-amber-900/40 text-amber-300 border border-amber-800/50',
  },
  balance: {
    subtle:  'text-slate-500',
    default: 'text-slate-300',
    strong:  'text-slate-100',
    bg:      'bg-slate-800/40',
    border:  'border-slate-700/50',
    dot:     'bg-slate-400',
    badge:   'bg-slate-800/60 text-slate-300 border border-slate-700/50',
  },
} as const;

export type FinancialColorKey = keyof typeof FINANCIAL_COLORS;
export type ColorScale = 'subtle' | 'default' | 'strong';

// ─── Tokens de alerta ─────────────────────────────────────────────────────────

export const ALERT_COLORS = {
  critical: {
    bg:     'bg-rose-950/40',
    border: 'border-rose-800/60',
    text:   'text-rose-300',
    icon:   'text-rose-400',
    badge:  'bg-rose-900/60 text-rose-300',
  },
  warning: {
    bg:     'bg-amber-950/40',
    border: 'border-amber-800/60',
    text:   'text-amber-300',
    icon:   'text-amber-400',
    badge:  'bg-amber-900/60 text-amber-300',
  },
  info: {
    bg:     'bg-blue-950/40',
    border: 'border-blue-800/60',
    text:   'text-blue-300',
    icon:   'text-blue-400',
    badge:  'bg-blue-900/60 text-blue-300',
  },
} as const;

// ─── Tokens de layout ─────────────────────────────────────────────────────────

export const LAYOUT = {
  /** Card padrão dark */
  card:        'bg-slate-900/40 border border-slate-800/60 rounded-xl',
  /** Card com hover */
  cardHover:   'bg-slate-900/40 border border-slate-800/60 rounded-xl hover:border-slate-700/60 transition-colors',
  /** Card de destaque */
  cardAccent:  'bg-slate-900 border border-slate-700 rounded-xl shadow-lg',
  /** Input padrão */
  input:       'bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-slate-500 outline-none transition-colors',
  /** Badge */
  badge:       'text-xs font-medium px-2 py-0.5 rounded-full',
  /** Separador */
  divider:     'border-t border-slate-800/60',
  /** Tabela header */
  tableHeader: 'bg-slate-800/60 text-slate-400 text-xs font-medium uppercase tracking-wider',
  /** Tabela row */
  tableRow:    'border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors',
} as const;

export const TYPOGRAPHY = {
  /** Título de seção */
  sectionTitle: 'text-sm font-semibold text-slate-300 uppercase tracking-wider',
  /** Valor KPI grande */
  kpiValue:     'text-2xl font-semibold tracking-tight',
  /** Label de KPI */
  kpiLabel:     'text-xs font-medium text-slate-400 uppercase tracking-wider',
  /** Texto de tabela */
  tableCell:    'text-xs text-slate-300',
  /** Texto muted */
  muted:        'text-xs text-slate-500',
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retorna a cor financeira correta baseada no valor.
 * Positivo → inflow (verde), negativo → outflow (vermelho), zero → balance (cinza).
 */
export function valueColor(value: number, scale: ColorScale = 'default'): string {
  if (value > 0)  return FINANCIAL_COLORS.inflow[scale];
  if (value < 0)  return FINANCIAL_COLORS.outflow[scale];
  return FINANCIAL_COLORS.balance[scale];
}

/**
 * Retorna badge classes para uma categoria de transação.
 */
export function categoryBadge(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes('pessoal') || normalized.includes('folha'))
    return FINANCIAL_COLORS.outflow.badge;
  if (normalized.includes('invest') || normalized.includes('capex'))
    return FINANCIAL_COLORS.investment.badge;
  if (normalized.includes('imposto') || normalized.includes('tribut'))
    return FINANCIAL_COLORS.neutral.badge;
  if (normalized.includes('receita') || normalized.includes('recebimento'))
    return FINANCIAL_COLORS.inflow.badge;
  return FINANCIAL_COLORS.balance.badge;
}

/**
 * Retorna cor de um sentimento de análise de IA.
 */
export function sentimentColor(sentiment: 'positive' | 'neutral' | 'negative' | 'critical'): string {
  switch (sentiment) {
    case 'positive': return FINANCIAL_COLORS.inflow.default;
    case 'neutral':  return FINANCIAL_COLORS.balance.default;
    case 'negative': return FINANCIAL_COLORS.neutral.default;
    case 'critical': return FINANCIAL_COLORS.outflow.default;
  }
}

/**
 * Retorna o label semântico de sentimento em pt-BR.
 */
export function sentimentLabel(sentiment: 'positive' | 'neutral' | 'negative' | 'critical'): string {
  switch (sentiment) {
    case 'positive': return 'Favorável';
    case 'neutral':  return 'Neutro';
    case 'negative': return 'Desfavorável';
    case 'critical': return 'Atenção Crítica';
  }
}

// ─── Constantes de cores para Recharts ────────────────────────────────────────
// Recharts usa hex — os tokens de Tailwind não funcionam diretamente nos gráficos.

export const CHART_COLORS = {
  inflow:     '#34d399',  // emerald-400
  outflow:    '#fb7185',  // rose-400
  investment: '#60a5fa',  // blue-400
  neutral:    '#fbbf24',  // amber-400
  balance:    '#94a3b8',  // slate-400
  grid:       '#1e293b',  // slate-800
  tooltip: {
    bg:     '#0f172a',    // slate-900
    border: '#1e293b',    // slate--800
    text:   '#f8fafc',    // slate-50
  },
} as const;

/** Paleta sequencial para múltiplas séries (ex: empresas em barras agrupadas). */
export const CHART_SERIES_COLORS = [
  '#818cf8', // indigo-400
  '#34d399', // emerald-400
  '#fb7185', // rose-400
  '#60a5fa', // blue-400
  '#fbbf24', // amber-400
  '#a78bfa', // violet-400
  '#f472b6', // pink-400
  '#2dd4bf', // teal-400
  '#facc15', // yellow-400
  '#4ade80', // green-400
  '#f87171', // red-400
] as const;

/** Configuração padrão de Tooltip do Recharts. */
export const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: CHART_COLORS.tooltip.bg,
    borderColor:     CHART_COLORS.tooltip.border,
    color:           CHART_COLORS.tooltip.text,
    borderRadius:    '8px',
    fontSize:        '12px',
  },
  cursor: { fill: 'transparent' },
} as const;
