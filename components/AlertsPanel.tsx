/**
 * components/AlertsPanel.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Painel de alertas proativos — conecta engines/alerts.ts à interface.
 *
 * ANTES: alerts eram detectados mas nunca exibidos além do badge no header.
 * AGORA: painel completo com severidade, impacto, ações e dismiss por sessão.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useMemo } from 'react';
import {
  AlertTriangle, Bell, BellOff, ChevronDown, ChevronRight,
  Clock, DollarSign, TrendingDown, TrendingUp, X, Zap,
  GitMerge, BarChart2, Activity, Eye, EyeOff,
} from 'lucide-react';
import type { Alert, AlertSeverity, AlertType } from '../engines/alerts';
import { alertSeverityColor } from '../engines/alerts';
import { formatCurrency } from '../utils/finance';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AlertsPanelProps {
  alerts: Alert[];
  onDismiss?: (alertId: string) => void;
  onViewTransactions?: (ids: string[]) => void;
  compact?: boolean;
}

// ─── Ícone por tipo ───────────────────────────────────────────────────────────

function AlertIcon({ type, size = 14 }: { type: AlertType; size?: number }) {
  const props = { size, strokeWidth: 2 };
  switch (type) {
    case 'DUE_DATE':      return <Clock {...props} />;
    case 'LOW_BALANCE':   return <TrendingDown {...props} />;
    case 'CONCENTRATION': return <BarChart2 {...props} />;
    case 'DEVIATION':     return <Activity {...props} />;
    case 'ANOMALY':       return <Zap {...props} />;
    case 'UNMATCHED':     return <GitMerge {...props} />;
    default:              return <AlertTriangle {...props} />;
  }
}

// ─── Label por tipo ───────────────────────────────────────────────────────────

const TYPE_LABELS: Record<AlertType, string> = {
  DUE_DATE:      'Vencimento',
  LOW_BALANCE:   'Saldo',
  CONCENTRATION: 'Concentração',
  DEVIATION:     'Desvio',
  ANOMALY:       'Anomalia',
  UNMATCHED:     'Conciliação',
};

// Rótulos em português dos metadados dos alertas (ex.: value → Valor).
const META_LABELS: Record<string, string> = {
  mean:      'Média',
  stdDev:    'Desvio-padrão',
  threshold: 'Limite',
  value:     'Valor',
  percent:   'Percentual',
  supplier:  'Fornecedor',
};

// ─── Severity badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const labels: Record<AlertSeverity, string> = {
    critical: 'CRÍTICO',
    warning:  'ATENÇÃO',
    info:     'INFO',
  };
  const colors = alertSeverityColor(severity);
  return (
    <span className={`text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} border ${colors.border}`}>
      {labels[severity]}
    </span>
  );
}

// ─── Card de alerta individual ────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
  onViewTransactions,
  defaultOpen = false,
}: {
  alert:                Alert;
  onDismiss?:           (id: string) => void;
  onViewTransactions?:  (ids: string[]) => void;
  defaultOpen?:         boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const colors = alertSeverityColor(alert.severity);

  return (
    <div className={`rounded-lg border ${colors.bg} ${colors.border} overflow-hidden transition-all duration-200`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setOpen(o => !o)}
      >
        <span className={colors.icon}>
          <AlertIcon type={alert.type} size={15} />
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={alert.severity} />
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
              {TYPE_LABELS[alert.type]}
            </span>
          </div>
          <p className={`text-sm font-medium mt-0.5 leading-snug ${colors.text}`}>
            {alert.title}
          </p>
        </div>

        {alert.impactValue > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs font-semibold text-slate-300">
              {formatCurrency(alert.impactValue)}
            </p>
            <p className="text-[10px] text-slate-500">impacto</p>
          </div>
        )}

        <div className="flex items-center gap-1 flex-shrink-0">
          {open
            ? <ChevronDown size={14} className="text-slate-500" />
            : <ChevronRight size={14} className="text-slate-500" />
          }
        </div>
      </div>

      {/* Body expandido */}
      {open && (
        <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
          <p className="text-sm text-slate-400 leading-relaxed">
            {alert.description}
          </p>

          <div className="flex items-center gap-2">
            {alert.relatedTransactionIds.length > 0 && onViewTransactions && (
              <button
                onClick={() => onViewTransactions(alert.relatedTransactionIds)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-slate-800/60 border border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
              >
                <Eye size={11} />
                Ver {alert.relatedTransactionIds.length} lançamento(s)
              </button>
            )}
            {onDismiss && (
              <button
                onClick={() => onDismiss(alert.id)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-slate-800/40 border border-slate-700/40 text-slate-500 hover:text-slate-300 transition-colors ml-auto"
              >
                <EyeOff size={11} />
                Dispensar
              </button>
            )}
          </div>

          {/* Metadados extras */}
          {alert.meta && Object.keys(alert.meta).length > 0 && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              {Object.entries(alert.meta).slice(0, 4).map(([k, v]) => (
                <div key={k} className="bg-slate-900/50 rounded-md px-2 py-1.5">
                  <p className="text-[9px] text-slate-600 uppercase tracking-wider">{META_LABELS[k] ?? k}</p>
                  <p className="text-xs text-slate-400 font-medium truncate">
                    {typeof v === 'number'
                      ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
                      : String(v)}
                  </p>
                </div>
              ))}
            </div>
          )}

          <p className="text-[10px] text-slate-600">
            {alert.generatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  alerts,
  onDismiss,
  onViewTransactions,
  compact = false,
}) => {
  const [dismissed,   setDismissed]   = useState<Set<string>>(new Set());
  const [filterSev,   setFilterSev]   = useState<AlertSeverity | 'all'>('all');
  const [filterType,  setFilterType]  = useState<AlertType | 'all'>('all');
  const [muted,       setMuted]       = useState(false);

  const handleDismiss = (id: string) => {
    setDismissed(prev => new Set([...prev, id]));
    onDismiss?.(id);
  };

  const visible = useMemo(() =>
    alerts
      .filter(a => !dismissed.has(a.id))
      .filter(a => filterSev  === 'all' || a.severity === filterSev)
      .filter(a => filterType === 'all' || a.type    === filterType),
    [alerts, dismissed, filterSev, filterType]
  );

  const counts = useMemo(() => ({
    critical: alerts.filter(a => !dismissed.has(a.id) && a.severity === 'critical').length,
    warning:  alerts.filter(a => !dismissed.has(a.id) && a.severity === 'warning').length,
    info:     alerts.filter(a => !dismissed.has(a.id) && a.severity === 'info').length,
  }), [alerts, dismissed]);

  if (muted) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/30 border border-slate-800/40 rounded-xl">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <BellOff size={14} />
          <span>Alertas silenciados ({alerts.length - dismissed.size} ocultos)</span>
        </div>
        <button onClick={() => setMuted(false)} className="text-xs text-slate-400 hover:text-slate-200 transition-colors">
          Reativar
        </button>
      </div>
    );
  }

  if (visible.length === 0 && alerts.length > 0) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/30 border border-slate-800/40 rounded-xl">
        <p className="text-sm text-slate-500">Todos os alertas dispensados nesta sessão.</p>
        <button onClick={() => setDismissed(new Set())} className="text-xs text-slate-400 hover:text-slate-200">
          Restaurar
        </button>
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 bg-slate-900/20 border border-slate-800/40 rounded-xl">
        <div className="p-3 rounded-full bg-emerald-900/20 border border-emerald-800/30">
          <Bell size={20} className="text-emerald-500" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-slate-300">Nenhum alerta ativo</p>
          <p className="text-xs text-slate-500 mt-1">Fluxo de caixa dentro dos parâmetros normais</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header com contadores e filtros */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Contadores por severidade */}
        <div className="flex items-center gap-2">
          {counts.critical > 0 && (
            <button
              onClick={() => setFilterSev(filterSev === 'critical' ? 'all' : 'critical')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterSev === 'critical'
                  ? 'bg-rose-900/60 border-rose-700/60 text-rose-200'
                  : 'bg-rose-950/40 border-rose-800/50 text-rose-400 hover:border-rose-700/60'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {counts.critical} crítico{counts.critical > 1 ? 's' : ''}
            </button>
          )}
          {counts.warning > 0 && (
            <button
              onClick={() => setFilterSev(filterSev === 'warning' ? 'all' : 'warning')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterSev === 'warning'
                  ? 'bg-amber-900/60 border-amber-700/60 text-amber-200'
                  : 'bg-amber-950/40 border-amber-800/50 text-amber-400 hover:border-amber-700/60'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {counts.warning} atenção
            </button>
          )}
          {filterSev !== 'all' && (
            <button onClick={() => setFilterSev('all')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Todos
            </button>
          )}
        </div>

        {/* Silenciar */}
        {!compact && (
          <button
            onClick={() => setMuted(true)}
            className="text-xs text-slate-600 hover:text-slate-400 transition-colors flex items-center gap-1"
          >
            <BellOff size={11} />
            Silenciar
          </button>
        )}
      </div>

      {/* Lista de alertas */}
      <div className="space-y-2">
        {visible.map((alert, idx) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onDismiss={handleDismiss}
            onViewTransactions={onViewTransactions}
            defaultOpen={idx === 0 && alert.severity === 'critical'}
          />
        ))}
      </div>

      {dismissed.size > 0 && (
        <button
          onClick={() => setDismissed(new Set())}
          className="w-full text-xs text-slate-600 hover:text-slate-400 transition-colors py-1.5"
        >
          Restaurar {dismissed.size} dispensado(s)
        </button>
      )}
    </div>
  );
};
