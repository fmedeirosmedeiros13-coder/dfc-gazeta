import React, { useMemo, useState } from 'react';
import { Transaction } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, Line, Area, LabelList
} from 'recharts';
import { Target, TrendingUp, TrendingDown, AlertCircle, Calendar, ArrowUpRight, ArrowDownRight, Filter } from 'lucide-react';
import { formatCurrency, parseDate } from '../utils/finance';
import { reconcile } from '../engines/reconciliation';

interface VisaoEstrategicaRealizadoProps {
  planned: Transaction[];
  realized: Transaction[];
  isSlide?: boolean;
  totalPlanned?: number;
  totalRealized?: number;
  deviation?: number;
  deviationPercent?: number;
}

export const VisaoEstrategicaRealizado: React.FC<VisaoEstrategicaRealizadoProps> = ({ 
  planned, 
  realized, 
  isSlide = false,
  totalPlanned: propTotalPlanned,
  totalRealized: propTotalRealized,
  deviation: propDeviation,
  deviationPercent: propDeviationPercent
}) => {
  
  const [empresaFiltro, setEmpresaFiltro] = useState('all');
  const [tipoFiltro, setTipoFiltro] = useState<'todos' | 'pagamentos' | 'recebimentos'>('todos');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  // --- HELPERS ---
  // formatCurrency importado de utils/finance.ts
  
  const formatPercent = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(val / 100);
  };

  const parseDate = (dateStr: any) => {
    if (!dateStr || typeof dateStr !== 'string') return new Date(NaN);
    const parts = dateStr.split('/');
    if (parts.length === 3) return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    if (parts.length === 2) return new Date(new Date().getFullYear(), Number(parts[1]) - 1, Number(parts[0]));
    // Fallback for YYYY-MM-DD
    if (dateStr.includes('-')) {
        const [y, m, d] = dateStr.split('-');
        return new Date(Number(y), Number(m) - 1, Number(d));
    }
    return new Date(NaN);
  };

  const uniqueCompanies = useMemo(() => {
    const companies = new Set<string>();
    (planned || []).forEach(t => { if (t.companyCode) companies.add(String(t.companyCode)); });
    (realized || []).forEach(t => { if (t.companyCode) companies.add(String(t.companyCode)); });
    return Array.from(companies).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if(!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
    });
  }, [planned, realized]);

  const applyFilters = (t: Transaction) => {
    if (!t) return false;
    
    const date = parseDate(t.date);
    if (isNaN(date.getTime())) return false; // Exclui transações sem data válida

    if (empresaFiltro !== 'all' && String(t.companyCode) !== empresaFiltro) return false;
    if (tipoFiltro === 'pagamentos' && t.type !== 'PAYABLE') return false;
    if (tipoFiltro === 'recebimentos' && t.type !== 'RECEIVABLE') return false;
    
    if (dataInicio || dataFim) {
      const tDate = date.getTime();
      if (dataInicio) {
        const start = new Date(dataInicio + 'T00:00:00').getTime();
        if (tDate < start) return false;
      }
      if (dataFim) {
        const end = new Date(dataFim + 'T23:59:59').getTime();
        if (tDate > end) return false;
      }
    }
    return true;
  };

  const filteredPlanned = useMemo(() => (planned || []).filter(applyFilters), [planned, empresaFiltro, tipoFiltro, dataInicio, dataFim]);
  const filteredRealized = useMemo(() => (realized || []).filter(applyFilters), [realized, empresaFiltro, tipoFiltro, dataInicio, dataFim]);

  console.log('DEBUG VisaoEstrategica:', {
      filteredRealizedLength: filteredRealized.length,
      realizedLength: realized.length,
      realizedSample: realized.slice(0, 5)
  });

  // --- AGGREGATIONS ---
  const data = useMemo(() => {
    // Initialize totals
    let calcTotalPlanned = 0;
    let calcTotalRealized = 0;

    // Monthly Data
    const monthlyData: Record<string, { planned: number; realized: number; monthOrder: number }> = {};
    
    // Helper to ensure key exists
    const ensureKey = (date: Date) => {
        if (isNaN(date.getTime())) return null;
        const key = date.toLocaleString('pt-BR', { month: 'short' }).toUpperCase();
        const monthOrder = date.getMonth();
        
        if (!monthlyData[key]) {
            monthlyData[key] = { planned: 0, realized: 0, monthOrder };
        }
        return key;
    };

    // Process Planned
    (filteredPlanned || []).forEach(t => {
        const val = Number(t.value) || 0;
        calcTotalPlanned += val;

        const date = parseDate(t.date);
        const key = ensureKey(date);
        if (key) {
            monthlyData[key].planned += val;
        }
    });

    // Process Realized
    (filteredRealized || []).forEach(t => {
        const val = Number(t.value) || Number(t.originalTitleValue) || 0;
        calcTotalRealized += val;

        const date = parseDate(t.date);
        const key = ensureKey(date);
        if (key) {
            monthlyData[key].realized += val;
        }
    });

    const graphPlannedTotal = Object.values(monthlyData).reduce((acc, m) => acc + m.planned, 0);
    const graphRealizedTotal = Object.values(monthlyData).reduce((acc, m) => acc + m.realized, 0);

    if (Math.abs(graphPlannedTotal - calcTotalPlanned) > 0.01) {
        console.log(`[VisaoEstrategica] Diferença no Planejado: Gráfico (${graphPlannedTotal}) vs KPI (${calcTotalPlanned})`);
    }
    if (Math.abs(graphRealizedTotal - calcTotalRealized) > 0.01) {
        console.log(`[VisaoEstrategica] Diferença no Realizado: Gráfico (${graphRealizedTotal}) vs KPI (${calcTotalRealized})`);
    }

    // Always use the locally calculated totals to ensure KPI matches the graph exactly
    const totalPlanned = calcTotalPlanned;
    const totalRealized = calcTotalRealized;
    const diff = totalRealized - totalPlanned;
    const diffPercent = totalPlanned > 0 ? (diff / totalPlanned) * 100 : 0;

    const chartData = [
        {
            name: 'Total do Período',
            planned: totalPlanned,
            realized: totalRealized
        }
    ];

    // Cumulative Data
    let accPlanned = 0;
    let accRealized = 0;
    const cumulativeData = Object.entries(monthlyData)
        .map(([name, val]) => ({ name, ...val }))
        .sort((a, b) => a.monthOrder - b.monthOrder)
        .map(d => {
            accPlanned += d.planned;
            accRealized += d.realized;
            return {
                name: d.name,
                accPlanned,
                accRealized
            };
        });

    // Category Data
    // IMPORTANTE: o Realizado importado do CSV do TOTVS NÃO traz coluna de
    // categoria (engines/csvParser.ts grava 'Realizado' fixo em todo mundo,
    // só como placeholder). Por isso, a categoria do realizado é herdada do
    // PREVISTO com quem ele casa na conciliação (fornecedor + título) — a
    // mesma lógica já usada na tela Previsto vs Realizado — em vez de tentar
    // usar o category do próprio realizado, que nunca vai bater com nada.
    const categoryData: Record<string, { planned: number; realized: number }> = {};

    filteredPlanned.forEach(t => {
        const cat = t.category || 'OUTROS';
        if (!categoryData[cat]) categoryData[cat] = { planned: 0, realized: 0 };
        categoryData[cat].planned += (Number(t.value) || 0);
    });

    const reconciliation = reconcile(filteredPlanned, filteredRealized);

    // Realizado casado: usa a categoria do(s) previsto(s) daquele grupo.
    [...reconciliation.matched, ...reconciliation.reviewNeeded].forEach(group => {
        const cat = group.prev[0]?.category || 'OUTROS';
        const realTotal = group.real.reduce((s, r) => s + (Number(r.value) || Number(r.originalTitleValue) || 0), 0);
        if (!categoryData[cat]) categoryData[cat] = { planned: 0, realized: 0 };
        categoryData[cat].realized += realTotal;
    });

    // Realizado sem par no previsto: categoria desconhecida, fica visível
    // como "Não conciliado" em vez de silenciosamente não contar em lugar
    // nenhum (ou virar um "Realizado" fantasma que nunca bate com nada).
    if (reconciliation.unexpected.length > 0) {
        const naoConciliadoTotal = reconciliation.unexpected.reduce((s, r) => s + (Number(r.value) || Number(r.originalTitleValue) || 0), 0);
        if (!categoryData['Não conciliado']) categoryData['Não conciliado'] = { planned: 0, realized: 0 };
        categoryData['Não conciliado'].realized += naoConciliadoTotal;
    }

    const tableData = Object.entries(categoryData)
        .map(([category, val]) => {
            const diff = val.realized - val.planned;
            const percent = val.planned > 0 ? (diff / val.planned) * 100 : 0;
            return { category, ...val, diff, percent };
        })
        .sort((a, b) => b.planned - a.planned); // Sort by highest planned cost

    return {
        totalPlanned,
        totalRealized,
        diff,
        diffPercent,
        chartData,
        cumulativeData,
        tableData
    };
  }, [filteredPlanned, filteredRealized]);

  // --- RENDER ---
  return (
    <div className={`flex flex-col h-full animate-fadeIn ${isSlide ? 'gap-3' : 'gap-6'}`}>
        
        {/* FILTROS */}
        {!isSlide && (
            <div className="flex flex-wrap items-end gap-4 bg-slate-900/40 p-4 rounded-xl border border-slate-800/60 shrink-0">
                <div className="flex items-center gap-2 mr-2">
                    <Filter className="w-5 h-5 text-slate-400" />
                    <span className="text-sm font-medium text-slate-300">Filtros:</span>
                </div>
                
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Empresa</label>
                    <select 
                        value={empresaFiltro} 
                        onChange={(e) => setEmpresaFiltro(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 min-w-[150px] transition-colors"
                    >
                        <option value="all">Todas as Empresas</option>
                        {uniqueCompanies.map(c => (
                            <option key={c} value={c}>Empresa {c}</option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Tipo</label>
                    <select 
                        value={tipoFiltro} 
                        onChange={(e) => setTipoFiltro(e.target.value as any)}
                        className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 min-w-[150px] transition-colors"
                    >
                        <option value="todos">Todos</option>
                        <option value="pagamentos">Pagamentos</option>
                        <option value="recebimentos">Recebimentos</option>
                    </select>
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Data Início</label>
                    <input 
                        type="date" 
                        value={dataInicio} 
                        onChange={(e) => setDataInicio(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-colors"
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Data Fim</label>
                    <input 
                        type="date" 
                        value={dataFim} 
                        onChange={(e) => setDataFim(e.target.value)}
                        className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500 transition-colors"
                    />
                </div>
                
                {(empresaFiltro !== 'all' || tipoFiltro !== 'todos' || dataInicio || dataFim) && (
                    <button 
                        onClick={() => {
                            setEmpresaFiltro('all');
                            setTipoFiltro('todos');
                            setDataInicio('');
                            setDataFim('');
                        }}
                        className="text-xs font-medium text-slate-400 hover:text-slate-200 uppercase tracking-wider px-3 py-2 transition-colors ml-auto"
                    >
                        Limpar Filtros
                    </button>
                )}
            </div>
        )}

        {/* 1. TOPO: KPIs ESTRATÉGICOS */}
        <div className={`grid grid-cols-1 md:grid-cols-4 shrink-0 ${isSlide ? 'gap-3' : 'gap-6'}`}>
            {/* Custo Planejado */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col justify-between relative overflow-hidden group hover:border-slate-700/60 transition-all ${isSlide ? 'p-3' : 'p-6'}`}>
                <div className={`absolute top-0 right-0 opacity-5 group-hover:opacity-10 transition-opacity text-slate-100 ${isSlide ? 'p-2' : 'p-4'}`}>
                    <Target className={isSlide ? "w-10 h-10" : "w-16 h-16"} />
                </div>
                <div className="relative z-10">
                    <p className={`text-slate-400 font-medium uppercase tracking-wider mb-1 ${isSlide ? 'text-[10px]' : 'text-sm'}`}>Custo Planejado</p>
                    <h3 className={`font-semibold text-sky-400 tracking-tight leading-none ${isSlide ? 'text-xl' : 'text-3xl'}`}>
                        {formatCurrency(data.totalPlanned)}
                    </h3>
                </div>
            </div>

            {/* Custo Realizado */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col justify-between relative overflow-hidden group hover:border-slate-700/60 transition-all ${isSlide ? 'p-3' : 'p-6'}`}>
                <div className={`absolute top-0 right-0 opacity-5 group-hover:opacity-10 transition-opacity text-emerald-400 ${isSlide ? 'p-2' : 'p-4'}`}>
                    <Calendar className={isSlide ? "w-10 h-10" : "w-16 h-16"} />
                </div>
                <div className="relative z-10">
                    <p className={`text-slate-400 font-medium uppercase tracking-wider mb-1 ${isSlide ? 'text-[10px]' : 'text-sm'}`}>Custo Realizado</p>
                    <h3 className={`font-semibold text-emerald-400 tracking-tight leading-none ${isSlide ? 'text-xl' : 'text-3xl'}`}>
                        {formatCurrency(data.totalRealized)}
                    </h3>
                </div>
            </div>

            {/* Desvio Absoluto (= Diferença) — sempre laranja, é referência, não "bom"/"ruim" */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col justify-between relative overflow-hidden group hover:border-slate-700/60 transition-all ${isSlide ? 'p-3' : 'p-6'}`}>
                <div className={`absolute top-0 right-0 opacity-5 group-hover:opacity-10 transition-opacity text-orange-400 ${isSlide ? 'p-2' : 'p-4'}`}>
                    <AlertCircle className={isSlide ? "w-10 h-10" : "w-16 h-16"} />
                </div>
                <div className="relative z-10">
                    <p className={`text-slate-400 font-medium uppercase tracking-wider mb-1 ${isSlide ? 'text-[10px]' : 'text-sm'}`}>Desvio (R$)</p>
                    <h3 className={`font-semibold tracking-tight leading-none text-orange-400 ${isSlide ? 'text-xl' : 'text-3xl'}`}>
                        {data.diff > 0 ? '+' : ''}{formatCurrency(data.diff)}
                    </h3>
                </div>
            </div>

            {/* Desvio Percentual — verde quando bate (perto de 0%), vermelho quando há diferença */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col justify-between relative overflow-hidden group hover:border-slate-700/60 transition-all ${isSlide ? 'p-3' : 'p-6'}`}>
                <div className={`absolute top-0 right-0 opacity-5 group-hover:opacity-10 transition-opacity ${Math.abs(data.diffPercent) < 0.05 ? 'text-emerald-400' : 'text-rose-400'} ${isSlide ? 'p-2' : 'p-4'}`}>
                    {data.diffPercent > 0 ? <TrendingUp className={isSlide ? "w-10 h-10" : "w-16 h-16"} /> : <TrendingDown className={isSlide ? "w-10 h-10" : "w-16 h-16"} />}
                </div>
                <div className="relative z-10">
                    <p className={`text-slate-400 font-medium uppercase tracking-wider mb-1 ${isSlide ? 'text-[10px]' : 'text-sm'}`}>Desvio (%)</p>
                    <h3 className={`font-semibold tracking-tight leading-none ${Math.abs(data.diffPercent) < 0.05 ? 'text-emerald-400' : 'text-rose-400'} ${isSlide ? 'text-xl' : 'text-3xl'}`}>
                        {data.diffPercent > 0 ? '+' : ''}{data.diffPercent.toFixed(1)}%
                    </h3>
                </div>
            </div>
        </div>

        {/* 2. CENTRO: GRÁFICOS */}
        <div className={`grid grid-cols-1 lg:grid-cols-2 shrink-0 ${isSlide ? 'gap-3 h-[220px]' : 'gap-6 h-[320px]'}`}>
            {/* Gráfico Comparativo do Período */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col h-full min-h-0 ${isSlide ? 'p-3' : 'p-6'}`}>
                <h3 className={`text-slate-100 font-medium mb-2 flex items-center gap-2 ${isSlide ? 'text-sm' : 'text-lg'}`}>
                    <Calendar className="w-4 h-4 text-slate-400" /> Comparativo do Período
                </h3>
                <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.chartData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }} barGap={12}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.5} />
                            <XAxis 
                                dataKey="name" 
                                tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 500 }} 
                                axisLine={false} 
                                tickLine={false} 
                                dy={10} 
                            />
                            <YAxis 
                                tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }} 
                                tickFormatter={(v) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v)} 
                                axisLine={false} 
                                tickLine={false} 
                                width={40} 
                            />
                            <Tooltip 
                                cursor={{ fill: '#1e293b', opacity: 0.4 }}
                                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #334155', color: '#f8fafc', fontSize: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                formatter={(value: number) => formatCurrency(value)}
                            />
                            <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} formatter={(val) => <span className="text-slate-300 text-xs font-medium ml-2">{val}</span>} />
                            <Bar dataKey="planned" name="Planejado" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={60}>
                                <LabelList dataKey="planned" position="top" formatter={(val: number) => formatCurrency(val)} style={{ fill: '#7dd3fc', fontSize: '10px', fontWeight: 600 }} />
                            </Bar>
                            <Bar dataKey="realized" name="Realizado" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={60}>
                                <LabelList dataKey="realized" position="top" formatter={(val: number) => formatCurrency(val)} style={{ fill: '#34d399', fontSize: '10px', fontWeight: 600 }} />
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Curva Acumulada */}
            <div className={`bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col ${isSlide ? 'p-3' : 'p-6'}`}>
                <h3 className={`text-slate-100 font-medium mb-2 flex items-center gap-2 ${isSlide ? 'text-sm' : 'text-lg'}`}>
                    <TrendingUp className="w-4 h-4 text-slate-400" /> Curva Acumulada
                </h3>
                <ResponsiveContainer width="100%" height={isSlide ? 150 : 220}>
                    <ComposedChart data={data.cumulativeData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" opacity={0.3} />
                            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} dy={10} />
                            <YAxis tick={{ fontSize: 9, fill: '#64748b' }} tickFormatter={(v) => new Intl.NumberFormat('pt-BR', { notation: 'compact' }).format(v)} axisLine={false} tickLine={false} width={30} />
                            <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '11px' }}
                                formatter={(value: number) => formatCurrency(value)}
                            />
                            <Legend verticalAlign="top" height={24} iconType="circle" iconSize={6} formatter={(val) => <span className="text-slate-400 text-[10px] font-medium ml-1">{val}</span>} />
                            <Area type="monotone" dataKey="accPlanned" name="Planejado (Acum)" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.1} strokeWidth={3} activeDot={{ r: 6 }} dot={{ r: 4 }} />
                            <Line type="monotone" dataKey="accRealized" name="Realizado (Acum)" stroke="#10b981" strokeWidth={3} dot={{ r: 4, strokeWidth: 0, fill: '#10b981' }} activeDot={{ r: 6 }} />
                        </ComposedChart>
                    </ResponsiveContainer>
            </div>
        </div>

        {/* 3. BASE: TABELA RESUMIDA */}
        <div className="bg-slate-900/40 rounded-xl border border-slate-800/60 flex flex-col h-full min-h-0">
            <div className={`border-b border-slate-800/60 bg-slate-900/20 ${isSlide ? 'p-2' : 'p-4'}`}>
                <h3 className={`text-slate-100 font-medium flex items-center gap-2 ${isSlide ? 'text-sm' : 'text-lg'}`}>
                    <Target className="w-4 h-4 text-slate-400" /> Detalhamento por Atividade ({data.tableData.length} registros)
                </h3>
            </div>
            <div className={`flex-1 overflow-y-auto max-h-[340px] pr-2 custom-scrollbar ${isSlide ? 'p-2' : 'p-4'}`}>
                <table className="w-full text-left">
                    <thead className={`bg-slate-900/50 text-slate-400 font-semibold uppercase ${isSlide ? 'text-[10px]' : 'text-sm'} sticky top-0 z-10`}>
                        <tr>
                            <th className={`rounded-l-lg ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>Descrição / Categoria</th>
                            <th className={`text-right ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>Planejado</th>
                            <th className={`text-right ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>Realizado</th>
                            <th className={`text-right ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>Diferença</th>
                            <th className={`text-right rounded-r-lg ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>% Desvio</th>
                        </tr>
                    </thead>
                    <tbody className={`text-slate-300 divide-y divide-slate-800/50 ${isSlide ? 'text-[10px]' : 'text-[14px]'}`}>
                        {data.tableData.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                <td className={`font-medium text-slate-200 ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>{row.category}</td>
                                <td className={`text-right text-sky-400 ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>{formatCurrency(row.planned)}</td>
                                <td className={`text-right text-emerald-400 ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>{formatCurrency(row.realized)}</td>
                                <td className={`text-right font-medium text-orange-400 ${isSlide ? 'py-1 px-2' : 'py-3 px-3'}`}>
                                    {row.diff > 0 ? '+' : ''}{formatCurrency(row.diff)}
                                </td>
                                <td className={`text-right font-medium ${isSlide ? 'py-1 px-2' : 'py-3 px-3'} ${Math.abs(row.percent) < 0.05 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {row.percent > 0 ? '+' : ''}{row.percent.toFixed(1)}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
};
