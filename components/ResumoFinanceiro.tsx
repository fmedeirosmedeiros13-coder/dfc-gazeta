import React from 'react';
import { FinancialSummary, Transaction, TransactionType, AIAnalysisResult } from '../types';
import type { ExecutiveAnalysis } from '../services/claudeService';
import { BarChart, Bar, Tooltip, ResponsiveContainer, Cell, LabelList, PieChart, Pie, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area, ComposedChart } from 'recharts';
import { Activity, Target, TrendingUp, TrendingDown, Wallet, Briefcase, ArrowUpRight, ArrowDownRight, DollarSign, BrainCircuit, Lightbulb, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, parseDate } from '../utils/finance';

interface ResumoFinanceiroProps {
  summary: FinancialSummary;
  transactions: Transaction[];
  isSlide?: boolean;
  aiAnalysis?: ExecutiveAnalysis | null;
  isGeneratingAI?: boolean;
  onGenerateAI?: () => void;
}

export const ResumoFinanceiro: React.FC<ResumoFinanceiroProps> = ({ summary, transactions, isSlide = false, aiAnalysis, isGeneratingAI = false, onGenerateAI }) => {
  const [showAI, setShowAI] = React.useState(false);
  const allPayables = transactions.filter(t => t.type === TransactionType.PAYABLE && t.status === 'PREVISTO');
  const allReceivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
  const totalOutflow = summary.totalOutflow;
  const totalInflow = summary.totalInflow;
  const totalInvested = summary.totalInvested;
  const balance = totalInflow - totalOutflow;

  // --- EXECUTIVE ANALYSIS CALCULATIONS ---
  const coverageRatio = totalOutflow > 0 ? (totalInflow / totalOutflow) * 100 : 0;

  // KPI 2: Top Revenue
  const recByCategory: Record<string, number> = {};
  allReceivables.forEach(t => {
      const origin = t.customer || t.description || t.category || 'Geral';
      recByCategory[origin] = (recByCategory[origin] || 0) + t.value;
  });
  
  // KPI 3: Top Expense
  const payByCategory: Record<string, number> = {};
  allPayables.forEach(t => {
      const cat = t.category || 'Geral';
      payByCategory[cat] = (payByCategory[cat] || 0) + t.value;
  });

  // Charts Data
  const payByCatData = Object.entries(payByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 5);

  const recByCatData = Object.entries(recByCategory)
      .map(([name, value]) => ({ name, value }))
      .sort((a,b) => b.value - a.value)
      .slice(0, 5);

  const COLORS = {
      pay: '#e11d48', // Rose 600 (Less saturated)
      rec: '#059669', // Emerald 600 (Less vibrant)
      inv: '#0284c7', // Sky 600 (Institutional)
      linePay: '#be123c', // Rose 700
      lineRec: '#047857', // Emerald 700
      lineBal: '#f8fafc' // White
  };

  const distributionData = [
      { name: 'Pagamentos', value: totalOutflow, color: COLORS.pay },
      { name: 'Recebimentos', value: totalInflow, color: COLORS.rec },
      { name: 'Aplicações', value: totalInvested, color: COLORS.inv }
  ].filter(d => d.value > 0);

  // Trend Data
  const parseDate = (d: string) => {
      if(!d) return 0;
      if (d.includes('-')) {
          const [y, m, day] = d.split('-');
          return new Date(Number(y), Number(m)-1, Number(day)).getTime();
      }
      const parts = d.split('/');
      if(parts.length === 3) return new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0])).getTime();
      return 0;
  };
  const dateSet = new Set([...allPayables.map(t=>t.date), ...allReceivables.map(t=>t.date)]);
  let accum = 0;
  const trendData = Array.from(dateSet).map(date => {
      const dayPay = allPayables.filter(t => t.date === date).reduce((a,t) => a+t.value, 0);
      const dayRec = allReceivables.filter(t => t.date === date).reduce((a,t) => a+t.value, 0);
      const dayNet = dayRec - dayPay;
      return { date, ts: parseDate(date), Entradas: dayRec, Saídas: dayPay, dayNet };
  }).sort((a,b) => a.ts - b.ts).map(d => {
      accum += d.dayNet;
      return { ...d, SaldoAcumulado: accum };
  });

  // Se houver apenas 1 ponto de dados, o Recharts não desenha a linha.
  // Duplicamos o ponto para criar uma linha reta horizontal.
  if (trendData.length === 1) {
      trendData.push({ ...trendData[0], date: trendData[0].date + ' ' });
  }

  // formatCurrency importado de utils/finance.ts

  const formatCompact = (value: number) => {
      return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1, style: 'currency', currency: 'BRL' }).format(value);
  };

  // --- COMPONENTES INTERNOS ---
  const KPICard = ({ title, value, icon: Icon, color, trend, subtitle }: any) => (
      <div className={`bg-slate-900/40 rounded-xl ${isSlide ? 'p-3' : 'p-6'} border border-slate-800/60 flex flex-col justify-between relative overflow-hidden group hover:border-slate-700/60 transition-all`}>
          <div className={`absolute top-0 right-0 ${isSlide ? 'p-2' : 'p-4'} opacity-5 group-hover:opacity-10 transition-opacity ${color}`}>
              <Icon className={isSlide ? "w-10 h-10" : "w-16 h-16"} />
          </div>
          <div className="relative z-10">
              <p className={`text-slate-400 ${isSlide ? 'text-[10px]' : 'text-sm'} font-medium uppercase tracking-wider mb-2`}>{title}</p>
              <h3 className={`${isSlide ? 'text-2xl' : 'text-4xl'} font-semibold text-slate-100 tracking-tight leading-none`}>
                  {typeof value === 'number' && title !== 'Índice Cobertura Caixa' ? formatCompact(value) : value}
              </h3>
              {subtitle && (
                  <p className={`text-slate-400 ${isSlide ? 'text-[9px]' : 'text-sm'} mt-2`}>{subtitle}</p>
              )}
          </div>
          {trend && (
             <div className="relative z-10 mt-3 flex items-center gap-1 text-xs font-normal text-slate-400">
                 {trend > 0 ? <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" /> : <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />}
                 <span className={trend > 0 ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium'}>{Math.abs(trend).toFixed(1)}%</span> vs mês ant.
             </div>
          )}
      </div>
  );

  return (
    <div className={`flex flex-col h-full ${isSlide ? 'gap-4 pb-0' : 'gap-6 pb-10'} animate-fadeIn`}>
      {!isSlide && (
        <div className="flex items-center justify-between shrink-0">
          <h2 className="text-3xl font-semibold text-slate-100 tracking-tight">Resumo Financeiro Consolidado</h2>
        </div>
      )}

      {/* 1. TOPO: KPIs ESTRATÉGICOS */}
      <div className={`grid grid-cols-4 ${isSlide ? 'gap-4' : 'gap-6'} shrink-0`}>
          <KPICard title="Saldo Líquido" value={balance} icon={Wallet} color="text-slate-100" />
          <KPICard title="Entradas Totais" value={totalInflow} icon={TrendingUp} color="text-emerald-400" />
          <KPICard title="Saídas Totais" value={totalOutflow} icon={TrendingDown} color="text-rose-400" />
          <KPICard title="Aplicações" value={totalInvested} icon={Briefcase} color="text-slate-400" />
      </div>

      {/* ANÁLISE FINANCEIRA EXECUTIVA */}
      <div className={`flex flex-col ${isSlide ? 'gap-4' : 'gap-6'}`}>
          {/* KPIs Executivos */}
          <div className={`grid grid-cols-3 ${isSlide ? 'gap-4' : 'gap-6'} shrink-0`}>
              <KPICard 
                  title="Índice Cobertura Caixa" 
                  value={`${coverageRatio.toFixed(1)}%`} 
                  subtitle="Entradas vs Saídas"
                  icon={Activity} 
                  color={coverageRatio >= 100 ? "text-emerald-400" : "text-rose-400"} 
              />
              <KPICard 
                  title="Maior Fonte Receita" 
                  value={recByCatData[0]?.name || 'N/A'} 
                  subtitle={recByCatData[0] ? formatCurrency(recByCatData[0].value) : ''}
                  icon={ArrowUpRight} 
                  color="text-emerald-400" 
              />
              <KPICard 
                  title="Maior Categoria Pago" 
                  value={payByCatData[0]?.name || 'N/A'} 
                  subtitle={payByCatData[0] ? formatCurrency(payByCatData[0].value) : ''}
                  icon={ArrowDownRight} 
                  color="text-rose-400" 
              />
          </div>

          {/* GRÁFICOS: 3 COLUNAS */}
          <div className={`grid grid-cols-3 ${isSlide ? 'gap-4 h-[250px]' : 'gap-6 h-[320px]'} shrink-0 min-h-0`}>
          {/* Pagamentos por Categoria */}
          <div className={`bg-slate-900/40 rounded-xl ${isSlide ? 'p-3' : 'p-6'} border border-slate-800/60 flex flex-col`}>
              <h3 className={`text-slate-100 font-medium ${isSlide ? 'text-sm' : 'text-lg'} flex items-center gap-2 mb-4`}>
                  <ArrowDownRight className="w-5 h-5 text-rose-500" /> Pagamentos por Categoria
              </h3>
              <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={payByCatData} layout="vertical" margin={{top: 0, right: 30, left: 0, bottom: 0}} barSize={isSlide ? 12 : 18}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#1e293b" opacity={0.3} />
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" width={isSlide ? 80 : 100} tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b', fontWeight: 500}} tickLine={false} axisLine={false} />
                          <Tooltip cursor={{fill: '#1e293b', opacity: 0.4}} contentStyle={{backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '12px'}} formatter={(v: number) => formatCurrency(v)} />
                          <Bar dataKey="value" fill={COLORS.pay} radius={[0, 4, 4, 0]}>
                              <LabelList dataKey="value" position="right" formatter={(v: number) => formatCompact(v)} style={{fontSize: isSlide ? '8px' : '10px', fill: '#cbd5e1', fontWeight: 500}} />
                          </Bar>
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Recebimentos por Origem */}
          <div className={`bg-slate-900/40 rounded-xl ${isSlide ? 'p-3' : 'p-6'} border border-slate-800/60 flex flex-col`}>
              <h3 className={`text-slate-100 font-medium ${isSlide ? 'text-sm' : 'text-lg'} flex items-center gap-2 mb-4`}>
                  <ArrowUpRight className="w-5 h-5 text-emerald-500" /> Recebimentos por Origem
              </h3>
              <div className="flex-1 min-h-0">
                  <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={recByCatData} margin={{top: 0, right: 0, left: 0, bottom: 0}} barSize={isSlide ? 20 : 32}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" opacity={0.3} />
                          <XAxis dataKey="name" tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b'}} tickLine={false} axisLine={false} interval={0} angle={-15} textAnchor="end" height={isSlide ? 30 : 40} />
                          <YAxis tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b'}} tickFormatter={(v) => formatCompact(v)} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{fill: '#1e293b', opacity: 0.4}} contentStyle={{backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '12px'}} formatter={(v: number) => formatCurrency(v)} />
                          <Bar dataKey="value" fill={COLORS.rec} radius={[4, 4, 0, 0]} />
                      </BarChart>
                  </ResponsiveContainer>
              </div>
          </div>

          {/* Distribuição Financeira */}
          <div className={`bg-slate-900/40 rounded-xl ${isSlide ? 'p-3' : 'p-6'} border border-slate-800/60 flex flex-col relative`}>
              <h3 className={`text-slate-100 font-medium ${isSlide ? 'text-sm' : 'text-lg'} flex items-center gap-2 mb-4`}>
                  <Target className="w-5 h-5 text-slate-400" /> Distribuição Financeira
              </h3>
              <div className="flex-1 min-h-0 relative">
                  <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                          <Pie
                              data={distributionData}
                              cx="50%"
                              cy="50%"
                              innerRadius={isSlide ? 50 : 65}
                              outerRadius={isSlide ? 70 : 85}
                              paddingAngle={4}
                              dataKey="value"
                              stroke="none"
                          >
                              {distributionData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                          </Pie>
                          <Tooltip 
                              contentStyle={{backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '12px'}}
                              formatter={(value: number) => formatCurrency(value)}
                          />
                          <Legend 
                              verticalAlign="bottom" 
                              height={36}
                              iconType="circle"
                              iconSize={8}
                              formatter={(value) => <span className={`text-slate-400 ${isSlide ? 'text-[10px]' : 'text-xs'} font-medium ml-1`}>{value}</span>}
                          />
                      </PieChart>
                  </ResponsiveContainer>
                  {/* Central Text */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                      <span className={`text-xs text-slate-500 font-medium uppercase tracking-wider ${isSlide ? 'text-[10px]' : ''}`}>Total</span>
                      <span className={`${isSlide ? 'text-sm' : 'text-lg'} font-bold text-slate-200`}>{formatCompact(totalInflow + totalOutflow + totalInvested)}</span>
                  </div>
              </div>
          </div>
      </div>

      {/* 3. TENDÊNCIA FINANCEIRA (LARGURA TOTAL) */}
      <div className={`bg-slate-900/40 rounded-xl ${isSlide ? 'p-3' : 'p-6'} border border-slate-800/60 flex flex-col ${isSlide ? 'h-[250px]' : 'h-[320px]'} shrink-0`}>
          <div className="flex justify-between items-center mb-4">
              <h3 className={`text-slate-100 font-medium ${isSlide ? 'text-sm' : 'text-lg'} flex items-center gap-2`}>
                  <Activity className="w-5 h-5 text-slate-400" /> Tendência Financeira
              </h3>
              <div className="flex gap-4 text-xs font-medium">
                  <span className="flex items-center gap-1.5 text-emerald-500"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Entradas</span>
                  <span className="flex items-center gap-1.5 text-rose-500"><div className="w-2 h-2 rounded-full bg-rose-500"></div> Saídas</span>
                  <span className="flex items-center gap-1.5 text-slate-300"><div className="w-2 h-2 rounded-full bg-slate-300"></div> Saldo Acumulado</span>
              </div>
          </div>
          <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                   <ComposedChart data={trendData} margin={{top: 10, right: 10, left: 0, bottom: 0}}>
                       <defs>
                           <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor={COLORS.lineRec} stopOpacity={0.3}/>
                               <stop offset="95%" stopColor={COLORS.lineRec} stopOpacity={0}/>
                           </linearGradient>
                           <linearGradient id="colorPay" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor={COLORS.linePay} stopOpacity={0.3}/>
                               <stop offset="95%" stopColor={COLORS.linePay} stopOpacity={0}/>
                           </linearGradient>
                       </defs>
                       <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" opacity={0.3} />
                       <XAxis dataKey="date" tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b'}} tickLine={false} axisLine={false} dy={10} />
                       <YAxis yAxisId="left" tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b'}} tickFormatter={(v) => formatCompact(v)} axisLine={false} tickLine={false} width={40} />
                       <YAxis yAxisId="right" orientation="right" tick={{fontSize: isSlide ? 8 : 10, fill: '#64748b'}} tickFormatter={(v) => formatCompact(v)} axisLine={false} tickLine={false} width={40} />
                       <Tooltip 
                           contentStyle={{backgroundColor: '#0f172a', borderRadius: '8px', border: '1px solid #1e293b', color: '#f8fafc', fontSize: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} 
                           formatter={(value: number) => formatCurrency(value)}
                       />
                       <Area yAxisId="left" type="monotone" dataKey="Entradas" stroke={COLORS.lineRec} fillOpacity={1} fill="url(#colorRec)" strokeWidth={2} activeDot={{r: 4, strokeWidth: 0}} />
                       <Area yAxisId="left" type="monotone" dataKey="Saídas" stroke={COLORS.linePay} fillOpacity={1} fill="url(#colorPay)" strokeWidth={2} activeDot={{r: 4, strokeWidth: 0}} />
                       <Line yAxisId="right" type="monotone" dataKey="SaldoAcumulado" stroke={COLORS.lineBal} strokeWidth={2.5} dot={false} activeDot={{r: 5, strokeWidth: 0}} />
                   </ComposedChart>
              </ResponsiveContainer>
          </div>
      </div>

      {/* ── ANÁLISE SÊNIOR INTEGRADO (IA) ── */}
      {!isSlide && onGenerateAI && (
        <div className="bg-slate-800/60 rounded-xl border border-indigo-900/40 p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-600/20 rounded-lg">
                <BrainCircuit className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-200">Analista Sênior Integrado (IA)</h3>
                <p className="text-[10px] text-slate-400">Análise executiva do fluxo de caixa</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {aiAnalysis && (
                <button onClick={() => setShowAI(!showAI)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs text-slate-300 flex items-center gap-1 transition-all">
                  {showAI ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                  {showAI ? 'Recolher' : 'Ver Análise'}
                </button>
              )}
              <button onClick={onGenerateAI} disabled={isGeneratingAI} className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-bold transition-all shadow-md shadow-indigo-500/20 flex items-center gap-2 text-xs text-white">
                {isGeneratingAI ? <RefreshCw className="animate-spin w-3 h-3"/> : <Lightbulb className="w-3 h-3" />}
                {isGeneratingAI ? 'Gerando...' : aiAnalysis ? 'Atualizar' : 'Gerar Análise'}
              </button>
            </div>
          </div>

          {aiAnalysis && showAI && (
            <div className="space-y-3 mt-3 border-t border-slate-700/50 pt-3">
              {/* Sentimento */}
              {'sentiment' in aiAnalysis && (
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                  aiAnalysis.sentiment === 'positive' ? 'bg-emerald-900/30 text-emerald-400' :
                  aiAnalysis.sentiment === 'negative' ? 'bg-red-900/30 text-red-400' :
                  aiAnalysis.sentiment === 'critical' ? 'bg-red-900/50 text-red-300' :
                  'bg-slate-700/50 text-slate-300'
                }`}>
                  {aiAnalysis.sentiment === 'positive' ? <CheckCircle2 className="w-3 h-3"/> : <AlertTriangle className="w-3 h-3"/>}
                  {aiAnalysis.sentiment === 'positive' ? 'Cenário Positivo' :
                   aiAnalysis.sentiment === 'negative' ? 'Cenário Negativo' :
                   aiAnalysis.sentiment === 'critical' ? 'Cenário Crítico' : 'Cenário Neutro'}
                </div>
              )}

              {/* Resumo */}
              <div className="bg-slate-900/50 rounded-lg p-3">
                <h4 className="text-xs font-bold text-indigo-400 uppercase mb-1">Resumo Executivo</h4>
                <p className="text-xs text-slate-300 leading-relaxed">{aiAnalysis.summary}</p>
              </div>

              {/* Riscos e Oportunidades */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-red-900/10 rounded-lg p-3 border border-red-900/20">
                  <h4 className="text-xs font-bold text-red-400 uppercase mb-1">Riscos</h4>
                  <ul className="space-y-1">
                    {aiAnalysis.risks.map((r, i) => (
                      <li key={i} className="text-[11px] text-slate-300 flex items-start gap-1">
                        <span className="text-red-500 mt-0.5">•</span> {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="bg-emerald-900/10 rounded-lg p-3 border border-emerald-900/20">
                  <h4 className="text-xs font-bold text-emerald-400 uppercase mb-1">Oportunidades</h4>
                  <ul className="space-y-1">
                    {aiAnalysis.opportunities.map((o, i) => (
                      <li key={i} className="text-[11px] text-slate-300 flex items-start gap-1">
                        <span className="text-emerald-500 mt-0.5">•</span> {o}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Projeção e Itens de Ação (campos ricos do ExecutiveAnalysis) */}
              {'cashProjection' in aiAnalysis && aiAnalysis.cashProjection && (
                <div className="bg-blue-900/10 rounded-lg p-3 border border-blue-900/20">
                  <h4 className="text-xs font-bold text-blue-400 uppercase mb-1">Projeção de Caixa (30 dias)</h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">{aiAnalysis.cashProjection}</p>
                </div>
              )}

              {'actionItems' in aiAnalysis && aiAnalysis.actionItems?.length > 0 && (
                <div className="bg-amber-900/10 rounded-lg p-3 border border-amber-900/20">
                  <h4 className="text-xs font-bold text-amber-400 uppercase mb-1">Ações Prioritárias</h4>
                  <div className="space-y-1.5">
                    {aiAnalysis.actionItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          item.priority === 'alta' ? 'bg-red-900/30 text-red-400' :
                          item.priority === 'média' ? 'bg-amber-900/30 text-amber-400' :
                          'bg-slate-700/30 text-slate-400'
                        }`}>{item.priority}</span>
                        <span className="text-slate-300">{item.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-[9px] text-slate-500 text-right">Última atualização: {aiAnalysis.lastUpdated}</p>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
};