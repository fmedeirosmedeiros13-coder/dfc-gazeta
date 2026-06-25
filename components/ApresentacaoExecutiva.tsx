import React, { useMemo, useState, useEffect } from 'react';
import { FinancialSummary, Transaction, AIAnalysisResult, TransactionType, DashboardViewType } from '../types';
import { X, Printer, FileDown, Lock, Edit2, RefreshCw, Trash2, Check, Presentation } from 'lucide-react';
import { ResumoFinanceiro } from './ResumoFinanceiro';
import { Dashboard } from './Dashboard';
import { VisaoEstrategicaRealizado } from './VisaoEstrategicaRealizado';
import pptxgen from "pptxgenjs";
import html2canvas from "html2canvas";
import { PPTExportAlternative } from './PPTExportAlternative';
import { generatePayablesSlide, generateReceivablesSlide } from '../services/pptxNativeSlides';
import { formatCurrency, parseDate } from '../utils/finance';

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
  onExit 
}) => {

  // --- LÓGICA PRESERVADA & AJUSTADA ---
  const operatingResult = summary.totalInflow - summary.totalOutflow;
  const companyName = 'REDE GAZETA';
  const netInvestmentMovement = summary.totalInvested - totalManualResgates;
  const cashFlowImpact = totalManualResgates - summary.totalInvested;
  const netPeriodResult = initialBalance + operatingResult - netInvestmentMovement;

  const plannedTransactions = useMemo(() => {
    return transactions.filter(t => t.status === 'PREVISTO');
  }, [transactions]);

  const realizedTransactions = useMemo(() => {
      return transactions.filter(t => t.status === 'REALIZADO');
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

  const [boardSummary, setBoardSummary] = useState('');
  const [isEditingSummary, setIsEditingSummary] = useState(false);

  const generateAutoSummary = () => {
      const text = `No período analisado (${dateRange}), o saldo inicial consolidado foi de ${formatCurrency(initialBalance)}. As operações geraram um total de ${formatCurrency(summary.totalInflow)} em recebimentos e ${formatCurrency(summary.totalOutflow)} em pagamentos, resultando em um resultado operacional de ${formatCurrency(operatingResult)}. O fluxo líquido de aplicações e investimentos impactou o caixa em ${formatCurrency(cashFlowImpact)}, levando a um saldo final consolidado de ${formatCurrency(netPeriodResult)}.`;
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
      try {
        const canvas = await html2canvas(slides[i], {
          scale: 3,
          useCORS: true,
          backgroundColor: '#0f172a',
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (i > 0) pdf.addPage();
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
        <div className="pdf-export-page bg-gradient-to-br from-[#0f172a] to-[#1e293b] w-full max-w-[1920px] aspect-video shadow-2xl rounded-xl overflow-hidden flex flex-col relative print:break-after-page print:shadow-none mx-auto border border-slate-800 items-center justify-center text-center">
            <div className="flex flex-col items-center gap-6">
                <span className="inline-block bg-emerald-500/10 text-emerald-400 px-6 py-2 rounded-full text-sm font-semibold border border-emerald-500/20 tracking-widest uppercase">
                    Planejamento Financeiro
                </span>
                <h1 className="text-5xl font-extrabold text-white leading-tight">
                    Demonstrativo de Fluxo de Caixa<br/>Previsto (DFC)
                </h1>
                <p className="text-xl text-sky-400 font-medium flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    {dateRange}
                </p>
                <div className="mt-4 text-sm text-slate-500">Rede Gazeta • Relatório de Gestão Semanal</div>
            </div>
            <div className="absolute bottom-6 left-8 text-[10px] text-slate-600">Confidencial — Uso Interno</div>
            <div className="absolute bottom-6 right-8 text-[10px] text-slate-600">Gerado em {new Date().toLocaleDateString('pt-BR')}</div>
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
                    {/* FLUXO DE APLICAÇÕES */}
                    <div className="flex-[4] border border-slate-800 bg-slate-950/50 rounded-lg p-6 flex flex-col min-h-0">
                        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-4 shrink-0">
                            Fluxo de Aplicações e Investimentos
                        </h3>
                        <div className="flex-1 flex flex-col justify-center gap-4">
                            <div className="flex justify-between items-center border-b border-slate-800/50 pb-2">
                                <span className="text-sm font-medium text-slate-400">(-) Aplicações / Saídas</span>
                                <span className="text-lg font-semibold text-rose-400">({formatCurrency(summary.totalInvested)})</span>
                            </div>
                            <div className="flex justify-between items-center border-b border-slate-800/50 pb-2">
                                <span className="text-sm font-medium text-slate-400">(+) Resgates / Entradas</span>
                                <span className="text-lg font-semibold text-emerald-400">{formatCurrency(totalManualResgates)}</span>
                            </div>
                            <div className="flex justify-between items-center pt-2">
                                <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">(=) Fluxo Líquido</span>
                                <span className={`text-xl font-semibold ${cashFlowImpact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {cashFlowImpact < 0 ? `(${formatCurrency(Math.abs(cashFlowImpact))})` : formatCurrency(cashFlowImpact)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* RESUMO EXECUTIVO */}
                    <div className="flex-[6] border border-slate-800 bg-slate-950/50 rounded-lg p-6 flex flex-col min-h-0">
                        <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-800 pb-3 mb-4 shrink-0">
                            Resumo Executivo do Período
                        </h3>
                        <div className="flex-1 flex flex-col justify-center gap-4 text-sm font-normal text-slate-300 leading-relaxed text-justify">
                            <p>
                                A Controladoria apura um Resultado Operacional de
                                <strong className={`font-semibold ml-1 ${operatingResult >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{formatCurrency(operatingResult)}</strong>.
                            </p>
                            <p>
                                O volume de pagamentos operacionais totalizou
                                <strong className="font-semibold text-slate-100 ml-1">{formatCurrency(summary.totalOutflow)}</strong>, 
                                impactando diretamente o fluxo de caixa do período.
                            </p>
                            <p>
                                Após as movimentações de investimentos, a posição final consolidada encerra em
                                <strong className="font-semibold text-white ml-1">{formatCurrency(netPeriodResult)}</strong>.
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
                                Parecer da Controladoria
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
                            {['Resumo Financeiro', 'Fluxo de Caixa (DFC)', 'Contas a Pagar', 'Contas a Receber'].map((item, i) => (
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
                        },
                        {
                            icon: '👥', color: 'text-sky-400 bg-sky-500/10',
                            title: 'Despesas de Pessoal',
                            text: totalOut > 0 ? `${fmtPct(pessoalPct)} (${fmtK(pessoalVal)}) do total de saídas está comprometido com Folha e Benefícios.` : 'Sem dados de saídas.',
                        },
                        {
                            icon: '🏛', color: 'text-blue-400 bg-blue-500/10',
                            title: 'Impacto Tributário',
                            text: totalOut > 0 ? `${fmtPct(impPct)} (${fmtK(impVal)}) referentes a impostos e contribuições no período. Federais antecipam, estaduais/municipais postergam.` : 'Sem dados de impostos.',
                        },
                        {
                            icon: '🛡', color: 'text-emerald-400 bg-emerald-500/10',
                            title: 'Estratégia de Liquidez',
                            text: invVal > 0 ? `Aplicações/Resgates de investimentos no período: ${fmtK(invVal)}. Geração líquida de caixa: ${fmtK(totalIn - totalOut)}.` : `Geração líquida de caixa prevista: ${fmtK(totalIn - totalOut)}. Sem movimentação de investimentos.`,
                        },
                    ];

                    return cards.map((c, i) => (
                        <div key={i} className="bg-[#111827] rounded-xl border border-slate-700/50 p-5 flex gap-4 items-start">
                            <div className={`text-2xl p-3 rounded-lg ${c.color}`}>{c.icon}</div>
                            <div>
                                <h4 className="text-base font-bold text-slate-100 mb-1">{c.title}</h4>
                                <p className="text-sm text-slate-400 leading-relaxed">{c.text}</p>
                            </div>
                        </div>
                    ));
                })()}
            </div>

            <footer className="flex justify-between text-[10px] text-slate-600 border-t border-slate-700 pt-3 shrink-0">
                <span>Confidencial — Uso Interno</span>
                <span>Rede Gazeta</span>
            </footer>
        </div>

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