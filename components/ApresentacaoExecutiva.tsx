import React, { useMemo, useState, useEffect } from 'react';
import { FinancialSummary, Transaction, AIAnalysisResult, TransactionType, DashboardViewType } from '../types';
import { X, Printer, FileDown, Lock, Edit2, RefreshCw, Trash2, Check, Presentation, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ResumoFinanceiro } from './ResumoFinanceiro';
import { Dashboard } from './Dashboard';
import { VisaoEstrategicaRealizado } from './VisaoEstrategicaRealizado';
import pptxgen from "pptxgenjs";
import html2canvas from "html2canvas";
import { PPTExportAlternative } from './PPTExportAlternative';
import { generatePayablesSlide, generateReceivablesSlide } from '../services/pptxNativeSlides';
import { drawPayablesPage, drawReceivablesPage } from '../services/pdfNativeSlides';
import { formatCurrency, parseDate, COMPANIES } from '../utils/finance';

// ── Gráficos dos quadros de Pontos Críticos ──────────────────────────────────
const RiskDonut: React.FC<{ pct: number; color: string; caption?: string }> = ({ pct, color, caption }) => {
  const p = Math.max(0, Math.min(100, pct));
  const data = [{ value: p }, { value: 100 - p }];
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius="64%" outerRadius="88%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            <Cell fill={color} />
            <Cell fill="#1f2937" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-3xl font-bold" style={{ color }}>{p.toFixed(0)}%</span>
        {caption && <span className="text-[10px] text-slate-500 mt-0.5 px-2 text-center">{caption}</span>}
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
import { IC_TV, IC_INTERNET, IC_RADIO, IC_EVENTOS, IC_DESPESAS } from '../services/coverIcons';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList, LineChart, Line, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';

interface ApresentacaoExecutivaProps {
  summary: FinancialSummary;
  transactions: Transaction[];
  aiAnalysis?: AIAnalysisResult | null;
  isGeneratingAI?: boolean;
  onGenerateAI?: () => void;
  dfcManualValues?: Record<string, number>;
  onManualValueChange?: (key: string, value: number) => void;
  initialBalance: number;
  totalManualResgates: number;
  totalManualAplicacoes: number;
  applicationSnapshots?: import('../hooks/useApplicationSnapshots').ApplicationSnapshot[];
  onExit: () => void;
}

export const ApresentacaoExecutiva: React.FC<ApresentacaoExecutivaProps> = ({ 
  summary, 
  transactions, 
  aiAnalysis = null,
  isGeneratingAI = false,
  onGenerateAI = () => {},
  dfcManualValues = {},
  onManualValueChange = () => {},
  initialBalance, 
  totalManualResgates, 
  totalManualAplicacoes,
  applicationSnapshots = [],
  onExit 
}) => {

  // --- LÓGICA PRESERVADA & AJUSTADA ---
  const operatingResult = summary.totalInflow - summary.totalOutflow;
  const companyName = 'REDE GAZETA';
  const netInvestmentMovement = totalManualAplicacoes - totalManualResgates;
  const cashFlowImpact = totalManualResgates - totalManualAplicacoes;
  const netPeriodResult = initialBalance + operatingResult - netInvestmentMovement;

  const plannedTransactions = useMemo(() => {
    return transactions.filter(t => t.status === 'PREVISTO');
  }, [transactions]);

  const realizedTransactions = useMemo(() => {
      return transactions.filter(t => t.status === 'REALIZADO');
  }, [transactions]);

  // Maior fornecedor e maior cliente individual do período — não por
  // categoria, por NOME específico — pra dar uma leitura mais humana e
  // acionável do que só "os recebimentos cobriram X% dos pagamentos".
  const { topSupplier, topCustomer } = useMemo(() => {
      const bySupplier: Record<string, number> = {};
      transactions.forEach(t => {
          if (t.type !== TransactionType.PAYABLE || t.status !== 'PREVISTO') return;
          const name = (t.supplier || t.description || 'Desconhecido').trim();
          bySupplier[name] = (bySupplier[name] || 0) + (Number(t.value) || 0);
      });
      const byCustomer: Record<string, number> = {};
      transactions.forEach(t => {
          if (t.type !== TransactionType.RECEIVABLE) return;
          const name = (t.customer || t.description || 'Desconhecido').trim();
          byCustomer[name] = (byCustomer[name] || 0) + (Number(t.value) || 0);
      });
      const topEntry = (obj: Record<string, number>) => {
          const entries = Object.entries(obj).filter(([, v]) => v > 0);
          if (entries.length === 0) return null;
          const [name, value] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
          return { name, value };
      };
      return {
          topSupplier: topEntry(bySupplier),
          topCustomer: topEntry(byCustomer),
      };
  }, [transactions]);

  const totalPlanned = summary.totalOutflow;
  const totalRealized = summary.totalRealizedOutflow || 0;

  const deviation = totalRealized - totalPlanned;

  const deviationPercent = totalPlanned !== 0
    ? (deviation / totalPlanned) * 100
    : 0;

  // --- CÁLCULO DE DATAS (PRESERVADO) ---
  const dateRange = useMemo(() => {
    if (transactions.length === 0) return 'Período não identificado';
    
    const parseDate = (d: string) => {
        if (!d) return 0;
        const parts = d.split('/');
        if(parts.length === 3) return new Date(Number(parts[2]), Number(parts[1])-1, Number(parts[0])).getTime();
        if(parts.length === 2) return new Date(new Date().getFullYear(), Number(parts[1])-1, Number(parts[0])).getTime();
        return 0;
    };

    const timestamps = transactions
        .filter(t => t.type === TransactionType.PAYABLE || t.type === TransactionType.RECEIVABLE)
        .map(t => parseDate(t.date)).filter(ts => ts > 0);
    if (timestamps.length === 0) return 'DATA N/D';

    const minDate = new Date(Math.min(...timestamps));
    const maxDate = new Date(Math.max(...timestamps));

    return `${minDate.toLocaleDateString('pt-BR')} A ${maxDate.toLocaleDateString('pt-BR')}`;
  }, [transactions]);

  // formatCurrency importado de utils/finance.ts

  // --- Capa dinâmica: período separado + valores formatados ---
  // Início do período rola para o 1º dia útil: se cair em sábado/domingo (ou feriado, futuro),
  // avança para o próximo dia útil. Ex.: 31/05 (sáb) -> 01/06 (seg).
  const isHoliday = (_d: Date): boolean => false; // TODO: plugar lista de feriados (nacionais/ES)
  const rollToBusinessDay = (br: string): string => {
    const m = (br || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return br;
    const d = new Date(+m[3], +m[2] - 1, +m[1]);
    while (d.getDay() === 0 || d.getDay() === 6 || isHoliday(d)) {
      d.setDate(d.getDate() + 1);
    }
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  };
  const [coverIniRaw, coverFim] = dateRange.includes(' A ')
    ? dateRange.split(' A ').map(s => s.trim())
    : [dateRange, ''];
  const coverIni = coverFim ? rollToBusinessDay(coverIniRaw) : coverIniRaw;
  const coverNetFlow = summary.totalInflow - summary.totalOutflow - (totalManualAplicacoes || 0) + (totalManualResgates || 0);
  const fmtMi = (v: number): string => {
    const a = Math.abs(v);
    if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mi';
    if (a >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' mil';
    return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const [boardSummary, setBoardSummary] = useState('');
  const [isEditingSummary, setIsEditingSummary] = useState(false);

  const generateAutoSummary = () => {
      const coberturaPct = summary.totalOutflow > 0 ? (summary.totalInflow / summary.totalOutflow) * 100 : 0;
      const resultadoTexto = operatingResult >= 0
          ? `resultado operacional positivo de ${formatCurrency(operatingResult)}, indicando que os recebimentos do período cobriram integralmente as saídas`
          : `resultado operacional negativo de ${formatCurrency(Math.abs(operatingResult))}, com os recebimentos cobrindo ${coberturaPct.toFixed(0)}% dos pagamentos — a diferença foi suportada pelo saldo em caixa`;

      // Concentração no maior fornecedor: se ele sozinho responde por uma fatia
      // grande das saídas, vale um alerta específico e acionável — não só o
      // percentual genérico de cobertura.
      const supplierSharePct = topSupplier && summary.totalOutflow > 0 ? (topSupplier.value / summary.totalOutflow) * 100 : 0;
      const concentracaoTexto = (topSupplier && supplierSharePct >= 15)
          ? ` Chama atenção a concentração em ${topSupplier.name} (${supplierSharePct.toFixed(1)}% das saídas) — recomenda-se negociar prazo ou parcelamento com esse fornecedor específico, já que ele sozinho pressiona o caixa do período.`
          : (topSupplier ? ` O maior fornecedor do período foi ${topSupplier.name}, com ${formatCurrency(topSupplier.value)} (${supplierSharePct.toFixed(1)}% das saídas).` : '');

      const aplicacaoTexto = (totalManualAplicacoes > 0 || totalManualResgates > 0)
          ? `As aplicações financeiras tiveram efeito líquido de ${formatCurrency(cashFlowImpact)} sobre o caixa (${formatCurrency(totalManualAplicacoes)} aplicados e ${formatCurrency(totalManualResgates)} resgatados).`
          : `A posição em aplicações segue em ${formatCurrency(summary.totalInvested)}, funcionando como colchão de segurança caso o caixa operacional continue negativo.`;

      const fechamentoTexto = netPeriodResult >= initialBalance
          ? `A posição consolidada avançou de ${formatCurrency(initialBalance)} para ${formatCurrency(netPeriodResult)}, uma evolução favorável no período.`
          : `A posição consolidada recuou de ${formatCurrency(initialBalance)} para ${formatCurrency(netPeriodResult)}. Recomenda-se acompanhar a tendência nos próximos períodos e avaliar a necessidade de reforço de caixa.`;

      const text = `No período de ${dateRange}, a Rede Gazeta apresentou ${resultadoTexto}.${concentracaoTexto} ${aplicacaoTexto} ${fechamentoTexto}`;
      setBoardSummary(text);
  };

  useEffect(() => {
      if (!boardSummary) {
          generateAutoSummary();
      }
  }, [dateRange, initialBalance, summary, operatingResult, cashFlowImpact, netPeriodResult]);

  // --- FUNÇÃO DE EXPORTAÇÃO PPT ---
  const handleExportPPT = async () => {
    const pres = new pptxgen();
    pres.defineLayout({ name:'GAZETA_STANDARD', width: 10, height: 5.625 });
    pres.layout = 'GAZETA_STANDARD';

    const slides = document.querySelectorAll('.pdf-export-page');
    
    for (let i = 0; i < slides.length; i++) {
        const slideElement = slides[i] as HTMLElement;
        const slideType = slideElement.dataset.slideType;

        // Slides de Contas a Pagar/Receber → geração nativa (sem html2canvas)
        if (slideType === 'payables') {
            generatePayablesSlide(pres, transactions, realizedTransactions, dateRange);
            continue;
        }
        if (slideType === 'receivables') {
            generateReceivablesSlide(pres, transactions, dateRange);
            continue;
        }

        // Demais slides → captura por html2canvas (funciona bem para eles)
        try {
            const canvas = await html2canvas(slideElement, {
                scale: 3,
                useCORS: true,
                backgroundColor: '#0f172a',
                logging: false
            });
            
            const imgData = canvas.toDataURL('image/png');
            const slide = pres.addSlide();
            slide.addImage({ data: imgData, x: 0, y: 0, w: 10, h: 5.625 });
        } catch (error) {
            console.error(`Erro ao capturar slide ${i + 1}:`, error);
        }
    }

    pres.writeFile({ fileName: "Demonstrativo_Executivo.pptx" });
  };

  const handleExportPDF = async () => {
    const jsPDF = (await import('jspdf')).default;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'in', format: [10, 5.625] });

    const slides = Array.from(document.querySelectorAll<HTMLElement>('.pdf-export-page'));

    if (slides.length === 0) {
      alert('Não foi possível localizar os slides para exportar o PDF.');
      return;
    }

    for (let i = 0; i < slides.length; i++) {
      const slideType = slides[i].dataset.slideType;

      if (i > 0) pdf.addPage();

      // Slides de Contas a Pagar/Receber → desenho nativo (sem html2canvas)
      if (slideType === 'payables') {
        drawPayablesPage(pdf, transactions, realizedTransactions, dateRange);
        continue;
      }
      if (slideType === 'receivables') {
        drawReceivablesPage(pdf, transactions, dateRange);
        continue;
      }

      // Demais slides → captura por html2canvas
      try {
        const canvas = await html2canvas(slides[i], {
          scale: 3,
          useCORS: true,
          backgroundColor: '#0f172a',
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(imgData, 'JPEG', 0, 0, 10, 5.625, undefined, 'FAST');
      } catch (error) {
        console.error(`Erro ao capturar slide ${i + 1} no PDF:`, error);
      }
    }

    window.open(pdf.output('bloburl'), '_blank');
  };

  return (
    <div id="ppt-export-root" className="min-h-screen bg-[#0f172a] flex flex-col items-center p-8 font-sans gap-8">
        
        {/* CONTROLES SUPERIORES */}
        <div className="fixed top-8 right-8 flex gap-3 print:hidden z-50">
            <button 
                onClick={handleExportPPT}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors text-xs font-semibold uppercase tracking-widest rounded-md shadow-sm"
            >
                <Presentation className="w-4 h-4" /> Baixar PPTX
            </button>
            <button 
                onClick={handleExportPDF}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors text-xs font-semibold uppercase tracking-widest rounded-md shadow-sm"
            >
                <FileDown className="w-4 h-4" /> PDF
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition-colors text-xs font-semibold uppercase tracking-widest rounded-md shadow-sm" onClick={() => window.print()}>
                <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button 
                onClick={onExit}
                className="p-2.5 bg-slate-800 border border-slate-700 hover:bg-slate-700 text-slate-400 transition-colors rounded-md shadow-sm"
                title="Fechar"
            >
                <X className="w-4 h-4" />
            </button>
        </div>


        {/* CAPA */}
        <div
          data-slide-type="cover"
          className="pdf-export-page w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden relative print:break-after-page print:shadow-none mx-auto border border-slate-800"
          style={{ containerType: 'inline-size' as any, background: 'radial-gradient(72% 72% at 50% 46%, #0b2236 0%, #061522 55%, #02060f 100%)' }}
        >
            {/* Desenhos 3D em segundo plano (alinhados em pares: mesma altura e tamanho) */}
            <img src={IC_RADIO}    alt="" className="absolute pointer-events-none select-none" style={{ left: '36%', top: '28%', width: '28%', opacity: 0.16 }} />
            <img src={IC_TV}       alt="" className="absolute pointer-events-none select-none object-contain" style={{ left: '4%',  top: '27%', width: '14%', height: '22%', opacity: 0.13 }} />
            <img src={IC_EVENTOS}  alt="" className="absolute pointer-events-none select-none object-contain" style={{ left: '82%', top: '27%', width: '14%', height: '22%', opacity: 0.13 }} />
            <img src={IC_INTERNET} alt="" className="absolute pointer-events-none select-none object-contain" style={{ left: '4%',  top: '55%', width: '14%', height: '22%', opacity: 0.13 }} />
            <img src={IC_DESPESAS} alt="" className="absolute pointer-events-none select-none object-contain" style={{ left: '82%', top: '55%', width: '14%', height: '22%', opacity: 0.13 }} />

            {/* Título */}
            <div className="absolute inset-x-0 top-[6%] flex flex-col items-center text-center px-8">
                <h1 className="text-white font-extrabold leading-tight" style={{ fontSize: 'clamp(20px, 3.4cqw, 52px)' }}>Demonstrativo de Fluxo de Caixa</h1>
                <h2 className="font-extrabold" style={{ color: '#8fc6ff', letterSpacing: '0.15em', fontSize: 'clamp(18px, 3.1cqw, 46px)' }}>DFC</h2>
                <div className="mt-3 inline-flex items-center rounded-full px-5 py-1.5 border" style={{ background: '#0a1722', borderColor: '#1f8f7e' }}>
                    <span style={{ color: '#8fc6ff', fontWeight: 700, fontSize: 'clamp(10px, 1.2cqw, 16px)' }}>{coverFim ? `${coverIni} A ${coverFim}` : coverIni}</span>
                </div>
            </div>

            {/* Barra de KPIs (dinâmica) */}
            <div className="absolute inset-x-[3%] bottom-[12%] rounded-xl border flex items-stretch" style={{ background: '#0a1320', borderColor: '#1e3a34' }}>
                {[
                    { l: 'SALDO PREVISTO', v: fmtMi(summary.balance),      s: 'no período',        c: '#fcd34d' },
                    { l: 'ENTRADAS',       v: fmtMi(summary.totalInflow),  s: 'Total previsto',    c: '#6ee7b7' },
                    { l: 'SAÍDAS',         v: fmtMi(summary.totalOutflow), s: 'Total previsto',    c: '#fda4af' },
                    { l: 'FLUXO LÍQUIDO',  v: fmtMi(coverNetFlow),         s: 'Resultado líquido', c: '#6ee7b7' },
                    { l: 'PERÍODO',        v: coverFim ? `${coverIni} a ${coverFim}` : (coverIni || '—'), s: '', c: '#5eead4' },
                ].map((k, i) => (
                    <div key={i} className="flex-1 px-4 py-3" style={{ textAlign: 'center', borderLeft: i ? '1px solid #15283a' : 'none' }}>
                        <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: 'clamp(8px, 0.95cqw, 12px)' }}>{k.l}</div>
                        <div style={{ color: k.c, fontWeight: 800, whiteSpace: 'nowrap', fontSize: 'clamp(12px, 1.5cqw, 20px)' }}>{k.v}</div>
                        <div style={{ color: '#64748b', fontSize: 'clamp(7px, 0.8cqw, 10px)' }}>{k.s}</div>
                    </div>
                ))}
            </div>

            {/* Rodapé */}
            <div className="absolute bottom-[3%] right-[3%]" style={{ color: '#3f7a6e', fontWeight: 700, fontSize: 'clamp(7px, 0.85cqw, 11px)' }}>GERADO EM {new Date().toLocaleDateString('pt-BR')} • VERSÃO 1.0</div>
        </div>

        {/* PÁGINA 1: DEMONSTRATIVO FINANCEIRO CONSOLIDADO */}
        <div className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            {/* CABEÇALHO INSTITUCIONAL */}
            <header className="flex justify-between items-end pb-4 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-3xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Demonstrativo Financeiro Consolidado
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-lg font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            {/* CORPO DO DEMONSTRATIVO (20% / 45% / 35%) */}
            <div className="flex-1 flex flex-col gap-6 min-h-0">
                
                {/* 20% - KPIs PRINCIPAIS */}
                <div className="flex-[2] flex gap-6 shrink-0 min-h-0">
                    {/* 01 SALDO INICIAL */}
                    <div className="flex-1 border border-slate-800 bg-slate-950/50 rounded-lg p-4 flex flex-col justify-center gap-2">
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">Saldo Inicial</span>
                        <div className="text-4xl font-semibold text-slate-100 tracking-tight">
                            <span className="text-lg text-slate-500 mr-1 font-normal">R$</span>
                            {formatCurrency(initialBalance).replace('R$', '').trim()}
                        </div>
                    </div>
                    {/* 02 RECEBIMENTOS */}
                    <div className="flex-1 border border-slate-800 bg-slate-950/50 rounded-lg p-4 flex flex-col justify-center gap-2">
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">(+) Recebimentos</span>
                        <div className="text-4xl font-semibold text-emerald-400 tracking-tight">
                            <span className="text-lg text-emerald-700 mr-1 font-normal">R$</span>
                            {formatCurrency(summary.totalInflow).replace('R$', '').trim()}
                        </div>
                    </div>
                    {/* 03 PAGAMENTOS */}
                    <div className="flex-1 border border-slate-800 bg-slate-950/50 rounded-lg p-4 flex flex-col justify-center gap-2">
                        <span className="text-sm font-medium text-slate-400 uppercase tracking-wider">(-) Pagamentos</span>
                        <div className="text-4xl font-semibold text-rose-400 tracking-tight">
                            <span className="text-lg text-rose-700 mr-1 font-normal">R$</span>
                            {formatCurrency(summary.totalOutflow).replace('R$', '').trim()}
                        </div>
                    </div>
                    {/* 04 RESULTADO */}
                    <div className="flex-1 border border-slate-700 bg-slate-800/50 rounded-lg p-4 flex flex-col justify-center gap-2">
                        <span className="text-sm font-medium text-slate-300 uppercase tracking-wider">(=) Resultado Operacional</span>
                        <div className={`text-4xl font-semibold tracking-tight ${operatingResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            <span className={`text-lg mr-1 font-normal ${operatingResult >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>R$</span>
                            {formatCurrency(operatingResult).replace('R$', '').trim()}
                        </div>
                    </div>
                    {/* 05 SALDO FINAL */}
                    <div className="flex-[1.2] border border-slate-600 bg-slate-800 rounded-lg p-4 flex flex-col justify-center gap-2">
                        <span className="text-sm font-medium text-slate-200 uppercase tracking-wider">Saldo Final Consolidado</span>
                        <div className="text-4xl font-semibold text-white tracking-tight">
                            <span className="text-lg text-slate-400 mr-1 font-normal">R$</span>
                            {formatCurrency(netPeriodResult).replace('R$', '').trim()}
                        </div>
                    </div>
                </div>

                {/* 45% - BLOCO ESTRATÉGICO */}
                <div className="flex-[4.5] flex gap-6 shrink-0 min-h-0">
                    {/* FLUXO DE APLICAÇÕES — ponte (bridge) Caixa + Aplicações, lado a lado */}
                    <div className="flex-[5] border border-slate-800 bg-slate-950/50 rounded-lg p-5 flex flex-col min-h-0">
                        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-3 shrink-0">
                            Fluxo de Caixa e Aplicações
                        </h3>
                        {(() => {
                            // Ponte do Caixa: sai do saldo inicial e aplica cada movimento até o final.
                            const caixaSteps = [
                                { label: 'SD Inicial', value: initialBalance, kind: 'start' as const },
                                { label: '(+) Recebimentos', value: summary.totalInflow, kind: 'add' as const },
                                { label: '(-) Pagamentos', value: -summary.totalOutflow, kind: 'sub' as const },
                                { label: '(-) Aplicações', value: -totalManualAplicacoes, kind: 'sub' as const },
                                { label: '(+) Resgates', value: totalManualResgates, kind: 'add' as const },
                                { label: 'SD Final', value: netPeriodResult, kind: 'end' as const },
                            ];

                            // Ponte das Aplicações Financeiras: usa a última posição IMPORTADA como
                            // SD Inicial (o ponto real mais recente que se conhece) e SOMA o
                            // movimento do período (Resg Aplic do FC Diário) por cima — assim o
                            // SD Final sempre reflete a conta, mesmo quando o movimento foi
                            // digitado depois da última importação da planilha de Aplicações.
                            const hasSnapshot = applicationSnapshots.length >= 1;
                            const appOpening = hasSnapshot ? applicationSnapshots[applicationSnapshots.length - 1].totalGeral : 0;
                            const appClosing = appOpening + totalManualAplicacoes - totalManualResgates;
                            const aplicSteps = [
                                { label: 'SD Inicial', value: appOpening, kind: 'start' as const },
                                { label: '(-) Resgates', value: -totalManualResgates, kind: 'sub' as const },
                                { label: '(+) Aplicações', value: totalManualAplicacoes, kind: 'add' as const },
                                { label: 'SD Final', value: appClosing, kind: 'end' as const },
                            ];

                            const Row = ({ label, value, kind }: { label: string; value: number; kind: 'start' | 'add' | 'sub' | 'end' }) => (
                                <div className={`flex justify-between items-center py-1.5 ${kind === 'start' || kind === 'end' ? 'border-t border-slate-800 mt-1 pt-2' : ''}`}>
                                    <span className={`text-[13px] ${kind === 'start' || kind === 'end' ? 'font-semibold text-slate-200' : 'text-slate-400'}`}>{label}</span>
                                    <span className={`text-[13px] font-semibold tabular-nums ${
                                        kind === 'add' ? 'text-emerald-400' : kind === 'sub' ? 'text-rose-400' : value < 0 ? 'text-rose-400' : 'text-slate-100'
                                    }`}>
                                        {kind === 'sub' && value < 0 ? '(' : ''}{formatCurrency(Math.abs(value))}{kind === 'sub' && value < 0 ? ')' : ''}
                                    </span>
                                </div>
                            );

                            return (
                                <div className="flex-1 grid grid-cols-2 gap-5 min-h-0">
                                    <div className="flex flex-col justify-center bg-slate-900/40 rounded-md px-4 py-2">
                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">Caixa (Contas Correntes)</p>
                                        {caixaSteps.map((s, i) => <Row key={i} {...s} />)}
                                    </div>
                                    <div className="flex flex-col justify-center bg-slate-900/40 rounded-md px-4 py-2">
                                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                                            Aplicações Financeiras {!hasSnapshot && <span className="normal-case font-normal text-slate-600">(sem posição importada ainda)</span>}
                                        </p>
                                        {aplicSteps.map((s, i) => <Row key={i} {...s} />)}
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* RESUMO EXECUTIVO */}
                    <div className="flex-[6] border border-slate-800 bg-slate-950/50 rounded-lg p-6 flex flex-col min-h-0">
                        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-4 shrink-0">
                            Análise do Período
                        </h3>
                        <div className="flex-1 flex flex-col justify-center gap-3 text-sm font-normal text-slate-300 leading-relaxed text-justify">
                            <p>
                                Os recebimentos do período ({formatCurrency(summary.totalInflow)}) cobriram
                                <strong className="font-semibold text-slate-100 mx-1">
                                    {summary.totalOutflow > 0 ? ((summary.totalInflow / summary.totalOutflow) * 100).toFixed(0) : '0'}%
                                </strong>
                                dos pagamentos realizados ({formatCurrency(summary.totalOutflow)}), resultando em um resultado operacional
                                <strong className={`font-semibold ml-1 ${operatingResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(operatingResult)}</strong>.
                            </p>
                            {(topSupplier || topCustomer) && (
                                <p>
                                    {topSupplier && summary.totalOutflow > 0 && (
                                        <>
                                            O maior desembolso individual foi para
                                            <strong className="font-semibold text-slate-100 mx-1">{topSupplier.name}</strong>,
                                            <strong className="font-semibold text-rose-400 mx-1">{formatCurrency(topSupplier.value)}</strong>
                                            — sozinho, {((topSupplier.value / summary.totalOutflow) * 100).toFixed(1)}% de tudo que foi pago no período.{' '}
                                        </>
                                    )}
                                    {topCustomer && summary.totalInflow > 0 && (
                                        <>
                                            Do lado das entradas,
                                            <strong className="font-semibold text-slate-100 mx-1">{topCustomer.name}</strong>
                                            foi a maior fonte de receita,
                                            <strong className="font-semibold text-emerald-400 mx-1">{formatCurrency(topCustomer.value)}</strong>
                                            ({((topCustomer.value / summary.totalInflow) * 100).toFixed(1)}% do recebido)
                                            {(topCustomer.value / summary.totalInflow) > 0.3 ? ' — uma concentração alta, vale ficar de olho se esse cliente atrasar.' : '.'}
                                        </>
                                    )}
                                </p>
                            )}
                            <p>
                                {totalManualAplicacoes > 0 || totalManualResgates > 0 ? (
                                    <>
                                        As movimentações de aplicações somaram
                                        <strong className="font-semibold text-slate-100 mx-1">{formatCurrency(totalManualAplicacoes)}</strong>
                                        em aportes e
                                        <strong className="font-semibold text-slate-100 mx-1">{formatCurrency(totalManualResgates)}</strong>
                                        em resgates, um efeito líquido de
                                        <strong className={`font-semibold ml-1 ${cashFlowImpact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(cashFlowImpact)}</strong> sobre o caixa.
                                    </>
                                ) : (
                                    <>Não houve movimentação de aplicações ou resgates registrada neste período.</>
                                )}
                            </p>
                            <p>
                                A posição consolidada encerra o período em
                                <strong className="font-semibold text-white ml-1">{formatCurrency(netPeriodResult)}</strong>,
                                {netPeriodResult >= initialBalance
                                    ? ' um avanço frente ao saldo inicial.'
                                    : ' uma retração frente ao saldo inicial — vale acompanhar a tendência nos próximos períodos.'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* 35% - TABELA CONSOLIDADA / DIRETORIA */}
                <div className="flex-[3.5] flex gap-6 shrink-0 min-h-0">
                    {/* RESUMO PARA A DIRETORIA */}
                    <div className="flex-[7] border border-slate-800 bg-slate-950/50 rounded-lg p-6 flex flex-col relative group min-h-0">
                        <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-4 shrink-0">
                            <h3 className="text-lg font-semibold text-slate-200">
                                Parecer do Financeiro
                            </h3>
                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
                                {isEditingSummary ? (
                                    <button onClick={() => setIsEditingSummary(false)} className="p-1.5 text-emerald-400 hover:bg-slate-800 rounded-md transition-colors" title="Salvar">
                                        <Check className="w-4 h-4" />
                                    </button>
                                ) : (
                                    <>
                                        <button onClick={() => setIsEditingSummary(true)} className="p-1.5 text-slate-400 hover:bg-slate-800 rounded-md transition-colors" title="Editar">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={generateAutoSummary} className="p-1.5 text-slate-400 hover:bg-slate-800 rounded-md transition-colors" title="Gerar Automático">
                                            <RefreshCw className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => setBoardSummary('')} className="p-1.5 text-rose-400 hover:bg-slate-800 rounded-md transition-colors" title="Limpar">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        
                        <div className="flex-1 min-h-0">
                            {isEditingSummary ? (
                                <textarea 
                                    value={boardSummary}
                                    onChange={(e) => setBoardSummary(e.target.value)}
                                    className="w-full h-full p-4 text-sm font-normal text-slate-300 bg-slate-900 border border-slate-700 rounded-md focus:outline-none focus:border-slate-500 resize-none custom-scrollbar"
                                    placeholder="Insira o parecer executivo aqui..."
                                />
                            ) : (
                                <div className="h-full overflow-y-auto pr-4 text-sm font-normal text-slate-300 leading-relaxed text-justify whitespace-pre-wrap custom-scrollbar">
                                    {boardSummary || <span className="text-slate-500 italic">Nenhum parecer gerado. Utilize os controles para adicionar.</span>}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* PRÓXIMAS ANÁLISES */}
                    <div className="flex-[3] border border-slate-800 bg-slate-950/50 rounded-lg p-6 flex flex-col min-h-0">
                        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-4 shrink-0">
                            Anexos & Detalhamentos
                        </h3>
                        <div className="flex-1 flex flex-col justify-center gap-3">
                            {['Resumo Financeiro', 'Fluxo de Caixa (DFC)', 'Contas a Pagar', 'Contas a Receber', 'Pontos Críticos & Alocação', 'Aplicações Financeiras'].map((item, i) => (
                                <div key={i} className="flex items-center text-sm font-medium text-slate-400">
                                    <div className="w-1.5 h-1.5 bg-slate-600 rounded-full mr-3"></div>
                                    {item}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* PÁGINA 2: RESUMO FINANCEIRO */}
        <div className="bg-slate-900 w-full max-w-[1920px] min-h-[720px] shadow-2xl rounded-xl flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-3xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Resumo Financeiro
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-lg font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            <div className="flex-1 min-h-0">
                <ResumoFinanceiro summary={summary} transactions={transactions} isSlide={true} />
            </div>
        </div>
        <div className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-3xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Fluxo de Caixa (DFC)
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-lg font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            <div className="flex-1 overflow-hidden min-h-0">
                <Dashboard 
                    transactions={transactions} 
                    realizedTransactions={realizedTransactions}
                    summary={summary}
                    aiAnalysis={aiAnalysis}
                    onGenerateAI={onGenerateAI}
                    isGeneratingAI={isGeneratingAI}
                    viewType={DashboardViewType.BASE_DFC}
                    dfcManualValues={dfcManualValues}
                    onManualValueChange={onManualValueChange}
                />
            </div>
        </div>
        <div data-slide-type="payables" className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-3xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Contas a Pagar
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-lg font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            <div className="flex-1 overflow-hidden min-h-0">
                <Dashboard 
                    transactions={transactions} 
                    realizedTransactions={realizedTransactions}
                    summary={summary}
                    aiAnalysis={null}
                    onGenerateAI={() => {}}
                    isGeneratingAI={false}
                    viewType={DashboardViewType.PAYABLES}
                    dfcManualValues={dfcManualValues}
                    onManualValueChange={onManualValueChange}
                    isSlide={true}
                />
            </div>
        </div>
        <div data-slide-type="receivables" className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-3xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Contas a Receber
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-lg font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            <div className="flex-1 overflow-hidden min-h-0">
                <Dashboard 
                    transactions={transactions} 
                    realizedTransactions={realizedTransactions}
                    summary={summary}
                    aiAnalysis={null}
                    onGenerateAI={() => {}}
                    isGeneratingAI={false}
                    viewType={DashboardViewType.RECEIVABLES}
                    dfcManualValues={dfcManualValues}
                    onManualValueChange={onManualValueChange}
                    isSlide={true}
                />
            </div>
        </div>
        <div className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video min-h-[720px] shadow-2xl rounded-xl flex flex-col relative print:break-after-page print:shadow-none mx-auto p-4 gap-4 border border-slate-800">
            <header className="flex justify-between items-end pb-2 border-b border-slate-800 shrink-0">
                <div>
                    <h2 className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-1">
                        Rede Gazeta
                    </h2>
                    <h1 className="text-xl font-semibold text-slate-100 tracking-tight uppercase leading-none">
                        Análise Previsto vs Realizado
                    </h1>
                </div>
                <div className="text-right flex flex-col items-end">
                    <p className="text-base font-semibold text-slate-300 uppercase tracking-tight">{dateRange}</p>
                </div>
            </header>

            <div className="flex-1 min-h-0">
                <VisaoEstrategicaRealizado 
                    planned={plannedTransactions} 
                    realized={realizedTransactions} 
                    isSlide={true}
                    totalPlanned={totalPlanned}
                    totalRealized={totalRealized}
                    deviation={deviation}
                    deviationPercent={deviationPercent}
                />
            </div>
        </div>


        {/* PONTOS CRÍTICOS & ALOCAÇÃO */}
        <div className="pdf-export-page bg-[#1e293b] w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-600/20 rounded-lg">
                        <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100">Pontos Críticos & Alocação</h1>
                        <p className="text-xs text-slate-400 uppercase tracking-widest">Análise de Risco</p>
                    </div>
                </div>
                <p className="text-sm text-slate-400">{dateRange}</p>
            </header>

            <div className="flex-1 grid grid-cols-2 gap-5 min-h-0">
                {(() => {
                    const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
                    const receivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
                    const totalOut = payables.reduce((s, t) => s + t.value, 0);
                    const totalIn = receivables.reduce((s, t) => s + t.value, 0);

                    // Concentração de recebimento por dia
                    const recByDate: Record<string, number> = {};
                    receivables.forEach(t => { recByDate[t.date] = (recByDate[t.date] || 0) + t.value; });
                    const topRecDate = Object.entries(recByDate).sort((a, b) => b[1] - a[1])[0];
                    const recConcentration = topRecDate && totalIn > 0 ? (topRecDate[1] / totalIn * 100) : 0;

                    // Despesas de pessoal
                    const pessoal = payables.filter(t => (t.flowTypeLevel2 || '').trim() === '201' || (t.category || '').toUpperCase().includes('PESSOAL'));
                    const pessoalPct = totalOut > 0 ? (pessoal.reduce((s, t) => s + t.value, 0) / totalOut * 100) : 0;
                    const pessoalVal = pessoal.reduce((s, t) => s + t.value, 0);

                    // Impostos
                    const impostos = payables.filter(t => ['209', '215'].includes((t.flowTypeLevel2 || '').trim()) || (t.category || '').toUpperCase().includes('TRIBUT') || (t.category || '').toUpperCase().includes('IMPOSTO'));
                    const impPct = totalOut > 0 ? (impostos.reduce((s, t) => s + t.value, 0) / totalOut * 100) : 0;
                    const impVal = impostos.reduce((s, t) => s + t.value, 0);

                    // Investimentos/Resgates
                    const investimentos = transactions.filter(t => t.type === TransactionType.APPLICATION);
                    const invVal = investimentos.reduce((s, t) => s + t.value, 0);

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

                    return cards.map((c, i) => (
                        <div key={i} className="bg-[#111827] rounded-xl border border-slate-700/50 p-5 flex flex-col gap-3 min-h-0">
                            <div className="flex gap-4 items-start shrink-0">
                                <div className={`text-2xl p-3 rounded-lg ${c.color}`}>{c.icon}</div>
                                <div>
                                    <h4 className="text-base font-bold text-slate-100 mb-1">{c.title}</h4>
                                    <p className="text-sm text-slate-400 leading-relaxed">{c.text}</p>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0">{c.chart}</div>
                        </div>
                    ));
                })()}
            </div>

            <footer className="flex justify-between text-[10px] text-slate-600 border-t border-slate-700 pt-3 shrink-0">
                <span>Confidencial — Uso Interno</span>
                <span>Rede Gazeta</span>
            </footer>
        </div>

        {/* APLICAÇÕES FINANCEIRAS */}
        {applicationSnapshots.length > 0 && (() => {
            const snaps = applicationSnapshots; // já vem ordenado por data crescente
            const rows = snaps.map((s, i) => {
                const prev = i > 0 ? snaps[i - 1] : null;
                const diff = prev ? s.totalGeral - prev.totalGeral : 0;
                const pct = prev && prev.totalGeral !== 0 ? (diff / prev.totalGeral) * 100 : 0;
                return { ...s, diff, pct, isFirst: i === 0 };
            });
            const last = rows[rows.length - 1];
            const first = rows[0];
            const variacaoTotal = last.totalGeral - first.totalGeral;
            const variacaoTotalPct = first.totalGeral !== 0 ? (variacaoTotal / first.totalGeral) * 100 : 0;
            const chartData = rows.map(r => ({ label: r.label, saldo: r.totalGeral }));
            const porEmpresa = Object.entries(last.porEmpresa)
                .filter(([, v]) => v !== 0)
                .sort((a, b) => b[1] - a[1]);

            return (
        <div className="pdf-export-page bg-slate-900 w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto p-8 gap-6 border border-slate-800">
            <header className="flex justify-between items-end pb-4 border-b border-slate-700 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-600/20 rounded-lg">
                        <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-100">Aplicações Financeiras</h1>
                        <p className="text-xs text-slate-400 uppercase tracking-widest">Posição em {last.label}</p>
                    </div>
                </div>
                <p className="text-sm text-slate-400">{dateRange}</p>
            </header>

            <div className="grid grid-cols-3 gap-4 shrink-0">
                <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Saldo atual</p>
                    <p className="text-2xl font-bold text-slate-100 mt-1">{formatCurrency(last.totalGeral)}</p>
                </div>
                <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Variação vs. mês anterior</p>
                    <p className={`text-2xl font-bold mt-1 flex items-center gap-2 ${last.diff > 0 ? 'text-emerald-400' : last.diff < 0 ? 'text-red-400' : 'text-slate-300'}`}>
                        {last.isFirst ? '—' : (
                            <>
                                {last.diff > 0 ? <TrendingUp className="w-5 h-5" /> : last.diff < 0 ? <TrendingDown className="w-5 h-5" /> : <Minus className="w-5 h-5" />}
                                {last.diff >= 0 ? '+' : ''}{formatCurrency(last.diff)}
                            </>
                        )}
                    </p>
                </div>
                <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Variação do período ({first.label} → {last.label})</p>
                    <p className={`text-2xl font-bold mt-1 ${variacaoTotal > 0 ? 'text-emerald-400' : variacaoTotal < 0 ? 'text-red-400' : 'text-slate-300'}`}>
                        {variacaoTotalPct >= 0 ? '+' : ''}{variacaoTotalPct.toFixed(1)}%
                    </p>
                </div>
            </div>

            <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">
                <div className="col-span-2 bg-[#111827] border border-slate-700/50 rounded-xl p-4 flex flex-col min-h-0">
                    <p className="text-sm font-bold text-slate-200 mb-1">Evolução do saldo</p>
                    <p className="text-[10px] text-slate-500 mb-2">Variação bruta entre posições — inclui aportes, resgates e rendimento (a planilha já vem líquida disso).</p>
                    <div className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(v) => `${(v / 1_000_000).toFixed(0)}mi`} width={50} />
                                <RechartsTooltip
                                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                                    formatter={(v: number) => [formatCurrency(v), 'Saldo']}
                                />
                                <Line type="monotone" dataKey="saldo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
                <div className="bg-[#111827] border border-slate-700/50 rounded-xl p-4 flex flex-col min-h-0">
                    <p className="text-sm font-bold text-slate-200 mb-2">Por empresa (posição atual)</p>
                    <div className="flex-1 overflow-hidden grid grid-cols-2 gap-x-3 gap-y-1.5 content-start">
                        {porEmpresa.map(([cc, v]) => {
                            const name = COMPANIES.find(c => c.id === cc)?.name || cc;
                            return (
                                <div key={cc} className="flex flex-col text-xs border-b border-slate-800 pb-1">
                                    <span className="text-slate-500 truncate text-[10px]">{name}</span>
                                    <span className="text-slate-200 font-medium">{formatCurrency(v)}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <footer className="flex justify-between text-[10px] text-slate-600 border-t border-slate-700 pt-3 shrink-0">
                <span>Confidencial — Uso Interno</span>
                <span>Rede Gazeta</span>
            </footer>
        </div>
            );
        })()}

        {/* ESTRUTURA ALTERNATIVA PARA EXPORTAÇÃO PPT (OCULTA NA WEB) */}
        <PPTExportAlternative 
            summary={summary}
            transactions={transactions}
            realizedTransactions={realizedTransactions}
            dateRange={dateRange}
            initialBalance={initialBalance}
            operatingResult={operatingResult}
            cashFlowImpact={cashFlowImpact}
            netPeriodResult={netPeriodResult}
            boardSummary={boardSummary}
            aiAnalysis={aiAnalysis}
            isGeneratingAI={isGeneratingAI}
            onGenerateAI={onGenerateAI}
        />

    </div>
  );
};