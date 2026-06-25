import React, { useMemo } from 'react';
import { FinancialSummary, Transaction, TransactionType, DashboardViewType } from '../types';
import { ResumoFinanceiro } from './ResumoFinanceiro';
import { Dashboard } from './Dashboard';
import { VisaoEstrategicaRealizado } from './VisaoEstrategicaRealizado';
import { formatCurrency, parseDate } from '../utils/finance';

interface PPTExportAlternativeProps {
  summary: FinancialSummary;
  transactions: Transaction[];
  realizedTransactions?: Transaction[];
  dateRange: string;
  initialBalance: number;
  operatingResult: number;
  cashFlowImpact: number;
  netPeriodResult: number;
  boardSummary: string;
  aiAnalysis?: any;
  isGeneratingAI?: boolean;
  onGenerateAI?: () => void;
}

const slideStyle: React.CSSProperties = {
  width: "960px",
  height: "540px",
  padding: "46px 56px 50px 56px",
  boxSizing: "border-box",
  background: "#0b1b2b",
  position: "relative",
  overflow: 'hidden',
  pageBreakAfter: 'always',
  fontFamily: 'sans-serif',
  color: '#f1f5f9'
};

const contentWrapperStyle: React.CSSProperties = {
  transform: "scale(0.58)",
  transformOrigin: "top center",
  fontSize: "0.80em",
  width: "1210px",
  position: "absolute",
  top: "98px",
  left: "50%",
  marginLeft: "-605px"
};

const headerStyle: React.CSSProperties = {
  position: 'absolute',
  top: '38px',
  left: '56px',
  right: '56px',
  height: '42px',
  borderBottom: 'none',
  zIndex: 10
};

const SlideShell: React.FC<{ title: string, children: React.ReactNode, dateRange?: string }> = ({ title, children, dateRange }) => (
    <div className="ppt-slide" style={slideStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ fontSize: '9px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' }}>
          Rede Gazeta
        </div>
        <div style={{ fontSize: '16.2px', fontWeight: 600, color: '#f1f5f9', textTransform: 'uppercase', marginTop: '4px' }}>
          {title}
        </div>
        <div style={{ position: 'absolute', right: 0, top: '12px', fontSize: '12px', fontWeight: 'bold', color: '#cbd5e1', textTransform: 'uppercase' }}>
          {dateRange}
        </div>
      </div>

      {/* Content */}
      <div style={contentWrapperStyle}>
          {children}
      </div>
    </div>
);

export const PPTExportAlternative: React.FC<PPTExportAlternativeProps> = ({
  summary,
  transactions,
  realizedTransactions = [],
  dateRange,
  initialBalance,
  operatingResult,
  cashFlowImpact,
  netPeriodResult,
  boardSummary,
  aiAnalysis = null,
  isGeneratingAI = false,
  onGenerateAI = () => {}
}) => {
  // formatCurrency importado de utils/finance.ts

  const plannedTransactions = useMemo(() => {
    return transactions.filter(t => t.type === TransactionType.PAYABLE && t.status !== 'CANCELADO');
  }, [transactions]);

  return (
    <div id="ppt-export-root" style={{ position: 'absolute', left: '-9999px', top: 0, width: '960px' }}>
      
      {/* SLIDE 1: DEMONSTRATIVO FINANCEIRO CONSOLIDADO */}
      <SlideShell title="Demonstrativo Financeiro Consolidado" dateRange={dateRange}>
        {/* CORPO DO DEMONSTRATIVO */}
        <div style={{ position: 'relative', width: '1210px', height: '528px' }}>
            
            {/* KPIs PRINCIPAIS */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '1210px', height: '99px' }}>
                {/* 01 SALDO INICIAL */}
                <div style={{ position: 'absolute', left: '0px', top: 0, width: '280px', height: '99px', border: '1px solid rgba(30, 41, 59, 0.6)', backgroundColor: 'rgba(2, 6, 23, 0.6)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>Saldo Inicial</div>
                    <div style={{ fontSize: '27.6px', fontWeight: 600, color: '#f1f5f9' }}><span style={{ fontSize: '14.7px', color: '#64748b' }}>R$</span> {formatCurrency(initialBalance)}</div>
                </div>
                {/* 02 RECEBIMENTOS */}
                <div style={{ position: 'absolute', left: '310px', top: 0, width: '280px', height: '99px', border: '1px solid rgba(30, 41, 59, 0.6)', backgroundColor: 'rgba(2, 6, 23, 0.6)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>(+) Recebimentos</div>
                    <div style={{ fontSize: '27.6px', fontWeight: 600, color: '#34d399' }}><span style={{ fontSize: '14.7px', color: '#047857' }}>R$</span> {formatCurrency(summary.totalInflow)}</div>
                </div>
                {/* 03 PAGAMENTOS */}
                <div style={{ position: 'absolute', left: '620px', top: 0, width: '280px', height: '99px', border: '1px solid rgba(30, 41, 59, 0.6)', backgroundColor: 'rgba(2, 6, 23, 0.6)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>(-) Pagamentos</div>
                    <div style={{ fontSize: '27.6px', fontWeight: 600, color: '#fb7185' }}><span style={{ fontSize: '14.7px', color: '#be123c' }}>R$</span> {formatCurrency(summary.totalOutflow)}</div>
                </div>
                {/* 04 RESULTADO */}
                <div style={{ position: 'absolute', left: '930px', top: 0, width: '280px', height: '99px', border: '1px solid rgba(51, 65, 85, 0.6)', backgroundColor: 'rgba(15, 23, 42, 0.6)', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '12px', color: '#cbd5e1', textTransform: 'uppercase', marginBottom: '8px' }}>(=) Resultado Operacional</div>
                    <div style={{ fontSize: '27.6px', fontWeight: 600, color: operatingResult >= 0 ? '#34d399' : '#fb7185' }}><span style={{ fontSize: '14.7px', color: operatingResult >= 0 ? '#047857' : '#be123c' }}>R$</span> {formatCurrency(operatingResult)}</div>
                </div>
            </div>

            {/* INVESTIMENTOS E SALDO FINAL */}
            <div style={{ position: 'absolute', top: '140px', left: 0, width: '590px', height: '380px' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '590px', height: '160px', border: '1px solid #1e293b', backgroundColor: '#020617', borderRadius: '8px', padding: '25px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '14px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '15px' }}>(+/-) Movimentação Líquida de Investimentos</div>
                    <div style={{ fontSize: '40px', fontWeight: 'bold', color: cashFlowImpact >= 0 ? '#34d399' : '#fb7185' }}><span style={{ fontSize: '20px', color: cashFlowImpact >= 0 ? '#047857' : '#be123c' }}>R$</span> {cashFlowImpact < 0 ? `(${formatCurrency(Math.abs(cashFlowImpact))})` : formatCurrency(cashFlowImpact)}</div>
                </div>
                <div style={{ position: 'absolute', top: '180px', left: 0, width: '590px', height: '160px', border: '1px solid #3b82f6', backgroundColor: '#1e3a8a', borderRadius: '8px', padding: '25px', boxSizing: 'border-box' }}>
                    <div style={{ fontSize: '16px', color: '#bfdbfe', textTransform: 'uppercase', marginBottom: '15px' }}>Saldo Final Consolidado</div>
                    <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#ffffff' }}><span style={{ fontSize: '24px', color: '#93c5fd' }}>R$</span> {formatCurrency(netPeriodResult)}</div>
                </div>
            </div>

            {/* RESUMO EXECUTIVO */}
            <div style={{ position: 'absolute', top: '140px', left: '620px', width: '590px', height: '340px', border: '1px solid #1e293b', backgroundColor: '#020617', borderRadius: '8px', padding: '25px', boxSizing: 'border-box' }}>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f1f5f9', marginBottom: '15px' }}>Resumo Executivo</div>
                <div style={{ fontSize: '14px', color: '#94a3b8', lineHeight: '1.6', textAlign: 'justify' }}>
                    {boardSummary}
                </div>
            </div>
        </div>
      </SlideShell>

      {/* SLIDE 2: RESUMO FINANCEIRO */}
      <SlideShell title="Resumo Financeiro" dateRange={dateRange}>
        <div style={{ width: '1210px', height: '528px', boxSizing: 'border-box' }}>
            <ResumoFinanceiro summary={summary} transactions={transactions} isSlide={true} />
        </div>
      </SlideShell>

      {/* SLIDE 3: DFC */}
      <SlideShell title="Fluxo de Caixa (DFC)" dateRange={dateRange}>
        <div style={{ width: '1210px', height: '528px', boxSizing: 'border-box' }}>
            <Dashboard 
                transactions={transactions} 
                realizedTransactions={realizedTransactions}
                summary={summary}
                viewType={DashboardViewType.BASE_DFC}
                aiAnalysis={aiAnalysis}
                isGeneratingAI={isGeneratingAI}
                onGenerateAI={onGenerateAI}
                isSlide={true}
            />
        </div>
      </SlideShell>

      {/* SLIDE 4: PAGAMENTOS */}
      <SlideShell title="Contas a Pagar" dateRange={dateRange}>
        <div style={{ width: '1210px', height: '528px', boxSizing: 'border-box' }}>
            <Dashboard 
                transactions={transactions} 
                realizedTransactions={realizedTransactions}
                summary={summary}
                viewType={DashboardViewType.PAYABLES}
                aiAnalysis={aiAnalysis}
                isGeneratingAI={isGeneratingAI}
                onGenerateAI={onGenerateAI}
                isSlide={true}
            />
        </div>
      </SlideShell>

      {/* SLIDE 5: RECEBIMENTOS */}
      <SlideShell title="Contas a Receber" dateRange={dateRange}>
        <div style={{ width: '1210px', height: '528px', boxSizing: 'border-box' }}>
            <Dashboard 
                transactions={transactions} 
                realizedTransactions={realizedTransactions}
                summary={summary}
                viewType={DashboardViewType.RECEIVABLES}
                aiAnalysis={aiAnalysis}
                isGeneratingAI={isGeneratingAI}
                onGenerateAI={onGenerateAI}
                isSlide={true}
            />
        </div>
      </SlideShell>

      {/* SLIDE 6: ANÁLISE PREVISTO VS REALIZADO */}
      <SlideShell title="Análise Previsto vs Realizado" dateRange={dateRange}>
        <div style={{ width: '1210px', height: '528px', boxSizing: 'border-box' }}>
            <VisaoEstrategicaRealizado 
                planned={plannedTransactions} 
                realized={realizedTransactions} 
                isSlide={true}
            />
        </div>
      </SlideShell>

    </div>
  );
};
