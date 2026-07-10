import React, { useState, useRef, useMemo } from 'react';
import { Transaction, TransactionType } from '../types';
import { Plus, ArrowDownCircle, ArrowUpCircle, Briefcase, Upload, AlertTriangle, X, Check, CalendarDays, GitMerge, FileDown, RefreshCw, Pencil, Filter, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Lancamentos } from './Lancamentos';
import { MultiSelect } from './MultiSelect';
import { useTransactionFilters } from '../hooks/useTransactionFilters';
import { parseDate, formatCurrency } from '../utils/finance';
import { resolveFlowFromConta, FLOW_DEPARA, FLOW_DEPARA_AMBIGUOUS } from '../utils/flowDePara';
import { resolveCompanyFromCCPadrao } from '../utils/ccPadraoDePara';
import { COMPANIES } from '../utils/finance';
import { ApplicationEvolutionPanel } from './ApplicationEvolutionPanel';

interface GestaoLancamentosProps {
  transactions: Transaction[];
  onAddTransaction: (t: Transaction) => void;
  onImportTransactions: (ts: Transaction[]) => void;
  onDeleteTransaction: (id: string) => void;
  onClearTransactions: (type: TransactionType) => void;
  onUpdateTransaction?: (t: Transaction) => void;
  /** Histórico de posições das Aplicações Financeiras (uma por importação/mês). */
  applicationSnapshots?: import('../hooks/useApplicationSnapshots').ApplicationSnapshot[];
}

type TabType = 'PAGAMENTOS' | 'RECEBIMENTOS' | 'APLICACOES' | 'CALENDARIO' | 'TIPO_FLUXO';

const TAB_TO_TYPE: Record<TabType, TransactionType> = {
  'PAGAMENTOS': TransactionType.PAYABLE,
  'RECEBIMENTOS': TransactionType.RECEIVABLE,
  'APLICACOES': TransactionType.APPLICATION,
  'CALENDARIO': TransactionType.CALENDAR,
  'TIPO_FLUXO': TransactionType.FLOW_TYPE
};

export const GestaoLancamentos: React.FC<GestaoLancamentosProps> = ({ transactions, onAddTransaction, onImportTransactions, onDeleteTransaction, onClearTransactions, onUpdateTransaction, applicationSnapshots = [] }) => {
  // Estado do Formulário (Abas)
  const [activeTab, setActiveTab] = useState<TabType>('PAGAMENTOS');
  
  // Estado dos Filtros (Unificado)
  const [filtros, setFiltros] = useState({
    empresa: 'all',
    fornecedor: [] as string[],
    cliente: [] as string[],
    tipoFluxo: 'all',
    produto: 'all',
    dataInicio: '',
    dataFim: ''
  });

  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);

  // Modal "informar fluxo": títulos importados sem fluxo (após o fallback).
  const [missingFlowOpen, setMissingFlowOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<Transaction[]>([]);
  const [pendingWarning, setPendingWarning] = useState('');
  const [flowDrafts, setFlowDrafts] = useState<Record<string, string>>({});

  // Modal "informar empresa": aplicações importadas cujo C/C Padrão não está
  // no De-Para (utils/ccPadraoDePara.ts). Agrupado por C/C Padrão — todas as
  // aplicações da mesma conta recebem a mesma empresa escolhida de uma vez.
  const [missingCompanyOpen, setMissingCompanyOpen] = useState(false);
  const [pendingImportApp, setPendingImportApp] = useState<Transaction[]>([]);
  const [companyDrafts, setCompanyDrafts] = useState<Record<string, string>>({}); // ccPadrao -> companyId
  const [pendingWarningApp, setPendingWarningApp] = useState('');

  // Lista de opções de fluxo (N3) a partir do De-Para, deduplicada por N3.
  const FLOW_OPTIONS = useMemo(() => {
    const m = new Map<string, { n3: string; n2: string; desc: string; fluxo: string }>();
    Object.values(FLOW_DEPARA).forEach(f => { if (!m.has(f.n3)) m.set(f.n3, { n3: f.n3, n2: f.n2, desc: f.desc, fluxo: f.fluxo }); });
    Object.values(FLOW_DEPARA_AMBIGUOUS).forEach(arr => arr.forEach(f => { if (!m.has(f.n3)) m.set(f.n3, { n3: f.n3, n2: f.n2, desc: f.desc, fluxo: f.fluxo }); }));
    return Array.from(m.values()).sort((a, b) => a.n3.localeCompare(b.n3));
  }, []);
  const n3ToN2 = useMemo(() => {
    const m: Record<string, string> = {};
    FLOW_OPTIONS.forEach(o => { m[o.n3] = o.n2; });
    return m;
  }, [FLOW_OPTIONS]);
  const n3ToFluxo = useMemo(() => {
    const m: Record<string, string> = {};
    FLOW_OPTIONS.forEach(o => { m[o.n3] = o.fluxo; });
    return m;
  }, [FLOW_OPTIONS]);

  // Direção esperada por tipo de lançamento: Contas a Pagar só aceita fluxo de
  // Saída; Contas a Receber só aceita fluxo de Entrada. Fluxos sem direção
  // conhecida no De-Para (raro) ficam disponíveis para os dois, para não
  // travar o usuário por falta de informação.
  const flowOptionsFor = (t: Transaction) => {
      if (t.type === TransactionType.PAYABLE) {
          return FLOW_OPTIONS.filter(o => o.fluxo !== 'Entrada');
      }
      if (t.type === TransactionType.RECEIVABLE) {
          return FLOW_OPTIONS.filter(o => o.fluxo !== 'Saída');
      }
      return FLOW_OPTIONS;
  };

  const [pasteText, setPasteText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- STATES MATCHING EXCEL COLUMNS EXACTLY ---
  const [dtPrevPagt, setDtPrevPagt] = useState(''); 
  const [empresa, setEmpresa] = useState('1'); 
  const [estab, setEstab] = useState('1'); 
  const [fornecedorCod, setFornecedorCod] = useState(''); 
  const [nomeFornecedor, setNomeFornecedor] = useState(''); 
  const [especie, setEspecie] = useState('NF'); 
  const [serie, setSerie] = useState(''); 
  const [titulo, setTitulo] = useState(''); 
  const [parc, setParc] = useState('1'); 
  const [unidadeNegocioCod, setUnidadeNegocioCod] = useState(''); 
  const [nomeUnidadeNegocio, setNomeUnidadeNegocio] = useState('300 Corporativo'); 
  const [tipoFluxoCod, setTipoFluxoCod] = useState(''); 
  const [nomeTipoFluxo, setNomeTipoFluxo] = useState(''); 
  const [dtLiquidacao, setDtLiquidacao] = useState(''); 
  const [valorOriginal, setValorOriginal] = useState(''); 
  const [nomeCC, setNomeCC] = useState(''); 
  const [conta, setConta] = useState(''); 
  const [nomeConta, setNomeConta] = useState(''); 

  // Generic/Receivables States
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState(''); 
  const [carteira, setCarteira] = useState(''); 

  // New States for Flow Type Specifics
  const [secao, setSecao] = useState('Analítica'); 
  const [direcaoFluxo, setDirecaoFluxo] = useState('Entrada'); 
  const [fluxoN2, setFluxoN2] = useState(''); 
  
  // Calendar Specific

  const resetForm = () => {
    setValorOriginal('');
    setTitulo('');
    setFornecedorCod('');
    setNomeFornecedor('');
    setCustomer('');
    setDescription('');
    setSerie('');
    setCarteira('');
    setTipoFluxoCod('');
    setNomeTipoFluxo('');
    setEspecie('NF'); 
    setConta('');
    setFluxoN2('');
    setDtPrevPagt('');
    setEditingId(null);
  };

  // Sincronizar filtro quando muda a aba
  const handleTabChange = (tab: TabType) => {
      setActiveTab(tab);
      resetForm();
      // Resetar os filtros específicos ao mudar de aba
      setFiltros(prev => ({ ...prev, fornecedor: [], cliente: [], tipoFluxo: 'all' }));
  };

  const handleEdit = (t: Transaction) => {
      setEditingId(t.id);
      
      // Determina a aba correta baseada no tipo da transação
      let targetTab: TabType = 'PAGAMENTOS';
      if (t.type === TransactionType.PAYABLE) targetTab = 'PAGAMENTOS';
      else if (t.type === TransactionType.RECEIVABLE) targetTab = 'RECEBIMENTOS';
      else if (t.type === TransactionType.APPLICATION) targetTab = 'APLICACOES';
      else if (t.type === TransactionType.CALENDAR) targetTab = 'CALENDARIO';
      else if (t.type === TransactionType.FLOW_TYPE) targetTab = 'TIPO_FLUXO';
      
      setActiveTab(targetTab);

      // Populate fields based on Active Tab logic
      if (targetTab === 'CALENDARIO') {
          setDescription(t.description);
          setDtPrevPagt(t.date);
          setEmpresa(t.companyCode || '');
          setFornecedorCod(t.supplierCode || '');
          setNomeFornecedor(t.supplier || '');
          setEspecie(t.species || '');
          setTitulo(t.documentNumber || '');
          setTipoFluxoCod(t.flowTypeCode || '');
          setFluxoN2(t.flowTypeLevel2 || '');
          setValorOriginal(t.value.toString());
      } else if (targetTab === 'RECEBIMENTOS') {
          setDtPrevPagt(t.date);
          setCustomer(t.customer || '');
          setCarteira(t.portfolio || '');
          setValorOriginal(t.value.toString());
          setTipoFluxoCod(t.flowTypeCode || '');
          setFluxoN2(t.flowTypeLevel2 || '');
      } else if (targetTab === 'TIPO_FLUXO') {
          setConta(t.accountCode || '');
          setTipoFluxoCod(t.flowTypeCode || '');
          setFluxoN2(t.species || '');
          setNomeTipoFluxo(t.description);
          setSecao(t.category);
          setDirecaoFluxo(t.costCenter || 'Entrada');
      } else {
          // Default Pagamentos
          setDtPrevPagt(t.date);
          setEmpresa(t.companyCode || '');
          setEstab(t.establishment || '');
          setFornecedorCod(t.supplierCode || '');
          setNomeFornecedor(t.supplier || '');
          setEspecie(t.species || '');
          setSerie(t.series || '');
          setTitulo(t.documentNumber || '');
          setParc(t.installment || '');
          setUnidadeNegocioCod(t.businessUnitCode || '');
          setNomeUnidadeNegocio(t.businessUnit || '');
          setTipoFluxoCod(t.flowTypeCode || '');
          setFluxoN2(t.flowTypeLevel2 || '');
          setNomeTipoFluxo(t.category || '');
          setValorOriginal(t.value.toString());
      }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const type = TAB_TO_TYPE[activeTab];
    if ((type === TransactionType.PAYABLE || type === TransactionType.RECEIVABLE) && !valorOriginal) return;

    const finalValue = valorOriginal ? parseFloat(valorOriginal) : 0;

    const transactionData: Transaction = {
      id: editingId || crypto.randomUUID(),
      type,
      status: 'REALIZADO',
      
      date: dtPrevPagt || new Date().toLocaleDateString('pt-BR'), 
      value: finalValue,
      
      category: activeTab === 'TIPO_FLUXO' ? secao : 
                activeTab === 'CALENDARIO' ? 'Obrigação Recorrente' :
                (activeTab === 'PAGAMENTOS' ? (nomeTipoFluxo || 'Geral') : (nomeTipoFluxo || 'Geral')),
      
      description: activeTab === 'PAGAMENTOS' ? nomeFornecedor : 
                   activeTab === 'CALENDARIO' ? description : 
                   activeTab === 'TIPO_FLUXO' ? nomeTipoFluxo :
                   (customer || description),
      
      companyCode: empresa,
      establishment: estab,
      supplierCode: fornecedorCod, 
      supplier: nomeFornecedor,
      
      species: activeTab === 'TIPO_FLUXO' ? fluxoN2 : especie,
               
      series: serie,
      documentNumber: titulo,
      installment: parc,
      businessUnitCode: unidadeNegocioCod,
      businessUnit: nomeUnidadeNegocio,
      
      flowTypeCode: tipoFluxoCod, 
      flowTypeLevel2: (activeTab === 'PAGAMENTOS' || activeTab === 'RECEBIMENTOS' || activeTab === 'CALENDARIO') ? fluxoN2 : undefined,
      
      liquidationDate: dtLiquidacao,
      
      costCenter: activeTab === 'TIPO_FLUXO' ? direcaoFluxo : nomeCC,
      accountCode: conta, 
      accountName: nomeConta,

      customer: activeTab === 'RECEBIMENTOS' ? customer : undefined,
      portfolio: activeTab === 'RECEBIMENTOS' ? carteira : undefined,
    };

    if (editingId && onUpdateTransaction) {
        onUpdateTransaction(transactionData);
    } else {
        onAddTransaction(transactionData);
    }
    
    resetForm();
  };

  // ... (Funções de Importação/Exportação mantidas, omitindo para brevidade se não forem alteradas, mas preciso incluí-las para o arquivo funcionar)
  // Vou incluir as funções essenciais simplificadas ou completas. Como estou criando o arquivo, preciso de tudo.
  
  const handleDownloadTemplate = () => {
      // Lógica original mantida
      let headers = '';
      let example = '';
      let filename = '';
  
      if (activeTab === 'TIPO_FLUXO') {
          headers = 'Conta TOTVS;Fluxo nivel 3;Fluxo nível 2;Descrição;Seção;Fluxo';
          example = '114101;10001;100;Antecipações - Cliente;Analítica;Entrada';
          filename = 'Modelo_Tipo_Fluxo.csv';
      } else if (activeTab === 'CALENDARIO') {
          headers = 'DT PREV PAGT;EMPRESA;FORNECEDOR;NOME FORNECEDOR;ESPECIE;TITULO;TIPO DE FLUXO;VALOR;FLUXO N2';
          example = 'Folha de pagamento (quinzena) - Débito;;BANESTES S.A;15;50000.00;';
          filename = 'Modelo_Calendario.csv';
      } else if (activeTab === 'RECEBIMENTOS') {
          headers = 'DT PREVISÃO LIQUIDAÇÃO;EMPRESA;ESTABELECIMENTO;CLIENTE;NOME CLIENTE;ESPÉCIE;SÉRIE;TÍTULO;PARCELA;CARTEIRA;UNIDADE DE NEGÓCIO;NOME UNIDADE DE NEGÓCIO;TIPO DE FLUXO;NOME TIPO DE FLUXO;DT EMISSÃO;DT VENCIMENTO;DT LIQUIDAÇÃO;VL SALDO TÍTULO;VL ORIGINAL TÍTULO;VL CONSIDERADO';
          example = '03/02/2026;1;1;357729;CLIENTE EXEMPLO;HUB;bca;11063815;1 PAR;720;Fonte HUB;10801;Projetos;14/01/2026;03/02/2026;31/12/9999;2000;2000;2000;100';
          filename = 'Modelo_Recebimentos_Completo.csv';
      } else {
          headers = 'DT PREV PAGT;EMPRESA;ESTAB;FORNECEDOR;NOME FORNECEDOR;ESPECIE;SERIE;TITULO;PARC;UNIDADE DE NEGOCIO;NOME UNIDADE DE NEGOCIO;FLUXO NIVEL 2;TIPO DE FLUXO;NOME TIPO DE FLUXO;DT LIQUIDACAO;VALOR ORIGINAL;VL CONSIDERADO;NOME CC;CONTA;NOME CONTA;INVESTIMENTO;VLR SALDO CC CONTA';
          example = '25/12/2025;1;1;200300;Fornecedor Teste;NF;1;12345;1;100;300 Corporativo;100;20000;Pagamento Fornecedores;25/12/2025;1500.00;1500.00;Administrativo;1001;Despesas Gerais;Projeto Reforma;1500.00';
          filename = `Modelo_Pagamentos_Completo.csv`;
      }
  
      const csvContent = "data:text/csv;charset=utf-8," + headers + "\n" + example;
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Lógica original mantida
      const file = e.target.files?.[0];
      if (!file) return;
  
      const reader = new FileReader();
      const isBinary = file.name.toLowerCase().endsWith('.xls') || file.name.toLowerCase().endsWith('.xlsx');
  
      if (isBinary) {
          reader.readAsArrayBuffer(file);
          reader.onload = (e) => {
              const data = new Uint8Array(e.target?.result as ArrayBuffer);
              const workbook = XLSX.read(data, { type: 'array', codepage: 65001 });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              // Converte pra array de arrays (preserva acentos e todos os caracteres)
              const rows: string[][] = XLSX.utils.sheet_to_json(worksheet, { 
                  header: 1, raw: false, defval: '' 
              });
              if (rows.length < 2) { alert('Planilha vazia ou sem dados.'); return; }

              // Corrige colunas de DATA: o SheetJS (raw:false) formata a célula usando
              // o formato numérico ORIGINAL dela no Excel — que pode ser um código
              // genérico "Data Curta" interpretado pelo SheetJS como americano
              // (ex.: célula mostra "31/01/2023" no Excel, mas o SheetJS devolve
              // "1/31/2023"). Corrige pegando o valor BRUTO (serial do Excel) dessas
              // colunas e convertendo com a mesma lógica confiável de parseDateExcel,
              // em vez de confiar na string já formatada pelo SheetJS.
              const dateColRegex = /^DT |DATA$|DATA |VENC|EMISS|LIQUID/i;
              const headerRow = rows[0] || [];
              const dateColIndexes = headerRow
                  .map((h, idx) => ({ h: String(h ?? '').trim(), idx }))
                  .filter(({ h }) => dateColRegex.test(h))
                  .map(({ idx }) => idx);

              if (dateColIndexes.length > 0) {
                  const rowsRaw: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                      header: 1, raw: true, defval: ''
                  });
                  for (let i = 1; i < rows.length; i++) {
                      const rawRowVals = rowsRaw[i];
                      if (!rawRowVals) continue;
                      dateColIndexes.forEach(idx => {
                          const rawVal = rawRowVals[idx];
                          // Serial Excel = número puro → converte na mão (confiável,
                          // independente de locale). Texto já formatado → não mexe.
                          if (typeof rawVal === 'number' && rawVal > 10000 && rawVal < 73000) {
                              const excelBase = new Date(Date.UTC(1899, 11, 30));
                              excelBase.setUTCDate(excelBase.getUTCDate() + rawVal);
                              rows[i][idx] = `${String(excelBase.getUTCDate()).padStart(2, '0')}/${String(excelBase.getUTCMonth() + 1).padStart(2, '0')}/${excelBase.getUTCFullYear()}`;
                          }
                      });
                  }
              }

              // Monta texto semicolon-separated manualmente (sem passar por CSV)
              const csvText = rows.map(row => row.map(cell => String(cell ?? '')).join(';')).join('\n');
              console.log('XLSX HEADERS DIRETO:', rows[0]);
              console.log('XLSX PRIMEIRA LINHA:', rows[1]);
              processCSV(csvText);
          };
      } else {
          // Tenta UTF-8 primeiro; se tiver caracteres corrompidos, tenta Latin-1
          reader.readAsText(file, 'utf-8');
          reader.onload = (event) => {
            let text = event.target?.result as string;
            // Detecta encoding errado: \uFFFD (replacement char) ou padrões típicos de Latin-1 lido como UTF-8
            const hasEncodingIssue = text.includes('\uFFFD') || /[\xC0-\xFF][\x80-\xBF]/.test(text.slice(0, 500)) || text.includes('M-') || text.includes('\ufffd');
            if (hasEncodingIssue) {
                const readerLatin = new FileReader();
                readerLatin.readAsText(file, 'windows-1252');
                readerLatin.onload = (e2) => {
                    processCSV(e2.target?.result as string);
                };
                return;
            }
            processCSV(text);
          };
      }
      
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processCSV = (text: string) => {
      text = text.replace(/\r/g, '\n');
      let lines = text.split(/\r\n|\n/).filter(l => l.trim().length > 0);
      if (lines.length < 2) {
          alert("Conteúdo insuficiente.");
          return;
      }

      // Aplicações: o relatório TOTVS traz uma linha de título do relatório
      // ANTES do cabeçalho real (ex.: "rs_sea_operac_financ: Por Banco").
      // Localiza a linha que de fato tem os cabeçalhos e descarta o que vem antes.
      if (activeTab === 'APLICACOES') {
          const headerIdx = lines.findIndex(l => {
              const up = l.toUpperCase();
              return up.includes('BANCO') && up.includes('PRODUTO') && up.includes('VENCTO');
          });
          if (headerIdx > 0) lines = lines.slice(headerIdx);
      }

      const firstLine = lines[0];

      let separator = ';';
      if (firstLine.includes('\t')) separator = '\t';
      else if (firstLine.includes(';')) separator = ';';
      else if (firstLine.includes(',')) separator = ',';

      if (firstLine.split(separator).length === 1) {
          separator = '\t';
      }
      
      const normalizeHeader = (h: string) => {
          if (!h) return '';
          return h
              .replace(/\uFEFF/g, '')
              .replace(/\t/g, ' ')
              .replace(/[\r\n]+/g, '')
              .replace(/\//g, ' ')
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              .replace(/[^\w\s]/g, '')
              .replace(/_/g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .toUpperCase();
      };
      const rawHeaders = firstLine.replace(/^\uFEFF/, '').split(separator).map(h => h.replace(/^"|"$/g, ''));
      const headers = rawHeaders.map(h => normalizeHeader(h));
      console.log('HEADERS RAW (originais do arquivo)', rawHeaders);
      console.log('HEADERS NORMALIZADOS', headers);
      console.log('DEBUG HEADERS LENGTH', headers.length);
      console.log('DEBUG HEADERS ARRAY', headers);
      const colMap: Record<string, number> = {};
      headers.forEach((h, i) => colMap[h] = i);
      console.log('COLUNAS IDENTIFICADAS', Object.fromEntries(Object.entries(colMap).filter(([k]) => k.length > 0)));

      // Bloqueador: detecta pelo cabeçalho do arquivo qual aba ele realmente é
      // (Pagamentos tem FORNECEDOR, Recebimentos tem CLIENTE, Aplicações tem
      // BANCO+PRODUTO, Tipo de Fluxo tem CONTA TOTVS+FLUXO NIVEL sem
      // fornecedor/cliente). Se bater com uma aba DIFERENTE da que está aberta,
      // avisa antes de importar no lugar errado — em vez de importar calado.
      const TAB_LABELS: Record<TabType, string> = {
          PAGAMENTOS: 'Pagamentos', RECEBIMENTOS: 'Recebimentos', APLICACOES: 'Aplicações',
          CALENDARIO: 'Calendário', TIPO_FLUXO: 'Tipo de Fluxo',
      };
      const detectFileTabType = (cols: Record<string, number>): TabType | null => {
          const has = (k: string) => cols[k] !== undefined;
          const hasBanco      = has('BANCO');
          const hasProduto    = has('PRODUTO');
          const hasCCPadrao   = has('C C PADRAO') || has('CC PADRAO');
          const hasCliente    = has('CLIENTE') || has('NOME CLIENTE') || has('COD CLIENTE') || has('CLIENTE COD');
          const hasFornecedor = has('FORNECEDOR') || has('NOME FORNECEDOR') || has('COD FORNECEDOR') || has('FORNEC');
          const hasFluxoNivel = (has('FLUXO NIVEL 3') || has('FLUXO NIVEL 2')) && has('CONTA TOTVS');

          if (hasBanco && hasProduto) return 'APLICACOES';
          if (hasCCPadrao) return 'APLICACOES';
          if (hasFluxoNivel && !hasFornecedor && !hasCliente) return 'TIPO_FLUXO';
          if (hasCliente && !hasFornecedor) return 'RECEBIMENTOS';
          if (hasFornecedor && !hasCliente) return 'PAGAMENTOS';
          return null; // colunas ambíguas/insuficientes — não arrisca bloquear à toa
      };
      const detectedTab = detectFileTabType(colMap);
      if (detectedTab && detectedTab !== activeTab) {
          const prosseguir = window.confirm(
              `⚠️ Este arquivo parece ser de "${TAB_LABELS[detectedTab]}", mas a aba aberta é "${TAB_LABELS[activeTab]}".\n\n` +
              `Importar aqui pode gravar os dados no lugar errado.\n\n` +
              `Clique em OK para importar mesmo assim, ou Cancelar para parar e trocar de aba primeiro.`
          );
          if (!prosseguir) {
              if (fileInputRef.current) fileInputRef.current.value = '';
              return;
          }
      }

      const newTransactions: Transaction[] = [];
      const type = TAB_TO_TYPE[activeTab];

      // Diagnóstico: campos-chave que o parser não localizou nos headers
      const expectedKeys = {
          'PAGAMENTOS': ['DT PREV PAGT', 'EMPRESA', 'FORNECEDOR', 'NOME FORNECEDOR', 'ESPECIE', 'TITULO', 'TIPO DE FLUXO', 'VALOR'],
          'RECEBIMENTOS': ['DT PREVISAO LIQUIDACAO', 'EMPRESA', 'CLIENTE', 'NOME CLIENTE', 'ESPECIE', 'TITULO', 'TIPO DE FLUXO', 'VL CONSIDERADO'],
      };
      const keysToCheck = expectedKeys[activeTab as keyof typeof expectedKeys];
      let missingColsWarning = '';
      if (keysToCheck) {
          const missing = keysToCheck.filter(k => {
              const norm = k.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
              return !Object.keys(colMap).some(h => h === norm || h.includes(norm) || norm.includes(h));
          });
          if (missing.length > 0) {
              missingColsWarning = `\n\n⚠️ Colunas não encontradas no arquivo:\n${missing.join(', ')}\n\nEssas colunas ficaram em branco. Se precisar delas, exporte do TOTVS com essas colunas incluídas.`;
              console.warn('⚠️ COLUNAS NÃO ENCONTRADAS NO ARQUIVO:', missing);
              console.warn('Headers disponíveis no arquivo:', rawHeaders);
          }
      }
      console.log('DEBUG IMPORT', { activeTab, type });

      const parseNumber = (v: string) => {
          if (!v) return 0;
          let valStr = v.trim().replace(/^R\$\s?/, '').replace(/\s/g, '');
          if (valStr.startsWith('(') && valStr.endsWith(')')) valStr = '-' + valStr.slice(1, -1);

          // Detecta o formato pelo separador que aparece POR ÚLTIMO — funciona
          // mesmo com BR ("1.234,56") e US ("1,234.56") misturados no mesmo
          // arquivo, que é exatamente o que acontece quando parte da planilha
          // vem de export do TOTVS (BR) e parte foi digitada/colada à mão no
          // Excel com o padrão numérico da célula em inglês (US). Sem isso,
          // "115,000.00" (cento e quinze mil, formato US) virava "115,00"
          // (cento e quinze reais) — erro de mil vezes no valor.
          const lastComma = valStr.lastIndexOf(',');
          const lastDot = valStr.lastIndexOf('.');
          if (lastComma !== -1 && lastDot !== -1) {
              if (lastComma > lastDot) {
                  // BR: ponto é milhar, vírgula é decimal
                  valStr = valStr.replace(/\./g, '').replace(',', '.');
              } else {
                  // US: vírgula é milhar, ponto é decimal
                  valStr = valStr.replace(/,/g, '');
              }
          } else if (lastComma !== -1) {
              // só vírgula presente -> formato BR, vírgula é decimal
              valStr = valStr.replace(/\./g, '').replace(',', '.');
          }
          // só ponto ou nenhum separador -> já está no formato certo pro parseFloat

          return parseFloat(valStr) || 0;
      }

      // Suporta serial Excel (ex: 45000) além dos formatos normais de utils/finance.parseDate
      const parseDateExcel = (d: string) => {
          if (!d) return '';
          let dateStr = d.trim().replace(/^"|"$/g, '');
          // Serial Excel (número inteiro grande = dias desde 1900)
          if (/^\d+$/.test(dateStr)) {
               const serial = parseInt(dateStr);
               if (serial > 10000 && serial < 73000) {
                   const excelBase = new Date(Date.UTC(1899, 11, 30));
                   excelBase.setUTCDate(excelBase.getUTCDate() + serial);
                   return `${String(excelBase.getUTCDate()).padStart(2, '0')}/${String(excelBase.getUTCMonth() + 1).padStart(2, '0')}/${excelBase.getUTCFullYear()}`;
               }
          }
          if (dateStr.includes(' ')) dateStr = dateStr.split(' ')[0];
          // Ano com 2 dígitos: 26 → 2026
          const parts = dateStr.split('/');
          if (parts.length === 3 && parts[2].length <= 2) {
              const y = Number(parts[2]);
              parts[2] = String(y < 50 ? 2000 + y : 1900 + y);
              dateStr = parts.join('/');
          }
          return dateStr;
      };

      // Pre-load Flow Types for lookup (nome + nível 2)
      const flowTypeMap = new Map<string, string>();  // flowTypeCode → description
      const flowN2Map = new Map<string, string>();    // flowTypeCode → fluxo nível 2
      if (type === TransactionType.RECEIVABLE || type === TransactionType.PAYABLE || type === TransactionType.CALENDAR) {
          transactions.forEach(t => {
              if (t.type === TransactionType.FLOW_TYPE && t.flowTypeCode) {
                  const key = String(t.flowTypeCode).trim();
                  flowTypeMap.set(key, t.description);
                  if (t.species) flowN2Map.set(key, String(t.species).trim());
              }
          });
      }

      // Aplicações cujo C/C Padrão não tem empresa definida no De-Para são
      // desconsideradas na importação (decisão do usuário) — acumulado aqui
      // só para avisar quantas/quais foram descartadas no resumo final.
      const skippedAppAccounts = new Set<string>();
      let skippedAppCount = 0;

      for(let i=1; i<lines.length; i++) {
          if (!lines[i].trim()) continue;
          
          const rawRow = lines[i].split(separator).map(v => v.replace(/^"|"$/g, '').trim());

          // Se ainda assim o tamanho for muito discrepante, podemos validar, mas o usuário pediu para remover a validação rígida.
          // Vamos apenas garantir que temos colunas suficientes para não dar erro de índice.
          // Se faltar colunas, preenchemos com string vazia.
          if (Array.isArray(headers) && headers.length > 0) {
             while (rawRow.length < headers.length) {
                rawRow.push('');
             }
          }

          const row = rawRow.map(c => 
              c.normalize("NFKC")
               .replace(/\u00A0/g, " ")
               .replace(/\t+/g, " ")
               .replace(/\s+/g, " ")
               .trim()
          );
          


          const getVal = (possibleNames: string[]) => {
               for (const name of possibleNames) {
                   const normName = normalizeHeader(name);
                   if (colMap[normName] !== undefined) return row[colMap[normName]];
                   const foundKey = Object.keys(colMap).find(k => {
                       if (k === normName) return true;
                       if (normName.length <= 3) return k === normName || k.startsWith(normName + ' ') || k.endsWith(' ' + normName);
                       return k.includes(normName) || normName.includes(k);
                   });
                   if (foundKey !== undefined) return row[colMap[foundKey]];
               }
               return '';
          }

          let tr: Transaction | null = null;
          
          // Colunas genéricas para deteção rápida
          // DT PREV PAGT primeiro (data de previsão de pagamento)
          // NÃO incluir DT PREVISAO LIQUIDACAO aqui (é a data de liquidação prevista, geralmente 31/12/9999)
          const dtPrevRaw = getVal(['DT PREV PAGT', 'DT PREV REC', 'DT PREVISAO LIQUIDACAO', 'DT PREVISAO', 'DT VENCIMENTO', 'DATA', 'DT VENCTO', 'DIA']);
          // Valida se o texto tem CARA de data usável: dd/mm/aaaa (com ano de 2 ou
          // 4 dígitos), aaaa-mm-dd, ou serial Excel (número grande, >10000).
          // Um valor solto como "20" ou "6" (fragmento de dia, sem mês/ano) NÃO
          // é uma data válida — antes passava batido e virava a data da linha.
          const isValidDate = (d: string) => {
              if (!d) return false;
              const s = d.trim();
              // Serial Excel: número grande o suficiente pra ser uma data real.
              if (/^\d+$/.test(s)) {
                  const n = parseInt(s, 10);
                  return n > 10000 && n < 73000;
              }
              // dd/mm/aaaa ou dd/mm/aa
              const parts = s.split('/');
              if (parts.length === 3) {
                  let y = Number(parts[2]);
                  if (y < 100) y = y < 50 ? 2000 + y : 1900 + y;  // 26 → 2026
                  if (y > 2030) return false;  // 31/12/9999 e similares (placeholder TOTVS)
                  return !!(Number(parts[0]) && Number(parts[1]));
              }
              // aaaa-mm-dd
              const isoParts = s.split('-');
              if (isoParts.length === 3 && isoParts[0].length === 4) return true;
              return false;  // qualquer outra coisa (ex.: "20", "6") não é data completa
          };
          const dtPrev = isValidDate(dtPrevRaw) ? dtPrevRaw : '';
          
          if (type === TransactionType.CALENDAR) {
               const despesas  = getVal(['DESPESAS DE FOLHA CONVENCOES', 'DESPESAS', 'DESCRICAO']);
               const fornecCod = getVal(['FORNECEDOR', 'FORNEC', 'COD FORNECEDOR']);
               const nomeForn  = getVal(['NOME FORNECEDOR', 'NOME FORNEC']);
               const empresaImp = getVal(['EMPRESA', 'EMP']);
               const esp       = getVal(['ESPECIE', 'ESPÉCIE']);
               const tit       = getVal(['TITULO', 'TÍTULO']);
               const fluxoCod  = getVal(['TIPO DE FLUXO', 'FLUXO N3', 'FLUXO NIVEL 3', 'TIPO FLUXO']);
               let   fluxo2    = getVal(['FLUXO N2', 'FLUXO NIVEL 2']);
               // Lookup no cadastro de Tipo de Fluxo
               if (!fluxo2 && fluxoCod) {
                   const n2Cadastro = flowN2Map.get(String(fluxoCod).trim());
                   if (n2Cadastro) fluxo2 = n2Cadastro;
               }
               // Fallback (raro): a planilha do TOTVS quase sempre traz o fluxo.
               // Se NÃO vier o N3, tenta resolver pela Conta TOTVS no De-Para embutido.
               // Conta ambígua (vários N3 conforme produto) não é chutada — fica vazia.
               let fluxoCodFinal = fluxoCod;
               if (!fluxoCodFinal) {
                   const contaTotvs = getVal(['CONTA TOTVS', 'CONTA', 'CTB']);
                   const dep = resolveFlowFromConta(contaTotvs);
                   if (dep && dep !== 'AMBIGUOUS') {
                       fluxoCodFinal = dep.n3;
                       if (!fluxo2) fluxo2 = dep.n2;
                   }
               }
               const dataPrev  = getVal(['DT PREV PAGT', 'DATA PAGAMENTO', 'DT PREVISAO', 'DATA', 'DIA']);
               const valor     = getVal(['VALOR', 'VLR', 'R$']);

               if (despesas || nomeForn || fornecCod) {
                   tr = {
                       id: crypto.randomUUID(),
                       date: dataPrev || dtPrev || '',
                       description: despesas || nomeForn || '',
                       value: parseNumber(valor),
                       type,
                       status: 'PREVISTO',
                       category: 'Obrigação Recorrente',
                       businessUnit: 'Corporativo',
                       companyCode: empresaImp,
                       supplierCode: fornecCod,
                       supplier: nomeForn || despesas,
                       species: esp,
                       documentNumber: tit,
                       flowTypeCode: fluxoCodFinal,
                       flowTypeLevel2: fluxo2,
                   } as Transaction;
               }
          } else if (type === TransactionType.FLOW_TYPE) {
               const contaTotvs = getVal(['CONTA TOTVS', 'CONTA', 'CTB']);
               const code3 = getVal(['FLUXO NIVEL 3', 'CODIGO', 'COD TIPO', 'COD FLUXO']);
               const code2 = getVal(['FLUXO NIVEL 2', 'NIVEL 2']);
               const name = getVal(['DESCRICAO', 'NOME', 'TIPO FLUXO']);
               const nature = getVal(['SECAO', 'NATUREZA', 'SINTETICA', 'ANALITICA']);
               const direction = getVal(['FLUXO', 'ENTRADA', 'SAIDA']); 
               
               if (code3 || name) {
                   console.log('FLOW_TYPE ROW', { code3, name });
                   tr = {
                       id: crypto.randomUUID(),
                       date: new Date().toLocaleDateString('pt-BR'),
                       description: name,
                       value: 0,
                       type,
                       status: 'REALIZADO',
                       category: nature || 'Analítica',
                       costCenter: direction || '-',
                       flowTypeCode: code3,
                       businessUnit: 'Corporativo',
                       species: code2,
                       accountCode: contaTotvs
                   } as Transaction;
               }
          } else if (type === TransactionType.RECEIVABLE) {
               const empresa = getVal(['EMP', 'EMPRESA']);
               const estab = getVal(['ESTAB', 'ESTABELECIMENTO']);
               const clienteCod = getVal(['CLIENTE (COD)', 'CLIENTE COD', 'CLIENTE', 'COD CLIENTE']);
               const nomeCliente = getVal(['NOME CLIENTE', 'NOME', 'CLIENTE NOME']);
               const especie = getVal(['ESPECIE', 'ESP', 'TP DOCTO', 'TIPO DOCTO', 'TIPO DOC', 'TP DOCUMENTO']);
               const serie = getVal(['SER', 'SERIE']);
               const titulo = getVal(['TITULO', 'TIT', 'DOCUMENTO', 'NF', 'NUMERO', 'NR TITULO', 'NUM TITULO', 'NR TIT', 'NR DOCUMENTO']);
               const parcela = getVal(['PARC', 'PARCELA']);
               const carteira = getVal(['CART', 'CARTEIRA']);
               const unCod = getVal(['UN', 'UNIDADE DE NEGOCIO', 'UNIDADE']);
               const unNome = getVal(['NOME UN', 'NOME UNIDADE DE NEGOCIO', 'NOME UNIDADE']);
               
               const tpFluxo = getVal(['TP FLUXO', 'TIPO DE FLUXO', 'TIPO FLUXO']);
               let nmTpFluxo = getVal(['NOME TP FLUXO', 'NOME TIPO DE FLUXO', 'DESC TIPO FLUXO', 'NOME DO TIPO DE FLUXO', 'TIPO DE FLUXO NOME', 'DESCRICAO TIPO DE FLUXO', 'DESCRIÇÃO TIPO DE FLUXO']);
               
               if (!nmTpFluxo && tpFluxo) {
                   const normalizedTpFluxo = String(tpFluxo).trim();
                   const desc = flowTypeMap.get(normalizedTpFluxo);
                   if (desc) nmTpFluxo = desc;
                   else nmTpFluxo = 'Tipo de Fluxo não encontrado';
               }
               
               const dtEmissao = getVal(['DT EMISSAO', 'EMISSAO']);
               const dtVenc = getVal(['DT VENC', 'DT VENCIMENTO', 'VENCIMENTO']);
               const dtLiq = getVal(['DT LIQ', 'DT LIQUIDACAO', 'LIQUIDACAO']);
               const vlSaldo = getVal(['VL SALDO', 'VL SALDO TITULO', 'SALDO', 'VALOR SALDO']);
               const vlOriginal = getVal(['VL ORIG', 'VL ORIGINAL TITULO', 'VALOR ORIGINAL']);
               const vlConsiderado = getVal(['VLR ORIGINAL CC CONTA', 'VLR ORIGINAL CC/CONTA', 'VL CONSID', 'VL CONSIDERADO', 'VALOR', 'VLR LIQUIDO', 'R$', 'VALOR RECEBER']);

               let flowLevel2 = getVal(['FLUXO NIVEL 2', 'FLUXO N2', 'NIVEL 2']);
               // Fallback (raro) por Conta TOTVS quando o N3 não vier na planilha.
               let tpFluxoFinal = tpFluxo;
               if (!tpFluxoFinal) {
                   const contaTotvsR = getVal(['CONTA TOTVS', 'CONTA', 'CTB']);
                   const depR = resolveFlowFromConta(contaTotvsR);
                   if (depR && depR !== 'AMBIGUOUS') {
                       tpFluxoFinal = depR.n3;
                       if (!flowLevel2) flowLevel2 = depR.n2;
                   }
               }
               // Prioridade 1: Lookup no cadastro de Tipo de Fluxo
               if (!flowLevel2 && tpFluxo) {
                   const n2Cadastro = flowN2Map.get(String(tpFluxo).trim());
                   if (n2Cadastro) flowLevel2 = n2Cadastro;
               }
               // Prioridade 2: Fallback por truncamento do código
               if (!flowLevel2 && tpFluxo && tpFluxo.length > 2) {
                  const rawCode = tpFluxo.replace(/\./g, '');
                  if (tpFluxo.includes('.')) {
                      const parts = tpFluxo.split('.');
                      if (parts.length >= 2) flowLevel2 = parts.slice(0, parts.length - 1).join('.');
                  } else {
                      flowLevel2 = rawCode.substring(0, 3);
                  }
               }

               let categoryVal = nmTpFluxo || 'Recebimento';
               if (flowLevel2 === '201') categoryVal = 'Pessoal';

               if (dtPrev || titulo) {
                   tr = {
                       id: crypto.randomUUID(),
                       date: parseDateExcel(dtPrev),
                       companyCode: empresa,
                       establishment: estab,
                       customerCode: clienteCod,
                       customer: nomeCliente,
                       description: nomeCliente || 'Cliente Diverso',
                       species: especie,
                       series: serie,
                       documentNumber: titulo,
                       installment: parcela,
                       portfolio: carteira,
                       businessUnitCode: unCod,
                       businessUnit: unNome,
                       flowTypeCode: tpFluxoFinal,
                       flowTypeLevel2: flowLevel2,
                       category: categoryVal,
                       emissionDate: parseDateExcel(dtEmissao),
                       dueDate: parseDateExcel(dtVenc),
                       liquidationDate: parseDateExcel(dtLiq),
                       balanceTitleValue: parseNumber(vlSaldo),
                       originalTitleValue: parseNumber(vlOriginal),
                       value: parseNumber(vlConsiderado),
                       type,
                       status: 'PREVISTO'
                   } as Transaction;
               }

          } else if (type === TransactionType.APPLICATION) {
               // Base de Aplicações Financeiras (relatório TOTVS: Banco/Produto/
               // Operação/Data/Vencto/Moeda/C-C Padrão/Situação/Sdo Operação/
               // Em Andamento/Categoria). Ignora linhas de título/rodapé do
               // relatório (não têm valor de saldo válido).
               const bancoCod   = getVal(['BANCO']);
               const produto    = getVal(['PRODUTO']);
               const operacao   = getVal(['OPERACAO', 'OPERAÇÃO']);
               const dtOperacao = getVal(['DATA']);
               const dtVencto   = getVal(['VENCTO', 'VENCIMENTO']);
               const ccPadrao   = getVal(['C/C PADRAO', 'CC PADRAO', 'C C PADRAO']);
               const situacao   = getVal(['SITUACAO']);
               const sdoOperacao = getVal(['SDO OPERACAO', 'SALDO OPERACAO']);
               const emAndamento = getVal(['EM ANDAMENTO']);
               const categoria  = getVal(['CATEGORIA']);

               const valorSaldo = parseNumber(sdoOperacao);
               // Linha de título/rodapé do relatório TOTVS: sem saldo, descarta.
               if (valorSaldo !== 0 && ccPadrao) {
                   const companyId = resolveCompanyFromCCPadrao(ccPadrao);
                   if (!companyId) {
                       // Conta sem empresa definida no De-Para (ex.: BANES-TEMP,
                       // BANESAMALF, Banes-PF, Banes-TM2) — decisão do usuário:
                       // DESCONSIDERAR ao importar, não perguntar nem gravar.
                       skippedAppAccounts.add(ccPadrao);
                       skippedAppCount++;
                   } else {
                       const companyName = COMPANIES.find(c => c.id === companyId)?.name;
                       tr = {
                           id: crypto.randomUUID(),
                           // Posição ATUAL (data da importação) — não a data de
                           // contratação do CDB/Fundo. Ver utils/ccPadraoDePara.ts
                           // e a conversa com o usuário: usar a data original faria
                           // o sistema tratar o saldo inteiro como saída de caixa
                           // naquele dia passado, distorcendo DFC/alertas/resumo.
                           date: new Date().toLocaleDateString('pt-BR'),
                           emissionDate: parseDateExcel(dtOperacao),  // referência apenas
                           dueDate: parseDateExcel(dtVencto),          // referência apenas
                           value: valorSaldo,
                           type: TransactionType.APPLICATION,
                           status: 'REALIZADO',
                           description: `${produto || 'Aplicação'} ${operacao || ''} — ${ccPadrao}`.trim(),
                           companyCode: companyId,
                           establishment: ccPadrao,
                           accountCode: bancoCod,
                           documentNumber: operacao,
                           species: situacao,
                           category: produto || categoria || 'Aplicação',
                           businessUnit: companyName || 'Sem empresa definida',
                       } as Transaction;
                   }
               }

          } else {
              // PAGAMENTOS
              const dtVenc = getVal(['DT VENCIMENTO', 'VENCIMENTO']);
              const dtLiq = getVal(['DT LIQUID', 'DT LIQUIDACAO', 'PAGAMENTO']);
              let valConsid = parseNumber(getVal(['VLR ORIGINAL CC CONTA', 'VLR ORIGINAL CC/CONTA', 'VL ORIGINAL CC CONTA', 'VL CONSIDER', 'VALOR', 'VL CONSIDERADO', 'VLR LIQUIDO', 'R$']));
              
              const supplierVal = getVal(['NOME FORNECEDOR', 'NOME FORNEC', 'RAZAO SOCIAL']);
              const supplierCodeVal = getVal(['COD FORN', 'FORNECEDOR', 'FORNECEDOR COD', 'COD FORNECEDOR', 'COD FORNEC']);
              const histVal = getVal(['HISTORICO', 'DESCRICAO']);
              const desc = supplierVal || histVal || 'Transação Importada';
              
              let dateToUse = dtPrev || (isValidDate(dtVenc) ? dtVenc : '') || (isValidDate(dtLiq) ? dtLiq : '');
              let statusToUse = (dtLiq && isValidDate(dtLiq)) ? 'REALIZADO' : 'PREVISTO';

              // Detecção Automática de Realizado (Se tiver DATA PAGAMENTO)
              const dtPagamentoReal = getVal(['DATA PAGAMENTO', 'DT PAGAMENTO']);
              if (dtPagamentoReal) {
                  statusToUse = 'REALIZADO';
                  dateToUse = dtPagamentoReal;

                  // Prioridade: Líquido > Pagamento > Original
                  const vLiq = parseNumber(getVal(['VALOR LIQUIDO', 'VLR LIQUIDO', 'VL LIQUIDO']));
                  const vPag = parseNumber(getVal(['VALOR PAGAMENTO', 'VLR PAGAMENTO', 'VL PAGAMENTO', 'VALOR PAGO']));
                  const vOrig = parseNumber(getVal(['VALOR ORIGINAL', 'VLR ORIGINAL', 'VL ORIGINAL']));

                  if (vLiq !== 0) valConsid = vLiq;
                  else if (vPag !== 0) valConsid = vPag;
                  else if (vOrig !== 0) valConsid = vOrig;
              }

              let flowCode = getVal(['TIPO DE FLUXO', 'COD TIPO FLUXO', 'TP FLUXO']);
              let flowLevel2 = getVal(['FLUXO N2', 'FLUXO NIVEL 2', 'NIVEL 2', 'COD NIVEL 2']);
              let categoryVal = getVal(['NOME TIPO DE FLUXO', 'DESC TIPO FLUXO', 'CATEGORIA', 'NOME TIPO FLUXO', 'NOME TP FLUXO', 'NOME DO TIPO DE FLUXO', 'TIPO DE FLUXO NOME', 'DESCRICAO TIPO DE FLUXO', 'DESCRIÇÃO TIPO DE FLUXO']) || '';
              // O TOTVS às vezes repete o próprio código na coluna do "nome" (ex.:
              // "20520"). Nesse caso o cadastro de Tipo de Fluxo (se tiver o nome
              // de verdade) é preferido — senão a coluna "Nome Tipo de Fluxo" só
              // mostraria o código de novo, sem servir pra nada.
              const looksLikeCode = (v: string) => !v || /^\d+$/.test(v.trim()) || v.trim() === String(flowCode).trim();
              if (looksLikeCode(categoryVal) && flowCode) {
                  const descCadastro = flowTypeMap.get(String(flowCode).trim());
                  if (descCadastro) categoryVal = descCadastro;
              }
              if (!categoryVal) categoryVal = 'Geral';
              
              // Prioridade 1: Lookup no cadastro de Tipo de Fluxo
              if (!flowLevel2 && flowCode) {
                  const n2Cadastro = flowN2Map.get(String(flowCode).trim());
                  if (n2Cadastro) flowLevel2 = n2Cadastro;
              }
              // Prioridade 2: Fallback por truncamento do código
              if (!flowLevel2 && flowCode && flowCode.length > 2) {
                  const rawCode = flowCode.replace(/\./g, '');
                  if (flowCode.includes('.')) {
                      const parts = flowCode.split('.');
                      if (parts.length >= 2) flowLevel2 = parts.slice(0, parts.length - 1).join('.');
                  } else {
                      flowLevel2 = rawCode.substring(0, 3);
                  }
              }

              if (flowLevel2 === '201') categoryVal = 'Pessoal';

              const investmentVal = getVal(['INVESTIMENTO']);
              let isInvestment = false;
              if (investmentVal && investmentVal.trim() !== '') {
                  categoryVal = 'Investimento';
                  isInvestment = true;
                  if (!flowCode) {
                      flowCode = '401'; 
                  }
              }

              let finalValue = valConsid;
              if (isInvestment && finalValue === 0) {
                   const rawSaldoCC = getVal(['VL SALDO CC CONTA', 'VLR SALDO CC CONTA', 'VLR SALDO CC', 'SALDO CC', 'VLR SALDO CC/CONTA']);
                   const saldoCC = parseNumber(rawSaldoCC);
                   if (saldoCC !== 0) finalValue = saldoCC;
              }

              if (finalValue || dateToUse) {
                  tr = {
                      id: crypto.randomUUID(),
                      date: parseDateExcel(dateToUse),
                      value: finalValue,
                      type: type,
                      status: statusToUse,
                      description: desc,
                      companyCode: getVal(['EMPRESA', 'COD EMPRESA', 'EMP']),
                      establishment: getVal(['ESTAB', 'ESTABELECIMENTO']),
                      supplierCode: supplierCodeVal,
                      supplier: supplierVal,
                      species: getVal(['ESPECIE', 'ESP', 'TP DOCTO', 'TIPO DOCTO', 'TIPO DOC', 'TP DOCUMENTO']), 
                      series: getVal(['SERIE', 'SER']),     
                      documentNumber: getVal(['TITULO', 'TIT', 'DOCUMENTO', 'NF', 'NUMERO', 'NR TITULO', 'NUM TITULO', 'NR TIT', 'NR DOCUMENTO', 'NO TITULO']),
                      installment: getVal(['PARC', 'PARCELA']),
                      businessUnitCode: getVal(['U.N.', 'UNIDADE DE NEGOCIO', 'COD UN', 'UNIDADE']), 
                      businessUnit: getVal(['NOME U.N.', 'NOME UNIDADE DE NEGOCIO', 'NOME UN', 'DESC UNIDADE']) || 'Corporativo',
                      flowTypeCode: flowCode,
                      flowTypeLevel2: flowLevel2,
                      category: categoryVal,
                      liquidationDate: parseDateExcel(dtLiq),
                      originalTitleValue: parseNumber(getVal(['VL ORIGIN', 'VALOR ORIGINAL', 'VLR ORIGINAL', 'VL ORIGINAL TITULO'])),
                      balanceTitleValue: parseNumber(getVal(['VL SALDO', 'SALDO TITULO'])),
                      costCenter: getVal(['CC', 'NOME CC', 'CENTRO CUSTO', 'DESC CC']),
                      accountCode: getVal(['CONTA', 'CONTA CONTABIL']),
                      accountName: getVal(['NOME CONTA', 'NOME CTA', 'DESC CONTA']),
                      investmentDescription: investmentVal, 
                  } as Transaction;
              }
          }

          if (tr) newTransactions.push(tr);
      }

      // Antes de importar: existe título a pagar/receber SEM fluxo (após o fallback
      // por Conta TOTVS)? Se sim, pergunta ao usuário e dá a opção de informar o
      // fluxo de cada um antes de concluir a importação.
      const semFluxo = newTransactions.filter(t =>
          (t.type === TransactionType.PAYABLE || t.type === TransactionType.RECEIVABLE)
          && !String(t.flowTypeCode || '').trim()
      );
      if (semFluxo.length > 0) {
          const drafts: Record<string, string> = {};
          semFluxo.forEach(t => { drafts[t.id] = ''; });
          setPendingImport(newTransactions);
          setPendingWarning(missingColsWarning);
          setFlowDrafts(drafts);
          setMissingFlowOpen(true);
          return; // aguarda o usuário informar os fluxos no modal
      }

      // Aplicações: contas sem empresa definida foram descartadas acima —
      // avisa no resumo final quais/quantas, para transparência.
      let appSkipWarning = '';
      if (skippedAppCount > 0) {
          appSkipWarning = `\n\n⚠️ ${skippedAppCount} aplicaç${skippedAppCount === 1 ? 'ão' : 'ões'} desconsiderada(s) por não ter empresa definida: ${[...skippedAppAccounts].join(', ')}.`;
      }

      commitImport(newTransactions, missingColsWarning + appSkipWarning);
  };

  // Conclui a importação: grava e (quando fizer sentido) gera os recorrentes.
  // Chamado direto (sem fluxo faltante) ou após o modal de "informar fluxo".
  //
  // O Calendário é um CADASTRO FIXO: importado uma vez, persiste no IndexedDB
  // e não precisa ser reimportado. A geração/reconciliação Calendário × Pagamentos
  // acontece quando os PAGAMENTOS são importados (ou pelo botão "Verificar & Gerar").
  // GUARDA: importar o Calendário sem nenhum Pagamento REAL no sistema apenas SALVA
  // as obrigações — não gera previsões (senão geraria tudo, sem ter contra o que casar).
  const commitImport = (newTransactions: Transaction[], missingColsWarning: string) => {
      const importPayables = [
          ...transactions.filter(t => t.type === TransactionType.PAYABLE),
          ...newTransactions.filter(t => t.type === TransactionType.PAYABLE),
      ];
      const importCalendar = [
          ...transactions.filter(t => t.type === TransactionType.CALENDAR),
          ...newTransactions.filter(t => t.type === TransactionType.CALENDAR),
      ];

      // Pagamento REAL = não foi gerado pelo próprio Calendário.
      const hasRealPayables = importPayables.some(p => !p.generatedFromCalendarId);
      const skipGeneration = activeTab === 'CALENDARIO' && !hasRealPayables;

      let calAdditions: Transaction[] = [];
      let calDeletions: string[] = [];
      const existingCalUpdates: Transaction[] = [];
      if (!skipGeneration) {
          const { updates: calUpdates, additions, deletions } = runCalendarGeneration(importCalendar, importPayables);
          calAdditions = additions;
          calDeletions = deletions;
          newTransactions.push(...calAdditions);
          calUpdates.forEach(u => {
              const idx = newTransactions.findIndex(t => t.id === u.id);
              if (idx >= 0) newTransactions[idx] = u;          // obrigação ainda no lote -> atualiza em memória
              else existingCalUpdates.push(u);                 // obrigação já no estado -> via callback
          });
      }

      if (newTransactions.length > 0) {
          onImportTransactions(newTransactions);
          existingCalUpdates.forEach(u => onUpdateTransaction && onUpdateTransaction(u));
          calDeletions.forEach(id => onDeleteTransaction(id));   // reconciliação: remove gerados cujo real chegou
          const partes: string[] = [];
          if (skipGeneration) partes.push(`Calendário salvo (cadastro fixo). Importe os Pagamentos ou use "Verificar & Gerar" para gerar as previsões.`);
          if (calAdditions.length > 0) partes.push(`${calAdditions.length} pagamento(s) recorrente(s) gerado(s) automaticamente (faltavam).`);
          if (calDeletions.length > 0) partes.push(`${calDeletions.length} pagamento(s) gerado(s) removido(s) por reconciliação (o real chegou).`);
          const extra = partes.length > 0 ? `\n\n` + partes.join('\n') : '';

          // Diagnóstico: listar fornecedores tributários para identificar Municipal/Estadual
          const taxTransactions = newTransactions.filter(t => {
              const n2 = (t.flowTypeLevel2 || '').trim();
              return n2 === '209' || n2 === '215' || (t.category || '').toUpperCase().includes('TRIBUT') || (t.category || '').toUpperCase().includes('IMPOSTO');
          });
          if (taxTransactions.length > 0) {
              const uniqueSuppliers = new Map<string, string>();
              taxTransactions.forEach(t => {
                  const code = t.supplierCode || '?';
                  const name = t.supplier || t.description || '?';
                  if (!uniqueSuppliers.has(code)) uniqueSuppliers.set(code, name);
              });
              console.log('📋 FORNECEDORES TRIBUTÁRIOS IMPORTADOS (abra F12 → Console pra ver):');
              console.table(Array.from(uniqueSuppliers.entries()).map(([cod, nome]) => ({ 'Cód Fornecedor': cod, 'Nome': nome })));
          }

          alert(`${newTransactions.length} registros importados com sucesso para ${activeTab}!${extra}${missingColsWarning}`);
      } else {
          alert(`Nenhum registro compatível encontrado para ${activeTab}.`);
      }
  };

  // Aplica os fluxos informados no modal e conclui a importação.
  const confirmMissingFlow = (importAnyway: boolean) => {
      const list = pendingImport.map(t => {
          const chosen = (flowDrafts[t.id] || '').trim();
          if (chosen) {
              const n2 = n3ToN2[chosen];
              return { ...t, flowTypeCode: chosen, flowTypeLevel2: t.flowTypeLevel2 || n2 || t.flowTypeLevel2 } as Transaction;
          }
          return t;
      });
      // Segunda camada de proteção (a primeira é o dropdown já filtrado por
      // direção): barra qualquer combinação errada — fluxo de Entrada num
      // Contas a Pagar, ou de Saída num Contas a Receber — mesmo que tenha
      // entrado por outro caminho.
      const direcaoErrada = list.find(t => {
          const fluxo = n3ToFluxo[String(t.flowTypeCode || '').trim()];
          if (!fluxo) return false;
          if (t.type === TransactionType.PAYABLE    && fluxo === 'Entrada') return true;
          if (t.type === TransactionType.RECEIVABLE && fluxo === 'Saída')   return true;
          return false;
      });
      if (direcaoErrada) {
          const fluxo = n3ToFluxo[String(direcaoErrada.flowTypeCode || '').trim()];
          const tipoLabel = direcaoErrada.type === TransactionType.PAYABLE ? 'Contas a Pagar' : 'Contas a Receber';
          alert(`Fluxo incompatível: "${direcaoErrada.flowTypeCode}" é um fluxo de ${fluxo}, mas este lançamento é ${tipoLabel}. Escolha um fluxo de ${direcaoErrada.type === TransactionType.PAYABLE ? 'Saída' : 'Entrada'}.`);
          return;
      }
      // Se não for "importar mesmo assim", impede concluir com algum fluxo ainda vazio.
      if (!importAnyway) {
          const aindaVazio = list.some(t =>
              (t.type === TransactionType.PAYABLE || t.type === TransactionType.RECEIVABLE)
              && !String(t.flowTypeCode || '').trim()
          );
          if (aindaVazio) {
              alert('Ainda há título(s) sem fluxo. Informe o fluxo de todos ou use "Importar mesmo assim".');
              return;
          }
      }
      setMissingFlowOpen(false);
      commitImport(list, pendingWarning);
      setPendingImport([]);
      setFlowDrafts({});
      setPendingWarning('');
  };

  // Aplica a empresa escolhida (por C/C Padrão) a todas as aplicações daquela
  // conta e conclui a importação.
  const confirmMissingCompany = (importAnyway: boolean) => {
      const list = pendingImportApp.map(t => {
          const cc = (t as any).__ccPadraoPendente;
          if (!cc) return t;
          const chosen = (companyDrafts[cc] || '').trim();
          if (chosen) {
              const companyName = COMPANIES.find(c => c.id === chosen)?.name;
              const { __ccPadraoPendente, ...rest } = t as any;
              return { ...rest, companyCode: chosen, businessUnit: companyName || rest.businessUnit } as Transaction;
          }
          return t;
      });
      if (!importAnyway) {
          const aindaVazio = list.some(t => (t as any).__ccPadraoPendente);
          if (aindaVazio) {
              alert('Ainda há conta(s) sem empresa definida. Escolha a empresa de todas ou use "Importar mesmo assim".');
              return;
          }
      }
      // Limpa o campo auxiliar antes de gravar (não faz parte do schema).
      const clean = list.map(t => { const { __ccPadraoPendente, ...rest } = t as any; return rest as Transaction; });
      setMissingCompanyOpen(false);
      commitImport(clean, pendingWarningApp);
      setPendingImportApp([]);
      setCompanyDrafts({});
      setPendingWarningApp('');
  };

  // Chave de match: Fornecedor (código) + Tipo de Fluxo (ambos preenchidos).
  const calendarMatchKey = (t: Transaction) =>
      `${(t.supplierCode || '').trim()}|${(t.flowTypeCode || '').trim()}`;
  const hasKey = (t: Transaction) =>
      !!(t.supplierCode || '').trim() && !!(t.flowTypeCode || '').trim();

  // Núcleo da verificação + reconciliação.
  // - Pagamento REAL presente (não-gerado) com mesma chave  -> obrigação 'OK';
  //   e qualquer pagamento GERADO daquela obrigação é removido (reconciliação).
  // - Sem pagamento real e sem gerado                       -> gera um PAYABLE ('GERADO').
  // - Sem pagamento real mas já gerado                      -> mantém como está.
  const runCalendarGeneration = (calendarItems: Transaction[], payables: Transaction[]) => {
      // Só pagamentos REAIS (não os que o próprio Calendário gerou) contam como "já presente".
      const realPayables = payables.filter(p => !p.generatedFromCalendarId);
      const realKeys = new Set(
          realPayables.filter(p => hasKey(p)).map(calendarMatchKey)
      );

      // Uma data é "completa" quando está no formato dd/mm/aaaa.
      const isFullDate = (d?: string) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(d || '').trim());
      // dd/mm/aaaa -> número comparável aaaammdd (NaN se não for data completa).
      const toNum = (d?: string) => {
          const p = String(d || '').trim().split('/');
          return (p.length === 3 && p[2].length === 4)
              ? Number(p[2]) * 10000 + Number(p[1]) * 100 + Number(p[0])
              : NaN;
      };

      // Janela = intervalo de datas do PREVISTO importado (min/max dos pagamentos reais).
      // A geração fica RESTRITA a essa janela: só gera recorrentes cujo dia cai nela.
      const realDateNums = realPayables.map(p => toNum(p.date)).filter(n => !Number.isNaN(n));
      const hasWindow = realDateNums.length > 0;
      const minN = hasWindow ? Math.min(...realDateNums) : 0;
      const maxN = hasWindow ? Math.max(...realDateNums) : 0;

      // Mês/ano de referência (fallback quando não há janela de datas, ex. dados sem data completa).
      const refCounts = new Map<string, number>();
      realPayables.forEach(p => {
          const parts = String(p.date || '').split('/');
          if (parts.length === 3 && parts[2].length === 4) {
              const k = parts[1].padStart(2, '0') + '/' + parts[2];
              refCounts.set(k, (refCounts.get(k) || 0) + 1);
          }
      });
      let refMM = '', refYYYY = '', best = -1;
      refCounts.forEach((n, k) => { if (n > best) { best = n; const [mm, yy] = k.split('/'); refMM = mm; refYYYY = yy; } });
      if (!refMM) { const now = new Date(); refMM = String(now.getMonth() + 1).padStart(2, '0'); refYYYY = String(now.getFullYear()); }

      // Data da linha a gerar (dd/mm/aaaa) a partir do dia do calendário:
      // - com janela: procura a ocorrência do dia DENTRO do intervalo importado; se não cair, retorna null (não gera);
      // - sem janela: completa com o mês/ano de referência.
      const occurrenceInWindow = (calDate: string): string | null => {
          const raw = String(calDate || '').trim();
          const parts = raw.split('/');
          if (parts.length === 3 && parts[2].length === 4) {
              if (!hasWindow) return raw;
              const n = toNum(raw);
              return (n >= minN && n <= maxN) ? raw : null;
          }
          const dayNum = parseInt(parts[0] || '1', 10) || 1;
          if (!hasWindow) {
              const last = new Date(Number(refYYYY), Number(refMM), 0).getDate();
              return `${String(Math.min(dayNum, last)).padStart(2, '0')}/${refMM}/${refYYYY}`;
          }
          let y = Math.floor(minN / 10000), m = Math.floor((minN % 10000) / 100);
          const ey = Math.floor(maxN / 10000), em = Math.floor((maxN % 10000) / 100);
          while (y < ey || (y === ey && m <= em)) {
              const last = new Date(y, m, 0).getDate();
              const day = Math.min(dayNum, last);
              const cand = y * 10000 + m * 100 + day;
              if (cand >= minN && cand <= maxN) return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
              m++; if (m > 12) { m = 1; y++; }
          }
          return null;
      };

      const updates: Transaction[]   = [];   // obrigações com status alterado
      const additions: Transaction[] = [];   // novos pagamentos gerados
      const deletions: string[]      = [];   // ids de pagamentos gerados a remover

      calendarItems.forEach(cal => {
          if (!hasKey(cal)) return;  // sem fornecedor + tipo de fluxo não há como casar
          const key = calendarMatchKey(cal);
          const linkedGenerated = payables.filter(p => p.generatedFromCalendarId === cal.id);
          const staleLinked = linkedGenerated.filter(g => !isFullDate(g.date));  // data incompleta (lixo)
          const validLinked = linkedGenerated.filter(g => isFullDate(g.date));

          if (realKeys.has(key)) {
              // Pagamento real chegou: marca OK e reconcilia (remove o gerado, se houver).
              if (cal.calendarStatus !== 'OK') updates.push({ ...cal, calendarStatus: 'OK' });
              linkedGenerated.forEach(g => deletions.push(g.id));
              return;
          }

          // Fora do match real: sempre limpa linhas obsoletas (dia solto).
          staleLinked.forEach(g => deletions.push(g.id));

          const occ = occurrenceInWindow(cal.date);
          if (!occ) return;  // recorrente não cai na janela do previsto importado -> não gera

          const already = validLinked.some(g => g.date === occ);
          if (!already) {
              additions.push({
                  ...cal,
                  id: crypto.randomUUID(),
                  type: TransactionType.PAYABLE,
                  date: occ,   // data dentro da janela do previsto importado
                  status: 'PREVISTO',
                  category: 'Obrigação Recorrente',
                  calendarStatus: undefined,
                  generatedFromCalendarId: cal.id,
              });
          }
          if (cal.calendarStatus !== 'GERADO') updates.push({ ...cal, calendarStatus: 'GERADO' });
      });
      return { updates, additions, deletions };
  };

  const handleCheckAndGenerate = () => {
      if (!onUpdateTransaction) return;
      const calendarItems = transactions.filter(t => t.type === TransactionType.CALENDAR);
      const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
      const { updates, additions, deletions } = runCalendarGeneration(calendarItems, payables);
      additions.forEach(onAddTransaction);
      deletions.forEach(id => onDeleteTransaction(id));
      updates.forEach(u => onUpdateTransaction(u));
      const okCount = updates.filter(u => u.calendarStatus === 'OK').length;
      alert(
        `Verificação concluída.\n\n` +
        `${additions.length} pagamento(s) gerado(s) (faltavam na importação).\n` +
        `${okCount} obrigação(ões) já presente(s) nos pagamentos.\n` +
        `${deletions.length} pagamento(s) gerado(s) removido(s) por reconciliação (o real chegou).`
      );
  };

  const handleInitiateClear = (e: React.MouseEvent) => {
    e.preventDefault(); 
    setIsConfirmingClear(true);
  };

  const handleConfirmClear = () => {
    // Limpa baseado no filtro de TIPO atual ou na aba ativa?
    // O botão de limpar original limpava baseado na ABA ativa.
    // Vamos manter isso para segurança.
    const type = TAB_TO_TYPE[activeTab];
    onClearTransactions(type);
    setIsConfirmingClear(false);
  };

  // --- FUNÇÃO DE FILTRAGEM (SOLICITADA) ---
  const aplicarFiltros = (lista: Transaction[]) => {
      const currentType = TAB_TO_TYPE[activeTab];
      return lista.filter(t => {
          // 0. Filtro de Aba Ativa (Sempre aplicado)
          if (t.type !== currentType) {
              return false;
          }

          // 1. Filtro de Empresa
          if (filtros.empresa !== 'all' && t.companyCode !== filtros.empresa) {
              return false;
          }

          // 2. Filtro de Fornecedor (não se aplica a Aplicações — não tem fornecedor)
          if (filtros.fornecedor.length > 0 && currentType !== TransactionType.APPLICATION) {
              if (currentType === TransactionType.PAYABLE) {
                  const supplierCode = t.supplierCode || '';
                  if (!filtros.fornecedor.includes(supplierCode)) return false;
              } else if (currentType !== TransactionType.RECEIVABLE) {
                  // Outros tipos que usam fornecedor
                  const code = t.supplierCode || t.description || '';
                  if (!filtros.fornecedor.includes(code)) return false;
              }
          }

          // 2b. Filtro de Produto (Apenas Aplicações — CDB, FUNDOS...)
          if (currentType === TransactionType.APPLICATION && filtros.produto !== 'all') {
              if ((t.category || '') !== filtros.produto) return false;
          }

          // 3. Filtro de Cliente (Apenas Recebimentos)
          if (currentType === TransactionType.RECEIVABLE && filtros.cliente.length > 0) {
              const customerCode = t.customerCode || '';
              if (!filtros.cliente.includes(customerCode)) return false;
          }

          // 3b. Filtro de Tipo de Fluxo (não se aplica a Aplicações)
          if (filtros.tipoFluxo !== 'all' && currentType !== TransactionType.APPLICATION) {
              const flowCode = t.flowTypeCode || '';
              if (flowCode !== filtros.tipoFluxo) return false;
          }

          // 4. Filtro de Data (Início e Fim)
          if (filtros.dataInicio || filtros.dataFim) {
              const tDate = parseDate(t.date);

              if (filtros.dataInicio) {
                  const [y, m, d] = filtros.dataInicio.split('-').map(Number);
                  if (tDate < new Date(y, m - 1, d).getTime()) return false;
              }

              if (filtros.dataFim) {
                  const [y, m, d] = filtros.dataFim.split('-').map(Number);
                  if (tDate > new Date(y, m - 1, d).getTime()) return false;
              }
          }

          return true;
      });
  };

  const lancamentosFiltrados = useMemo(() => aplicarFiltros(transactions), [transactions, filtros, activeTab]);

  const filteredTransactionsNew = useTransactionFilters(
      transactions,
      filtros,
      TAB_TO_TYPE[activeTab]
  );

  // Lista única de empresas para o select (baseada nas transações existentes)
  const uniqueCompanies = useMemo(() => {
      const companies = new Set<string>();
      transactions.forEach(t => { if(t.companyCode) companies.add(t.companyCode); });
      return Array.from(companies).sort();
  }, [transactions]);

  // Lista única de fornecedores para a aba ativa (exceto Recebimentos)
  const uniqueFornecedores = useMemo(() => {
      const map = new Map<string, string>();
      const currentType = TAB_TO_TYPE[activeTab];
      
      // Não mostrar fornecedores na aba de Recebimentos
      if (currentType === TransactionType.RECEIVABLE) return [];

      transactions.forEach(t => { 
          if(t.type === currentType) {
              let code = '';
              let name = '';
              
              if (currentType === TransactionType.PAYABLE) {
                  code = t.supplierCode || '';
                  name = t.supplier || code;
              } else {
                  code = t.supplierCode || t.description || '';
                  name = code;
              }
              
              if (code && !map.has(code)) {
                  map.set(code, `${code} - ${name}`);
              }
          }
      });
      
      return Array.from(map.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions, activeTab]);

  // Lista única de clientes (Apenas Recebimentos)
  const uniqueClientes = useMemo(() => {
      const map = new Map<string, string>();
      const currentType = TAB_TO_TYPE[activeTab];

      if (currentType !== TransactionType.RECEIVABLE) return [];

      transactions.forEach(t => {
          if (t.type === currentType) {
              const code = t.customerCode || '';
              const name = t.customer || code;
              
              if (code && !map.has(code)) {
                  map.set(code, `${code} - ${name}`);
              }
          }
      });

      return Array.from(map.entries())
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
  }, [transactions, activeTab]);

  // Lista única de tipos de fluxo para a aba ativa
  const uniqueTiposFluxo = useMemo(() => {
      const tipos = new Set<string>();
      const currentType = TAB_TO_TYPE[activeTab];
      transactions.forEach(t => { 
          if(t.type === currentType) {
              const flowCode = t.flowTypeCode;
              if (flowCode) tipos.add(flowCode);
          }
      });
      return Array.from(tipos).sort();
  }, [transactions, activeTab]);

  // Lista única de produtos (Apenas Aplicações — CDB, FUNDOS...)
  const uniqueProdutos = useMemo(() => {
      const produtos = new Set<string>();
      transactions.forEach(t => {
          if (t.type === TransactionType.APPLICATION && t.category) produtos.add(t.category);
      });
      return Array.from(produtos).sort();
  }, [transactions]);

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] gap-6 relative">
      <input type="file" accept=".csv,.txt,.xls,.xlsx" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />

      {/* Confirmation Modal Overlay */}
      {isConfirmingClear && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 rounded-2xl shadow-xl w-full max-w-md p-6 border border-slate-800/60 transform scale-100 transition-all">
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 bg-red-900/40 rounded-full flex items-center justify-center">
                        <AlertTriangle className="w-8 h-8 text-red-500" />
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-100">Confirmar Exclusão Total?</h3>
                        <p className="text-sm text-slate-400 mt-2">
                            Você está prestes a excluir <strong>TODOS</strong> os {lancamentosFiltrados.length} registros de <span className="font-bold text-slate-300">{activeTab}</span>.
                            {activeTab === 'APLICACOES' && <><br/>O histórico de posições (gráfico "Evolução das Aplicações") também será apagado.</>}
                            <br/>Esta ação não pode ser desfeita.
                        </p>
                    </div>
                    <div className="flex gap-3 w-full mt-4">
                        <button 
                            onClick={() => setIsConfirmingClear(false)}
                            className="flex-1 px-4 py-3 bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border border-slate-700/60"
                        >
                            <X className="w-4 h-4" /> Cancelar
                        </button>
                        <button 
                            onClick={handleConfirmClear}
                            className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                        >
                            <Check className="w-4 h-4" /> Confirmar Exclusão
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Modal: informar fluxo de títulos importados sem fluxo */}
      {missingFlowOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-800/60 flex flex-col" style={{ maxHeight: '85vh' }}>
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 bg-amber-900/40 rounded-full flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-100">Títulos sem fluxo</h3>
                        <p className="text-sm text-slate-400 mt-1">
                            {Object.keys(flowDrafts).length} título(s) vieram na planilha sem o código de fluxo e não foram resolvidos pela Conta TOTVS. Informe o fluxo de cada um antes de concluir.
                        </p>
                    </div>
                </div>

                <div className="overflow-auto flex-1 -mx-2 px-2 space-y-2">
                    {pendingImport.filter(t => t.id in flowDrafts).map(t => (
                        <div key={t.id} className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-200 font-medium truncate">{t.supplier || t.customer || t.description || 'Sem descrição'}</p>
                                <p className="text-[11px] text-slate-500">
                                    {t.type === TransactionType.PAYABLE ? 'A pagar (aceita só fluxo de Saída)' : 'A receber (aceita só fluxo de Entrada)'}
                                    {t.documentNumber ? ` · Título ${t.documentNumber}` : ''}
                                    {' · '}{formatCurrency(Number(t.value) || 0)}
                                </p>
                            </div>
                            <select
                                value={flowDrafts[t.id] || ''}
                                onChange={(e) => setFlowDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                                className="w-full sm:w-72 px-2 py-2 rounded-md border border-slate-600 bg-slate-900 text-slate-100 text-xs"
                            >
                                <option value="">— escolher fluxo (N3) —</option>
                                {flowOptionsFor(t).map(o => (
                                    <option key={o.n3} value={o.n3}>{o.n3} — {o.desc}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full mt-5">
                    <button
                        onClick={() => { setMissingFlowOpen(false); setPendingImport([]); setFlowDrafts({}); setPendingWarning(''); }}
                        className="flex-1 px-4 py-3 bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border border-slate-700/60"
                    >
                        <X className="w-4 h-4" /> Cancelar importação
                    </button>
                    <button
                        onClick={() => confirmMissingFlow(true)}
                        className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold rounded-xl transition-colors"
                    >
                        Importar mesmo assim
                    </button>
                    <button
                        onClick={() => confirmMissingFlow(false)}
                        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" /> Confirmar e importar
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Modal: informar empresa das aplicações sem C/C Padrão mapeado */}
      {missingCompanyOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-800/60 flex flex-col" style={{ maxHeight: '85vh' }}>
                <div className="flex items-start gap-3 mb-4">
                    <div className="w-12 h-12 bg-amber-900/40 rounded-full flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-6 h-6 text-amber-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-100">Contas sem empresa definida</h3>
                        <p className="text-sm text-slate-400 mt-1">
                            {Object.keys(companyDrafts).length} conta(s) (C/C Padrão) desta importação não estão no De-Para de empresas. Informe a empresa de cada uma antes de concluir.
                        </p>
                    </div>
                </div>

                <div className="overflow-auto flex-1 -mx-2 px-2 space-y-2">
                    {Object.keys(companyDrafts).map(cc => {
                        const rows = pendingImportApp.filter(t => (t as any).__ccPadraoPendente === cc);
                        const total = rows.reduce((s, t) => s + (Number(t.value) || 0), 0);
                        return (
                            <div key={cc} className="bg-slate-800/50 border border-slate-700/60 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-slate-200 font-medium truncate">{cc}</p>
                                    <p className="text-[11px] text-slate-500">
                                        {rows.length} aplicaç{rows.length === 1 ? 'ão' : 'ões'} · {formatCurrency(total)}
                                    </p>
                                </div>
                                <select
                                    value={companyDrafts[cc] || ''}
                                    onChange={(e) => setCompanyDrafts(prev => ({ ...prev, [cc]: e.target.value }))}
                                    className="w-full sm:w-64 px-2 py-2 rounded-md border border-slate-600 bg-slate-900 text-slate-100 text-xs"
                                >
                                    <option value="">— escolher empresa —</option>
                                    {COMPANIES.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>
                        );
                    })}
                </div>

                <div className="flex flex-col sm:flex-row gap-3 w-full mt-5">
                    <button
                        onClick={() => { setMissingCompanyOpen(false); setPendingImportApp([]); setCompanyDrafts({}); setPendingWarningApp(''); }}
                        className="flex-1 px-4 py-3 bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border border-slate-700/60"
                    >
                        <X className="w-4 h-4" /> Cancelar importação
                    </button>
                    <button
                        onClick={() => confirmMissingCompany(true)}
                        className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold rounded-xl transition-colors"
                    >
                        Importar mesmo assim
                    </button>
                    <button
                        onClick={() => confirmMissingCompany(false)}
                        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                        <Check className="w-4 h-4" /> Confirmar e importar
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Paste Modal Overlay */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 rounded-2xl shadow-xl w-full max-w-2xl p-6 border border-slate-800/60 transform scale-100 transition-all flex flex-col h-[60vh]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-emerald-500" />
                        Colar Dados da Planilha
                    </h3>
                    <button onClick={() => { setIsPasteModalOpen(false); setPasteText(''); }} className="text-slate-400 hover:text-slate-200">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <p className="text-sm text-slate-400 mb-4">
                    Copie os dados do Excel (Ctrl+C) e cole no campo abaixo (Ctrl+V). Certifique-se de incluir o cabeçalho.
                </p>
                <textarea 
                    className="flex-1 w-full p-3 bg-slate-950 border border-slate-800/60 text-slate-100 rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 text-xs font-mono whitespace-pre custom-scrollbar"
                    placeholder="Cole aqui os dados da sua planilha..."
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="flex justify-end gap-3 mt-4">
                    <button 
                        onClick={() => { setIsPasteModalOpen(false); setPasteText(''); }}
                        className="px-4 py-2 bg-slate-800/60 hover:bg-slate-700/60 text-slate-100 font-bold rounded-xl transition-colors border border-slate-700/60"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={() => {
                            if (pasteText.trim()) {
                                const normalizedText = pasteText
                                    .replace(/\r\n/g, '\n')
                                    .replace(/\t/g, ';');
                                
                                processCSV(normalizedText);
                                setIsPasteModalOpen(false);
                                setPasteText('');
                            } else {
                                alert("Por favor, cole algum texto antes de processar.");
                            }
                        }}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2"
                    >
                        <Check className="w-4 h-4" /> Processar Dados
                    </button>
                </div>
            </div>
        </div>
      )}

      {/* Tab Navigation (Formulário) */}
      <div className="flex justify-between items-end">
          <div className="flex p-1 bg-slate-900/40 border border-slate-800/60 rounded-lg w-fit overflow-x-auto max-w-full">
            <button onClick={() => handleTabChange('PAGAMENTOS')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'PAGAMENTOS' ? 'bg-slate-800 text-red-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <ArrowDownCircle className="w-4 h-4" /> Pagamentos
            </button>
            <button onClick={() => handleTabChange('RECEBIMENTOS')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'RECEBIMENTOS' ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <ArrowUpCircle className="w-4 h-4" /> Recebimentos
            </button>
            <button onClick={() => handleTabChange('APLICACOES')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'APLICACOES' ? 'bg-slate-800 text-blue-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <Briefcase className="w-4 h-4" /> Aplicações
            </button>
            <button onClick={() => handleTabChange('CALENDARIO')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'CALENDARIO' ? 'bg-slate-800 text-purple-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <CalendarDays className="w-4 h-4" /> Calendário
            </button>
            <button onClick={() => handleTabChange('TIPO_FLUXO')} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'TIPO_FLUXO' ? 'bg-slate-800 text-orange-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>
              <GitMerge className="w-4 h-4" /> Tipo de Fluxo
            </button>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 flex-1 overflow-hidden">
        {/* Form Section */}
        <div className="lg:col-span-1 bg-slate-900/40 p-5 rounded-xl shadow-sm border border-slate-800/60 h-full overflow-y-auto custom-scrollbar">
           <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 uppercase">
                {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />} 
                {editingId ? 'Editar Registro' : activeTab.replace('_', ' ')}
              </h3>
              {editingId && (
                  <button onClick={resetForm} className="text-xs text-red-400 hover:underline">Cancelar</button>
              )}
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {activeTab === 'PAGAMENTOS' ? (
              <>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dt Prev Pagt (Texto)</label>
                    <input type="text" placeholder="Ex: 01/02 ou 25/12/2025" value={dtPrevPagt} onChange={(e) => setDtPrevPagt(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs focus:border-red-500 outline-none placeholder:text-slate-600" />
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Empresa</label>
                        <input type="text" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estab</label>
                        <input type="text" value={estab} onChange={(e) => setEstab(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                 </div>
                 <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fornecedor (Cód)</label>
                    <input type="text" value={fornecedorCod} onChange={(e) => setFornecedorCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Fornecedor</label>
                    <input type="text" value={nomeFornecedor} onChange={(e) => setNomeFornecedor(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Espécie</label>
                        <input type="text" value={especie} onChange={(e) => setEspecie(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: CO ou NF" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Série</label>
                        <input type="text" value={serie} onChange={(e) => setSerie(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="1" />
                    </div>
                 </div>
                 <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Titulo</label>
                        <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Parc</label>
                        <input type="text" value={parc} onChange={(e) => setParc(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                 </div>
                 <div className="grid grid-cols-4 gap-2">
                    <div className="col-span-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">U.N.</label>
                        <input type="text" value={unidadeNegocioCod} onChange={(e) => setUnidadeNegocioCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                    <div className="col-span-3">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Unidade de Negócio</label>
                        <input type="text" value={nomeUnidadeNegocio} onChange={(e) => setNomeUnidadeNegocio(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                 </div>
                 <div className="grid grid-cols-5 gap-2">
                    <div className="col-span-1">
                         <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nível 2</label>
                         <input type="text" value={fluxoN2} onChange={(e) => setFluxoN2(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                    <div className="col-span-1">
                         <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">T. Fluxo</label>
                         <input type="text" value={tipoFluxoCod} onChange={(e) => setTipoFluxoCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                    <div className="col-span-3">
                         <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Tipo de Fluxo</label>
                         <input type="text" value={nomeTipoFluxo} onChange={(e) => setNomeTipoFluxo(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                    </div>
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor Original (R$)</label>
                    <input type="number" step="0.01" value={valorOriginal} onChange={(e) => setValorOriginal(e.target.value)} className="w-full p-2 border border-slate-700 bg-red-900/20 text-red-400 font-bold rounded text-sm placeholder:text-slate-600" />
                 </div>
              </>
            ) : activeTab === 'RECEBIMENTOS' ? (
              <>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dt Previsão Liquidação</label>
                    <input type="text" value={dtPrevPagt} onChange={(e) => setDtPrevPagt(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Cliente</label>
                    <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Carteira (GMU, GES, etc)</label>
                    <input type="text" value={carteira} onChange={(e) => setCarteira(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: GMU" />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fluxo Nível 2</label>
                    <input type="text" value={fluxoN2} onChange={(e) => setFluxoN2(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 100" />
                 </div>
                 <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Vl Considerado (R$)</label>
                    <input type="number" step="0.01" value={valorOriginal} onChange={(e) => setValorOriginal(e.target.value)} className="w-full p-2 border border-slate-700 bg-emerald-900/20 text-emerald-400 font-bold rounded text-sm" />
                 </div>
              </>
            ) : activeTab === 'CALENDARIO' ? (
              <>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Descrição Despesa / Convenção</label>
                   <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: Folha de Pagamento" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dt Prev Pagt</label>
                       <input type="text" value={dtPrevPagt} onChange={(e) => setDtPrevPagt(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="dd/mm/aaaa" />
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Empresa</label>
                       <input type="text" value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 2" />
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fornecedor (Cód)</label>
                       <input type="text" value={fornecedorCod} onChange={(e) => setFornecedorCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 70007" />
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Fornecedor</label>
                       <input type="text" value={nomeFornecedor} onChange={(e) => setNomeFornecedor(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: Banestes" />
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Espécie</label>
                       <input type="text" value={especie} onChange={(e) => setEspecie(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: DF" />
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Título</label>
                       <input type="text" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 958" />
                   </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tipo de Fluxo</label>
                       <input type="text" value={tipoFluxoCod} onChange={(e) => setTipoFluxoCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 20101" />
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fluxo N2</label>
                       <input type="text" value={fluxoN2} onChange={(e) => setFluxoN2(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 201" />
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor (R$)</label>
                   <input type="number" step="0.01" value={valorOriginal} onChange={(e) => setValorOriginal(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="0,00" />
                </div>
              </>
            ) : activeTab === 'TIPO_FLUXO' ? (
              <>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conta TOTVS</label>
                   <input type="text" value={conta} onChange={(e) => setConta(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 114101" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fluxo Nível 3 (Código)</label>
                       <input type="text" value={tipoFluxoCod} onChange={(e) => setTipoFluxoCod(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 10001" />
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fluxo Nível 2</label>
                       <input type="text" value={fluxoN2} onChange={(e) => setFluxoN2(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: 100" />
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Descrição</label>
                   <input type="text" value={nomeTipoFluxo} onChange={(e) => setNomeTipoFluxo(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="Ex: Antecipações - Cliente" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Seção (Natureza)</label>
                       <select value={secao} onChange={(e) => setSecao(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs">
                           <option value="Analítica">Analítica</option>
                           <option value="Sintética">Sintética</option>
                       </select>
                   </div>
                   <div>
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fluxo</label>
                       <select value={direcaoFluxo} onChange={(e) => setDirecaoFluxo(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs">
                           <option value="Entrada">Entrada</option>
                           <option value="Saída">Saída</option>
                       </select>
                   </div>
                </div>
              </>
            ) : (
              // APLICAÇÕES
              <>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Data</label>
                   <input type="text" value={dtPrevPagt} onChange={(e) => setDtPrevPagt(e.target.value)} className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs" placeholder="dd/mm/aaaa" />
                </div>
                <div>
                   <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Empresa</label>
                   <select 
                     value={empresa} 
                     onChange={(e) => setEmpresa(e.target.value)} 
                     className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs focus:border-blue-500 outline-none"
                   >
                     <option value="">Selecione...</option>
                     <option value="1">S/A</option>
                     <option value="2">TVG</option>
                     <option value="3">TVC</option>
                     <option value="4">TVN</option>
                     <option value="5">MIX</option>
                     <option value="6">FM102</option>
                     <option value="14">TNR</option>
                     <option value="17">DIF</option>
                     <option value="18">CID</option>
                     <option value="22">FMLIN</option>
                     <option value="23">NGER</option>
                   </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Descrição (Produto)</label>
                  <select 
                    value={description} 
                    onChange={(e) => setDescription(e.target.value)} 
                    className="w-full p-2 border border-slate-700 bg-slate-800 text-slate-100 rounded text-xs focus:border-blue-500 outline-none"
                  >
                    <option value="">Selecione o Produto...</option>
                    <option value="Fundo de Invest - BTG Pactual">Fundo de Invest - BTG Pactual</option>
                    <option value="CDB - Banestes">CDB - Banestes</option>
                    <option value="Ebricks">Ebricks</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valor (R$)</label>
                  <input type="number" step="0.01" value={valorOriginal} onChange={(e) => setValorOriginal(e.target.value)} className="w-full p-2 border border-slate-700 bg-blue-900/20 text-blue-400 font-bold rounded text-sm" />
                </div>
              </>
            )}
             
             {/* Botão de Submit */}
             <button type="submit" className={`w-full text-white py-3 rounded-lg font-medium transition-colors shadow-lg mt-6 flex items-center justify-center gap-2 ${
               activeTab === 'PAGAMENTOS' ? 'bg-red-600 hover:bg-red-700' : 
               activeTab === 'RECEBIMENTOS' ? 'bg-emerald-600 hover:bg-emerald-700' : 
               activeTab === 'CALENDARIO' ? 'bg-purple-600 hover:bg-purple-700' :
               activeTab === 'TIPO_FLUXO' ? 'bg-orange-600 hover:bg-orange-700' :
               'bg-blue-600 hover:bg-blue-700'
             }`}>
               {editingId ? 'Atualizar Registro' : 'Gravar Registro'}
             </button>
          </form>
        </div>

        {/* List Section com Filtros */}
        <div className="lg:col-span-3 min-w-0 bg-slate-900/40 rounded-xl shadow-sm border border-slate-800/60 overflow-hidden flex flex-col">
          
          {/* BARRA DE FILTROS (NOVA) */}
          <div className="p-4 border-b border-slate-800/60 bg-slate-900/50 flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase">Filtros:</span>
              </div>
              
              {/* Select Empresa */}
              <select 
                  value={filtros.empresa} 
                  onChange={(e) => setFiltros(prev => ({ ...prev, empresa: e.target.value }))}
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-blue-500"
              >
                  <option value="all">Todas as Empresas</option>
                  {uniqueCompanies.map(c => <option key={c} value={c}>Empresa {c}</option>)}
              </select>

              {/* Select Fornecedor (Ocultar em Recebimentos e Aplicações) */}
              {activeTab !== 'RECEBIMENTOS' && activeTab !== 'APLICACOES' && (
                  <div className="w-[250px]">
                      <MultiSelect
                          options={uniqueFornecedores}
                          selected={filtros.fornecedor}
                          onChange={(vals) => setFiltros(prev => ({ ...prev, fornecedor: vals }))}
                          placeholder="Todos os Fornecedores"
                      />
                  </div>
              )}

              {/* Select Produto (Apenas Aplicações) */}
              {activeTab === 'APLICACOES' && (
                  <select
                      value={filtros.produto}
                      onChange={(e) => setFiltros(prev => ({ ...prev, produto: e.target.value }))}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-blue-500"
                  >
                      <option value="all">Todos os Produtos</option>
                      {uniqueProdutos.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
              )}

              {/* Select Cliente (Apenas em Recebimentos) */}
              {activeTab === 'RECEBIMENTOS' && (
                  <div className="w-[250px]">
                      <MultiSelect
                          options={uniqueClientes}
                          selected={filtros.cliente}
                          onChange={(vals) => setFiltros(prev => ({ ...prev, cliente: vals }))}
                          placeholder="Todos os Clientes"
                      />
                  </div>
              )}

              {/* Select Tipo de Fluxo (não se aplica a Aplicações) */}
              {activeTab !== 'APLICACOES' && (
                  <select 
                      value={filtros.tipoFluxo} 
                      onChange={(e) => setFiltros(prev => ({ ...prev, tipoFluxo: e.target.value }))}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-blue-500 max-w-[200px] truncate"
                  >
                      <option value="all">Todos os Tipos de Fluxo</option>
                      {uniqueTiposFluxo.map(tf => <option key={tf} value={tf}>{tf}</option>)}
                  </select>
              )}

              {/* Data Inicial */}
              <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">De:</span>
                  <input 
                      type="date" 
                      value={filtros.dataInicio} 
                      onChange={(e) => setFiltros(prev => ({ ...prev, dataInicio: e.target.value }))}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-blue-500"
                  />
              </div>

              {/* Data Final */}
              <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold">Até:</span>
                  <input 
                      type="date" 
                      value={filtros.dataFim} 
                      onChange={(e) => setFiltros(prev => ({ ...prev, dataFim: e.target.value }))}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded px-2 py-1.5 outline-none focus:border-blue-500"
                  />
              </div>

          </div>
          
          {/* TOOLBAR ORIGINAL RESTAURADA */}
          <div className={`p-4 border-b flex justify-between items-center ${
            activeTab === 'PAGAMENTOS' ? 'bg-red-900/20 border-red-900/30' : 
            activeTab === 'RECEBIMENTOS' ? 'bg-emerald-900/20 border-emerald-900/30' : 
            activeTab === 'CALENDARIO' ? 'bg-purple-900/20 border-purple-900/30' :
            activeTab === 'TIPO_FLUXO' ? 'bg-orange-900/20 border-orange-900/30' :
            'bg-blue-900/20 border-blue-900/30'
          }`}>
            <h3 className={`font-bold ${
               activeTab === 'PAGAMENTOS' ? 'text-red-400' : 
               activeTab === 'RECEBIMENTOS' ? 'text-emerald-400' : 
               activeTab === 'CALENDARIO' ? 'text-purple-400' :
               activeTab === 'TIPO_FLUXO' ? 'text-orange-400' :
               'text-blue-400'
            }`}>
              {activeTab.replace('_', ' ')}
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-2 py-1 bg-slate-800 rounded border border-slate-700 text-slate-300">{lancamentosFiltrados.length} linhas</span>
              
              {activeTab === 'CALENDARIO' && (
                  <button onClick={handleCheckAndGenerate} className="flex items-center gap-2 px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white border border-purple-600 rounded text-xs font-bold transition-colors shadow-sm">
                    <RefreshCw className="w-3 h-3" /> Verificar & Gerar
                  </button>
              )}
              
              <button onClick={handleInitiateClear} className="flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-red-900/30 border border-red-900/30 text-red-400 rounded text-xs font-bold transition-colors shadow-sm">
                <Trash2 className="w-3 h-3" /> Limpar
              </button>
              {/* Botão "Modelo" removido — quando precisar de um modelo, o usuário pede direto no chat. */}
              <button onClick={() => setIsPasteModalOpen(true)} className={`flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-xs font-bold transition-colors shadow-sm`}>
                <Upload className="w-3 h-3" /> Colar Planilha
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded text-xs font-bold transition-colors shadow-sm">
                <Upload className="w-3 h-3" /> Importar CSV/Excel
              </button>
            </div>
          </div>

          {activeTab === 'APLICACOES' && applicationSnapshots.length > 0 && (
            <div className="px-4 pb-4 min-w-0">
              <ApplicationEvolutionPanel snapshots={applicationSnapshots} />
            </div>
          )}

          <div className="overflow-auto flex-1 w-full">
            <Lancamentos 
                transactions={filteredTransactionsNew} 
                onEdit={handleEdit} 
                onDelete={onDeleteTransaction}
                activeTab={activeTab} // Passando activeTab apenas se Lancamentos precisar de contexto extra
            />
          </div>
        </div>
      </div>
    </div>
  );
};
