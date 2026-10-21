import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';
import { Transaction, TransactionType } from '../types';

// Donut de risco (anel fino, % centralizado)
const RiskDonut: React.FC<{ pct: number; color: string; caption?: string }> = ({ pct, color, caption }) => {
  const p = Math.max(0, Math.min(100, pct));
  const data = [{ value: p }, { value: 100 - p }];
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="68%" outerRadius="90%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            <Cell fill={color} />
            <Cell fill="#46586c" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl font-bold" style={{ color }}>{p.toFixed(0)}%</span>
        {caption && <span className="text-[11px] text-slate-400 mt-0.5 px-2 text-center">{caption}</span>}
      </div>
    </div>
  );
};

const LiquidityBars: React.FC<{ entradas: number; saidas: number; resultado: number }> = ({ entradas, saidas, resultado }) => {
  const data = [
    { name: 'Entradas',  v: entradas,  c: '#34d399' },
    { name: 'Saídas',    v: saidas,    c: '#fb7185' },
    { name: 'Resultado', v: resultado, c: resultado >= 0 ? '#38bdf8' : '#fbbf24' },
  ];
  const fmt = (v: number) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis hide domain={[0, 'dataMax']} />
        <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => <Cell key={i} fill={d.c} />)}
          <LabelList dataKey="v" position="top" formatter={fmt} style={{ fill: '#cbd5e1', fontSize: 10, fontWeight: 700 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

interface Props {
  transactions: Transaction[];
}

/**
 * Tela "Pontos Críticos & Alocação" (Análise de Risco) — antes era uma página do
 * Demonstrativo Executivo; agora vive como tela própria do sistema.
 */
export const RiskAllocationView: React.FC<Props> = ({ transactions }) => {
  const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
  const receivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
  const totalOut = payables.reduce((s, t) => s + (Number(t.value) || 0), 0);
  const totalIn = receivables.reduce((s, t) => s + (Number(t.value) || 0), 0);

  const recByDate: Record<string, number> = {};
  receivables.forEach(t => { recByDate[t.date] = (recByDate[t.date] || 0) + (Number(t.value) || 0); });
  const topRecDate = Object.entries(recByDate).sort((a, b) => b[1] - a[1])[0];
  const recConcentration = topRecDate && totalIn > 0 ? (topRecDate[1] / totalIn * 100) : 0;

  const pessoal = payables.filter(t => (t.flowTypeLevel2 || '').trim() === '201' || (t.category || '').toUpperCase().includes('PESSOAL'));
  const pessoalVal = pessoal.reduce((s, t) => s + (Number(t.value) || 0), 0);
  const pessoalPct = totalOut > 0 ? (pessoalVal / totalOut * 100) : 0;

  const impostos = payables.filter(t => ['209', '215'].includes((t.flowTypeLevel2 || '').trim()) || (t.category || '').toUpperCase().includes('TRIBUT') || (t.category || '').toUpperCase().includes('IMPOSTO'));
  const impVal = impostos.reduce((s, t) => s + (Number(t.value) || 0), 0);
  const impPct = totalOut > 0 ? (impVal / totalOut * 100) : 0;

  const investimentos = transactions.filter(t => t.type === TransactionType.APPLICATION);
  const invVal = investimentos.reduce((s, t) => s + (Number(t.value) || 0), 0);

  const fmtK = (v: number) => `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  const fmtPct = (v: number) => `${v.toFixed(0)}%`;

  const cards = [
    {
      icon: '⏱', color: 'text-amber-400 bg-amber-500/10',
      title: 'Concentração de Recebimento',
      text: topRecDate ? `${fmtPct(recConcentration)} (${fmtK(topRecDate[1])}) dos recebimentos estão previstos para o dia ${topRecDate[0]}.` : 'Sem dados de recebimentos.',
      chart: <RiskDonut pct={recConcentration} color="#fbbf24" caption={topRecDate ? `concentrado em ${topRecDate[0]}` : 'do total recebido'} />,
    },
    {
      icon: '👥', color: 'text-sky-400 bg-sky-500/10',
      title: 'Despesas de Pessoal',
      text: totalOut > 0 ? `${fmtPct(pessoalPct)} (${fmtK(pessoalVal)}) do total de saídas está comprometido com Folha e Benefícios.` : 'Sem dados de saídas.',
      chart: <RiskDonut pct={pessoalPct} color="#38bdf8" caption="do total de saídas" />,
    },
    {
      icon: '🏛', color: 'text-blue-400 bg-blue-500/10',
      title: 'Impacto Tributário',
      text: totalOut > 0 ? `${fmtPct(impPct)} (${fmtK(impVal)}) referentes a impostos e contribuições no período. Federais antecipam, estaduais/municipais postergam.` : 'Sem dados de impostos.',
      chart: <RiskDonut pct={impPct} color="#60a5fa" caption="do total de saídas" />,
    },
    {
      icon: '🛡', color: 'text-emerald-400 bg-emerald-500/10',
      title: 'Estratégia de Liquidez',
      text: invVal > 0 ? `Aplicações/Resgates de investimentos no período: ${fmtK(invVal)}. Geração líquida de caixa: ${fmtK(totalIn - totalOut)}.` : `Geração líquida de caixa prevista: ${fmtK(totalIn - totalOut)}. Sem movimentação de investimentos.`,
      chart: <LiquidityBars entradas={totalIn} saidas={totalOut} resultado={totalIn - totalOut} />,
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {cards.map((c, i) => (
        <div key={i} className="bg-[#111827] rounded-xl border border-slate-700/50 p-5 flex flex-col gap-3 h-[320px]">
          <div className="flex gap-4 items-start shrink-0">
            <div className={`text-2xl p-3 rounded-lg ${c.color}`}>{c.icon}</div>
            <div>
              <h4 className="text-base font-bold text-slate-100 mb-1">{c.title}</h4>
              <p className="text-sm text-slate-400 leading-relaxed">{c.text}</p>
            </div>
          </div>
          <div className="flex-1 min-h-0">{c.chart}</div>
        </div>
      ))}
    </div>
  );
};

export default RiskAllocationView;
