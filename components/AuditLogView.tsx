/**
 * components/AuditLogView.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Visualizador do audit log de alterações.
 *
 * ANTES: engines/auditLog.ts registrava tudo mas nada era visível na UI.
 * AGORA: interface completa com filtro por ação, timeline e exportação CSV.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Activity, Download, Filter, RefreshCw,
  FileUp, PencilLine, PlusCircle, Trash2,
  BrainCircuit, Camera, RefreshCwIcon, Bell,
  LogIn, FileWarning, Edit2, FileDown, Presentation,
  Table, Eraser,
} from 'lucide-react';
import { auditLog, actionLabel, type AuditEntry, type AuditAction, type AuditStats } from '../engines/auditLog';

// ─── Ícone por ação ───────────────────────────────────────────────────────────

function ActionIcon({ action, size = 14 }: { action: AuditAction; size?: number }) {
  const p = { size, strokeWidth: 2, className: 'flex-shrink-0' };
  switch (action) {
    case 'CSV_IMPORT':             return <FileUp {...p} />;
    case 'CSV_IMPORT_ERROR':       return <FileWarning {...p} />;
    case 'MANUAL_VALUE_CHANGE':    return <PencilLine {...p} />;
    case 'TRANSACTION_ADD':        return <PlusCircle {...p} />;
    case 'TRANSACTION_DELETE':     return <Trash2 {...p} />;
    case 'TRANSACTION_EDIT':       return <Edit2 {...p} />;
    case 'DATA_CLEAR':             return <Eraser {...p} />;
    case 'AI_ANALYSIS_GENERATED':  return <BrainCircuit {...p} />;
    case 'EXPORT_PDF':             return <FileDown {...p} />;
    case 'EXPORT_PPTX':            return <Presentation {...p} />;
    case 'EXPORT_CSV':             return <Table {...p} />;
    case 'SNAPSHOT_CAPTURED':      return <Camera {...p} />;
    case 'ERP_SYNC':               return <RefreshCwIcon {...p} />;
    case 'ALERT_TRIGGERED':        return <Bell {...p} />;
    case 'SESSION_START':          return <LogIn {...p} />;
    default:                       return <Activity {...p} />;
  }
}

// ─── Cor por ação ─────────────────────────────────────────────────────────────

function actionColor(action: AuditAction): string {
  if (['TRANSACTION_DELETE', 'DATA_CLEAR', 'CSV_IMPORT_ERROR'].includes(action)) return 'text-rose-400';
  if (['MANUAL_VALUE_CHANGE', 'TRANSACTION_EDIT'].includes(action))               return 'text-amber-400';
  if (['TRANSACTION_ADD', 'CSV_IMPORT', 'ERP_SYNC'].includes(action))             return 'text-emerald-400';
  if (['AI_ANALYSIS_GENERATED', 'SNAPSHOT_CAPTURED'].includes(action))            return 'text-indigo-400';
  return 'text-slate-400';
}

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = entry.before !== undefined || entry.after !== undefined || entry.meta;

  return (
    <div className="border-b border-slate-800/30 last:border-0">
      <div
        className={`flex items-start gap-3 px-4 py-3 ${hasDetails ? 'cursor-pointer hover:bg-slate-800/20' : ''} transition-colors`}
        onClick={() => hasDetails && setOpen(o => !o)}
      >
        <span className={`mt-0.5 ${actionColor(entry.action)}`}>
          <ActionIcon action={entry.action} size={13} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-300">
              {actionLabel(entry.action)}
            </span>
            {entry.subject && entry.subject !== 'app' && (
              <code className="text-[9px] bg-slate-800/60 text-slate-500 px-1.5 py-0.5 rounded font-mono truncate max-w-[200px]">
                {entry.subject}
              </code>
            )}
          </div>
          {entry.reason && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{entry.reason}</p>
          )}
        </div>

        <p className="text-[10px] text-slate-600 flex-shrink-0 mt-0.5">
          {entry.displayTime}
        </p>
      </div>

      {open && hasDetails && (
        <div className="px-4 pb-3 pt-1 bg-slate-900/20 space-y-2">
          {entry.before !== undefined && (
            <div className="flex gap-3">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider w-12 flex-shrink-0 pt-0.5">Antes</span>
              <code className="text-[10px] text-rose-400 bg-rose-950/20 px-2 py-1 rounded font-mono flex-1 break-all">
                {JSON.stringify(entry.before)}
              </code>
            </div>
          )}
          {entry.after !== undefined && (
            <div className="flex gap-3">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider w-12 flex-shrink-0 pt-0.5">Depois</span>
              <code className="text-[10px] text-emerald-400 bg-emerald-950/20 px-2 py-1 rounded font-mono flex-1 break-all">
                {JSON.stringify(entry.after)}
              </code>
            </div>
          )}
          {entry.meta && Object.keys(entry.meta).length > 0 && (
            <div className="flex gap-3">
              <span className="text-[9px] text-slate-600 uppercase tracking-wider w-12 flex-shrink-0 pt-0.5">Meta</span>
              <code className="text-[10px] text-slate-500 bg-slate-800/40 px-2 py-1 rounded font-mono flex-1 break-all">
                {JSON.stringify(entry.meta)}
              </code>
            </div>
          )}
          <p className="text-[9px] text-slate-700">Sessão: {entry.sessionId}</p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const ACTION_FILTERS: { value: AuditAction | 'all'; label: string }[] = [
  { value: 'all',                   label: 'Todos' },
  { value: 'MANUAL_VALUE_CHANGE',   label: 'Valores manuais' },
  { value: 'CSV_IMPORT',            label: 'Importações CSV' },
  { value: 'TRANSACTION_ADD',       label: 'Lançamentos' },
  { value: 'AI_ANALYSIS_GENERATED', label: 'Análise IA' },
  { value: 'ERP_SYNC',              label: 'Sync ERP' },
  { value: 'DATA_CLEAR',            label: 'Limpezas' },
];

export const AuditLogView: React.FC = () => {
  const [entries,    setEntries]    = useState<AuditEntry[]>([]);
  const [stats,      setStats]      = useState<AuditStats | null>(null);
  const [isLoading,  setIsLoading]  = useState(true);
  const [filter,     setFilter]     = useState<AuditAction | 'all'>('all');
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const [entries, stats] = await Promise.all([
      auditLog.query({ action: filter === 'all' ? undefined : filter as AuditAction, limit: 100 }),
      auditLog.stats(),
    ]);
    setEntries(entries);
    setStats(stats);
    setIsLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csv  = await auditLog.exportCSV();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `audit-log-dfc-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-slate-900/40 border border-slate-800/60 rounded-xl px-5 py-4">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-indigo-400" />
          <div>
            <h2 className="text-base font-semibold text-slate-200">Registro de Auditoria</h2>
            <p className="text-xs text-slate-500">
              {stats ? `${stats.totalEntries} entradas · ${stats.manualChangesToday} alterações hoje` : 'Carregando...'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-500 hover:text-slate-300 transition-colors"
            title="Atualizar"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-900/30 border border-indigo-800/50 text-indigo-400 text-xs font-medium hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
          >
            <Download size={13} />
            {isExporting ? 'Exportando...' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {Object.entries(stats.entriesByAction)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 6)
            .map(([action, count]) => (
              <div key={action} className="bg-slate-900/30 border border-slate-800/40 rounded-lg px-3 py-2 text-center">
                <p className="text-lg font-semibold text-slate-300">{count}</p>
                <p className="text-[9px] text-slate-600 uppercase tracking-wider truncate">
                  {actionLabel(action as AuditAction)}
                </p>
              </div>
            ))
          }
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-1 flex-wrap">
        {ACTION_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              filter === f.value
                ? 'bg-indigo-900/50 border-indigo-700/60 text-indigo-300'
                : 'bg-slate-900/30 border-slate-800/40 text-slate-500 hover:text-slate-300 hover:border-slate-700/50'
            }`}
          >
            <span className="flex items-center gap-1">
              <Filter size={9} />
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-600">
            <RefreshCw size={14} className="animate-spin" />
            <span className="text-sm">Carregando registros...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <Activity size={24} className="text-slate-700" />
            <p className="text-sm text-slate-600">Nenhum registro encontrado</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {entries.map(entry => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {entries.length >= 100 && (
        <p className="text-xs text-slate-600 text-center">
          Exibindo últimas 100 entradas. Exporte o CSV para o histórico completo.
        </p>
      )}
    </div>
  );
};
