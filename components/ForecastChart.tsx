/**
 * components/ForecastChart.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visualização da projeção preditiva de caixa.
 *
 * ANTES: engines/forecast.ts e hooks/useSnapshots existiam mas não tinham UI.
 * AGORA: gráfico de área com histórico real + cone de confiança projetado.
 *
 * Recursos:
 *   • Série histórica (linha sólida, cor por saldo +/-)
 *   • Cone de confiança (área sombreada entre lower e upper)
 *   • Data estimada de cruzamento com zero (linha vertical vermelha)
 *   • Selector de horizonte: 7 / 30 / 90 dias
 *   • Badge de qualidade do modelo
 *   • Trend indicator (↑ ↓ →) baseado nos últimos 5 snapshots
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Info, AlertTriangle } from 'lucide-react';

import type { DFCSnapshot } from '../hooks/useSnapshots';
import { forecast, formatConfidence, confidenceColor } from '../engines/forecast';
import { formatCurrency, formatCompact } from '../utils/finance';
import { CHART_COLORS, RECHARTS_TOOLTIP_STYLE } from '../utils/designTokens';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ForecastChartProps {
  snapshots: DFCSnapshot[];
  field?: keyof DFCSnapshot['summary'];
  title?: string;
  compact?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatAxisDate(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!d) return dateStr;
  return `${d}/${m}`;
}

function TrendBadge({ snapshots, field }: { snapshots: DFCSnapshot[]; field: keyof DFCSnapshot['summary'] }) {
  const recent = snapshots.slice(-5);
  if (recent.length < 2) return null;
  const first = recent[0].summary[field];
  const last  = recent[recent.length - 1].summary[field];
  const diff  = last - first;
  const pct   = first !== 0 ? Math.abs(diff / first) : 0;

  if (pct < 0.03) return (
    <span className="flex items-center gap-1 text-xs text-slate-500 px-2 py-0.5 rounded-full bg-slate-800/50 border border-slate-700/50">
      <Minus size={10} /> Estável
    </span>
  );
  if (diff > 0) return (
    <span className="flex items-center gap-1 text-xs text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-900/20 border border-emerald-800/30">
      <TrendingUp size={10} /> +{(pct * 100).toFixed(0)}%
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-rose-400 px-2 py-0.5 rounded-full bg-rose-900/20 border border-rose-800/30">
      <TrendingDown size={10} /> -{(pct * 100).toFixed(0)}%
    </span>
  );
}

// ─── Tooltip customizado ──────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;

  const isProjection = payload[0]?.payload?.isActual === false;
  const value  = payload.find((p: any) => p.dataKey === 'value')?.value;
  const upper  = payload.find((p: any) => p.dataKey === 'upper')?.value;
  const lower  = payload.find((p: any) => p.dataKey === 'lower')?.value;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl text-xs min-w-[160px]">
      <p className="text-slate-400 mb-2 font-medium">
        {label} {isProjection && <span className="text-amber-400 ml-1">· projeção</span>}
      </p>
      {value !== undefined && (
        <div className="flex justify-between gap-4 mb-1">
          <span className="text-slate-500">Saldo</span>
          <span className={`font-semibold ${value >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {formatCurrency(value)}
          </span>
        </div>
      )}
      {isProjection && upper !== undefined && lower !== undefined && (
        <>
          <div className="flex justify-between gap-4 text-slate-600">
            <span>Máx.</span><span>{formatCompact(upper)}</span>
          </div>
          <div className="flex justify-between gap-4 text-slate-600">
            <span>Mín.</span><span>{formatCompact(lower)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export const ForecastChart: React.FC<ForecastChartProps> = ({
  snapshots,
  field = 'balance',
  title = 'Projeção de Caixa',
  compact = false,
}) => {
  const [horizon, setHorizon] = useState<7 | 30 | 90>(30);

  const result = useMemo(
    () => forecast(snapshots, horizon, field),
    [snapshots, horizon, field]
  );

  const chartData = useMemo(() =>
    result.points.map(p => ({
      date:     formatAxisDate(p.date),
      rawDate:  p.date,
      value:    p.isActual ? p.value : p.value,
      upper:    p.isActual ? null : p.upper,
      lower:    p.isActual ? null : p.lower,
      isActual: p.isActual,
    })),
    [result.points]
  );

  // Zero cross reference
  const zeroCrossLabel = result.zeroCrossDate
    ? formatAxisDate(result.zeroCrossDate)
    : null;

  // Insufficient data
  if (snapshots.length < 3) {
    return (
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-6 flex flex-col items-center justify-center gap-3 min-h-[220px]">
        <div className="p-3 rounded-full bg-slate-800/60 border border-slate-700/50">
          <Info size={20} className="text-slate-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">Projeção indisponível</p>
          <p className="text-xs text-slate-600 mt-1 max-w-xs">
            {result.qualityNote}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {snapshots.length} de 3 snapshots mínimos coletados.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-800/40">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {result.dataPoints} snapshots · modelo {result.dominantModel}
            </p>
          </div>
          <TrendBadge snapshots={snapshots} field={field} />
        </div>

        <div className="flex items-center gap-3">
          {/* Confiança */}
          <div className="text-right">
            <p className={`text-sm font-semibold ${confidenceColor(result.confidence)}`}>
              {formatConfidence(result.confidence)}
            </p>
            <p className="text-[10px] text-slate-600">confiança</p>
          </div>

          {/* Selector de horizonte */}
          <div className="flex bg-slate-800/60 rounded-lg border border-slate-700/50 p-0.5">
            {([7, 30, 90] as const).map(h => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  horizon === h
                    ? 'bg-slate-700 text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {h}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Aviso de cruzamento com zero */}
      {result.zeroCrossDate && (
        <div className="flex items-center gap-2 px-5 py-2 bg-rose-950/30 border-b border-rose-800/30">
          <AlertTriangle size={12} className="text-rose-400 flex-shrink-0" />
          <p className="text-xs text-rose-300">
            Saldo projetado pode chegar a zero em <strong>{result.zeroCrossDate}</strong>.
            Revisar entradas ou postergar pagamentos.
          </p>
        </div>
      )}

      {/* Gráfico */}
      <div className={compact ? 'h-48 px-2 pt-4 pb-2' : 'h-72 px-2 pt-5 pb-3'}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />

            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              interval={Math.floor(chartData.length / 6)}
            />
            <YAxis
              tickFormatter={v => formatCompact(v).replace('R$ ', '')}
              tick={{ fontSize: 10, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              width={52}
            />

            <Tooltip content={<CustomTooltip />} />

            {/* Cone de confiança — área preenchida */}
            <Area
              dataKey="upper"
              stroke="none"
              fill={CHART_COLORS.neutral}
              fillOpacity={0.08}
              connectNulls
              isAnimationActive={false}
            />
            <Area
              dataKey="lower"
              stroke="none"
              fill={CHART_COLORS.neutral}
              fillOpacity={0.0}
              connectNulls
              isAnimationActive={false}
            />

            {/* Linha principal */}
            <Line
              dataKey="value"
              type="monotone"
              stroke={CHART_COLORS.balance}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: CHART_COLORS.balance, strokeWidth: 0 }}
              connectNulls
            />

            {/* Linha de zero */}
            <ReferenceLine y={0} stroke={CHART_COLORS.outflow} strokeDasharray="4 4" strokeOpacity={0.4} />

            {/* Cruzamento com zero */}
            {zeroCrossLabel && (
              <ReferenceLine
                x={zeroCrossLabel}
                stroke={CHART_COLORS.outflow}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
                label={{ value: '⚠', position: 'top', fontSize: 11, fill: CHART_COLORS.outflow }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Footer com nota de qualidade */}
      {!compact && (
        <div className="px-5 py-3 border-t border-slate-800/40 flex items-start gap-2">
          <Info size={11} className="text-slate-600 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-600 leading-relaxed">{result.qualityNote}</p>
        </div>
      )}
    </div>
  );
};
