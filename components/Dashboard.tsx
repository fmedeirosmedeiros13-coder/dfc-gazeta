import React, { useRef, useState, useMemo } from 'react';
import { Transaction, TransactionType, FinancialSummary, AIAnalysisResult, DashboardViewType, ManualValues } from '../types';
import { parseDate, BANKS_MAPPING, formatCurrency, formatCompact, formatDFCCell, calcInitialBalance, calcResgAplicTotal, getStartDate } from '../utils/finance';
import { FLOW_DEPARA, FLOW_DEPARA_AMBIGUOUS } from '../utils/flowDePara';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, PieChart, Pie, LabelList, AreaChart, Area, LineChart, Line } from 'recharts';
import { TrendingUp, TrendingDown, Wallet, AlertCircle, RefreshCw, Briefcase, ChevronRight, ArrowUpCircle, BrainCircuit, ShieldCheck, Lightbulb, Table2, Scale, Upload, Trash2, AlertTriangle, CheckCircle2, FileX, Tag, ArrowLeft, Layers, CalendarRange, DollarSign, Calendar, ArrowDownRight, ArrowUpRight, Printer, Calculator, Target, LayoutGrid, ListFilter, Landmark } from 'lucide-react';
import { FluxoCaixaDiario }      from './FluxoCaixaDiario';
import { ContasPagar }           from './ContasPagar';
import { VisaoEstrategicaRealizado } from './VisaoEstrategicaRealizado';
import { FinanceLayout }         from './FinanceLayout';
import { ReconciliationView }    from './ReconciliationView';
import { AlertsPanel }           from './AlertsPanel';
import { DrillDownChart }        from './DrillDownChart';
import { AuditLogView }          from './AuditLogView';
import { exportDFCPdf, buildDFCRows } from '../services/dfcPdfService';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// --- Sub-components Definitions ---

const KPICard: React.FC<{ title: string; value: number; isTotal?: boolean; color?: string; customBg?: string; customText?: string }> = ({ title, value, isTotal, color, customBg, customText }) => {
  const bgColor = customBg || 'bg-slate-900/40 border-slate-800/60';
  const textColor = customText || (isTotal ? 'text-slate-100' : (color || 'text-slate-100'));
  
  return (
    <div className={`p-6 rounded-xl border flex flex-col items-center justify-center gap-2 ${bgColor}`}>
      <p className={`text-xs font-medium uppercase tracking-wider text-center ${customText ? 'opacity-80' : 'text-slate-400'}`}>{title}</p>
      <h4 className={`text-2xl font-semibold truncate text-center ${textColor}`}>
        R$ {value.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })}
      </h4>
    </div>
  );
};

const ListItem: React.FC<{ label: string; value: number; max: number; compact?: boolean; barColor?: string }> = ({ label, value, max, compact, barColor }) => {
    const width = max > 0 ? (value / max) * 100 : 0;
    const bg = barColor || 'bg-slate-800/60';

    return (
        <div className={`relative bg-slate-900/40 border border-slate-800/60 rounded px-3 overflow-hidden flex items-center ${compact ? 'py-1.5' : 'py-2.5'} mb-1`}>
             <div className={`absolute top-0 left-0 bottom-0 ${bg} z-0 transition-all duration-500`} style={{ width: `${width}%`, opacity: 0.8 }} />
             <div className="relative z-10 flex justify-between items-center w-full gap-2">
                 <span className={`font-medium text-slate-300 truncate flex-1 ${compact ? 'text-[11px]' : 'text-xs'}`} title={label}>
                     {label}
                 </span>
                 <span className={`font-semibold text-slate-200 ${compact ? 'text-[11px]' : 'text-xs'}`}>
                     {value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                 </span>
             </div>
        </div>
    )
}

// --- End Sub-components ---

interface DashboardProps {
  transactions: Transaction[];
  realizedTransactions?: Transaction[];
  summary: FinancialSummary;
  aiAnalysis: AIAnalysisResult | null;
  onGenerateAI: () => void;
  isGeneratingAI: boolean;
  viewType: DashboardViewType;
  dfcManualValues?: ManualValues;
  onManualValueChange?: (key: string, value: number) => void;
  onImportRealized?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearRealized?: () => void;
  isSlide?: boolean;
  /** Alertas ativos — para a view ALERTS (Fase 5). */
  alerts?: import('../engines/alerts').Alert[];
  /** Snapshots históricos — para a view FORECAST (Fase 5). */
  snapshots?: import('../hooks/useSnapshots').DFCSnapshot[];
  /** Snapshots do Previsto por período — para o seletor de período no Previsto vs Realizado. */
  previstoSnapshots?: import('../hooks/usePrevistoSnapshots').PrevistoSnapshot[];
}

// Internal Interface for Reconciliation Groups
interface MatchGroup {
    prev: Transaction[];
    real: Transaction[];
    diff: number;
    type: '1:1' | 'N:M' | 'GLOBAL' | 'EXATO';
}

// Alias para manter compatibilidade com o resto do arquivo sem renomear cada uso
const parseDateGlobal = parseDate;
const BANKS_MAPPING_GLOBAL = BANKS_MAPPING;

// Mapa N3 (5 dígitos) → descrição, montado do De-Para. Usado para rotular as
// subcategorias N3 no detalhe da Base DFC.
const N3_DESC: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  Object.values(FLOW_DEPARA).forEach(f => { if (f.n3 && !m[f.n3]) m[f.n3] = f.desc; });
  Object.values(FLOW_DEPARA_AMBIGUOUS).forEach(arr => arr.forEach(f => { if (f.n3 && !m[f.n3]) m[f.n3] = f.desc; }));
  return m;
})();

export const Dashboard: React.FC<DashboardProps> = ({ transactions, realizedTransactions = [], summary, aiAnalysis, onGenerateAI, isGeneratingAI, viewType, dfcManualValues, onManualValueChange, onImportRealized, onClearRealized, isSlide = false, alerts = [], snapshots = [], previstoSnapshots = [] }) => {
  
  const [activeConciliationTab, setActiveConciliationTab] = useState<'DEFAULT' | 'MATCHED' | 'PENDING' | 'UNEXPECTED' | 'STRATEGIC'>('DEFAULT');
  const fileRef = useRef<HTMLInputElement>(null);

  // Quais grupos N2 estão abertos mostrando o detalhe N3 (na Base DFC).
  const [expandedN2, setExpandedN2] = useState<Set<string>>(new Set());
  const toggleN2 = (rowKey: string) => setExpandedN2(prev => {
    const next = new Set(prev);
    next.has(rowKey) ? next.delete(rowKey) : next.add(rowKey);
    return next;
  });

  // formatCurrency, formatCompact e formatDFCCell importados de utils/finance.ts
  const formatFullCurrency = formatCurrency; // alias — idênticos em uso



  // Helper function to calculate Initial Balance based on FC_DIARIO inputs
  // Delegam para utils/finance.ts — sem lógica duplicada aqui
  const getSimulationInitialBalance = (compId: string): number => {
    const startDate = getStartDate(transactions);
    if (!startDate) return 0;
    return calcInitialBalance(compId, startDate, dfcManualValues ?? {});
  };

  const getSimulationResgAplicTotal = (compId: string): number => {
    return calcResgAplicTotal(compId, dfcManualValues ?? {});
  };

  // --- VIEW: CONTAS A RECEBER (RECEIVABLES) ---
  if (viewType === DashboardViewType.RECEIVABLES) {
      const allReceivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
      
      const totalInflow = allReceivables.reduce((acc, t) => acc + (Number(t.value) || 0), 0);
      
      // Aggregate allReceivables by customer for lists
      const customerData: Record<string, { id: string, name: string, value: number }> = {};
      allReceivables.forEach(t => {
          const key = t.customerCode || t.customer || t.description || 'Desconhecido';
          const name = t.customer || t.description || 'Desconhecido';
          if (!customerData[key]) {
              customerData[key] = { id: key, name, value: 0 };
          }
          customerData[key].value += (Number(t.value) || 0);
      });
      const aggregatedReceivables = Object.values(customerData);

      // Helper function to filter by portfolio codes OR fallback terms
      const filterByGovType = (codes: string[], terms: string[]) => {
          const filtered = allReceivables.filter(t => {
              const portfolio = (t.portfolio || '').toUpperCase();
              // Priority 1: Check specific codes in portfolio (GFE, GES, GMU)
              const hasCode = codes.some(c => portfolio.includes(c));
              if (hasCode) return true;

              // Priority 2: Fallback to text terms if no code found
              const text = (t.customer || '' + t.description || '' + t.category || '').toUpperCase();
              return terms.some(term => text.includes(term));
          });
          
          const govData: Record<string, { id: string, name: string, value: number }> = {};
          filtered.forEach(t => {
              const key = t.customerCode || t.customer || t.description || 'Desconhecido';
              const name = t.customer || t.description || 'Desconhecido';
              if (!govData[key]) {
                  govData[key] = { id: key, name, value: 0 };
              }
              govData[key].value += (Number(t.value) || 0);
          });
          
          return Object.values(govData).sort((a,b) => b.value - a.value);
      };

      // Government Lists (Mapped to GFE, GES, GMU)
      const listGovFed = filterByGovType(['GFE'], ['FEDERAL', 'UNIAO', 'MINISTERIO']);
      const listGovEst = filterByGovType(['GES'], ['ESTADO', 'ESTADUAL', 'GOVERNO DO', 'SECOM']);
      const listGovMun = filterByGovType(['GMU'], ['PREFEITURA', 'MUNICIPAL', 'MUNICIPIO']);
      
      // Sums (Full value of all matching items)
      const valGovFed = listGovFed.reduce((acc, t) => acc + (Number(t.value) || 0), 0);
      const valGovEst = listGovEst.reduce((acc, t) => acc + (Number(t.value) || 0), 0);
      const valGovMun = listGovMun.reduce((acc, t) => acc + (Number(t.value) || 0), 0);
      
      // General Government Sum
      const valGov = valGovFed + valGovEst + valGovMun; 
      
      // Other Categories
      // Helper to check if transaction is Assinatura
      // Critérios: espécie 'ASS', fluxo nível 2 = '107' (Assinaturas), ou flowTypeCode iniciando com '107'
      const isAssinatura = (t: Transaction) => {
          const species = (t.species || '').toUpperCase().trim();
          const flowN2 = (t.flowTypeLevel2 || '').trim();
          const flowCode = (t.flowTypeCode || '').trim();
          return species === 'ASS' || flowN2 === '107' || flowCode.startsWith('107');
      };

      const valAssinatura = allReceivables.filter(isAssinatura).reduce((acc, t) => acc + (Number(t.value) || 0), 0);
      
      // Particular is Total - Gov - Assinatura
      // Using Set to exclude IDs already counted in Gov to avoid double counting if overlaps exist
      const idsGov = new Set([...listGovFed, ...listGovEst, ...listGovMun].map(t => t.id));
      const valParticular = allReceivables
          .filter(t => {
              const key = t.customerCode || t.customer || t.description || 'Desconhecido';
              return !idsGov.has(key) && !isAssinatura(t);
          })
          .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

      // Top 10 for KPI
      const top10List = [...aggregatedReceivables].sort((a,b) => b.value - a.value).slice(0, 10);
      const valTop10 = top10List.reduce((acc, t) => acc + (Number(t.value) || 0), 0);

      // DISPLAY LISTS - STRICT LIMITS
      // 1. High/Low Value Lists: Fixed at max 10 items
      const highValue = aggregatedReceivables.filter(t => (Number(t.value) || 0) > 35000).sort((a,b) => b.value - a.value);
      const lowValue = aggregatedReceivables.filter(t => (Number(t.value) || 0) <= 35000).sort((a,b) => b.value - a.value);

      // 2. Gov Lists for Display: Fixed at max 15 items
      const displayGovFed = listGovFed.slice(0, 15);
      const displayGovEst = listGovEst.slice(0, 15);
      const displayGovMun = listGovMun.slice(0, 15);

      // Company Chart
      const COMPANIES_MAP: Record<string, string> = {
          '1': 'S.A. A GAZETA', '2': 'TV GAZETA', '3': 'TV CACHOEIRO', '4': 'TV NORTE',
          '5': 'RD MIX', '6': 'FM 102', '14': 'VÍDEO', '17': 'DIFUSORA',
          '18': 'CIDADÃ', '22': 'FM LINHARES', '23': 'RD N. GERAÇÃO'
      };
      const companyData: Record<string, number> = {};
      allReceivables.forEach(t => {
          const k = t.companyCode || 'N/D';
          companyData[k] = (companyData[k] || 0) + (Number(t.value) || 0);
      });
      const barChartData = Object.entries(companyData).map(([code, value]) => ({ name: COMPANIES_MAP[code] || (code !== 'N/D' ? `Empresa ${code}` : code), value })).sort((a,b) => b.value - a.value);

      // Daily Data
      const dailyData: Record<string, number> = {};
      allReceivables.forEach(t => dailyData[t.date] = (dailyData[t.date] || 0) + (Number(t.value) || 0));
      const vlDiaList = Object.entries(dailyData).map(([date, value]) => ({ date, value })).sort((a,b) => b.value - a.value);

      return (
        <div className={`flex flex-col ${isSlide ? 'gap-3 pb-0 h-full' : 'gap-6 pb-10'} animate-fadeIn`}>
             {!isSlide && (
             <div className="flex justify-between items-center">
                 <div className="bg-[#0e7490] text-white text-sm font-bold py-2 px-6 rounded-lg w-fit shadow-md uppercase tracking-wider">
                     RECEBIMENTOS
                 </div>
             </div>
             )}

             {/* KPI Row - Custom Blue Style matching screenshot */}
             <div className="grid grid-cols-5 gap-3 shrink-0">
                 {[
                     { label: 'TOP 10', val: valTop10 },
                     { label: 'PARTICULAR', val: valParticular },
                     { label: 'ASSINATURA', val: valAssinatura },
                     { label: 'GOVERNO', val: valGov },
                     { label: 'TOTAL PREVISTO', val: totalInflow }
                 ].map((kpi, idx) => (
                     <div key={idx} className={`bg-[#0f4c75] rounded-lg ${isSlide ? 'p-2' : 'p-4'} text-center shadow-md border-b-4 border-[#3282b8]`}>
                         <p className={`${isSlide ? 'text-[8px]' : 'text-[10px]'} font-bold text-slate-300 uppercase tracking-widest mb-1`}>{kpi.label}</p>
                         <h3 className={`${isSlide ? 'text-sm' : 'text-lg'} font-bold text-white`}>R$ {Math.round(kpi.val).toLocaleString('pt-BR')}</h3>
                     </div>
                 ))}
             </div>

         <FinanceLayout
             isSlide={isSlide}
             className=""
             col1={
                 (() => {
                     const items = highValue.slice(0, 15);
                     const maxVal = items.length > 0 ? Math.max(...items.map(t => t.value)) : 1;
                     return (
                     <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-full min-h-0 p-3 shadow-md">
                         <div className="text-center border-b border-slate-700 pb-2 mb-2 shrink-0">
                             <p className={`${isSlide ? 'text-[10px]' : 'text-xs'} font-bold text-slate-300 uppercase tracking-wide`}>Acima de R$ 35 mil</p>
                         </div>
                         <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                             {items.length > 0 ? items.map(t => (
                                 <div key={t.id} className="flex items-center gap-1.5 min-h-[22px]">
                                     <span className={`${isSlide ? 'text-[9px] w-[48%]' : 'text-[11px] w-[42%]'} text-slate-300 font-semibold truncate shrink-0`} title={t.name}>{t.name}</span>
                                     <div className="flex-1 h-[16px] bg-slate-900/60 rounded-sm overflow-hidden">
                                         <div className="h-full bg-gradient-to-r from-teal-600 to-teal-400 rounded-sm transition-all" style={{ width: `${Math.max((t.value / maxVal) * 100, 3)}%` }} />
                                     </div>
                                     <span className={`${isSlide ? 'text-[9px] w-[52px]' : 'text-[11px] w-[62px]'} text-right font-bold text-teal-300 shrink-0`}>{Math.round(t.value).toLocaleString('pt-BR')}</span>
                                 </div>
                             )) : <p className="text-[10px] text-slate-500 text-center mt-4">Nenhum registro.</p>}
                         </div>
                     </div>
                     );
                 })()
             }
             col2={
                 (() => {
                     const items = lowValue.slice(0, 15);
                     const maxVal = items.length > 0 ? Math.max(...items.map(t => t.value)) : 1;
                     return (
                     <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-full min-h-0 p-3 shadow-md">
                         <div className="text-center border-b border-slate-700 pb-2 mb-2 shrink-0">
                             <p className={`${isSlide ? 'text-[10px]' : 'text-xs'} font-bold text-slate-300 uppercase tracking-wide`}>Abaixo de R$ 35 mil</p>
                         </div>
                         <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                             {items.length > 0 ? items.map(t => (
                                 <div key={t.id} className="flex items-center gap-1.5 min-h-[22px]">
                                     <span className={`${isSlide ? 'text-[9px] w-[48%]' : 'text-[11px] w-[42%]'} text-slate-300 font-semibold truncate shrink-0`} title={t.name}>{t.name}</span>
                                     <div className="flex-1 h-[16px] bg-slate-900/60 rounded-sm overflow-hidden">
                                         <div className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-sm transition-all" style={{ width: `${Math.max((t.value / maxVal) * 100, 3)}%` }} />
                                     </div>
                                     <span className={`${isSlide ? 'text-[9px] w-[52px]' : 'text-[11px] w-[62px]'} text-right font-bold text-cyan-300 shrink-0`}>{Math.round(t.value).toLocaleString('pt-BR')}</span>
                                 </div>
                             )) : <p className="text-[10px] text-slate-500 text-center mt-4">Nenhum registro.</p>}
                         </div>
                     </div>
                     );
                 })()
             }
                 col3={
                     /* Col 3: Gov Cards with Detailed Lists (Max 15 items per list) */
                     <div className="flex flex-col gap-4 h-full overflow-hidden">
                         {[
                             { title: 'Governo Federal', val: valGovFed, list: displayGovFed, color: 'text-blue-400', borderColor: 'border-blue-500' },
                             { title: 'Governo Estadual', val: valGovEst, list: displayGovEst, color: 'text-emerald-400', borderColor: 'border-emerald-500' },
                             { title: 'Governo Municipal', val: valGovMun, list: displayGovMun, color: 'text-indigo-400', borderColor: 'border-indigo-500' }
                         ].map((card, i) => (
                             <div key={i} className={`bg-slate-800 rounded-xl ${isSlide ? 'p-1.5' : 'p-2'} flex-1 flex flex-col border border-slate-700 shadow-md min-h-0`}>
                                 <div className="text-center border-b border-slate-700 pb-1 mb-2 flex-shrink-0">
                                     <p className={`${isSlide ? 'text-[8px]' : 'text-[10px]'} font-bold text-slate-300 uppercase tracking-wider`}>{card.title}</p>
                                     <p className={`${isSlide ? 'text-xs' : 'text-sm'} font-black ${card.color} tracking-tight`}>R$ {Math.round(card.val).toLocaleString('pt-BR')}</p>
                                 </div>
                                 <div className="flex-1 overflow-auto custom-scrollbar space-y-1.5 min-h-0">
                                     {card.list.length > 0 ? card.list.map(t => (
                                         <div key={t.id} className={`flex justify-between items-center bg-slate-700/50 px-2 py-1.5 rounded-md shadow-sm text-[9px] border-l-2 ${card.borderColor} hover:bg-slate-700 transition-colors`}>
                                             <span className={`truncate max-w-[75%] text-slate-300 font-semibold ${isSlide ? 'text-[8px]' : ''}`}>{t.name}</span>
                                             <span className={`font-bold text-slate-200 ${isSlide ? 'text-[8px]' : ''}`}>{Math.round(t.value).toLocaleString('pt-BR')}</span>
                                         </div>
                                     )) : <p className="text-[9px] text-slate-500 text-center mt-2">Sem registros.</p>}
                                 </div>
                             </div>
                         ))}
                     </div>
                 }
                 col4={
                     /* Col 4: Total Empresa Chart */
                     <div className="bg-slate-800 rounded-xl p-4 flex flex-col border border-slate-700 shadow-md h-full min-h-0">
                         <p className="text-center text-slate-300 text-sm font-bold mb-4 uppercase tracking-wide">Total Empresa</p>
                         <div className="flex-1 min-h-0">
                             <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={barChartData.slice(0, 10)} layout="vertical" margin={{top:5, right:50, left:10, bottom:5}}>
                                     <XAxis type="number" hide />
                                     <YAxis dataKey="name" type="category" width={65} tick={{fontSize: barChartData.length > 8 ? 8 : 10, fill: '#94a3b8', fontWeight: 'bold'}} interval={0} />
                                     <Tooltip cursor={{fill: 'transparent'}} contentStyle={{backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', borderRadius: '8px'}} itemStyle={{color: '#38bdf8'}} formatter={(v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} />
                                     <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={30}>
                                         {barChartData.slice(0, 10).map((entry, index) => (
                                             <Cell key={`cell-${index}`} fill="#38bdf8" />
                                         ))}
                                         <LabelList dataKey="value" position="right" style={{ fontSize: '10px', fill: '#e2e8f0', fontWeight: 'bold' }} formatter={(v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} />
                                     </Bar>
                                 </BarChart>
                             </ResponsiveContainer>
                         </div>
                     </div>
                 }
                 col5={
                     /* Col 5: VL Dia */
                     <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden shadow-md h-full">
                         <div className="p-2 bg-slate-900 text-center border-b border-slate-700">
                             <p className={`${isSlide ? 'text-[10px]' : 'text-xs'} font-bold text-slate-300 uppercase tracking-wide`}>VL Dia</p>
                         </div>
                         <div className="flex-1 overflow-auto custom-scrollbar p-2 space-y-2 min-h-0">
                             {vlDiaList.map((d, idx) => {
                                 const valStr = d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                                 const fontSizeClass = valStr.length > 12 ? 'text-[10px]' : valStr.length > 9 ? 'text-xs' : 'text-sm';
                                 return (
                                     <div key={idx} className="bg-slate-700/50 p-2 rounded-lg border border-slate-600/50 hover:bg-slate-700 transition-colors flex flex-col items-end">
                                         <p className="text-[9px] text-slate-400 mb-0.5 font-semibold uppercase tracking-wider">Dia {d.date}</p>
                                         <p className={`${fontSizeClass} font-black text-slate-200 tracking-tight`}>{valStr}</p>
                                     </div>
                                 );
                             })}
                         </div>
                     </div>
                 }
             />

             {aiAnalysis && !isSlide && (
                 <div className="bg-slate-900 p-6 rounded-xl shadow-lg border border-slate-800 animate-fadeIn">
                    <div className="flex items-start gap-4">
                        <div className="mt-1"><Briefcase className="w-5 h-5 text-indigo-400" /></div>
                        <div>
                            <h4 className="font-bold text-slate-200 mb-2">Resumo Executivo</h4>
                            <p className="text-slate-400 text-sm leading-relaxed">{aiAnalysis.summary}</p>
                        </div>
                    </div>
                    
                    {(aiAnalysis.risks.length > 0 || aiAnalysis.opportunities.length > 0) && (
                        <div className="grid grid-cols-2 gap-6 mt-6 pt-6 border-t border-slate-800">
                             <div>
                                 <h5 className="text-xs font-bold text-red-400 uppercase mb-3 flex items-center gap-2">
                                     <AlertTriangle className="w-3 h-3" /> Pontos de Atenção
                                 </h5>
                                 <ul className="space-y-2">
                                     {aiAnalysis.risks.map((r, i) => (
                                         <li key={i} className="text-xs text-slate-400 flex gap-2">
                                             <span className="w-1 h-1 rounded-full bg-red-500 mt-1.5 flex-shrink-0"></span>
                                             {r}
                                         </li>
                                     ))}
                                 </ul>
                             </div>
                             <div>
                                 <h5 className="text-xs font-bold text-emerald-400 uppercase mb-3 flex items-center gap-2">
                                     <CheckCircle2 className="w-3 h-3" /> Oportunidades
                                 </h5>
                                 <ul className="space-y-2">
                                     {aiAnalysis.opportunities.map((o, i) => (
                                         <li key={i} className="text-xs text-slate-400 flex gap-2">
                                             <span className="w-1 h-1 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0"></span>
                                             {o}
                                         </li>
                                     ))}
                                 </ul>
                             </div>
                        </div>
                    )}
                    
                    <div className="mt-4 text-[10px] text-slate-400 text-right">
                        Atualizado em: {aiAnalysis.lastUpdated}
                    </div>
                </div>
            )}
        </div>
      );
  }

  // --- VIEW: CONTAS A PAGAR (PAYABLES) ---
  if (viewType === DashboardViewType.PAYABLES) {
    return (
      <ContasPagar 
        transactions={transactions}
        realizedTransactions={realizedTransactions}
        isSlide={isSlide}
      />
    );
  }
  
  // --- VIEW: PREVISTO VS REALIZADO (REALIZED - ALGORITMO AVANÇADO N:M) ---
  // ── Fase 5: Novas views conectadas aos engines ────────────────────────────

  if ((viewType as string) === 'ALERTS') {
    return (
      <div className="space-y-4">
        <AlertsPanel
          alerts={alerts}
          onViewTransactions={(ids) => console.log('Ver transações:', ids)}
        />
        <DrillDownChart
          transactions={transactions}
          title="Análise por Dimensão"
          showDetailTable
        />
      </div>
    );
  }

  if ((viewType as string) === 'FORECAST') {
    return (
      <div className="space-y-4">
        <DrillDownChart
          transactions={transactions}
          title="Fluxo por Empresa — Clique para detalhar"
          rootGroupBy="company"
          showDetailTable
        />
      </div>
    );
  }

  if ((viewType as string) === 'AUDIT') {
    return <AuditLogView />;
  }

    if (viewType === DashboardViewType.REALIZED) {
    return (
      <ReconciliationView
        transactions={transactions}
        realizedTransactions={realizedTransactions}
        onImportRealized={onImportRealized}
        onClearRealized={onClearRealized}
        previstoSnapshots={previstoSnapshots}
      />
    );
  }

    if (viewType === DashboardViewType.BASE_DFC) {
     const COLS = [
          {id:'1',label:'S/A'},
          {id:'2',label:'TVG'},
          {id:'3',label:'TVC'},
          {id:'4',label:'TVN'},
          {id:'5',label:'MIX'},
          {id:'6',label:'FM102'},
          {id:'14',label:'TNR'}, 
          {id:'17',label:'DIF'},
          {id:'18',label:'CID'},
          {id:'22',label:'FMLIN'},
          {id:'23',label:'NGER'},
      ];

      const INFLOW_ROWS = [
          { code: '100', label: 'Antecipações Entradas', keywords: ['Antecipações', 'Antecipacoes'] },
          { code: '101', label: 'Publicidade JN', keywords: ['JN', 'Jornal Nacional'] },
          { code: '102', label: 'Publicidade Digital', keywords: ['Digital', 'Web', 'Site'] },
          { code: '103', label: 'Ative', keywords: ['Ative'] },
          { code: '104', label: 'Publicidade Local TV', keywords: ['Local TV'] },
          { code: '105', label: 'Publicidade Local RD', keywords: ['Local RD'] },
          { code: '106', label: 'Publicidade Rede RD', keywords: ['Rede RD'] },
          { code: '107', label: 'Assinaturas', keywords: ['Assinatura'] },
          { code: '108', label: 'Projetos', keywords: ['Projeto'] },
          { code: '109', label: 'Publicidade Web', keywords: ['Web'] },
          { code: '110', label: 'Serviços', keywords: ['Serviço', 'Servico'] },
          { code: '111', label: 'Produção', keywords: ['Produção', 'Producao'] },
          { code: '112', label: 'Publicidade Globo', keywords: ['Globo'] },
          { code: '113', label: 'Financeiras', keywords: ['Financeira'] },
          { code: '114', label: 'Outras', keywords: ['Outra', 'Recebimento', 'Venda', 'Fatura', 'Nota Fiscal', 'NF', 'Cliente'] },
      ];

      const OUTFLOW_ROWS = [
          { code: '200', label: 'Antecipações Saídas', keywords: ['Antecipações Saída'] },
          { code: '201', label: 'Despesas com Pessoal', keywords: ['Pessoal', 'Folha', 'Salário', '201'] },
          { code: '202', label: 'Despesas Comerciais', keywords: ['Comercial'] },
          { code: '203', label: 'Despesas Promocionais', keywords: ['Promocional', 'Marketing'] },
          { code: '204', label: 'Despesas com Produção/Programa', keywords: ['Produção', 'Programa'] },
          { code: '205', label: 'Despesas Operativas', keywords: ['Operativa'] },
          { code: '206', label: 'Despesas Administrativas', keywords: ['Administrativa', 'Aluguel', 'Condomínio', 'Energia'] },
          { code: '207', label: 'Consumo de Materiais', keywords: ['Material'] },
          { code: '208', label: 'Despesas Financeiras', keywords: ['Financeira', 'Juros', 'Tarifa'] },
          { code: '209', label: 'Despesas Tributárias', keywords: ['Tributária', 'Imposto'] },
          { code: '210', label: 'Apuração de Custos', keywords: ['Custo'] },
          { code: '211', label: 'Despesas com Projetos', keywords: ['Projeto Despesa'] },
          { code: '212', label: 'Insumos/Materiais', keywords: ['Insumo'] },
          { code: '214', label: 'Causas Judiciais', keywords: ['Judicial'] },
          { code: '215', label: 'Impostos/Contribuições', keywords: ['Contribuição'] },
          { code: '216', label: 'Outros Desembolsos', keywords: ['Outros'] },
          { code: '217', label: 'Distribuição de Lucros', keywords: ['Lucro', 'Dividendo'] },
          { code: '218', label: 'Comissões', keywords: ['Comissão', 'Comissao'] },
      ];

      const INVEST_ROWS = [
          { code: 'INV_TOTAL', label: 'Investimentos (Capex)', keywords: [] },
      ];

      const FINANC_ROWS = [
          { code: '8', label: 'Recebimento de empréstimos', keywords: ['Empréstimo Rec'] },
          { code: '8', label: 'Pagamentos de Empréstimos', keywords: ['Empréstimo Pag'] },
      ];
      
      const INFLOW_ROWS_EXT = [
          ...INFLOW_ROWS,
          { code: '999', label: 'Outros Recebimentos', keywords: [] }
      ];

      const OUTFLOW_ROWS_EXT = [
          ...OUTFLOW_ROWS,
          { code: '299', label: 'Outros Pagamentos', keywords: [] }
      ];
      
      const matrix: Record<string, number> = {};
      const totals: Record<string, number> = {}; 

      // Detalhe N3 dentro de cada grupo N2.
      const n3Matrix: Record<string, number> = {};       // `${prefix}_${codN2}_N3_${n3}_${colId}`
      const n3Totals: Record<string, number> = {};       // `${prefix}_${codN2}_N3_${n3}`
      const n3ByGroup: Record<string, Set<string>> = {};  // `${prefix}_${codN2}` -> conjunto de N3

      // --- INTEGRATION: USE CALCULATED INITIAL BALANCE ---
      COLS.forEach(col => {
          matrix[`0_${col.id}`] = getSimulationInitialBalance(col.id);
      });

      // --- NOVA LÓGICA DE CLASSIFICAÇÃO ÚNICA (SEM DUPLICAÇÃO) ---
      (transactions || []).forEach(t => {
          if (!t) return;
          // 1. Identificar Coluna (Empresa)
          // Normalização simples para garantir match (remove zeros à esquerda)
          const col = COLS.find(c => String(Number(t.companyCode || 0)).trim() === String(c.id).trim());
          if (!col) return; // Ignora empresas fora do escopo desta visão

          const text = (String(t.category || '') + ' ' + String(t.description || '') + ' ' + String(t.flowTypeCode || '') + ' ' + String(t.flowTypeLevel2 || '')).toUpperCase();
          let prefix = '';
          let categoryCode = '';

          // 2. Verificar Financiamento (Prioridade sobre Operacional)
          // Verifica se encaixa em Empréstimos (Recebimento ou Pagamento)
          const financMatch = FINANC_ROWS.find(r => r.keywords.some(k => text.includes(k.toUpperCase())));
          if (financMatch) {
              prefix = 'FIN';
              categoryCode = financMatch.code;
          } 
          // 3. Verificar Investimentos (Capex)
          else if (t.type === TransactionType.PAYABLE && (
              (t.investmentDescription && t.investmentDescription.trim() !== '') ||
              t.category === 'Investimento' ||
              t.flowTypeCode === '401'
          )) {
              prefix = 'INV';
              categoryCode = 'INV_TOTAL';
          }
          // 4. Classificação Operacional (Inflow/Outflow)
          else if (t.type === TransactionType.RECEIVABLE) {
              prefix = 'IN';
              const match = INFLOW_ROWS.find(r => {
                  if (t.flowTypeCode === r.code) return true;
                  return r.keywords.some(k => text.includes(k.toUpperCase()));
              });
              categoryCode = match ? match.code : '999'; // Fallback para Outros
          } 
          else if (t.type === TransactionType.PAYABLE) {
              prefix = 'OUT';
              const match = OUTFLOW_ROWS.find(r => {
                  if (t.flowTypeCode === r.code) return true;
                  return r.keywords.some(k => text.includes(k.toUpperCase()));
              });
              categoryCode = match ? match.code : '299'; // Fallback para Outros
          }

          // 5. Acumular Valores
          if (prefix && categoryCode) {
              const key = `${prefix}_${categoryCode}_${col.id}`;
              const totalKey = `${prefix}_${categoryCode}`;
              
              matrix[key] = (matrix[key] || 0) + (Number(t.value) || 0);
              totals[totalKey] = (totals[totalKey] || 0) + (Number(t.value) || 0);

              // Detalhe N3: usa o código de fluxo de 5 dígitos; sem ele, agrupa em "—".
              const n3 = String(t.flowTypeCode || '').trim() || '—';
              const gkey = `${prefix}_${categoryCode}`;
              n3Matrix[`${gkey}_N3_${n3}_${col.id}`] = (n3Matrix[`${gkey}_N3_${n3}_${col.id}`] || 0) + (Number(t.value) || 0);
              n3Totals[`${gkey}_N3_${n3}`] = (n3Totals[`${gkey}_N3_${n3}`] || 0) + (Number(t.value) || 0);
              (n3ByGroup[gkey] = n3ByGroup[gkey] || new Set<string>()).add(n3);
          }
      });

      const renderDataRow = (rowDef: {code: string, label: string}, prefix: string) => {
          const rowKey = `${prefix}_${rowDef.code}`;
          const rowTotal = totals[rowKey] || 0;
          const showCode = rowDef.code !== 'INV_TOTAL';

          // N3 do grupo, ordenados por valor (maior primeiro).
          const n3List = Array.from(n3ByGroup[rowKey] || [])
              .map(n3 => ({ n3, total: n3Totals[`${rowKey}_N3_${n3}`] || 0 }))
              .filter(x => x.total !== 0)
              .sort((a, b) => b.total - a.total);
          const canExpand = n3List.length > 0;
          const isOpen = expandedN2.has(rowKey);

          return (
              <React.Fragment key={rowKey}>
              <tr
                  className={`bg-slate-800 border-b border-slate-700 ${isSlide ? 'text-[7px]' : 'text-[10px]'} hover:bg-slate-700/50 ${canExpand ? 'cursor-pointer' : ''}`}
                  onClick={canExpand ? () => toggleN2(rowKey) : undefined}
              >
                  <td className={`${isSlide ? 'p-0.5 pl-1' : 'p-1 pl-4'} border-r border-slate-700 font-medium text-slate-300 flex gap-2 items-start whitespace-normal min-w-[250px]`}>
                      {canExpand && <ChevronRight className={`w-3 h-3 shrink-0 mt-0.5 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />}
                      {showCode && <span className="w-6 text-right text-slate-500 shrink-0">{rowDef.code}</span>}
                      <span className="break-words leading-tight">{rowDef.label}</span>
                  </td>
                  {COLS.map(c => {
                      const val = matrix[`${rowKey}_${c.id}`];
                      return (
                          <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 text-right text-slate-400`}>
                              {val ? val.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                          </td>
                      );
                  })}
                  <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right font-bold text-slate-200 bg-slate-900/50`}>
                      {rowTotal ? rowTotal.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                  </td>
              </tr>
              {isOpen && n3List.map(({ n3 }) => (
                  <tr key={`${rowKey}_${n3}`} className={`bg-slate-900/60 border-b border-slate-800 ${isSlide ? 'text-[7px]' : 'text-[10px]'} text-slate-400`}>
                      <td className={`${isSlide ? 'p-0.5 pl-6' : 'p-1 pl-12'} border-r border-slate-800 whitespace-normal min-w-[250px]`}>
                          <span className="w-10 inline-block text-right text-slate-600 mr-2">{n3 === '—' ? '' : n3}</span>
                          <span className="break-words leading-tight italic">{n3 === '—' ? 'Sem N3 informado' : (N3_DESC[n3] || 'N3 fora do De-Para')}</span>
                      </td>
                      {COLS.map(c => {
                          const val = n3Matrix[`${rowKey}_N3_${n3}_${c.id}`];
                          return (
                              <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-800 text-right`}>
                                  {val ? val.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                              </td>
                          );
                      })}
                      <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right text-slate-300 bg-slate-900/70`}>
                          {(n3Totals[`${rowKey}_N3_${n3}`] || 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                      </td>
                  </tr>
              ))}
              </React.Fragment>
          );
      };

      const renderTotalRow = (label: string, valueFn: (cId: string) => number, bgColor: string, textColor: string) => {
          const colValues = COLS.map(c => valueFn(c.id));
          const total = colValues.reduce((a,b) => a+b, 0);

          return (
              <tr className={`${bgColor} border-y border-slate-600 ${isSlide ? 'text-[8px]' : 'text-[11px]'} font-bold ${textColor}`}>
                  <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-600 uppercase`}>{label}</td>
                  {colValues.map((v, i) => (
                      <td key={i} className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-600 text-right`}>
                          {v ? v.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                      </td>
                  ))}
                  <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right`}>
                      {total ? total.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                  </td>
              </tr>
          );
      };

      const getInflowTotal = (cId: string) => INFLOW_ROWS_EXT.reduce((acc, r) => acc + (matrix[`IN_${r.code}_${cId}`] || 0), 0);
      const getOutflowTotal = (cId: string) => OUTFLOW_ROWS_EXT.reduce((acc, r) => acc + (matrix[`OUT_${r.code}_${cId}`] || 0), 0);
      const getInvestTotal = (cId: string) => INVEST_ROWS.reduce((acc, r) => acc + (matrix[`INV_${r.code}_${cId}`] || 0), 0);
      const getFinancTotal = (cId: string) => FINANC_ROWS.reduce((acc, r) => acc + (matrix[`FIN_${r.code}_${cId}`] || 0), 0);

      const getOperBalance = (cId: string) => (matrix[`0_${cId}`] || 0) + getInflowTotal(cId) - getOutflowTotal(cId);
      const getAfterInvestBalance = (cId: string) => getOperBalance(cId) - getInvestTotal(cId);
      const getFinalBalance = (cId: string) => getAfterInvestBalance(cId) + getFinancTotal(cId);

      const sortedInflowRows = [...INFLOW_ROWS_EXT]
          .map(r => ({ ...r, total: totals[`IN_${r.code}`] || 0 }))
          .filter(r => r.total !== 0)
          .sort((a, b) => b.total - a.total);

      const sortedOutflowRows = [...OUTFLOW_ROWS_EXT]
          .map(r => ({ ...r, total: totals[`OUT_${r.code}`] || 0 }))
          .filter(r => r.total !== 0)
          .sort((a, b) => b.total - a.total);
      
      const sortedInvestRows = [...INVEST_ROWS]
          .map(r => ({ ...r, total: totals[`INV_${r.code}`] || 0 }))
          .filter(r => r.total !== 0)
          .sort((a, b) => b.total - a.total);

      const sortedFinancRows = [...FINANC_ROWS]
          .map(r => ({ ...r, total: totals[`FIN_${r.code}`] || 0 }))
          .filter(r => r.total !== 0)
          .sort((a, b) => b.total - a.total);

      return (
         <div className="bg-slate-900/40 rounded-xl shadow-sm border border-slate-800/60 overflow-hidden flex flex-col h-full animate-fadeIn">
             <div className="p-4 bg-slate-900/60 border-b border-slate-800/60 flex justify-between items-center">
                 <h2 className="text-sm font-medium uppercase pl-2 text-slate-100 flex items-center gap-2">
                     <LayoutGrid className="w-4 h-4 text-slate-400" />
                     Base DFC - Nível 02
                     <span className="hidden sm:inline text-[10px] normal-case text-slate-500 font-normal ml-1">· clique numa linha para ver o detalhe N3</span>
                 </h2>
                 <div className="flex gap-2">
                     <button className="px-4 py-1.5 bg-slate-800/60 border border-slate-700/60 text-slate-100 rounded-lg text-xs font-medium uppercase hover:bg-slate-700/60 transition-colors">
                         Exportar
                     </button>
                 </div>
             </div>

             <div className="flex-1 overflow-auto custom-scrollbar bg-slate-950 relative">
                 <table className="border-collapse w-full whitespace-nowrap">
                     <thead className="sticky top-0 z-20">
                         <tr className={`bg-[#1e3a8a] ${isSlide ? 'text-[7px]' : 'text-[10px]'} font-bold text-white text-center uppercase border-b border-slate-700`}>
                             <th className={`${isSlide ? 'p-1' : 'p-2'} border-r border-slate-700 text-left min-w-[250px]`}>FLUXO DE CAIXA - NIVEL 02</th>
                             {COLS.map(c => <th key={c.id} className={`${isSlide ? 'p-1' : 'p-2'} border-r border-slate-700 min-w-[70px]`}>{c.label}</th>)}
                             <th className={`${isSlide ? 'p-1' : 'p-2'} min-w-[90px]`}>TOTAL</th>
                         </tr>
                     </thead>
                     <tbody>
                         <tr className={`bg-emerald-900/50 font-bold ${isSlide ? 'text-[8px]' : 'text-[11px]'} border-b border-slate-700 text-emerald-400`}>
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 flex items-center gap-2`}>
                                 <span className="w-6 text-right">0</span>
                                 SALDO INICIAL
                             </td>
                             {COLS.map(c => (
                                 <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} text-right border-r border-slate-700 font-bold text-emerald-300`}>
                                     {/* Display calculated value instead of input */}
                                     {getSimulationInitialBalance(c.id).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                 </td>
                             ))}
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right`}>
                                 {COLS.reduce((acc, c) => acc + getSimulationInitialBalance(c.id), 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                             </td>
                         </tr>
                         <tr className={`bg-amber-900/30 font-bold ${isSlide ? 'text-[8px]' : 'text-[11px]'} border-b border-slate-700 text-amber-400`}>
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700`}>ATIVIDADES OPERACIONAIS</td>
                             {COLS.map(c => {
                                 const val = getInflowTotal(c.id) - getOutflowTotal(c.id);
                                 return <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} text-right border-r border-slate-700`}>{val.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                             })}
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right`}>
                                 {COLS.reduce((acc, c) => acc + (getInflowTotal(c.id) - getOutflowTotal(c.id)), 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                             </td>
                         </tr>
                         {renderTotalRow('1 ENTRADAS', getInflowTotal, 'bg-slate-800', 'text-blue-400')}
                         {sortedInflowRows.map(r => renderDataRow(r, 'IN'))}
                         {renderTotalRow('2 SAÍDAS', getOutflowTotal, 'bg-slate-800', 'text-red-400')}
                         {sortedOutflowRows.map(r => renderDataRow(r, 'OUT'))}
                         {renderTotalRow('3 SALDO DE CAIXA OPERAC', getOperBalance, 'bg-slate-700', 'text-slate-200')}
                         <tr className={`bg-amber-900/30 font-bold ${isSlide ? 'text-[8px]' : 'text-[11px]'} border-y border-slate-700 text-amber-400`}>
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700`}>ATIVIDADES DE INVESTIMENTO</td>
                             {COLS.map(c => {
                                 const val = getInvestTotal(c.id);
                                 return <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} text-right border-r border-slate-700`}>{val.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                             })}
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right`}>
                                 {COLS.reduce((acc, c) => acc + getInvestTotal(c.id), 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                             </td>
                         </tr>
                         {sortedInvestRows.map(r => renderDataRow(r, 'INV'))}
                         {renderTotalRow('5 GERAÇÃO DE CAIXA APÓS', getAfterInvestBalance, 'bg-slate-700', 'text-slate-200')}
                         <tr className={`bg-amber-900/30 font-bold ${isSlide ? 'text-[8px]' : 'text-[11px]'} border-y border-slate-700 text-amber-400`}>
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700`} colSpan={COLS.length + 2}>ATIVIDADES DE FINANCIAMENTO</td>
                         </tr>
                         {sortedFinancRows.map(r => renderDataRow(r, 'FIN'))}
                         {renderTotalRow('99 SALDO FINAL DE CAIXA', getFinalBalance, 'bg-slate-700', 'text-slate-200')}
                     </tbody>
                 </table>
             </div>
         </div>
      );
  }

  // --- LOGICA DAILY (TABELA RESUMO OFICIAL GAZETA) ---
  if (viewType === DashboardViewType.DAILY) {
      const allPayables = transactions.filter(t => t.type === TransactionType.PAYABLE);
      const allReceivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);

      const uniqueDates: string[] = Array.from(new Set<string>([
          ...allPayables.map(t => t.date),
          ...allReceivables.map(t => t.date)
      ])).sort((a: string, b: string) => parseDateGlobal(a) - parseDateGlobal(b));

      // Ordem atualizada conforme imagem de referência
      const COMPANY_ORDER = ['1', '2', '3', '4', '5', '6', '14', '17', '18', '22', '23'];

      const COMPANY_ALIASES: Record<string, string[]> = {
          '1': ['A GAZ', 'A GAZETA', 'S.A. A GAZETA', 'S.A A GAZETA'],
          '2': ['TV GAZ', 'TV GAZETA'],
          '3': ['TV SUL', 'TV CACHOEIRO'],
          '4': ['TV NORT', 'TV NORTE'],
          '14': ['TV NORO', 'TV NOROESTE', 'VIDEO'],
          '6': ['LIT VIX', 'FM 102', 'LITORAL'],
          '17': ['LIT SUL', 'DIFUSORA'],
          '18': ['LIT NOR', 'CIDADÃ', 'CIDADA', 'CIDADAO'],
          '22': ['LIT NORO', 'FM LINHARES'],
          '5': ['RD MIX'],
          '23': ['GAZ FM', 'RD N. GERAÇÃO', 'RD N GERACAO', 'RADIO NOVA GERACAO']
      };

      const buildMatrix = (list: Transaction[]) => {
          const matrix: Record<string, Record<string, number>> = {};
          const colTotals: Record<string, number> = {};
          let grandTotal = 0;

          // Inicializa matriz zerada
          COMPANY_ORDER.forEach(comp => {
              matrix[comp] = {};
              uniqueDates.forEach(d => matrix[comp][d] = 0);
          });
          uniqueDates.forEach(d => colTotals[d] = 0);

          list.forEach(t => {
              // Normalização Robusta de Empresa
              const rawComp = String(t.companyCode || '').trim().toUpperCase();
              const compId = rawComp.replace(/^0+/, ''); // Remove zeros a esquerda (01 -> 1)
              
              // 1. Tenta match direto pelo ID
              let matchedComp = COMPANY_ORDER.includes(compId) ? compId : null;
              
              // 2. Se não achou, tenta pelos Aliases (Nome Curto/Longo)
              if (!matchedComp) {
                  matchedComp = Object.keys(COMPANY_ALIASES).find(key => {
                      return COMPANY_ALIASES[key].some(alias => rawComp.includes(alias) || alias === rawComp);
                  }) || null;
              }

              if (matchedComp && uniqueDates.includes(t.date)) {
                  matrix[matchedComp][t.date] = (matrix[matchedComp][t.date] || 0) + (Number(t.value) || 0);
                  colTotals[t.date] += (Number(t.value) || 0);
                  grandTotal += (Number(t.value) || 0);
              }
          });

          return { matrix, colTotals, grandTotal };
      };

      const payData = buildMatrix(allPayables);
      const recData = buildMatrix(allReceivables);

      const formatDateHeader = (d: string) => {
          const ts = parseDateGlobal(d);
          if (!ts) return d;
          const dateObj = new Date(ts);
          const day = String(dateObj.getDate()).padStart(2, '0');
          const shortMonth = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][dateObj.getMonth()];
          const weekDay = ['dom','seg','ter','qua','qui','sex','sáb'][dateObj.getDay()];
          return (
            <div className="flex flex-col items-center leading-tight">
                <span className="text-[10px] uppercase opacity-75">{weekDay}</span>
                <span>{day}/{shortMonth}</span>
            </div>
          );
      };

      const formatCell = (val: number) => {
          if (val === 0) return <span className="text-slate-300">-</span>;
          return val.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
      };

      const renderTable = (
        title: string, 
        data: { matrix: Record<string, Record<string, number>>, colTotals: Record<string, number>, grandTotal: number }, 
        headerColor: string, 
        totalColor: string
      ) => (
          <div className="mb-8 bg-slate-800 shadow-sm border border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full text-xs border-collapse font-sans">
                  <thead>
                      <tr className={`${headerColor} text-slate-200 font-bold text-left`}>
                          <th className="p-2 border border-slate-600 uppercase min-w-[80px] w-[80px] text-center">{title}</th>
                          {uniqueDates.map(d => (
                              <th key={d} className="p-2 border border-slate-600 text-center min-w-[90px]">{formatDateHeader(d)}</th>
                          ))}
                          <th className="p-2 border border-slate-600 text-right min-w-[100px]">Total</th>
                      </tr>
                  </thead>
                  <tbody>
                      {COMPANY_ORDER.map(comp => {
                          const rowTotal = uniqueDates.reduce((acc, d) => acc + (data.matrix[comp]?.[d] || 0), 0);
                          return (
                              <tr key={comp} className="hover:bg-slate-700/50">
                                  <td className="p-1 border border-slate-700 text-center font-bold text-slate-300">{comp}</td>
                                  {uniqueDates.map(d => {
                                      const val = data.matrix[comp]?.[d];
                                      return (
                                          <td key={d} className="p-1 border border-slate-700 text-right text-slate-400 font-mono">
                                              {formatCell(val || 0)}
                                          </td>
                                      );
                                  })}
                                  <td className="p-1 border border-slate-700 text-right font-bold text-slate-200 bg-slate-800/50">
                                      {formatCell(rowTotal)}
                                  </td>
                              </tr>
                          );
                      })}
                      
                      <tr className={`${totalColor} font-bold text-white border-t-2 border-slate-500`}>
                          <td className="p-2 border border-slate-600 uppercase text-center">Totais</td>
                          {uniqueDates.map(d => (
                              <td key={d} className="p-2 border border-slate-600 text-right">
                                  {formatCell(data.colTotals[d] || 0)}
                              </td>
                          ))}
                          <td className="p-2 border border-slate-600 text-right">
                              {formatCell(data.grandTotal)}
                          </td>
                      </tr>
                  </tbody>
              </table>
          </div>
      );

      return (
          <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-full animate-fadeIn">
               <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                   <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
                       <CalendarRange className="w-5 h-5 text-indigo-400" /> 
                       Resumo de Movimentação Diária
                   </h2>
                   <div className="flex gap-2">
                        <span className="text-[10px] bg-slate-700 px-2 py-1 rounded text-slate-300 font-bold border border-slate-600">MODELO CONTROLADORIA</span>
                   </div>
               </div>

               <div className="overflow-auto flex-1 custom-scrollbar p-6 bg-slate-900">
                   {renderTable('A PAGAR', payData, 'bg-red-900/50', 'bg-red-900')}
                   <div className="h-8"></div>
                   {renderTable('A RECEBER', recData, 'bg-emerald-900/50', 'bg-emerald-900')}
               </div>
          </div>
      );
  }

  // --- LOGICA FC DIARIO (SIMULACAO DETALHADA) ---
  if (viewType === DashboardViewType.FC_DIARIO) {
      return (
          <FluxoCaixaDiario
              transactions={transactions}
              dfcManualValues={dfcManualValues}
              onManualValueChange={onManualValueChange}
          />
      );
  }

  // --- LOGICA DFC (DFC CONSOLIDADO - MODELO IMAGEM) ---
  if (viewType === DashboardViewType.DFC) {
      const DFC_COLS = [
          { id: '1', label: 'S/A' },
          { id: '2', label: 'TVG' },
          { id: '3', label: 'TVC' },
          { id: '4', label: 'TVN' },
          { id: '5', label: 'MIX' },
          { id: '6', label: 'FM102' },
          { id: '14', label: 'TNR' },
          { id: '17', label: 'DIF' },
          { id: '18', label: 'CID' },
          { id: '22', label: 'FMLIN' },
          { id: '23', label: 'NGER' },
      ];

      const getTotalBy = (compId: string, type: TransactionType, catFilter?: string | string[], useInvestmentField?: boolean, excludeFilters?: string[]) => {
          // console.log("getTotalBy chamado", { compId, type, catFilter, useInvestmentField });
          return transactions.reduce((acc, t) => {
             if (t.companyCode === compId && t.type === type) {
                 if (useInvestmentField) {
                     if (t.investmentDescription && t.investmentDescription.trim() !== '') {
                         return acc + (Number(t.value) || 0);
                     }
                     return acc;
                 }

                 // Filtro positivo (Inclusão)
                 if (catFilter) {
                     const filters = Array.isArray(catFilter) ? catFilter : [catFilter];
                     const matches = filters.some(f => 
                        (t.category && t.category.toLowerCase().includes(f.toLowerCase())) || 
                        (t.description && t.description.toLowerCase().includes(f.toLowerCase())) ||
                        (t.flowTypeLevel2 && t.flowTypeLevel2.toString() === f)
                     );
                     if (!matches) return acc;
                 }
                 
                 // Filtro negativo (Exclusão)
                 if (excludeFilters && excludeFilters.length > 0) {
                     const matchesExclude = excludeFilters.some(f => 
                        (t.category && t.category.toLowerCase().includes(f.toLowerCase())) || 
                        (t.description && t.description.toLowerCase().includes(f.toLowerCase())) ||
                        (t.flowTypeLevel2 && t.flowTypeLevel2.toString() === f)
                     );
                     if (matchesExclude) return acc;
                 }

                 return acc + (Number(t.value) || 0);
             }
             return acc;
          }, 0);
      };

      const renderRow = (label: string, type: 'INPUT' | 'CALC' | 'HEADER' | 'DATA', params?: { 
          tType?: TransactionType, 
          filter?: string | string[], 
          excludeFilters?: string[], // ADDED
          bgColor?: string, 
          textColor?: string,
          manualKey?: string,
          isTotal?: boolean,
          useInvestmentField?: boolean,
          customValueFn?: (cId: string) => number 
      }) => {
          const rowValues = DFC_COLS.map(c => {
              if (params?.customValueFn) return params.customValueFn(c.id); 
              if (type === 'DATA' && params?.tType) return getTotalBy(c.id, params.tType, params.filter, params.useInvestmentField, params.excludeFilters);
              if (type === 'INPUT' && params?.manualKey) return dfcManualValues?.[`${params.manualKey}_${c.id}`] || 0;
              return 0;
          });
          const total = rowValues.reduce((acc, v) => acc + v, 0);

          return (
              <tr className={`border-b border-slate-700 ${params?.bgColor || 'bg-slate-800'} ${isSlide ? 'text-[8px]' : 'text-[10px]'}`}>
                  <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 font-bold ${params?.textColor || 'text-slate-300'} min-w-[200px] whitespace-normal break-words max-w-[300px]`}>
                      {label}
                  </td>
                  {DFC_COLS.map((c, i) => (
                      <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 text-right ${params?.textColor || 'text-slate-400'}`}>
                          {type === 'INPUT' ? (
                             <input 
                                type="number" 
                                value={dfcManualValues?.[`${params?.manualKey}_${c.id}`] || ''}
                                onChange={(e) => onManualValueChange && onManualValueChange(`${params?.manualKey}_${c.id}`, parseFloat(e.target.value))}
                                className="w-full h-full bg-transparent text-right outline-none text-slate-200"
                                placeholder="-"
                             />
                          ) : (
                             rowValues[i] !== 0 ? rowValues[i].toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'
                          )}
                      </td>
                  ))}
                  <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right font-bold ${params?.textColor || 'text-slate-200'} bg-slate-900/50`}>
                      {total !== 0 ? total.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                  </td>
              </tr>
          );
      }
      
      const getColumnSummary = (cId: string) => {
          const initial = getSimulationInitialBalance(cId); 
          const inflows = getTotalBy(cId, TransactionType.RECEIVABLE); // Total Entradas (Sem filtro pega tudo)
          const outflows = getTotalBy(cId, TransactionType.PAYABLE);   // Total Saídas (Sem filtro pega tudo)
          const investment = getTotalBy(cId, TransactionType.APPLICATION); 
          const opBalance = initial + inflows - outflows; 
          const prevResg = getSimulationResgAplicTotal(cId);
          const finalBalance = opBalance - investment + prevResg;
          return { initial, inflows, outflows, investment, opBalance, prevResg, finalBalance };
      }

      const renderSummaryRow = (label: string, field: keyof ReturnType<typeof getColumnSummary>, bgColor: string, textColor: string) => {
         const rowVals = DFC_COLS.map(c => getColumnSummary(c.id)[field]);
         const total = rowVals.reduce((acc, v) => acc + v, 0);
         
         return (
             <tr className={`${bgColor} border-b border-slate-700 ${isSlide ? 'text-[9px]' : 'text-[11px]'}`}>
                 <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 font-bold uppercase ${textColor}`}>{label}</td>
                 {rowVals.map((v, i) => (
                     <td key={i} className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-slate-700 text-right font-bold ${textColor}`}>
                         {v.toLocaleString('pt-BR', {minimumFractionDigits: 0}) as string}
                     </td>
                 ))}
                 <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right font-bold ${textColor} bg-opacity-20 bg-black`}>
                     {total.toLocaleString('pt-BR', {minimumFractionDigits: 0}) as string}
                 </td>
             </tr>
         )
      };

      const handleExportPDF = async () => {
        try {
          const rows = buildDFCRows({
            columns: DFC_COLS,
            getTotal: (cId, type, filter, useInv, excl) =>
              getTotalBy(cId, type as TransactionType, filter, useInv, excl),
            getInitialBalance: getSimulationInitialBalance,
            getResgAplicTotal: getSimulationResgAplicTotal,
          });

          await exportDFCPdf({
            rows,
            columns: DFC_COLS,
            title:       'DEMONSTRAÇÃO DOS FLUXOS DE CAIXA',
            companyName: 'REDE GAZETA',
            period:      new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', day: '2-digit' }),
            showValidation: true,
          });
        } catch (error) {
          console.error('Erro ao gerar PDF:', error);
          alert('Erro ao gerar PDF. Tente novamente.');
        }
      };

      return (
         <div id="dfc-export-container" className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-full animate-fadeIn">
            <div className="bg-[#0f172a] p-3 flex justify-between items-center text-white border-b-4 border-slate-800">
                 <div className="flex items-center gap-2">
                     <Table2 className="w-5 h-5 text-indigo-400" />
                     <h2 className="text-sm font-bold uppercase tracking-wider">DFC - DEMONSTRATIVO DE FLUXO DE CAIXA</h2>
                 </div>
                 <div className="flex gap-2" data-html2canvas-ignore>
                     <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] font-bold uppercase text-slate-300">CONSOLIDADO</span>
                     <button onClick={handleExportPDF} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded text-[10px] font-bold uppercase flex items-center gap-2 transition-colors">
                         <Printer className="w-3 h-3" /> Exportar PDF
                     </button>
                 </div>
            </div>
            
            <div className="flex-1 overflow-auto custom-scrollbar bg-slate-900">
                <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-20">
                        <tr className={`bg-[#1e3a8a] text-white ${isSlide ? 'text-[8px]' : 'text-[10px]'} uppercase font-bold`}>
                             <th className={`${isSlide ? 'p-1' : 'p-2'} text-left min-w-[200px] border-r border-slate-700`}>FLUXO DE CAIXA - DFC</th>
                             {DFC_COLS.map(c => <th key={c.id} className={`${isSlide ? 'p-1' : 'p-2'} text-right min-w-[70px] border-r border-slate-700`}>{c.label}</th>)}
                             <th className={`${isSlide ? 'p-1' : 'p-2'} text-right min-w-[80px] bg-red-900`}>TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {renderRow('SLD INICIAL DE CAIXA', 'CALC', { // Changed to CALC type logic via customFn
                            bgColor: 'bg-[#1e3a8a]', 
                            textColor: 'text-white',
                            customValueFn: getSimulationInitialBalance
                        })}

                        <tr className={`bg-slate-800 text-indigo-300 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'} border-b border-slate-700`}>
                            <td className={`${isSlide ? 'p-0.5' : 'p-1'}`} colSpan={DFC_COLS.length + 2}>1 - ATIVIDADES OPERACIONAIS</td>
                        </tr>
                        
                        <tr className={`bg-slate-900 text-slate-300 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'}`}>
                            <td className={`${isSlide ? 'p-0.5 pl-2' : 'p-1 pl-4'}`} colSpan={DFC_COLS.length + 1}>Entradas</td>
                            <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right bg-slate-900/50`}>
                                {DFC_COLS.reduce((acc, c) => acc + getTotalBy(c.id, TransactionType.RECEIVABLE), 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                            </td>
                        </tr>
                        {renderRow('(+) Publicidade/Projetos', 'DATA', { tType: TransactionType.RECEIVABLE, filter: ['Publicidade', 'Projeto', 'Ative', '101', '102', '103', '104', '105', '106', '108', '109', '112'] })}
                        {renderRow('(+) Serviços', 'DATA', { tType: TransactionType.RECEIVABLE, filter: ['Serviço', 'Servico', 'Produção', 'Producao', 'Financeira', '110', '111', '113'] })}
                        {renderRow('(+) Assinaturas', 'DATA', { tType: TransactionType.RECEIVABLE, filter: ['Assinatura', '107'] })}
                        {renderRow('(+) Outras Entradas', 'DATA', { tType: TransactionType.RECEIVABLE, filter: '', excludeFilters: ['Publicidade', 'Projeto', 'Ative', 'Serviço', 'Servico', 'Produção', 'Producao', 'Financeira', 'Assinatura', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113'] })}

                        <tr className={`bg-slate-900 text-red-400 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'}`}>
                            <td className={`${isSlide ? 'p-0.5 pl-2' : 'p-1 pl-4'}`} colSpan={DFC_COLS.length + 1}>Saídas</td>
                            <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right bg-slate-900/50`}>
                                {DFC_COLS.reduce((acc, c) => acc + getTotalBy(c.id, TransactionType.PAYABLE), 0).toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                            </td>
                        </tr>
                        {renderRow('(-) Distr Lucro/capital', 'DATA', { tType: TransactionType.PAYABLE, filter: ['Lucro', 'Dividendo'], textColor: 'text-red-400' })}
                        {renderRow('(-) Pessoal', 'DATA', { tType: TransactionType.PAYABLE, filter: ['Pessoal', 'Folha', 'Salário', 'Salario', 'Benefício', 'Beneficio', '201', '202'], textColor: 'text-red-400' })}
                        {renderRow('(-) Comissões', 'DATA', { tType: TransactionType.PAYABLE, filter: ['Comiss', 'Comissao', '218'], textColor: 'text-red-400' })}
                        {renderRow('(-) Impostos', 'DATA', { tType: TransactionType.PAYABLE, filter: ['Imposto', 'Tribut', '209', '215'], textColor: 'text-red-400' })}
                        {renderRow('(-) Fornecedores / Outros', 'DATA', { tType: TransactionType.PAYABLE, filter: '', excludeFilters: ['Lucro', 'Dividendo', 'Pessoal', 'Folha', 'Salário', 'Salario', 'Benefício', 'Beneficio', 'Comiss', 'Comissao', 'Imposto', 'Tribut', 'Investimento', '201', '202', '209', '215', '218'], textColor: 'text-red-400' })}

                        <tr className={`bg-slate-800 text-indigo-300 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'} border-b border-slate-700 mt-2`}>
                            <td className={`${isSlide ? 'p-0.5' : 'p-1'}`} colSpan={DFC_COLS.length + 2}>2 - ATIVIDADES DE INVESTIMENTO</td>
                        </tr>
                        {renderRow('(-) Investimentos (Capex)', 'DATA', { tType: TransactionType.PAYABLE, useInvestmentField: true, textColor: 'text-slate-400' })}

                        <tr className={`bg-slate-800 text-indigo-300 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'} border-b border-slate-700 mt-2`}>
                            <td className={`${isSlide ? 'p-0.5' : 'p-1'}`} colSpan={DFC_COLS.length + 2}>3 - ATIVIDADES DE FINANCIAMENTO</td>
                        </tr>

                        {renderSummaryRow('SLD DE CAIXA ANTES DA APL/RESG', 'opBalance', 'bg-[#1e3a8a]', 'text-white')}
                        {renderRow('(+/-) Previsão de Resg/Aplic', 'CALC', { 
                            bgColor: 'bg-amber-900/30', 
                            textColor: 'text-amber-200',
                            customValueFn: getSimulationResgAplicTotal 
                        })}
                        {renderSummaryRow('SLD FINAL DE CAIXA', 'finalBalance', 'bg-[#1e3a8a]', 'text-white')}

                        <tr className={`bg-red-900/20 text-red-400 font-bold ${isSlide ? 'text-[8px]' : 'text-[10px]'} border-b border-red-900/30 mt-4 border-t-4 border-slate-800`}>
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} border-r border-red-900/30`}>APLICAÇÕES (SLD BRUTO)</td>
                             {DFC_COLS.map(c => <td key={c.id} className={`${isSlide ? 'p-0.5' : 'p-1'} text-right border-r border-red-900/30 font-bold`}>{c.label}</td>)}
                             <td className={`${isSlide ? 'p-0.5' : 'p-1'} text-right font-bold`}>TOTAL</td>
                        </tr>
                        {renderRow('Fundo de Invest - BTG Pactual', 'DATA', { tType: TransactionType.APPLICATION, filter: 'BTG' })}
                        {renderRow('CDB - Banestes', 'DATA', { tType: TransactionType.APPLICATION, filter: 'Banestes' })}
                        {renderRow('Ebricks', 'DATA', { tType: TransactionType.APPLICATION, filter: 'Ebricks' })}
                        
                        {renderSummaryRow('SALDO ATUAL', 'investment', 'bg-[#1e3a8a]', 'text-white')}
                        {renderRow('(+/-) Previsão de Aplic/Resg', 'INPUT', { manualKey: 'dfc_prev_aplic', bgColor: 'bg-amber-900/30', textColor: 'text-amber-200' })}
                        {renderSummaryRow('SALDO APÓS APLIC/RESG', 'investment', 'bg-[#1e3a8a]', 'text-white')}

                        <tr className="h-4 bg-slate-900"></tr>

                        {renderSummaryRow('TOTAL DE DISPONIBILIDADES', 'finalBalance', 'bg-[#0f172a]', 'text-white')}
                    </tbody>
                </table>
            </div>
         </div>
      );
  }

  // Fallback
  return <div className="p-10 text-center text-slate-500">Selecione uma visão no menu lateral.</div>;
}