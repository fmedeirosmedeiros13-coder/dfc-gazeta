/**
 * engines/forecast.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine de projeção preditiva de fluxo de caixa.
 *
 * ABORDAGEM:
 *   Três modelos combinados por ponderação (ensemble):
 *
 *   1. REGRESSÃO LINEAR (peso 0.4)
 *      Ajusta uma reta aos snapshots históricos de saldo.
 *      Boa para capturar tendências de médio prazo (crescimento/queda).
 *      Confiável com ≥ 7 snapshots.
 *
 *   2. MÉDIA MÓVEL EXPONENCIAL — EMA (peso 0.35)
 *      Dá mais peso aos dados recentes.
 *      Boa para reagir rápido a mudanças de comportamento.
 *      Confiável com ≥ 3 snapshots.
 *
 *   3. NAÏVE SAZONAL SEMANAL (peso 0.25)
 *      Usa o padrão do mesmo dia da semana nas últimas semanas.
 *      Captura que "toda sexta tem folha" ou "toda segunda tem DARF".
 *      Confiável com ≥ 14 snapshots (2 semanas).
 *
 *   O cone de confiança se expande com o horizonte:
 *   ±σ para 7 dias, ±2σ para 30 dias, ±3σ para 90 dias.
 *
 * USO:
 *   const fc = forecast(snapshots, 30);
 *   fc.points.forEach(p => console.log(p.date, p.value, p.lower, p.upper));
 *   console.log(fc.confidence); // 0.0–1.0
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { DFCSnapshot, TimeSeriesPoint } from '../hooks/useSnapshots';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ForecastPoint {
  date:      string;    // YYYY-MM-DD
  value:     number;    // valor central projetado
  lower:     number;    // limite inferior do cone de confiança
  upper:     number;    // limite superior do cone de confiança
  isActual:  boolean;   // true para pontos históricos, false para projeção
}

export interface ForecastResult {
  /** Pontos históricos + projeção (histórico + horizonte dias). */
  points:       ForecastPoint[];
  /** Score de confiança do modelo: 0–1. Decresce com horizonte e sobe com mais dados. */
  confidence:   number;
  /** Qual modelo dominou a projeção. */
  dominantModel: 'linear' | 'ema' | 'seasonal' | 'ensemble';
  /** Número de snapshots usados. */
  dataPoints:   number;
  /** Data estimada em que o saldo cruza zero (null se não cruzar no horizonte). */
  zeroCrossDate: string | null;
  /** Mensagem explicativa sobre a qualidade da projeção. */
  qualityNote:  string;
}

// ─── Helpers matemáticos ──────────────────────────────────────────────────────

/** Regressão linear simples: retorna { slope, intercept }. */
function linearRegression(points: TimeSeriesPoint[]): { slope: number; intercept: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.value ?? 0 };

  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.value);

  const sumX  = xs.reduce((s, x) => s + x, 0);
  const sumY  = ys.reduce((s, y) => s + y, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumX2 = xs.reduce((s, x) => s + x * x, 0);

  const slope     = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

/** Média Móvel Exponencial. alpha: fator de suavização (0–1). */
function ema(values: number[], alpha = 0.3): number[] {
  if (!values.length) return [];
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

/** Desvio padrão de uma série. */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

/** Adiciona N dias a uma string YYYY-MM-DD. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Índice do dia da semana (0=Dom … 6=Sáb) de uma string YYYY-MM-DD. */
function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

// ─── Modelos individuais ──────────────────────────────────────────────────────

/**
 * Modelo 1: Regressão linear.
 * Projeta o valor para os próximos `horizon` dias.
 */
function forecastLinear(
  history: TimeSeriesPoint[],
  horizon: number,
): number[] {
  const { slope, intercept } = linearRegression(history);
  const n = history.length;
  return Array.from({ length: horizon }, (_, i) => intercept + slope * (n + i));
}

/**
 * Modelo 2: Projeção EMA — extrapola a última EMA com a taxa de mudança recente.
 */
function forecastEMA(
  history: TimeSeriesPoint[],
  horizon: number,
  alpha = 0.3,
): number[] {
  const values  = history.map(p => p.value);
  const emaVals = ema(values, alpha);
  const last    = emaVals[emaVals.length - 1];

  // Taxa de mudança média dos últimos 5 pontos da EMA
  const tail  = emaVals.slice(-5);
  const delta = tail.length >= 2
    ? (tail[tail.length - 1] - tail[0]) / (tail.length - 1)
    : 0;

  return Array.from({ length: horizon }, (_, i) => last + delta * (i + 1));
}

/**
 * Modelo 3: Naïve sazonal semanal.
 * Para cada dia futuro, usa a média dos mesmos dias da semana no histórico.
 */
function forecastSeasonal(
  history: TimeSeriesPoint[],
  horizon: number,
  lastDate: string,
): number[] {
  // Agrupar variações por dia da semana
  const byDow: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  for (let i = 1; i < history.length; i++) {
    const dow   = dayOfWeek(history[i].date);
    const delta = history[i].value - history[i - 1].value;
    byDow[dow].push(delta);
  }

  // Média por dia da semana
  const avgDelta: Record<number, number> = {};
  for (const [dow, deltas] of Object.entries(byDow)) {
    avgDelta[Number(dow)] = deltas.length
      ? deltas.reduce((s, v) => s + v, 0) / deltas.length
      : 0;
  }

  const lastVal = history[history.length - 1].value;
  const result: number[] = [];
  let current = lastVal;

  for (let i = 0; i < horizon; i++) {
    const futureDate = addDays(lastDate, i + 1);
    const dow        = dayOfWeek(futureDate);
    current += avgDelta[dow] ?? 0;
    result.push(current);
  }

  return result;
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Gera projeção preditiva de saldo de caixa.
 *
 * @param snapshots  Histórico de snapshots (useSnapshots.snapshots)
 * @param horizon    Dias a projetar (padrão: 30)
 * @param field      Campo do summary a projetar (padrão: 'balance')
 */
export function forecast(
  snapshots:  DFCSnapshot[],
  horizon = 30,
  field:   keyof DFCSnapshot['summary'] = 'balance',
): ForecastResult {

  // ── Preparar série histórica ──────────────────────────────────────────────
  const history: TimeSeriesPoint[] = snapshots
    .filter(s => s.period.start) // Ignorar snapshots sem dados
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map(s => ({ date: s.id, value: s.summary[field] }));

  const n        = history.length;
  const lastDate = history[n - 1]?.date ?? new Date().toISOString().slice(0, 10);
  const lastVal  = history[n - 1]?.value ?? 0;

  // ── Qualidade da projeção ─────────────────────────────────────────────────
  let qualityNote: string;
  let confidence:  number;

  if (n < 3) {
    qualityNote = 'Dados insuficientes (< 3 snapshots). Importe mais semanas para ativar a projeção.';
    confidence  = 0;
  } else if (n < 7) {
    qualityNote = 'Projeção preliminar (< 7 snapshots). Precisão limitada — baseada apenas em EMA.';
    confidence  = 0.35;
  } else if (n < 14) {
    qualityNote = 'Projeção moderada (7–13 snapshots). Regressão linear + EMA ativos.';
    confidence  = 0.60;
  } else {
    qualityNote = 'Projeção confiável (≥ 14 snapshots). Ensemble com sazonalidade semanal ativo.';
    confidence  = 0.80;
  }

  // Reduz a confiança com o horizonte
  const horizonPenalty = Math.max(0, (horizon - 7) / 100);
  confidence = Math.max(0, confidence - horizonPenalty);

  // ── Pesos dos modelos (diminuem conforme menos dados) ─────────────────────
  const wLinear   = n >= 7  ? 0.40 : 0;
  const wEMA      = n >= 3  ? 0.35 : 1;   // fallback se não há dados suficientes
  const wSeasonal = n >= 14 ? 0.25 : 0;
  const wTotal    = wLinear + wEMA + wSeasonal;

  // ── Rodar modelos ─────────────────────────────────────────────────────────
  const linear   = n >= 7  ? forecastLinear(history, horizon)             : Array(horizon).fill(lastVal);
  const emaVals  = n >= 3  ? forecastEMA(history, horizon)                : Array(horizon).fill(lastVal);
  const seasonal = n >= 14 ? forecastSeasonal(history, horizon, lastDate) : Array(horizon).fill(lastVal);

  // ── Ensemble ──────────────────────────────────────────────────────────────
  const projected = Array.from({ length: horizon }, (_, i) => {
    const v = (wLinear * linear[i] + wEMA * emaVals[i] + wSeasonal * seasonal[i]) / wTotal;
    return v;
  });

  // ── Cone de confiança ─────────────────────────────────────────────────────
  const historicalSD = stdDev(history.map(p => p.value));

  // ── Montar resultado ──────────────────────────────────────────────────────
  const historicalPoints: ForecastPoint[] = history.map(p => ({
    date:     p.date,
    value:    p.value,
    lower:    p.value,
    upper:    p.value,
    isActual: true,
  }));

  const forecastPoints: ForecastPoint[] = projected.map((value, i) => {
    const sigma = historicalSD * Math.sqrt(i + 1) * (1 - confidence + 0.2);
    return {
      date:     addDays(lastDate, i + 1),
      value:    Math.round(value * 100) / 100,
      lower:    Math.round((value - sigma) * 100) / 100,
      upper:    Math.round((value + sigma) * 100) / 100,
      isActual: false,
    };
  });

  // ── Data de cruzamento com zero ───────────────────────────────────────────
  let zeroCrossDate: string | null = null;
  for (const p of forecastPoints) {
    if (p.value <= 0) {
      zeroCrossDate = p.date;
      break;
    }
  }

  // ── Modelo dominante ──────────────────────────────────────────────────────
  let dominantModel: ForecastResult['dominantModel'] = 'ensemble';
  if (wTotal > 0) {
    const weights = [
      { model: 'linear' as const, w: wLinear },
      { model: 'ema' as const,    w: wEMA    },
      { model: 'seasonal' as const, w: wSeasonal },
    ];
    const max = weights.reduce((a, b) => a.w >= b.w ? a : b);
    if (max.w / wTotal > 0.60) dominantModel = max.model;
  }

  return {
    points:        [...historicalPoints, ...forecastPoints],
    confidence:    Math.round(confidence * 100) / 100,
    dominantModel,
    dataPoints:    n,
    zeroCrossDate,
    qualityNote,
  };
}

/**
 * Formata a confiança como percentual legível.
 * Ex: 0.75 → "75%"
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Retorna cor Tailwind para o nível de confiança.
 */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.70) return 'text-emerald-400';
  if (confidence >= 0.40) return 'text-amber-400';
  return 'text-rose-400';
}
