/**
 * App.tsx — v4.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestrador raiz da aplicação DFC — Rede Gazeta.
 *
 * Fase 1: utils/finance.ts, types.ts, hooks/useFinancialCalculations.ts
 * Fase 2: engines/reconciliation.ts, engines/indirectMethod.ts,
 *          engines/csvParser.ts, hooks/usePersistence.ts
 * Fase 3: services/claudeService.ts, engines/alerts.ts,
 *          hooks/useDrillDown.ts, utils/designTokens.ts
 * Fase 4: hooks/useSnapshots.ts, engines/forecast.ts,
 *          engines/auditLog.ts, services/erpConnector.ts,
 *          services/notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Transaction,
  TransactionType,
  ViewMode,
  DashboardViewType,
  VIEW_MODE_TO_DASHBOARD_VIEW,
  ManualValues,
} from './types';
import { Dashboard }             from './components/Dashboard';
import { GestaoLancamentos }     from './components/GestaoLancamentos';
import { ResumoFinanceiro }      from './components/ResumoFinanceiro';
import { ApresentacaoExecutiva } from './components/ApresentacaoExecutiva';
import { Sidebar }               from './components/Sidebar';
import { AlertsPanel }           from './components/AlertsPanel';
import { ForecastChart }         from './components/ForecastChart';
import { AuditLogView }          from './components/AuditLogView';
import { DrillDownChart }        from './components/DrillDownChart';
import {
  FileSpreadsheet, Scale, CalendarRange, LayoutGrid,
  Calculator, PieChart, Table2, Save, AlertTriangle,
  Bell, RefreshCw, TrendingUp, Activity,
} from 'lucide-react';

// Serviços e engines
import { analyzeFinancialData, type ExecutiveAnalysis } from './services/claudeService';
import { syncFromERP, getERPConfigFromEnv }             from './services/erpConnector';
import { notificationService }                           from './services/notifications';

// Hooks
import { useFinancialCalculations } from './hooks/useFinancialCalculations';
import { usePersistence }           from './hooks/usePersistence';
import { useSnapshots }             from './hooks/useSnapshots';
import { usePrevistoSnapshots }     from './hooks/usePrevistoSnapshots';
import { useRealizadoSnapshots }    from './hooks/useRealizadoSnapshots';
import { useApplicationSnapshots }  from './hooks/useApplicationSnapshots';

// Engines
import { parseRealizedCSV, summarizeParseResult } from './engines/csvParser';
import * as XLSX from 'xlsx';
import { detectAlerts, alertCount, type Alert }   from './engines/alerts';
import { auditLog }                               from './engines/auditLog';

// ─── Dado inicial ─────────────────────────────────────────────────────────────

const INITIAL_DATA: Transaction[] = [
  {
    id:              '1',
    date:            '2025-12-23',
    description:     'Exemplo Previsto',
    supplier:        'PRECIS1464',
    supplierCode:    '1464',
    companyCode:     '1',
    value:           500.00,
    type:            TransactionType.PAYABLE,
    status:          'PREVISTO',
    category:        'Fornecedores',
    businessUnit:    '100',
    businessUnitCode:'1',
  },
];

// ─── Config de views ──────────────────────────────────────────────────────────

const VIEW_CONFIG: Record<ViewMode, { icon: React.ElementType; title: string }> = {
  [ViewMode.DASHBOARD_DAILY_GAZETA]: { icon: CalendarRange,   title: 'Modelo Oficial Controladoria'  },
  [ViewMode.RESUMO_FINANCEIRO]:      { icon: PieChart,        title: 'Resumo Financeiro Consolidado' },
  [ViewMode.DASHBOARD_BASE_DFC]:     { icon: LayoutGrid,      title: 'Base DFC - Nível 02'           },
  [ViewMode.DASHBOARD_FC_DIARIO]:    { icon: Calculator,      title: 'FC Diário Simulação'           },
  [ViewMode.DASHBOARD_BY_COMPANY]:   { icon: Scale,           title: 'Previsto vs Realizado'         },
  [ViewMode.DATA_ENTRY]:             { icon: FileSpreadsheet, title: 'Gestão de Lançamentos'         },
  [ViewMode.DASHBOARD_DFC]:          { icon: Table2,          title: 'DFC Consolidada'               },
  [ViewMode.DASHBOARD_PAYABLES]:     { icon: Table2,          title: 'Contas a Pagar'                },
  [ViewMode.DASHBOARD_RECEIVABLES]:  { icon: Table2,          title: 'Contas a Receber'              },
  [ViewMode.APRESENTACAO_EXEC]:      { icon: Table2,          title: 'Apresentação Executiva'        },
  [ViewMode.ALERTS_VIEW]:            { icon: Bell,            title: 'Alertas & Anomalias'           },
  [ViewMode.FORECAST_VIEW]:          { icon: TrendingUp,      title: 'Projeção de Caixa'             },
  [ViewMode.AUDIT_VIEW]:             { icon: Activity,        title: 'Registro de Auditoria'         },
};

// ─── Componente principal ─────────────────────────────────────────────────────

export default function App() {

  // ── 1. Estado global ──────────────────────────────────────────────────────
  const [transactions,          setTransactions]          = useState<Transaction[]>(INITIAL_DATA);
  const [realizedTransactions,  setRealizedTransactions]  = useState<Transaction[]>([]);
  const [viewMode,              setViewMode]              = useState<ViewMode>(ViewMode.DASHBOARD_DAILY_GAZETA);
  const [selectedCompany,       setSelectedCompany]       = useState<string>('all');
  const [logoUrl,               setLogoUrl]               = useState(
    'https://upload.wikimedia.org/wikipedia/commons/2/27/Rede_Gazeta_Logotipo_2020.png'
  );
  const [manualValues,          setManualValues]          = useState<ManualValues>({});
  const [aiAnalysis,            setAiAnalysis]            = useState<ExecutiveAnalysis | null>(null);
  const [isGeneratingAI,        setIsGeneratingAI]        = useState(false);
  const [alerts,                setAlerts]                = useState<Alert[]>([]);
  const [isSyncingERP,          setIsSyncingERP]          = useState(false);
  const [lastERPSync,           setLastERPSync]           = useState<Date | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);

  // ── 2. Cálculos financeiros ───────────────────────────────────────────────
  const {
    filteredTransactions,
    filteredRealized,
    uniqueCompanies,
    summary,
    executiveInitialBalance,
    totalManualResgates,
  } = useFinancialCalculations({
    transactions,
    realizedTransactions,
    selectedCompany,
    manualValues,
  });

  // ── 3. Persistência IndexedDB ─────────────────────────────────────────────
  const { isReady, lastSaved, isSaving } = usePersistence({
    transactions,
    realizedTransactions,
    manualValues,
    setTransactions,
    setRealizedTransactions,
    setManualValues,
  });

  // ── 4. Snapshots históricos ───────────────────────────────────────────────
  const snapshots = useSnapshots();
  // Snapshot do Previsto por período (guarda cada importação para confrontar
  // depois com o Realizado do mesmo período, sem misturar meses diferentes).
  const previstoSnapshots = usePrevistoSnapshots();
  // Idem para o Realizado — permite escolher o período do realizado de forma
  // explícita e simétrica ao período do previsto, na tela de Reconciliação.
  const realizadoSnapshots = useRealizadoSnapshots();
  // Posição das Aplicações Financeiras por mês (para o relatório de evolução).
  const applicationSnapshots = useApplicationSnapshots();

  // ── 5. Inicialização única ────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady) return;

    // Configurar notificações
    notificationService.init({ enableBrowser: true });

    // Capturar snapshot do estado atual
    snapshots.capture(summary, filteredTransactions, filteredRealized, alerts);

    // Poda automática de snapshots e audit log antigos
    snapshots.prune(180);
    auditLog.prune(365);

    // Registrar início de sessão
    auditLog.record({ action: 'SESSION_START', subject: 'app' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]); // Só na primeira vez que os dados ficam prontos

  // ── 6. Detecção de alertas ────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady) return;
    const detected = detectAlerts({
      transactions:         filteredTransactions,
      realizedTransactions: filteredRealized,
      manualValues,
    });
    setAlerts(detected);
    notificationService.processAlerts(detected);
  }, [filteredTransactions, filteredRealized, manualValues, isReady]);

  const counts = useMemo(() => alertCount(alerts), [alerts]);

  // ── 7. Briefing diário (verificar a cada minuto) ──────────────────────────
  useEffect(() => {
    if (!isReady) return;
    const interval = setInterval(() => {
      notificationService.sendDailyBriefing(summary, aiAnalysis);
    }, 60_000); // 1 minuto
    return () => clearInterval(interval);
  }, [summary, aiAnalysis, isReady]);

  // ── 8. Handlers ───────────────────────────────────────────────────────────

  const handleManualValueChange = useCallback((key: string, value: number) => {
    const prev = manualValues[key];
    setManualValues(mv => ({ ...mv, [key]: value }));
    auditLog.record({
      action:  'MANUAL_VALUE_CHANGE',
      subject: key,
      before:  prev ?? 0,
      after:   value,
    });
  }, [manualValues]);

  const handleUpdateTransaction = useCallback((updated: Transaction) => {
    setTransactions(prev => prev.map(t => t.id === updated.id ? updated : t));
    auditLog.record({ action: 'TRANSACTION_EDIT', subject: updated.id, after: updated });
  }, []);

  const handleGenerateAI = useCallback(async () => {
    if (isGeneratingAI) return;
    setIsGeneratingAI(true);
    const result = await analyzeFinancialData(summary, filteredTransactions, filteredRealized, alerts);
    setAiAnalysis(result);
    setIsGeneratingAI(false);
    auditLog.record({
      action:  'AI_ANALYSIS_GENERATED',
      subject: 'claude-executive-briefing',
      after:   { sentiment: result.sentiment, actionItemsCount: result.actionItems?.length ?? 0 },
    });
  }, [isGeneratingAI, summary, filteredTransactions, filteredRealized, alerts]);

  const handleImportRealized = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buf   = ev.target?.result as ArrayBuffer;
        const bytes = new Uint8Array(buf);
        let csvText: string;

        if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
          // É um XLSX (assinatura "PK") — inclusive arquivos .csv que na verdade são Excel.
          const wb   = XLSX.read(buf, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as any[][];
          // Localiza a linha de cabeçalho real (pula a banda de metadados do TOTVS).
          let hr = rows.findIndex(r => {
            const j = (r || []).map(c => String(c).toUpperCase()).join('|');
            return (j.includes('DATA PAGTO') || j.includes('DATA PAGAMENTO')) &&
                   (j.includes('VALOR PAGAMENTO') || j.includes('VLR'));
          });
          if (hr < 0) hr = 0;
          const header   = rows[hr] || [];
          // Mantém só linhas de dados (1ª coluna = código de empresa numérico); descarta subtotais/rodapés.
          const dataRows = rows.slice(hr + 1).filter(r => /^\d+$/.test(String((r || [])[0] ?? '').trim()));
          const esc = (c: any) => String(c ?? '').replace(/;/g, ',');
          csvText = [header.map(esc).join(';'), ...dataRows.map(r => r.map(esc).join(';'))].join('\n');
        } else {
          // CSV/TXT — decodifica como ISO-8859-1 (padrão dos exports TOTVS).
          csvText = new TextDecoder('iso-8859-1').decode(buf);
        }

        const result  = parseRealizedCSV(
          csvText,
          [...transactions, ...realizedTransactions],
          selectedCompany !== 'all' ? selectedCompany : '',
          selectedCompany,
        );
        const summaryMsg = summarizeParseResult(result);

        if (result.valid.length === 0) {
          const details = result.rejected.slice(0, 5)
            .map(r => `  Linha ${r.lineNumber}: ${r.reason}`).join('\n');
          alert(`Nenhum registro válido.\n\n${summaryMsg}\n\n${details}`);
          auditLog.record({ action: 'CSV_IMPORT_ERROR', subject: file.name,
            meta: { rejected: result.rejected.length, summaryMsg } });
          return;
        }

        let confirmMsg = `Importar ${result.valid.length} transação(ões)?\n\n${summaryMsg}`;
        if (result.rejected.length > 0) {
          confirmMsg += `\n\nRejeitadas (${result.rejected.length}):`;
          result.rejected.slice(0, 3).forEach(r => { confirmMsg += `\n  Linha ${r.lineNumber}: ${r.reason}`; });
          if (result.rejected.length > 3) confirmMsg += `\n  ...e mais ${result.rejected.length - 3}`;
        }
        if (result.duplicates.length > 0) confirmMsg += `\n\n⚠ ${result.duplicates.length} duplicata(s) ignorada(s).`;
        if (!window.confirm(confirmMsg)) return;

        const newTx = result.valid.map(r => r.transaction);
        setRealizedTransactions(prev => [...prev, ...newTx]);
        realizadoSnapshots.capture(newTx);

        auditLog.record({
          action: 'CSV_IMPORT', subject: file.name,
          after: { imported: newTx.length, skipped: result.duplicates.length + result.rejected.length },
        });
      } catch (err) {
        console.error('[handleImportRealized]', err);
        alert('Erro inesperado ao processar o arquivo.');
      }
    };
    reader.readAsArrayBuffer(file);
  }, [transactions, realizedTransactions, selectedCompany, realizadoSnapshots]);

  // ── 9. Sincronização ERP ──────────────────────────────────────────────────
  const handleERPSync = useCallback(async () => {
    if (isSyncingERP) return;
    const erpConfig = getERPConfigFromEnv();
    if (!erpConfig) {
      alert('Configuração ERP não encontrada. Configure VITE_ERP_PROXY_URL e VITE_ERP_TYPE no .env.local');
      return;
    }

    setIsSyncingERP(true);
    try {
      const result = await syncFromERP(erpConfig, [...transactions, ...realizedTransactions]);
      if (result.success && result.imported.length > 0) {
        setRealizedTransactions(prev => [...prev, ...result.imported]);
        realizadoSnapshots.capture(result.imported);
        setLastERPSync(result.syncedAt);
        alert(`✓ ERP: ${result.imported.length} transação(ões) importadas. ${result.skipped} ignoradas (duplicatas).`);
      } else if (result.errors.length > 0) {
        alert(`Erro na sincronização ERP:\n${result.errors.join('\n')}`);
      } else {
        alert('ERP sincronizado — nenhuma transação nova encontrada.');
      }
    } finally {
      setIsSyncingERP(false);
    }
  }, [isSyncingERP, transactions, realizedTransactions, realizadoSnapshots]);

  // ── 10. Apresentação Executiva (sem Sidebar) ──────────────────────────────

  if (viewMode === ViewMode.APRESENTACAO_EXEC) {
    return (
      <ApresentacaoExecutiva
        transactions={[...filteredTransactions, ...filteredRealized]}
        summary={summary}
        aiAnalysis={aiAnalysis}
        isGeneratingAI={isGeneratingAI}
        onGenerateAI={handleGenerateAI}
        dfcManualValues={manualValues}
        onManualValueChange={handleManualValueChange}
        initialBalance={executiveInitialBalance}
        totalManualResgates={totalManualResgates}
        applicationSnapshots={applicationSnapshots.snapshots}
        onExit={() => setViewMode(ViewMode.DASHBOARD_DAILY_GAZETA)}
      />
    );
  }

  // ── 11. Layout principal ──────────────────────────────────────────────────

  const viewConfig        = VIEW_CONFIG[viewMode];
  const ViewIcon          = viewConfig.icon;
  const dashboardViewType = VIEW_MODE_TO_DASHBOARD_VIEW[viewMode] ?? DashboardViewType.DAILY;

  return (
    <div className="min-h-screen flex bg-slate-950 font-sans text-slate-100">
      <Sidebar
        viewMode={viewMode}
        setViewMode={setViewMode}
        logoUrl={logoUrl}
        setLogoUrl={setLogoUrl}
        logoInputRef={logoInputRef}
        alertCounts={counts}
      />

      <main className="flex-1 min-w-0 ml-64 p-8 overflow-x-hidden">
        {/* Header */}
        <header className="flex justify-between items-center mb-8 bg-slate-900/40 p-6 rounded-xl shadow-sm border border-slate-800/60">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-slate-800/50 text-slate-300 rounded-lg border border-slate-700/50">
              <ViewIcon size={24} />
            </div>
            <div>
              <h1 className="text-xl font-medium text-slate-100 tracking-tight">{viewConfig.title}</h1>
              <p className="text-sm font-normal text-slate-400 mt-0.5">
                {selectedCompany === 'all' ? 'Visão Consolidada' : `Filtrado por Empresa ${selectedCompany}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Alertas críticos */}
            {counts.critical > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs font-medium">
                <Bell size={12} className="animate-pulse" />
                {counts.critical} crítico{counts.critical > 1 ? 's' : ''}
              </div>
            )}
            {counts.warning > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-950/50 border border-amber-800/60 text-amber-300 text-xs font-medium">
                <AlertTriangle size={12} />
                {counts.warning} atenção
              </div>
            )}

            {/* Sincronização ERP */}
            <button
              onClick={handleERPSync}
              disabled={isSyncingERP}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/60 text-slate-400 text-xs font-medium hover:text-slate-200 hover:bg-slate-700/60 transition-colors disabled:opacity-50"
              title={lastERPSync ? `Último sync: ${lastERPSync.toLocaleTimeString('pt-BR')}` : 'Sincronizar com ERP'}
            >
              <RefreshCw size={12} className={isSyncingERP ? 'animate-spin' : ''} />
              {isSyncingERP ? 'Sync...' : 'ERP'}
            </button>

            {/* Status persistência */}
            {isReady && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {isSaving
                  ? <><Save size={12} className="animate-pulse text-amber-400" /><span>Salvando...</span></>
                  : lastSaved
                  ? <><Save size={12} className="text-emerald-500" /><span>{lastSaved.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></>
                  : <><Save size={12} className="text-slate-600" /><span>Não salvo</span></>
                }
              </div>
            )}

            <span className="text-sm font-medium text-slate-400">Empresa:</span>
            <select
              value={selectedCompany}
              onChange={e => setSelectedCompany(e.target.value)}
              className="text-sm font-medium border border-slate-700 rounded-lg bg-slate-900 text-slate-200 px-4 py-2.5 focus:ring-1 focus:ring-slate-500 outline-none min-w-[200px] transition-colors"
            >
              <option value="all">TODAS AS EMPRESAS</option>
              {uniqueCompanies.map(c => <option key={c} value={c}>EMPRESA {c}</option>)}
            </select>
          </div>
        </header>

        {/* Snapshot count info */}
        {snapshots.snapshots.length >= 3 && (
          <div className="mb-4 px-4 py-2 rounded-lg bg-slate-900/30 border border-slate-800/40 text-xs text-slate-500 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0"></span>
            {snapshots.snapshots.length} snapshots históricos · modelo preditivo{' '}
            {snapshots.snapshots.length >= 14 ? 'ensemble ativo' : snapshots.snapshots.length >= 7 ? 'parcial' : 'em calibração'}
          </div>
        )}

        {/* Views */}
        {viewMode === ViewMode.ALERTS_VIEW ? (
          <AlertsPanel
            alerts={alerts}
            onViewTransactions={(ids) => console.log('Ver lançamentos:', ids)}
          />
        ) : viewMode === ViewMode.FORECAST_VIEW ? (
          <div className="space-y-5">
            <ForecastChart
              snapshots={snapshots.snapshots}
              field="balance"
              title="Projeção de Saldo"
            />
            <ForecastChart
              snapshots={snapshots.snapshots}
              field="totalOutflow"
              title="Projeção de Saídas"
              compact
            />
            <DrillDownChart
              transactions={filteredTransactions}
              title="Fluxo por Dimensão — Clique para detalhar"
              showDetailTable
            />
          </div>
        ) : viewMode === ViewMode.AUDIT_VIEW ? (
          <AuditLogView />
        ) : viewMode === ViewMode.DATA_ENTRY ? (
          <GestaoLancamentos
            key="data-entry"
            transactions={transactions}
            onAddTransaction={t => { setTransactions(p => [...p, t]); auditLog.record({ action: 'TRANSACTION_ADD', subject: t.id, after: t }); }}
            onDeleteTransaction={id => { setTransactions(p => p.filter(t => t.id !== id)); auditLog.record({ action: 'TRANSACTION_DELETE', subject: id }); }}
            onImportTransactions={ts => {
                const temApp = ts.some(t => t.type === TransactionType.APPLICATION);
                if (temApp) {
                  // Aplicações não acumulam: cada importação é a posição ATUAL,
                  // substitui a anterior (evita somar junho+julho em dobra).
                  // O histórico mês a mês fica guardado à parte, no snapshot.
                  const novasApp = ts.filter(t => t.type === TransactionType.APPLICATION);
                  const outras   = ts.filter(t => t.type !== TransactionType.APPLICATION);
                  setTransactions(p => [
                    ...p.filter(t => t.type !== TransactionType.APPLICATION),
                    ...novasApp,
                    ...outras,
                  ]);
                  applicationSnapshots.capture(novasApp);
                  if (outras.length > 0) previstoSnapshots.capture(outras);
                } else {
                  setTransactions(p => [...p, ...ts]);
                  previstoSnapshots.capture(ts);
                }
            }}
            onClearTransactions={type => { setTransactions(p => p.filter(t => t.type !== type)); auditLog.record({ action: 'DATA_CLEAR', subject: `type:${type}` }); }}
            onUpdateTransaction={handleUpdateTransaction}
            applicationSnapshots={applicationSnapshots.snapshots}
          />
        ) : viewMode === ViewMode.RESUMO_FINANCEIRO ? (
          <ResumoFinanceiro key="resumo" summary={summary} transactions={filteredTransactions} aiAnalysis={aiAnalysis} isGeneratingAI={isGeneratingAI} onGenerateAI={handleGenerateAI} />
        ) : (
          <Dashboard
            key={viewMode}
            transactions={filteredTransactions}
            realizedTransactions={filteredRealized}
            summary={summary}
            aiAnalysis={aiAnalysis}
            onGenerateAI={handleGenerateAI}
            isGeneratingAI={isGeneratingAI}
            viewType={dashboardViewType}
            onImportRealized={handleImportRealized}
            alerts={alerts}
            snapshots={snapshots.snapshots}
            previstoSnapshots={previstoSnapshots.snapshots}
            realizadoSnapshots={realizadoSnapshots.snapshots}
            applicationSnapshots={applicationSnapshots.snapshots}
            onClearRealized={() => {
              if (window.confirm('Limpar todos os lançamentos realizados?')) {
                setRealizedTransactions([]);
                auditLog.record({ action: 'DATA_CLEAR', subject: 'realized-transactions' });
              }
            }}
            dfcManualValues={manualValues}
            onManualValueChange={handleManualValueChange}
          />
        )}
      </main>
    </div>
  );
}
