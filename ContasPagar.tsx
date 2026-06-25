/**
 * components/DrillDownChart.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Gráfico de barras com drill-down interativo.
 *
 * ANTES: clicar em qualquer gráfico não fazia nada.
 * AGORA: clique em barra → filtro automático → breadcrumb → tabela abaixo atualiza.
 *
 * Nível 0 (root):    todas empresas
 * Nível 1 (empresa): filtrado por empresa → categorias
 * Nível 2 (categ.):  filtrado por categoria → fornecedores
 * Nível 3 (entid.):  transações individuais
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { ChevronRight, Home, ArrowLeft } from 'lucide-react';
import { Transaction } from '../types';
import { useDrillDown, nextDrillLevel, type DrillLevel } from '../hooks/useDrillDown';
import { formatCurrency, formatCompact, COMPANIES } from '../utils/finance';
import { CHART_COLORS, CHART_SERIES_COLORS, RECHARTS_TOOLTIP_STYLE } from '../utils/designTokens';

// ─── Props ────────────────────────────────────────────────────────────────────

interface DrillDownChartProps {
  transactions: Transaction[];
  title?: string;
  /** Dimensão de agrupamento no primeiro nível. Default: 'company' */
  rootGroupBy?: 'company' | 'category';
  /** Altura do gráfico em px. Default: 260 */
  height?: number;
  /** Se true, mostra a tabela de detalhes abaixo do gráfico */
  showDetailTable?: boolean;
}

// ─── Label da dimensão ────────────────────────────────────────────────────────

const LEVEL_LABELS: Record<DrillLevel, string> = {
  root:      'Consolidado',
  empresa:   'Empresa',
  categoria: 'Categoria',
  entidade:  'Fornecedor / Cliente',
};

const GROUPBY_FOR_LEVEL: Record<DrillLevel, 'company' | 'category' | 'supplier' | 'date'> = {
  root:      'company',
  empresa:   'category',
  categoria: 'supplier',
  entidade:  'date',
};

function companyLabel(id: string): string {
  return COMPANIES.find(c => c.id === id)?.name ?? `Empresa ${id}`;
}

// ─── Tooltip customizado ──────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const inflow  = payload.find((p: any) => p.dataKey === 'inflow')?.value  ?? 0;
  const outflow = payload.find((p: any) => p.dataKey === 'outflow')?.value ?? 0;
  const net     = inflow - outflow;

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl text-xs min-w-[160px]">
      <p className="text-slate-400 font-medium mb-2 truncate max-w-[180px]">{label}</p>
      {inflow > 0  && <div className="flex justify-between gap-4 mb-0.5"><span className="text-slate-500">Entrada</span><span className="text-emerald-400 font-semibold">{formatCompact(inflow)}</span></div>}
      {outflow > 0 && <div className="flex justify-between gap-4 mb-0.5"><span className="text-slate-500">Saída</span><span className="text-rose-400 font-semibold">{formatCompact(outflow)}</span></div>}
      <div className="flex justify-between gap-4 border-t border-slate-800 mt-1 pt-1">
        <span className="text-slate-500">Líquido</span>
        <span className={`font-semibold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCompact(net)}</span>
      </div>
      <p className="text-slate-600 mt-1 text-[9px]">Clique para detalhar →</p>
    </div>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function Breadcrumb({
  trail,
  onBack,
  onReset,
}: {
  trail:   { level: DrillLevel; label: string }[];
  onBack:  () => void;
  onReset: () => void;
}) {
  if (trail.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-slate-500 mb-3">
      <button onClick={onReset} className="hover:text-slate-300 transition-colors">
        <Home size={11} />
      </button>
      {trail.map((step, idx) => (
        <React.Fragment key={idx}>
          <ChevronRight size={10} className="text-slate-700" />
          <span className={idx === trail.length - 1 ? 'text-slate-300 font-medium' : 'hover:text-slate-300 cursor-pointer'}>
            {step.label}
          </span>
        </React.Fragment>
      ))}
      <button onClick={onBack} className="ml-2 flex items-center gap-1 text-slate-600 hover:text-slate-400 transition-colors">
        <ArrowLeft size={10} /> voltar
      </button>
    </div>
  );
}

// ─── Tabela de detalhes ───────────────────────────────────────────────────────

function DetailTable({ transactions }: { transactions: Transaction[] }) {
  const top = transactions
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return (
    <div className="mt-4 border border-slate-800/40 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 bg-slate-800/30 border-b border-slate-800/40">
        <p className="text-xs font-medium text-slate-400">
          Top {top.length} lançamentos ({transactions.length} total)
        </p>
      </div>
      <div className="divide-y divide-slate-800/30">
        {top.map(t => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 truncate">{t.supplier ?? t.description}</p>
              <p className="text-[10px] text-slate-600">{t.date} · {t.category}</p>
            </div>
            <p className={`text-xs font-mono font-medium flex-shrink-0 ${
              t.type === 'RECEIVABLE' ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {t.type === 'RECEIVABLE' ? '+' : '-'}{formatCurrency(t.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export const DrillDownChart: React.FC<DrillDownChartProps> = ({
  transactions,
  title = 'Fluxo por Dimensão',
  rootGroupBy = 'company',
  height = 260,
  showDetailTable = false,
}) => {
  const drill = useDrillDown();

  // Determinar groupBy baseado no nível atual
  const currentGroupBy = useMemo(() => {
    if (drill.current.level === 'root') {
      return rootGroupBy === 'company' ? 'company' : 'category';
    }
    return GROUPBY_FOR_LEVEL[drill.current.level];
  }, [drill.current.level, rootGroupBy]);

  // Construir dados do gráfico
  const chartData = useMemo(() => {
    const raw = drill.buildChartData(transactions, currentGroupBy as any);
    return raw
      .map(d => ({
        ...d,
        displayLabel: currentGroupBy === 'company'
          ? companyLabel(d.value).replace('A ', '').replace('TV ', '').slice(0, 10)
          : d.label.length > 14 ? d.label.slice(0, 14) + '…' : d.label,
      }))
      .slice(0, 12); // limitar a 12 barras
  }, [transactions, drill.buildChartData, currentGroupBy]);

  // Transações filtradas para a tabela
  const filteredTx = useMemo(
    () => drill.applyFilter(transactions),
    [drill.applyFilter, transactions]
  );

  // Nível seguinte para label do tooltip
  const nextLevel = nextDrillLevel(drill.current.level);

  const handleBarClick = (data: any) => {
    if (!nextLevel || !data?.value) return;
    const label = currentGroupBy === 'company'
      ? companyLabel(data.value)
      : data.label;
    drill.into(nextLevel, data.value, label);
  };

  return (
    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800/40">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {LEVEL_LABELS[drill.current.level]}
              {nextLevel && ` · clique para detalhar por ${LEVEL_LABELS[nextLevel].toLowerCase()}`}
            </p>
          </div>
          {drill.isDrilled && (
            <button
              onClick={drill.reset}
              className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded border border-slate-700/50 hover:border-slate-600 transition-colors"
            >
              Voltar ao início
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 pb-5">
        {/* Breadcrumb */}
        <Breadcrumb trail={drill.trail} onBack={drill.back} onReset={drill.reset} />

        {/* Gráfico */}
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
              barGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} vertical={false} />
              <XAxis
                dataKey="displayLabel"
                tick={{ fontSize: 9, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={v => formatCompact(v).replace('R$ ', '')}
                tick={{ fontSize: 9, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />

              <Bar
                dataKey="inflow"
                name="Entrada"
                fill={CHART_COLORS.inflow}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
                cursor={nextLevel ? 'pointer' : 'default'}
                onClick={handleBarClick}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length]} fillOpacity={0.7} />
                ))}
              </Bar>

              <Bar
                dataKey="outflow"
                name="Saída"
                fill={CHART_COLORS.outflow}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
                cursor={nextLevel ? 'pointer' : 'default'}
                onClick={handleBarClick}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length]} fillOpacity={0.4} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tabela de detalhes */}
        {showDetailTable && drill.isDrilled && (
          <DetailTable transactions={filteredTx} />
        )}

        {/* Legenda */}
        <div className="flex items-center gap-4 mt-3 justify-center">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS.inflow, opacity: 0.7 }} />
            Entradas
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CHART_COLORS.outflow, opacity: 0.4 }} />
            Saídas
          </span>
          {nextLevel && (
            <span className="text-[10px] text-slate-600 ml-2">↑ clique nas barras para detalhar</span>
          )}
        </div>
      </div>
    </div>
  );
};
