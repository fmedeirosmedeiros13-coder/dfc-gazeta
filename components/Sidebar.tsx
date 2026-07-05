import React, { useState } from 'react';
import { ViewMode } from '../types';
import {
  FileSpreadsheet, ArrowDownCircle,
  ArrowUpCircle, Table2, Scale, CalendarRange,
  LayoutGrid, Calculator, PieChart, Projector,
  Bell, TrendingUp, Activity,
} from 'lucide-react';

interface SidebarProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  logoUrl: string;
  setLogoUrl: (url: string) => void;
  logoInputRef: React.RefObject<HTMLInputElement>;
  alertCounts?: { critical: number; warning: number };
}

export const Sidebar: React.FC<SidebarProps> = ({
  viewMode,
  setViewMode,
  logoUrl,
  setLogoUrl,
  logoInputRef,
  alertCounts,
}) => {
  const navItems = [
    { mode: ViewMode.DASHBOARD_DAILY_GAZETA, label: 'Resumo Diário', icon: CalendarRange },
    { mode: ViewMode.RESUMO_FINANCEIRO,      label: 'Resumo Financeiro', icon: PieChart },
    { mode: ViewMode.DASHBOARD_DFC,          label: 'DFC Consolidada', icon: Table2 },
    { mode: ViewMode.DASHBOARD_BASE_DFC,     label: 'DFC', icon: LayoutGrid },
    { mode: ViewMode.DASHBOARD_FC_DIARIO,    label: 'FC Diário Banco', icon: Calculator },
    { mode: ViewMode.DASHBOARD_BY_COMPANY,   label: 'Previsto vs Realizado', icon: Scale },
    { mode: ViewMode.DASHBOARD_PAYABLES,     label: 'Contas a Pagar', icon: ArrowDownCircle,
      iconColor: 'text-rose-400 group-hover:text-rose-300' },
    { mode: ViewMode.DASHBOARD_RECEIVABLES,  label: 'Contas a Receber', icon: ArrowUpCircle,
      iconColor: 'text-emerald-400 group-hover:text-emerald-300' },
  ];

  const analyticsItems = [
    {
      mode: ViewMode.ALERTS_VIEW,
      label: 'Alertas',
      icon: Bell,
      iconColor: (alertCounts?.critical ?? 0) > 0
        ? 'text-rose-400 group-hover:text-rose-300'
        : 'text-slate-400 group-hover:text-slate-200',
      badge: (alertCounts?.critical ?? 0) > 0
        ? { value: alertCounts!.critical, color: 'bg-rose-500' }
        : (alertCounts?.warning ?? 0) > 0
        ? { value: alertCounts!.warning, color: 'bg-amber-500' }
        : undefined,
    },
    { mode: ViewMode.FORECAST_VIEW, label: 'Projeção', icon: TrendingUp },
    { mode: ViewMode.AUDIT_VIEW,    label: 'Auditoria', icon: Activity },
  ];

  const toolItems = [
    { mode: ViewMode.DATA_ENTRY,        label: 'Cadastro e Lançamento', icon: FileSpreadsheet },
    { mode: ViewMode.APRESENTACAO_EXEC, label: 'Demonstrativo\nExecutivo', icon: Projector },
  ];

  const renderButton = (item: {
    mode: ViewMode;
    label: string;
    icon: React.ElementType;
    iconColor?: string;
    badge?: { value: number; color: string };
  }) => {
    const isActive = viewMode === item.mode;
    const iconClass = item.iconColor ?? (isActive ? 'text-indigo-300' : 'text-slate-400 group-hover:text-slate-200');

    return (
      <button
        key={item.mode}
        onClick={() => setViewMode(item.mode)}
        className={`group w-full flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 relative overflow-hidden ${
          isActive
            ? 'bg-slate-800/60 text-slate-100 font-semibold shadow-sm'
            : 'text-slate-400 font-medium hover:bg-slate-800/40 hover:text-slate-200'
        }`}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-indigo-400/80 rounded-r-full" />
        )}
        <item.icon size={18} className={`shrink-0 transition-colors ${iconClass}`} />
        <span className="text-[14px] tracking-wide text-left flex-1 leading-snug whitespace-pre-line">
          {item.label}
        </span>
        {item.badge && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white ${item.badge.color}`}>
            {item.badge.value}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside className="w-64 bg-slate-950 text-slate-100 flex flex-col fixed inset-y-0 z-20 border-r border-slate-800/60 shadow-2xl">
      {/* Logo */}
      <div className="p-8 flex flex-col items-center gap-4 border-b border-slate-800/60 bg-slate-900/40">
        <div
          className="bg-white p-2 rounded-xl cursor-pointer hover:scale-105 transition-transform shadow-sm"
          onClick={() => logoInputRef.current?.click()}
        >
          <img src={logoUrl} alt="Logo" className="max-h-12 object-contain" />
          <input
            type="file"
            ref={logoInputRef}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const r = new FileReader();
                r.onload = () => setLogoUrl(r.result as string);
                r.readAsDataURL(f);
              }
            }}
          />
        </div>
        <div className="text-center">
          <span className="text-lg font-black tracking-tight text-slate-200">DFC GESTÃO</span>
          <span className="block text-xs font-medium tracking-widest text-slate-400 mt-0.5">REDE GAZETA</span>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
        {/* Dashboards */}
        {navItems.map(renderButton)}

        {/* Análise & Inteligência */}
        <div className="pt-5 pb-1">
          <h3 className="px-4 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
            Análise & Inteligência
          </h3>
        </div>
        {analyticsItems.map(renderButton)}

        {/* Ferramentas */}
        <div className="pt-5 pb-1">
          <h3 className="px-4 text-[10px] font-semibold text-slate-600 uppercase tracking-widest">
            Ferramentas
          </h3>
        </div>
        {toolItems.map(renderButton)}

      </nav>
    </aside>
  );
};
