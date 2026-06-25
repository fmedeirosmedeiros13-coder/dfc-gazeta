import React from 'react';
import { Wallet, TrendingUp, TrendingDown, Briefcase } from 'lucide-react';
import { FinancialSummary } from '../types';

interface FinancialSummaryHeaderProps {
  summary: FinancialSummary;
}

export const FinancialSummaryHeader: React.FC<FinancialSummaryHeaderProps> = ({ summary }) => {
  const formatFullCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <div className="grid grid-cols-4 gap-6">
      {/* Card Saldo Líquido */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 flex justify-between items-center relative overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${summary.balance >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`}></div>
        <div>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1.5">Saldo Líquido</p>
          <h3 className={`text-3xl font-semibold tracking-tight ${summary.balance >= 0 ? 'text-slate-800' : 'text-slate-800'}`}>
            {formatFullCurrency(summary.balance)}
          </h3>
        </div>
        <div className={`p-3.5 rounded-xl ${summary.balance >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
          <Wallet className="w-6 h-6" />
        </div>
      </div>

      {/* Card Entradas */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 flex justify-between items-center relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500"></div>
        <div>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1.5">Entradas</p>
          <h3 className="text-3xl font-semibold tracking-tight text-slate-800">{formatFullCurrency(summary.totalInflow)}</h3>
        </div>
        <div className="p-3.5 bg-emerald-50 rounded-xl">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
        </div>
      </div>

      {/* Card Saídas */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 flex justify-between items-center relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500"></div>
        <div>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1.5">Saídas</p>
          <h3 className="text-3xl font-semibold tracking-tight text-slate-800">{formatFullCurrency(summary.totalOutflow)}</h3>
        </div>
        <div className="p-3.5 bg-rose-50 rounded-xl">
          <TrendingDown className="w-6 h-6 text-rose-600" />
        </div>
      </div>

      {/* Card Aplicações */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 flex justify-between items-center relative overflow-hidden">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>
        <div>
          <p className="text-slate-500 text-xs font-semibold uppercase tracking-widest mb-1.5">Aplicações</p>
          <h3 className="text-3xl font-semibold tracking-tight text-slate-800">{formatFullCurrency(summary.totalInvested)}</h3>
        </div>
        <div className="p-3.5 bg-blue-50 rounded-xl">
          <Briefcase className="w-6 h-6 text-blue-600" />
        </div>
      </div>
    </div>
  );
};