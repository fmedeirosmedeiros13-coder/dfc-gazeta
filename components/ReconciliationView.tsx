/**
 * components/ReconciliationView.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visão completa de Previsto × Realizado.
 *
 * ANTES: 250+ linhas de algoritmo inline no Dashboard.tsx, sem score de confiança.
 * AGORA: usa engines/reconciliation.ts — algoritmo reutilizável, resultado tipado.
 *        Cada par exibe o score de confiança (0–100) com cor semântica.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Scale, Upload, Trash2, CheckCircle2, AlertTriangle,
  FileX, ArrowLeft, ChevronDown, ChevronRight, GitMerge,
  ShieldCheck, Eye,
} from 'lucide-react';
import { Transaction } from '../types';
import { reconcile, confidenceColor, formatCoverage, type MatchGroup, type ReconciliationResult } from '../engines/reconciliation';
import { formatCurrency, formatCompact, parseDate } from '../utils/finance';
import { VisaoEstrategicaRealizado } from './VisaoEstrategicaRealizado';
import type { PrevistoSnapshot } from '../hooks/usePrevistoSnapshots';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ReconciliationViewProps {
  transactions:        Transaction[];
  realizedTransactions: Transaction[];
  onImportRealized?:   (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearRealized?:    () => void;
  /** Snapshots do Previsto por período (cada importação = um período). */
  previstoSnapshots?:  PrevistoSnapshot[];
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ score, reason }: { score: number; reason: string }) {
  const color = confidenceColor(score);
  const bg = color === 'green' ? 'bg-emerald-900/30 border-emerald-800/40 text-emerald-400'
           : color === 'amber' ? 'bg-amber-900/30 border-amber-800/40 text-amber-400'
           : 'bg-rose-900/30 border-rose-800/40 text-rose-400';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border ${bg}`}
      title={reason}
    >
      <ShieldCheck size={8} />
      {score}%
    </span>
  );
}

// ─── Match type label ─────────────────────────────────────────────────────────

const MATCH_LABELS: Record<string, string> = {
  EXACT:  'Exato',
  '1:1':  '1:1',
  '1:N':  '1:N',
  'N:1':  'N:1',
  'N:M':  'N:M',
  GLOBAL: 'Global',
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600">{sub}</p>}
    </div>
  );
}

// ─── Match row ────────────────────────────────────────────────────────────────

function MatchRow({ group }: { group: MatchGroup }) {
  const [open, setOpen] = useState(false);
  const totalReal = group.real.reduce((s, t) => s + t.value, 0);
  const totalPrev = group.prev.reduce((s, t) => s + (t.originalTitleValue ?? t.value), 0);

  return (
    <div className="border border-slate-800/40 rounded-lg overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-800/20 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {/* Score */}
        <ConfidenceBadge score={group.confidence} reason={group.confidenceReason} />

        {/* Tipo */}
        <span className="text-[10px] font-medium text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">
          {MATCH_LABELS[group.type] ?? group.type}
        </span>

        {/* Fornecedor principal */}
        <span className="text-xs text-slate-300 flex-1 truncate">
          {group.prev[0]?.supplier ?? group.prev[0]?.description ?? '—'}
          {group.prev.length > 1 && <span className="text-slate-500 ml-1">+{group.prev.length - 1}</span>}
        </span>

        {/* Valor previsto */}
        <span className="text-xs text-slate-400 font-mono">{formatCurrency(totalPrev)}</span>

        {/* Diferença */}
        {Math.abs(group.diff) > 0.01 ? (
          <span className={`text-xs font-mono ${group.diff > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {group.diff > 0 ? '+' : ''}{formatCurrency(group.diff)}
          </span>
        ) : (
          <span className="text-xs text-emerald-500">✓</span>
        )}

        {open ? <ChevronDown size={12} className="text-slate-600" /> : <ChevronRight size={12} className="text-slate-600" />}
      </div>

      {open && (
        <div className="px-4 pb-3 pt-2 bg-slate-900/30 border-t border-slate-800/30 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Previsto ({group.prev.length})</p>
            {group.prev.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs text-slate-300 truncate">{t.supplier ?? t.description}</p>
                  <p className="text-[10px] text-slate-600">{t.documentNumber ?? t.date}</p>
                </div>
                <p className="text-xs text-slate-400 font-mono flex-shrink-0">
                  {formatCurrency(t.originalTitleValue ?? t.value)}
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Realizado ({group.real.length})</p>
            {group.real.map(t => (
              <div key={t.id} className="flex items-center justify-between gap-2 py-1 border-b border-slate-800/20 last:border-0">
                <div className="min-w-0">
                  <p className="text-xs text-slate-300 truncate">{t.supplier ?? t.description}</p>
                  <p className="text-[10px] text-slate-600">{t.date}</p>
                </div>
                <p className="text-xs text-slate-400 font-mono flex-shrink-0">
                  {formatCurrency(t.value)}
                </p>
              </div>
            ))}
          </div>
          {group.confidenceReason && (
            <p className="col-span-2 text-[10px] text-slate-600 italic">{group.confidenceReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pending/Unexpected rows ──────────────────────────────────────────────────

function PendingRow({ t }: { t: Transaction }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border border-slate-800/40 rounded-lg">
      <AlertTriangle size={12} className="text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 truncate">{t.supplier ?? t.description}</p>
        <p className="text-[10px] text-slate-600">{t.date} · {t.documentNumber ?? 'sem documento'}</p>
      </div>
      <p className="text-xs text-amber-400 font-mono">{formatCurrency(t.originalTitleValue ?? t.value)}</p>
    </div>
  );
}

function UnexpectedRow({ t }: { t: Transaction }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border border-slate-800/40 rounded-lg">
      <FileX size={12} className="text-rose-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-300 truncate">{t.supplier ?? t.description}</p>
        <p className="text-[10px] text-slate-600">{t.date} · {t.documentNumber ?? 'sem documento'}</p>
      </div>
      <p className="text-xs text-rose-400 font-mono">{formatCurrency(t.value)}</p>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

type Tab = 'overview' | 'matched' | 'review' | 'pending' | 'unexpected' | 'strategic';

export const ReconciliationView: React.FC<ReconciliationViewProps> = ({
  transactions,
  realizedTransactions,
  onImportRealized,
  onClearRealized,
  previstoSnapshots = [],
}) => {
  const [tab, setTab] = useState<Tab>('overview');
  const fileRef = useRef<HTMLInputElement>(null);

  // Período selecionado: por padrão, o mais recente importado (se houver
  // algum snapshot de previsto); "ALL" mantém o comportamento antigo
  // (todo o previsto acumulado, sem filtro de período).
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>(
    previstoSnapshots[0]?.id ?? 'ALL'
  );
  const selectedPeriod = previstoSnapshots.find(s => s.id === selectedPeriodId) ?? null;

  // Previsto do período: usa a FOTO salva no snapshot (imune a importações
  // futuras de outros meses), não o `transactions` acumulado inteiro.
  const previstoFiltrado = selectedPeriod ? selectedPeriod.transactions : transactions;

  // Realizado do MESMO período: filtra pela data, para não misturar meses.
  const realizadoFiltrado = useMemo(() => {
    if (!selectedPeriod) return realizedTransactions;
    const start = parseDate(selectedPeriod.period.start.split('-').reverse().join('/'));
    const end   = parseDate(selectedPeriod.period.end.split('-').reverse().join('/'));
    return realizedTransactions.filter(t => {
      const d = parseDate(t.date);
      return d >= start && d <= end;
    });
  }, [realizedTransactions, selectedPeriod]);

  const result: ReconciliationResult = useMemo(
    () => reconcile(previstoFiltrado, realizadoFiltrado),
    [previstoFiltrado, realizadoFiltrado]
  );

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview',    label: 'Visão Geral' },
    { id: 'matched',     label: 'Conciliados',  count: result.matched.length },
    { id: 'review',      label: 'Revisão',      count: result.reviewNeeded.length },
    { id: 'pending',     label: 'Em Aberto',    count: result.pending.length },
    { id: 'unexpected',  label: 'Surpresas',    count: result.unexpected.length },
    { id: 'strategic',   label: 'Estratégico' },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 bg-slate-900/40 border border-slate-800/60 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Scale size={18} className="text-amber-400" />
          <div>
            <h2 className="text-base font-semibold text-slate-200">Conciliação Financeira</h2>
            <p className="text-xs text-slate-500">
              {realizedTransactions.length > 0
                ? `${realizedTransactions.length} realizado(s) importado(s)`
                : 'Importe os realizados para iniciar'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.txt,.xls,.xlsx" className="hidden" onChange={onImportRealized} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-800/50 text-amber-400 text-xs font-medium hover:bg-amber-900/50 transition-colors"
          >
            <Upload size={13} />
            Importar Realizados
          </button>
          {realizedTransactions.length > 0 && (
            <button
              onClick={onClearRealized}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-500 text-xs font-medium hover:text-rose-400 hover:border-rose-800/50 transition-colors"
            >
              <Trash2 size={13} />
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Seletor de período do Previsto */}
      {previstoSnapshots.length > 0 && (
        <div className="flex items-center gap-3 bg-slate-900/40 border border-slate-800/60 rounded-xl px-5 py-3">
          <span className="text-xs text-slate-500 font-medium shrink-0">Período do previsto:</span>
          <select
            value={selectedPeriodId}
            onChange={e => setSelectedPeriodId(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-slate-700 bg-slate-950 text-slate-200 text-xs"
          >
            {previstoSnapshots.map(s => (
              <option key={s.id} value={s.id}>{s.label} ({s.transactions.length} título(s))</option>
            ))}
            <option value="ALL">Todos os períodos (comportamento antigo — pode misturar meses)</option>
          </select>
          <span className="text-[11px] text-slate-600">
            {realizadoFiltrado.length} realizado(s) neste período
          </span>
        </div>
      )}

      {realizadoFiltrado.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-16 bg-slate-900/20 border border-dashed border-slate-700/50 rounded-xl">
          <GitMerge size={32} className="text-slate-700" />
          <div className="text-center">
            <p className="text-sm font-medium text-slate-500">Nenhum realizado importado</p>
            <p className="text-xs text-slate-600 mt-1">Importe o CSV de pagamentos realizados para iniciar a conciliação</p>
          </div>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-900/30 border border-amber-800/50 text-amber-400 text-sm hover:bg-amber-900/50 transition-colors">
            <Upload size={14} /> Importar agora
          </button>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard
              label="Cobertura"
              value={formatCoverage(result)}
              sub={`${result.matched.length} pares conciliados`}
              color="text-emerald-400"
            />
            <KPICard
              label="Conciliado"
              value={formatCompact(result.totals.matchedValue)}
              sub="valor total casado"
              color="text-slate-200"
            />
            <KPICard
              label="Em Aberto"
              value={formatCompact(result.totals.pendingValue)}
              sub={`${result.pending.length} previsto(s) sem par`}
              color="text-amber-400"
            />
            <KPICard
              label="Surpresas"
              value={formatCompact(result.totals.unexpectedValue)}
              sub={`${result.unexpected.length} realizado(s) sem par`}
              color="text-rose-400"
            />
          </div>

          {/* Revisar badge */}
          {result.reviewNeeded.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40">
              <AlertTriangle size={13} className="text-amber-400 flex-shrink-0" />
              <p className="text-xs text-amber-300">
                <strong>{result.reviewNeeded.length} par(es)</strong> com score de confiança baixo requerem validação manual.
              </p>
              <button onClick={() => setTab('review')} className="ml-auto text-xs text-amber-400 underline underline-offset-2 hover:text-amber-300">
                Revisar
              </button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-900/40 border border-slate-800/40 p-1 rounded-lg overflow-x-auto">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  tab === t.id
                    ? 'bg-slate-700 text-slate-100 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                    tab === t.id ? 'bg-slate-600 text-slate-300' : 'bg-slate-800 text-slate-500'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Conteúdo */}
          <div className="space-y-2">
            {tab === 'overview' && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 px-1">Top conciliados por impacto</p>
                {result.matched.slice(0, 8).map((g, i) => <MatchRow key={i} group={g} />)}
                {result.matched.length > 8 && (
                  <button onClick={() => setTab('matched')} className="w-full text-xs text-slate-500 hover:text-slate-300 py-2">
                    Ver todos ({result.matched.length}) →
                  </button>
                )}
              </div>
            )}

            {tab === 'matched' && (
              <div className="space-y-2">
                {result.matched.length === 0
                  ? <p className="text-sm text-slate-600 text-center py-8">Nenhum item conciliado</p>
                  : result.matched.map((g, i) => <MatchRow key={i} group={g} />)
                }
              </div>
            )}

            {tab === 'review' && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 px-1">
                  Estes pares foram casados com score &lt; 70% — validação manual recomendada.
                </p>
                {result.reviewNeeded.length === 0
                  ? <p className="text-sm text-slate-600 text-center py-8">✓ Nenhum item para revisar</p>
                  : result.reviewNeeded.map((g, i) => <MatchRow key={i} group={g} />)
                }
              </div>
            )}

            {tab === 'pending' && (
              <div className="space-y-2">
                {result.pending.length === 0
                  ? (
                    <div className="flex flex-col items-center gap-2 py-8">
                      <CheckCircle2 size={24} className="text-emerald-500" />
                      <p className="text-sm text-slate-500">Todos os previstos foram conciliados</p>
                    </div>
                  )
                  : result.pending.map(t => <PendingRow key={t.id} t={t} />)
                }
              </div>
            )}

            {tab === 'unexpected' && (
              <div className="space-y-2">
                {result.unexpected.length === 0
                  ? (
                    <div className="flex flex-col items-center gap-2 py-8">
                      <CheckCircle2 size={24} className="text-emerald-500" />
                      <p className="text-sm text-slate-500">Nenhum pagamento sem previsto correspondente</p>
                    </div>
                  )
                  : result.unexpected.map(t => <UnexpectedRow key={t.id} t={t} />)
                }
              </div>
            )}

            {tab === 'strategic' && (
              <VisaoEstrategicaRealizado
                planned={previstoFiltrado}
                realized={realizadoFiltrado}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};
