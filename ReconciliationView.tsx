import React, { useMemo } from 'react';
import { FinancialSummary, Transaction, TransactionType } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrency, parseDate } from '../utils/finance';

interface ResumoExecutivoSlideProps {
  summary: FinancialSummary;
  transactions: Transaction[];
  dateRange: string;
}

export const ResumoExecutivoSlide: React.FC<ResumoExecutivoSlideProps> = ({
  summary,
  transactions,
  dateRange
}) => {
  // formatCurrency importado de utils/finance.ts

  const formatShortCurrency = (val: number) => {
    if (Math.abs(val) >= 1000000) {
      return (val / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M';
    }
    if (Math.abs(val) >= 1000) {
      return (val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
    }
    return val.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  };

  const chartData = useMemo(() => {
    const dailyData: Record<string, { date: string; inflow: number; outflow: number }> = {};
    
    transactions.forEach(t => {
      if (t.status === 'CANCELADO') return;
      
      const dateStr = t.date;
      if (!dailyData[dateStr]) {
        dailyData[dateStr] = { date: dateStr, inflow: 0, outflow: 0 };
      }
      
      if (t.type === TransactionType.RECEIVABLE) {
        dailyData[dateStr].inflow += t.value;
      } else if (t.type === TransactionType.PAYABLE) {
        dailyData[dateStr].outflow += t.value;
      }
    });

    return Object.values(dailyData)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14); // Last 14 days for a clean chart
  }, [transactions]);

  const coverageRatio = summary.totalOutflow > 0 
    ? (summary.totalInflow / summary.totalOutflow) * 100 
    : 0;

  const netBalance = summary.totalInflow - summary.totalOutflow;

  return (
    <div 
      className="ppt-slide"
      style={{
        width: '960px',
        height: '540px',
        backgroundColor: '#0b1b2b',
        color: '#f1f5f9',
        fontFamily: 'sans-serif',
        position: 'relative',
        boxSizing: 'border-box',
        padding: '38px 48px',
        overflow: 'hidden',
        pageBreakAfter: 'always'
      }}
    >
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
            Rede Gazeta
          </div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#f1f5f9', textTransform: 'uppercase' }}>
            Resumo Financeiro
          </div>
        </div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', paddingBottom: '4px' }}>
            {dateRange}
        </div>
      </div>

      {/* DIVIDER */}
      <div style={{ height: '1px', backgroundColor: 'rgba(255, 255, 255, 0.1)', marginBottom: '24px' }}></div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
        {/* KPI 1: Saldo Líquido */}
        <div style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(51, 65, 85, 0.6)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Saldo Líquido</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: netBalance >= 0 ? '#34d399' : '#fb7185' }}>
            <span style={{ fontSize: '11px', color: netBalance >= 0 ? '#047857' : '#be123c', marginRight: '4px', fontWeight: 600 }}>R$</span>
            {formatCurrency(netBalance)}
          </div>
        </div>

        {/* KPI 2: Entradas Totais */}
        <div style={{ flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)', border: '1px solid rgba(30, 41, 59, 0.6)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Entradas Totais</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#34d399' }}>
            <span style={{ fontSize: '11px', color: '#047857', marginRight: '4px', fontWeight: 600 }}>R$</span>
            {formatCurrency(summary.totalInflow)}
          </div>
        </div>

        {/* KPI 3: Saídas Totais */}
        <div style={{ flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)', border: '1px solid rgba(30, 41, 59, 0.6)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Saídas Totais</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: '#fb7185' }}>
            <span style={{ fontSize: '11px', color: '#be123c', marginRight: '4px', fontWeight: 600 }}>R$</span>
            {formatCurrency(summary.totalOutflow)}
          </div>
        </div>

        {/* KPI 4: Índice Cobertura */}
        <div style={{ flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.6)', border: '1px solid rgba(30, 41, 59, 0.6)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Índice de Cobertura</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: coverageRatio >= 100 ? '#34d399' : '#fb7185' }}>
            {coverageRatio.toFixed(1)}<span style={{ fontSize: '12px', marginLeft: '2px', fontWeight: 600 }}>%</span>
          </div>
        </div>
      </div>

      {/* CHART */}
      <div style={{ height: '280px', width: '100%', backgroundColor: 'rgba(2, 6, 23, 0.4)', border: '1px solid rgba(30, 41, 59, 0.4)', borderRadius: '8px', padding: '16px', boxSizing: 'border-box' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#64748b" 
              fontSize={10} 
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickFormatter={(val) => {
                const parts = val.split('-');
                return parts.length === 3 ? `${parts[2]}/${parts[1]}` : val;
              }}
            />
            <YAxis 
              stroke="#64748b" 
              fontSize={10} 
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => formatShortCurrency(val)}
            />
            <Tooltip 
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '12px' }}
              itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              formatter={(value: number) => [`R$ ${formatCurrency(value)}`, '']}
              labelFormatter={(label) => `Data: ${label}`}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} iconType="circle" iconSize={8} />
            <Bar dataKey="inflow" name="Entradas" fill="#34d399" radius={[2, 2, 0, 0]} maxBarSize={40} />
            <Bar dataKey="outflow" name="Saídas" fill="#fb7185" radius={[2, 2, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
