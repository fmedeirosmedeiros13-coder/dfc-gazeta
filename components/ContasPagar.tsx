import React from 'react';
import { Transaction, TransactionType } from '../types';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell, LabelList, XAxis, YAxis } from 'recharts';
import { Briefcase, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { FinanceLayout } from './FinanceLayout';
import { formatCurrency, classifyTax } from '../utils/finance';

interface ContasPagarProps {
  transactions: Transaction[];
  realizedTransactions?: Transaction[];

  isSlide?: boolean;
}

export const ContasPagar: React.FC<ContasPagarProps> = ({ 
  transactions, 
  realizedTransactions = [], 

  isSlide = false 
}) => {
  const formatFullCurrency = (val: number) => val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const COMPANIES_MAP: Record<string, string> = {
    '1': 'S.A. A GAZETA',
    '2': 'TV GAZETA',
    '3': 'TV CACHOEIRO',
    '4': 'TV NORTE',
    '5': 'RD MIX',
    '6': 'FM 102',
    '14': 'VÍDEO',
    '17': 'DIFUSORA',
    '18': 'CIDADÃ',
    '22': 'FM LINHARES',
    '23': 'RD N. GERAÇÃO'
  };

  const allPayables = transactions.filter(t => t.type === TransactionType.PAYABLE && t.status === 'PREVISTO');
  
  // For the "Total por Empresa" chart, we include both PREVISTO and REALIZADO to show consolidated total
  const chartPayables = [
    ...transactions.filter(t => t.type === TransactionType.PAYABLE),
    ...realizedTransactions.filter(t => t.type === TransactionType.PAYABLE)
  ];
  
  const totalPayables = transactions
    .filter(t => t.type === TransactionType.PAYABLE && t.status === 'PREVISTO')
    .reduce((acc, curr) => acc + (Number(curr.value) || 0), 0);

  const totalInflow = transactions.filter(t => t.type === TransactionType.RECEIVABLE).reduce((acc, t) => acc + (Number(t.value) || 0), 0);
  const totalInvested = transactions.filter(t => t.type === TransactionType.APPLICATION).reduce((acc, t) => acc + (Number(t.value) || 0), 0);
  const balance = totalInflow - totalPayables;

  const normalizeCategory = (cat?: string) => {
      if (!cat) return '';
      return cat
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .replace(/\s+/g, ' ')
          .trim();
  };

  const getSumByCat = (filter: string) => {
      const normalizedFilter = normalizeCategory(filter);
      return allPayables
          .filter(t => normalizeCategory(t.category).includes(normalizedFilter))
          .reduce((acc, t) => acc + (Number(t.value) || 0), 0);
  };
  
  const valPessoal = getSumByCat('Pessoal') + getSumByCat('Folha');
  const valInvest = getSumByCat('Investimento') + getSumByCat('Obra');
  // Impostos: usa classifyTax (por fornecedor + keywords) em vez de só category
  const valImpost = allPayables
      .filter(t => classifyTax(t) !== null)
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);
  // Comissões: exclui os que são impostos (mesmo que o tipo de fluxo diga "Comissões")
  const valComiss = allPayables
      .filter(t => normalizeCategory(t.category).includes('COMISS') && classifyTax(t) === null)
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);
  const valFornec = totalPayables - valPessoal - valInvest - valComiss - valImpost;

  const companyData: Record<string, number> = {};
  chartPayables.forEach(t => {
      const code = String(t.companyCode || '').trim();
      const k = COMPANIES_MAP[code] || (code ? `Empresa ${code}` : 'N/D');
      companyData[k] = (companyData[k] || 0) + (Number(t.value) || 0);
  });
  const barChartData = Object.entries(companyData)
    .map(([name, value]) => ({ name, value }))
    .sort((a,b) => b.value - a.value);

  const supplierData: Record<string, { id: string, name: string, value: number }> = {};
  allPayables.forEach(t => {
      const key = t.supplierCode || t.supplier || t.description || 'Desconhecido';
      const name = t.supplier || t.description || 'Desconhecido';
      if (!supplierData[key]) {
          supplierData[key] = { id: key, name, value: 0 };
      }
      supplierData[key].value += (Number(t.value) || 0);
  });
  
  const aggregatedPayables = Object.values(supplierData);

  const highValue = aggregatedPayables.filter(t => (Number(t.value) || 0) > 35000).sort((a,b) => b.value - a.value);
  const lowValue = aggregatedPayables.filter(t => (Number(t.value) || 0) <= 35000).sort((a,b) => b.value - a.value);
  
  const dailyData: Record<string, number> = {};
  allPayables.forEach(t => dailyData[t.date] = (dailyData[t.date] || 0) + (Number(t.value) || 0));
  const vlDiaList = Object.entries(dailyData).map(([date, value]) => ({ date, value })).sort((a,b) => b.value - a.value);

  return (
    <div className={`flex flex-col ${isSlide ? 'gap-3 pb-0 h-full' : 'gap-6 pb-10'} animate-fadeIn`}>
         {!isSlide && (
         <div className="flex justify-between items-center">
             <div className="bg-red-700 text-white text-sm font-bold py-2 px-6 rounded-lg w-fit shadow-md uppercase tracking-wider">
                 PAGAMENTOS
             </div>
         </div>
         )}

         {/* KPI Row - Custom Red/Warm Style for Payables */}
         <div className="grid grid-cols-6 gap-3 shrink-0">
             {[
                 { label: 'FORNECEDORES', val: valFornec },
                 { label: 'PESSOAL', val: valPessoal },
                 { label: 'INVESTIMENTO', val: valInvest },
                 { label: 'COMISSÕES', val: valComiss },
                 { label: 'IMPOSTOS', val: valImpost },
                 { label: 'TOTAL', val: totalPayables, isTotal: true }
             ].map((kpi, idx) => (
                 <div key={idx} className={`bg-[#450a0a] rounded-lg ${isSlide ? 'p-2' : 'p-4'} text-center shadow-md border-b-4 border-red-500`}>
                     <p className={`${isSlide ? 'text-[8px]' : 'text-[10px]'} font-bold text-slate-300 uppercase tracking-widest mb-1`}>{kpi.label}</p>
                     <h3 className={`${isSlide ? 'text-sm' : 'text-lg'} font-bold text-white`}>R$ {Math.round(kpi.val).toLocaleString('pt-BR')}</h3>
                 </div>
             ))}
         </div>

         <FinanceLayout
             isSlide={isSlide}
             className=""
             col1={
                 /* Col 1: > 35k - Barras horizontais */
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
                                         <div className="h-full bg-gradient-to-r from-sky-600 to-sky-400 rounded-sm transition-all" style={{ width: `${Math.max((t.value / maxVal) * 100, 3)}%` }} />
                                     </div>
                                     <span className={`${isSlide ? 'text-[9px] w-[52px]' : 'text-[11px] w-[62px]'} text-right font-bold text-sky-300 shrink-0`}>{Math.round(t.value).toLocaleString('pt-BR')}</span>
                                 </div>
                             )) : <p className="text-[10px] text-slate-500 text-center mt-4">Nenhum registro.</p>}
                         </div>
                     </div>
                     );
                 })()
             }
             col2={
                 /* Col 2: < 35k - Barras horizontais */
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
                                         <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-sm transition-all" style={{ width: `${Math.max((t.value / maxVal) * 100, 3)}%` }} />
                                     </div>
                                     <span className={`${isSlide ? 'text-[9px] w-[52px]' : 'text-[11px] w-[62px]'} text-right font-bold text-indigo-300 shrink-0`}>{Math.round(t.value).toLocaleString('pt-BR')}</span>
                                 </div>
                             )) : <p className="text-[10px] text-slate-500 text-center mt-4">Nenhum registro.</p>}
                         </div>
                     </div>
                     );
                 })()
             }
             col3={
                 /* Col 3: Categorias Específicas (Investimento, Impostos, Comissões) - Empilhadas */
                 <div className="flex flex-col gap-4 h-full overflow-hidden">
                     {[
                         { title: 'INVESTIMENTO', data: aggregatedPayables.filter(t => allPayables.find(p => (p.supplierCode || p.supplier || p.description || 'Desconhecido') === t.id)?.category?.includes('Investimento')), color: 'border-orange-500' },
                         { title: 'IMPOSTOS', data: aggregatedPayables.filter(t => { const p = allPayables.find(pp => (pp.supplierCode || pp.supplier || pp.description || 'Desconhecido') === t.id); return p ? classifyTax(p) !== null : false; }), color: 'border-red-500' },
                         { title: 'COMISSÕES', data: aggregatedPayables.filter(t => { const p = allPayables.find(pp => (pp.supplierCode || pp.supplier || pp.description || 'Desconhecido') === t.id); return p ? normalizeCategory(p.category).includes('COMISS') && classifyTax(p) === null : false; }), color: 'border-amber-500' }
                     ].map((box, i) => (
                         <div key={i} className={`bg-slate-800 rounded-xl ${isSlide ? 'p-1.5' : 'p-2'} flex-1 flex flex-col border border-slate-700 shadow-md min-h-0`}>
                             <div className="text-center border-b border-slate-700 pb-1 mb-2 flex-shrink-0">
                                 <p className={`${isSlide ? 'text-[8px]' : 'text-[10px]'} font-bold text-slate-300 uppercase tracking-wider`}>{box.title}</p>
                             </div>
                             <div className="flex-1 overflow-auto custom-scrollbar space-y-1 min-h-0">
                                 {box.data.length === 0 ? (
                                     <p className="text-[9px] text-slate-500 text-center mt-2">Sem registros.</p>
                                 ) : (
                                     box.data.map(t => (
                                         <div key={t.id} className={`flex justify-between items-center bg-slate-700/50 px-2 py-1.5 rounded-md shadow-sm text-[9px] border-l-2 ${box.color} hover:bg-slate-700 transition-colors`}>
                                             <span className={`truncate max-w-[75%] text-slate-300 font-semibold ${isSlide ? 'text-[8px]' : ''}`}>{t.name}</span>
                                             <span className={`font-bold text-slate-200 ${isSlide ? 'text-[8px]' : ''}`}>{Math.round(Number(t.value) || 0).toLocaleString('pt-BR')}</span>
                                         </div>
                                     ))
                                 )}
                             </div>
                         </div>
                     ))}
                 </div>
             }
             col4={
                 /* Col 4: Total Empresa Chart (Vertical) */
                 <div className="bg-slate-800 rounded-xl p-4 flex flex-col border border-slate-700 shadow-md h-full min-h-0">
                     <p className="text-center text-slate-300 text-sm font-bold mb-4 uppercase tracking-wide">Total por Empresa</p>
                     <div className="flex-1 min-h-0">
                         <ResponsiveContainer width="100%" height="100%">
                             <BarChart data={barChartData.slice(0, 10)} layout="vertical" margin={{top:5, right:50, left:10, bottom:5}}>
                                 <XAxis type="number" hide />
                                 <YAxis
                                     dataKey="name"
                                     type="category"
                                     width={90}
                                     interval={0}
                                     tick={(props: any) => {
                                         const { x, y, payload } = props;
                                         const maxChars = 12;
                                         const label = payload.value.length > maxChars
                                             ? payload.value.slice(0, maxChars - 1) + '…'
                                             : payload.value;
                                         return (
                                             <text x={x} y={y} dy={4} textAnchor="end" fontSize={barChartData.length > 8 ? 8 : 10} fontWeight="bold" fill="#94a3b8">
                                                 {label}
                                             </text>
                                         );
                                     }}
                                 />
                                 <Tooltip cursor={{fill: 'transparent'}} contentStyle={{backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc', borderRadius: '8px'}} itemStyle={{color: '#fb923c'}} formatter={(v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} />
                                 <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={30}>
                                     {barChartData.slice(0, 10).map((entry, index) => (
                                         <Cell key={`cell-${index}`} fill="#f97316" />
                                     ))}
                                     <LabelList dataKey="value" position="right" style={{ fontSize: '10px', fill: '#fb923c', fontWeight: 'bold' }} formatter={(v: number) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`} />
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
     </div>
   );
 };
