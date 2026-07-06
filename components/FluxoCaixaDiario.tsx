import React, { useMemo, useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseBanestesExtrato, type BanestesExtratoParseResult } from '../engines/banestesExtratoParser';
import { parseBBExtrato, type BBAccountBalance } from '../engines/bbExtratoParser';
import { parseCEFExtrato } from '../engines/cefExtratoParser';
import { parseItauExtrato } from '../engines/itauExtratoParser';
import { parseSicoobExtrato } from '../engines/sicoobExtratoParser';
import { detectBank } from '../engines/bankExtratoDetector';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { Transaction, TransactionType, ManualValues } from '../types';
import { parseDate, BANKS_MAPPING, byDate, moveWeekendToMonday, COMPANIES } from '../utils/finance';
import { Calculator, AlertTriangle } from 'lucide-react';

// Data canônica em ISO (yyyy-mm-dd), independente do formato de exibição.
// Usada como chave do fechamento persistido, para o seed funcionar mesmo
// quando os lançamentos do dia anterior já não estão mais carregados.
const toISO = (dateStr: string): string => {
  const t = parseDate(dateStr);
  if (!t) return dateStr;
  const dt = new Date(t);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Dia útil anterior (pula sábado e domingo): segunda → sexta anterior.
const prevBusinessDayISO = (dateStr: string): string => {
  const t = parseDate(dateStr);
  if (!t) return '';
  const dt = new Date(t);
  do { dt.setDate(dt.getDate() - 1); } while (dt.getDay() === 0 || dt.getDay() === 6);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

interface FluxoCaixaDiarioProps {
  transactions: Transaction[];
  dfcManualValues?: ManualValues;
  onManualValueChange?: (key: string, value: number) => void;
  /** Posição mais recente das Aplicações — usada pra sugerir resgate quando há saldo negativo. */
  applicationSnapshots?: import('../hooks/useApplicationSnapshots').ApplicationSnapshot[];
  // parseDateGlobal e banksMapping removidos — importados de utils/finance.ts
}

// Campo de valor monetário editável: mostra formatado (1.234,56) quando não
// está em foco — corrige o problema de <input type="number"> nunca conseguir
// exibir separador de milhar (limitação do próprio HTML, não é bug de conta).
// Ao focar, mostra um texto simples (vírgula decimal) fácil de editar; ao
// sair do campo, reformata e envia o valor numérico pra cima.
const CurrencyInput: React.FC<{
  value: number | undefined;
  onCommit: (v: number) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, onCommit, className, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');

  const hasValue = value !== undefined && value !== null && !Number.isNaN(value);
  const display = hasValue
    ? value!.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={editing ? text : display}
      onFocus={(e) => {
        setEditing(true);
        setText(hasValue ? String(value).replace('.', ',') : '');
        e.target.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const raw = text.trim();
        if (raw === '') return; // campo deixado vazio: não altera o valor existente
        const normalized = raw.replace(/\./g, '').replace(',', '.');
        const parsed = parseFloat(normalized);
        if (!Number.isNaN(parsed)) onCommit(parsed);
      }}
    />
  );
};

export const FluxoCaixaDiario: React.FC<FluxoCaixaDiarioProps> = ({
  transactions,
  dfcManualValues,
  onManualValueChange,
  applicationSnapshots = [],
}) => {
      // Mover transações de sábado/domingo para a segunda-feira seguinte
      const adjustedTransactions = transactions.map(t => ({
          ...t,
          date: moveWeekendToMonday(t.date),
      }));

      const allDates = (Array.from(new Set(adjustedTransactions.map(t => t.date))) as string[]).sort(byDate);
      
      const displayDates = allDates.slice(0, 5);

      // Botão "ocultar dia anterior": quando ligado, mostra só o dia corrente
      // (hoje) em diante. O cálculo do saldo continua passando por todos os dias;
      // só a EXIBIÇÃO das colunas anteriores é escondida.
      // Ocultar dias anteriores a uma data escolhida (dentre as do período
      // importado/exibido) — não fica preso a "hoje", o usuário escolhe.
      const [hideBeforeDate, setHideBeforeDate] = useState<string>('');
      const isVisibleIdx = (i: number) => !hideBeforeDate || parseDate(displayDates[i]) >= parseDate(hideBeforeDate);

      // Importação unificada de extratos bancários: aceita vários arquivos de
      // QUALQUER banco de uma vez (misturados). Cada PDF é lido, identificado
      // por assinatura de texto (engines/bankExtratoDetector.ts) e roteado pro
      // parser certo. Pra adicionar um banco novo: só plugar o parser aqui —
      // o botão e a tela não mudam.
      type UnifiedBalance = { bankId: string; companyId: string; saldo: number; dateISO: string };
      type UnifiedResult = {
          balances: UnifiedBalance[];
          skippedAccounts: string[];   // contas-caixa auxiliares (Banestes) ou fora do De-Para
          unrecognizedFiles: string[]; // PDFs cujo banco não foi identificado
          precisaExemplo: string[];    // contas com formato ainda não suportado (ex.: CEF com movimento)
      };
      const [extratoResult, setExtratoResult] = useState<UnifiedResult | null>(null);
      const [isImportingExtratos, setIsImportingExtratos] = useState(false);

      const handleImportExtratos = async (e: React.ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(e.target.files || []);
          if (files.length === 0) return;
          setIsImportingExtratos(true);
          try {
              const result: UnifiedResult = { balances: [], skippedAccounts: [], unrecognizedFiles: [], precisaExemplo: [] };

              for (const file of files) {
                  const buf = await file.arrayBuffer();
                  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
                  let fullText = '';
                  for (let i = 1; i <= doc.numPages; i++) {
                      const page = await doc.getPage(i);
                      const content = await page.getTextContent();
                      fullText += content.items.map((it: any) => it.str).join('\n') + '\n';
                  }

                  const bank = detectBank(fullText);
                  if (bank === 'BANESTES') {
                      const r = parseBanestesExtrato(fullText);
                      // Cada saldo herda a data DAQUELE extrato — bancos diferentes no
                      // mesmo lote podem ter fechado em dias diferentes.
                      if (r.dateISO) {
                          r.balances.forEach(b => result.balances.push({ bankId: 'BANESTES', companyId: b.companyId, saldo: b.saldo, dateISO: r.dateISO! }));
                      }
                      result.skippedAccounts.push(...r.skippedAccounts);
                  } else if (bank === 'BB') {
                      const r = parseBBExtrato(fullText);
                      if (r.dateISO && r.balance) {
                          result.balances.push({ bankId: 'BB', companyId: r.balance.companyId, saldo: r.balance.saldo, dateISO: r.dateISO });
                      }
                      if (r.contaNaoMapeada) result.skippedAccounts.push(r.contaNaoMapeada);
                  } else if (bank === 'CEF') {
                      const r = parseCEFExtrato(fullText);
                      if (r.dateISO && r.balance) {
                          result.balances.push({ bankId: 'CEF', companyId: r.balance.companyId, saldo: r.balance.saldo, dateISO: r.dateISO });
                      }
                      if (r.cnpjNaoMapeado) result.skippedAccounts.push(r.cnpjNaoMapeado);
                      if (r.precisaExemploComMovimento) result.precisaExemplo.push(`${file.name} (CEF com movimento — formato ainda não suportado)`);
                  } else if (bank === 'ITAU') {
                      const r = parseItauExtrato(fullText);
                      if (r.dateISO && r.balance) {
                          result.balances.push({ bankId: 'ITAU', companyId: r.balance.companyId, saldo: r.balance.saldo, dateISO: r.dateISO });
                      }
                      if (r.cnpjNaoMapeado) result.skippedAccounts.push(r.cnpjNaoMapeado);
                  } else if (bank === 'SICOOB') {
                      const r = parseSicoobExtrato(fullText);
                      if (r.dateISO && r.balance) {
                          result.balances.push({ bankId: 'SICOOB', companyId: r.balance.companyId, saldo: r.balance.saldo, dateISO: r.dateISO });
                      }
                      if (r.contaNaoMapeada) result.skippedAccounts.push(r.contaNaoMapeada);
                  } else {
                      result.unrecognizedFiles.push(file.name);
                  }
              }

              result.balances.forEach(b => {
                  // Fechamento do dia do extrato: o dia útil seguinte herda sozinho.
                  onManualValueChange(`sim_close_${b.companyId}_${b.bankId}_${b.dateISO}`, b.saldo);
                  // Escreve também direto no SD Inicial do primeiro dia visível na
                  // tela agora, pra aparecer na hora na linha do banco.
                  if (displayDates[0]) {
                      onManualValueChange(`sim_sd_ini_${b.companyId}_${b.bankId}_${displayDates[0]}`, b.saldo);
                  }
              });
              setExtratoResult(result);
          } catch (err) {
              alert('Não foi possível ler um dos PDFs. Confira se são extratos bancários válidos.');
              console.error(err);
          } finally {
              setIsImportingExtratos(false);
              e.target.value = '';
          }
      };

      const COMPANIES = [
          { id: '1', name: 'S.A. A GAZETA' },
          { id: '2', name: 'TV GAZETA' },
          { id: '3', name: 'TV CACHOEIRO' },
          { id: '4', name: 'TV NORTE' },
          { id: '5', name: 'RD MIX' },
          { id: '6', name: 'FM 102' },
          { id: '14', name: 'VÍDEO' },
          { id: '17', name: 'DIFUSORA' },
          { id: '18', name: 'CIDADÃ' },
          { id: '22', name: 'FM LINHARES' },
          { id: '23', name: 'RD N. GERAÇÃO' }
      ];

      // BANKS_MAPPING importado de utils/finance.ts

      const getDailyTotal = (compId: string, type: TransactionType, date: string) => {
          const companyDef = COMPANIES.find(c => c.id === compId);
          const fCompId = String(compId).replace(/^0+/, '').trim();
          const fCompName = companyDef ? companyDef.name.toUpperCase() : '';

          return adjustedTransactions
            .filter(t => {
                if (t.type !== type || t.date !== date) return false;

                const tComp = String(t.companyCode || '').trim().toUpperCase();
                const tCompAsId = tComp.replace(/^0+/, '');

                // Match by ID (Normalizado)
                if (tCompAsId === fCompId) return true;

                // Match by Name (Ex: "TV GAZETA" === "TV GAZETA")
                if (fCompName && tComp === fCompName) return true;
                
                return false;
            })
            .reduce((acc, t) => acc + t.value, 0);
      };

      const OTHER_BANKS_KEYWORDS = ['BB', 'BRASIL', 'ITAU', 'CEF', 'CAIXA', 'SICOOB', 'SANTANDER', 'BRADESCO', 'SAFRA', 'BTG', 'VOTORANTIM', 'DAYCOVAL', 'BANCO DO BRASIL'];

      const getBankTotal = (compId: string, bankId: string, type: TransactionType, date: string) => {
          const companyDef = COMPANIES.find(c => c.id === compId);
          const fCompId = String(compId).replace(/^0+/, '').trim();
          const fCompName = companyDef ? companyDef.name.toUpperCase() : '';

          return adjustedTransactions
            .filter(t => {
                if (t.type !== type || t.date !== date) return false;

                // Filtro de Empresa (Igual ao getDailyTotal)
                const tComp = String(t.companyCode || '').trim().toUpperCase();
                const tCompAsId = tComp.replace(/^0+/, '');
                const isSameCompany = (tCompAsId === fCompId) || (fCompName && tComp === fCompName);
                
                if (!isSameCompany) return false;
                
                // Lógica de Banco
                const bankName = bankId.toUpperCase();
                const supplier = (t.supplier || '').toUpperCase();
                const desc = (t.description || '').toUpperCase();
                const accName = (t.accountName || '').toUpperCase();
                const text = `${supplier} ${desc} ${accName}`;

                // Se for BANESTES, assume como padrão se não houver menção a outros bancos
                if (bankName.includes('BANESTES')) {
                    // Se tiver explicitamente BANESTES, pega
                    if (text.includes('BANESTES')) return true;
                    
                    // Se NÃO tiver menção a nenhum outro banco conhecido, assume Banestes (Default)
                    const hasOtherBank = OTHER_BANKS_KEYWORDS.some(other => text.includes(other));
                    if (!hasOtherBank) return true;

                    return false;
                }

                // Para outros bancos, exige match explícito
                return text.includes(bankName);
            })
            .reduce((acc, t) => acc + t.value, 0);
      };

      // Helper to calculate Row Data on the fly
      const calculateRowData = (storageId: string, compId: string, bankId: string | null) => {
          // Saldo de abertura do PRIMEIRO dia exibido: herda o fechamento persistido
          // do dia útil anterior (ex.: segunda pega a sexta). Se não houver fechamento
          // salvo (primeiríssimo uso), cai no seed único sim_start (ou 0).
          const firstDate = displayDates[0];
          const prevISO = firstDate ? prevBusinessDayISO(firstDate) : '';
          const prevClose = prevISO ? dfcManualValues?.[`sim_close_${storageId}_${prevISO}`] : undefined;
          let currentBalance = (prevClose !== undefined && !Number.isNaN(prevClose))
            ? prevClose
            : (dfcManualValues?.[`sim_start_${storageId}`] || 0);

          return displayDates.map((date: string) => {
              const pagtos = bankId 
                ? getBankTotal(compId, bankId, TransactionType.PAYABLE, date) 
                : getDailyTotal(compId, TransactionType.PAYABLE, date);
                
              const receb = bankId 
                ? getBankTotal(compId, bankId, TransactionType.RECEIVABLE, date) 
                : getDailyTotal(compId, TransactionType.RECEIVABLE, date);
              
              const keySdInicial = `sim_sd_ini_${storageId}_${date}`;
              const keyResg = `sim_resg_${storageId}_${date}`;
              const keyTransf = `sim_transf_${storageId}_${date}`;
              
              const manualSdIni = dfcManualValues?.[keySdInicial];
              // Só usa o valor digitado se for um número válido. Campo apagado vira
              // NaN (parseFloat('')) — nesse caso cai no saldo encadeado em vez de
              // contaminar parcial/final e todos os dias seguintes com NaN.
              const sdInicial = (manualSdIni !== undefined && !Number.isNaN(manualSdIni))
                ? manualSdIni
                : currentBalance;
              
              const resg = dfcManualValues?.[keyResg] || 0;
              const transf = dfcManualValues?.[keyTransf] || 0;
              
              const sdParcial = sdInicial - pagtos + resg + transf;
              const sdFinal = sdParcial + receb;
              
              currentBalance = sdFinal; 
              
              return { 
                  date, 
                  sdInicial, 
                  pagtos, 
                  resg, 
                  transf, 
                  sdParcial, 
                  receb, 
                  sdFinal, 
                  keySdInicial,
                  keyResg, 
                  keyTransf 
              };
          });
      };
      
      const structuredData = useMemo(() => COMPANIES.map(c => {
          const specificBanks = BANKS_MAPPING[c.id] || [];
          const bankRows = specificBanks.map(b => ({
              bank: b,
              days: calculateRowData(`${c.id}_${b.id}`, c.id, b.id)
          }));

          // CORREÇÃO: A linha da empresa agora é a somatória exata das linhas dos seus bancos
          const companyRow = displayDates.map((date, i) => {
              let sumSdInicial = 0;
              let sumPagtos = 0;
              let sumResg = 0;
              let sumTransf = 0;
              let sumSdParcial = 0;
              let sumReceb = 0;
              let sumSdFinal = 0;

              bankRows.forEach(br => {
                  const d = br.days[i];
                  sumSdInicial += d.sdInicial;
                  sumPagtos += d.pagtos;
                  sumResg += d.resg;
                  sumTransf += d.transf;
                  sumSdParcial += d.sdParcial;
                  sumReceb += d.receb;
                  sumSdFinal += d.sdFinal;
              });

              return {
                  date,
                  sdInicial: sumSdInicial,
                  pagtos: sumPagtos,
                  resg: sumResg,
                  transf: sumTransf,
                  sdParcial: sumSdParcial,
                  receb: sumReceb,
                  sdFinal: sumSdFinal,
                  keySdInicial: `sim_sd_ini_${c.id}_${date}`,
                  keyResg: `sim_resg_${c.id}_${date}`,
                  keyTransf: `sim_transf_${c.id}_${date}`
              };
          });

          return { entity: c, days: companyRow, banks: bankRows };
      }), [COMPANIES, BANKS_MAPPING, calculateRowData, displayDates]);

      // Persiste o fechamento (sdFinal) de cada dia por data e banco. É o que
      // permite a próxima janela (ex.: semana seguinte) herdar o saldo do último
      // dia útil mesmo quando os lançamentos daquele dia já saíram da tela.
      // Guarda contra regravação: só escreve quando o valor realmente muda.
      useEffect(() => {
          if (!onManualValueChange) return;
          structuredData.forEach(comp => {
              comp.banks.forEach(br => {
                  const storageId = `${comp.entity.id}_${br.bank.id}`;
                  br.days.forEach((d: any) => {
                      if (!Number.isFinite(d.sdFinal)) return;
                      const key = `sim_close_${storageId}_${toISO(d.date)}`;
                      const stored = dfcManualValues?.[key];
                      if (stored === undefined || Math.abs(stored - d.sdFinal) > 0.005) {
                          onManualValueChange(key, d.sdFinal);
                      }
                  });
              });
          });
      }, [structuredData, dfcManualValues, onManualValueChange]);

      // Totals
      const companyTotals = useMemo(() => {
          const calculateTotals = (rows: { days: any[] }[]) => {
              return displayDates.map((date: string, i) => {
                  let t = { sumInicial: 0, sumPagtos: 0, sumResg: 0, sumTransf: 0, sumParcial: 0, sumReceb: 0, sumFinal: 0 };
                  rows.forEach(r => {
                      const d = r.days[i];
                      t.sumInicial += d.sdInicial;
                      t.sumPagtos += d.pagtos;
                      t.sumResg += d.resg;
                      t.sumTransf += d.transf;
                      t.sumParcial += d.sdParcial;
                      t.sumReceb += d.receb;
                      t.sumFinal += d.sdFinal;
                  });
                  return t;
              });
          };

          const allCompanyRows = structuredData.map(s => ({ days: s.days }));
          return calculateTotals(allCompanyRows);
      }, [displayDates, structuredData]);

      // Avisos de saldo negativo: para cada empresa/dia visível com SD Final < 0,
      // sugere resgate de aplicação (se a empresa tem saldo disponível) ou aporte
      // (se não tem, ou o saldo em aplicações não cobre o déficit).
      const latestApplicationSnapshot = applicationSnapshots[applicationSnapshots.length - 1] ?? null;

      // Data do extrato importado mais recente (maior data entre todas as chaves
      // sim_close_ gravadas por qualquer banco/empresa). Dias ANTERIORES a essa
      // data são dado velho de teste/simulação manual — não fazem sentido pra
      // alertar de saldo negativo, já que não vieram de extrato real nenhum.
      const latestImportedDateISO = useMemo(() => {
          let max: string | null = null;
          Object.keys(dfcManualValues || {}).forEach(key => {
              if (!key.startsWith('sim_close_')) return;
              const dateISO = key.split('_').pop() || '';
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateISO) && (!max || dateISO > max)) max = dateISO;
          });
          return max;
      }, [dfcManualValues]);

      const negativeWarnings = useMemo(() => {
          const warnings: { companyId: string; companyName: string; date: string; deficit: number; aplicacaoDisponivel: number; }[] = [];
          const minTime = latestImportedDateISO
              ? (() => { const [y, m, d] = latestImportedDateISO.split('-').map(Number); return new Date(y, m - 1, d).getTime(); })()
              : null;
          structuredData.forEach(s => {
              displayDates.forEach((date, i) => {
                  if (!isVisibleIdx(i)) return;
                  if (minTime !== null && parseDate(date) < minTime) return; // dia anterior ao último extrato importado — ignora
                  const sdFinal = s.days[i]?.sdFinal;
                  if (typeof sdFinal === 'number' && sdFinal < 0) {
                      const aplicacaoDisponivel = latestApplicationSnapshot?.porEmpresa[s.entity.id] || 0;
                      warnings.push({
                          companyId: s.entity.id,
                          companyName: s.entity.name,
                          date,
                          deficit: Math.abs(sdFinal),
                          aplicacaoDisponivel,
                      });
                  }
              });
          });
          return warnings;
          // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [structuredData, displayDates, hideBeforeDate, latestApplicationSnapshot, latestImportedDateISO]);

      return (
         <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-full animate-fadeIn">
             {/* Header Toolbar */}
             <div className="p-2 bg-slate-800 border-b border-slate-700 flex flex-wrap gap-3 items-center">
                 <h2 className="text-xs font-bold uppercase pl-2 text-slate-200 flex items-center gap-2 shrink-0">
                     <Calculator className="w-4 h-4 text-indigo-400" />
                     Fluxo de Caixa - Simulação Diária
                 </h2>
                 <div className="flex flex-wrap gap-2">
                     <label className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors border cursor-pointer ${isImportingExtratos ? 'bg-slate-700 text-slate-500 border-slate-600 cursor-wait' : 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700'}`}>
                         {isImportingExtratos ? 'Lendo extratos...' : 'Importar Extratos Bancários'}
                         <input
                             type="file"
                             accept="application/pdf"
                             multiple
                             className="hidden"
                             disabled={isImportingExtratos}
                             onChange={handleImportExtratos}
                             title="Selecione os PDFs de qualquer banco (Banestes, BB...) — o sistema identifica sozinho de qual banco é cada um"
                         />
                     </label>
                     <div className="flex items-center gap-1.5">
                         <label className="text-[10px] font-bold uppercase text-slate-400">Ocultar antes de:</label>
                         <select
                             value={hideBeforeDate}
                             onChange={e => setHideBeforeDate(e.target.value)}
                             className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors border ${hideBeforeDate ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-700 text-slate-300 border-slate-600'}`}
                             title="Oculta as colunas de dias anteriores à data escolhida (dentre as do período importado)"
                         >
                             <option value="">Mostrar tudo</option>
                             {displayDates.map(d => (
                                 <option key={d} value={d}>{d}</option>
                             ))}
                         </select>
                     </div>
                     <button className="px-3 py-1 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700">
                         Exportar Excel
                     </button>
                 </div>
             </div>

             {/* Confirmação da importação de extratos — sem repetir os saldos, que já
                 aparecem direto na tabela (SD Inicial de cada banco). Mantém só os
                 avisos que não têm outro lugar pra aparecer. */}
             {extratoResult && (
                 <div className="mx-2 mt-2 bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-[11px]">
                     <div className="flex justify-between items-start">
                         <p className="text-slate-300">
                             ✓ {extratoResult.balances.length} conta(s) bancária(s) atualizada(s) — já aplicado no SD Inicial da coluna {displayDates[0] || 'atual'} de cada banco.
                         </p>
                         <button onClick={() => setExtratoResult(null)} className="text-slate-500 hover:text-slate-300 shrink-0 ml-2">✕</button>
                     </div>

                     {extratoResult.skippedAccounts.length > 0 && (
                         <p className="text-slate-600 mt-2">
                             Contas ignoradas (auxiliares ou fora do De-Para): {extratoResult.skippedAccounts.join(', ')}
                         </p>
                     )}
                     {extratoResult.unrecognizedFiles.length > 0 && (
                         <p className="text-amber-500 mt-2">
                             Arquivo(s) não reconhecido(s) — nenhum banco identificado: {extratoResult.unrecognizedFiles.join(', ')}. Avise pra eu adicionar o layout desse banco.
                         </p>
                     )}
                     {extratoResult.precisaExemplo.length > 0 && (
                         <p className="text-orange-400 mt-2">
                             Formato ainda não suportado (não gravado — evita chutar): {extratoResult.precisaExemplo.join(', ')}. Me manda um exemplo assim que eu completo o parser.
                         </p>
                     )}
                 </div>
             )}

             {/* Avisos de saldo negativo: sugere resgate (se tem aplicação) ou aporte */}
             {negativeWarnings.length > 0 && (
                 <div className="mx-2 mt-2 bg-red-950/40 border border-red-800/60 rounded-lg p-3 text-[11px]">
                     <p className="text-red-300 font-bold flex items-center gap-1.5 mb-2">
                         <AlertTriangle className="w-3.5 h-3.5" />
                         {negativeWarnings.length} situação(ões) de saldo negativo no período exibido
                     </p>
                     <div className="space-y-1.5">
                         {negativeWarnings.map((w, i) => {
                             const cobre = w.aplicacaoDisponivel >= w.deficit;
                             return (
                                 <div key={`${w.companyId}_${w.date}_${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 bg-slate-900/50 rounded px-2 py-1.5">
                                     <span className="text-slate-300">
                                         <span className="font-medium text-slate-100">{w.companyName}</span> em {w.date}:
                                         {' '}saldo negativo de <span className="text-red-400 font-medium">{w.deficit.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                                     </span>
                                     {w.aplicacaoDisponivel > 0 ? (
                                         <span className={cobre ? 'text-emerald-400' : 'text-amber-400'}>
                                             {cobre
                                                 ? `→ Resgate de aplicação cobre o déficit (disponível ${w.aplicacaoDisponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`
                                                 : `→ Resgate de aplicação cobre só parte (disponível ${w.aplicacaoDisponivel.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}) — falta aporte de ${(w.deficit - w.aplicacaoDisponivel).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`}
                                         </span>
                                     ) : (
                                         <span className="text-orange-400">→ Sem saldo em aplicações — aporte necessário</span>
                                     )}
                                 </div>
                             );
                         })}
                     </div>
                 </div>
             )}

             <div className="flex-1 min-w-0 overflow-auto custom-scrollbar bg-slate-900 relative">
                 <table className="border-collapse text-[10px] table-fixed">
                     <thead className="sticky top-0 z-20 shadow-lg">
                         <tr className="bg-slate-800">
                             <th className="sticky left-0 z-30 bg-slate-800 border border-slate-700 p-2 w-[200px] min-w-[200px] text-left align-top h-[50px]">
                                 <div className="flex flex-col font-bold text-slate-300 leading-tight">
                                     <span>FLUXO DE CAIXA</span>
                                     <span>SIMULAÇÃO</span>
                                     <span className="mt-1 font-black text-slate-100">REDE GAZETA</span>
                                 </div>
                             </th>
                             {displayDates.map((date, idx) => {
                                 if (!isVisibleIdx(idx)) return null;
                                 const [d, m, y] = date.split('/').map(Number);
                                 const dateObj = new Date(y, m - 1, d);
                                 const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
                                 const dayName = isNaN(dateObj.getTime()) ? '' : days[dateObj.getDay()];
                                 
                                 return (
                                     <th key={date} colSpan={7} className="border border-slate-700 p-0 min-w-[600px] h-[50px] border-l-4 border-l-slate-600">
                                         <div className="flex flex-col h-full">
                                            <div className="bg-[#1e3a8a] text-white font-bold text-center border-b border-slate-700 py-0.5 text-[10px]">
                                                {dayName}
                                            </div>
                                            <div className="bg-slate-800 flex justify-between items-center px-2 py-1 flex-1">
                                                 <span className="bg-amber-900/50 text-amber-400 px-1 rounded-[2px] text-[8px] font-bold border border-amber-700/50">DIGITADO</span>
                                                 <span className="font-bold text-indigo-300 text-[11px]">{date}</span>
                                                 <span className="w-8"></span>
                                            </div>
                                         </div>
                                     </th>
                                 );
                             })}
                         </tr>
                         <tr>
                             <th className="sticky left-0 z-30 bg-slate-800 border border-slate-700 p-1 w-[200px] min-w-[200px] text-left pl-2 font-bold text-slate-300 uppercase align-bottom">
                                 EMPRESAS
                             </th>
                             {displayDates.map((date, idx) => isVisibleIdx(idx) && (
                                 <React.Fragment key={date}>
                                     <th className="bg-slate-800 border border-slate-700 p-1 w-[80px] font-bold text-slate-400 text-center border-l-4 border-l-slate-600">SD Inicial</th>
                                     <th className="bg-slate-800 border border-slate-700 p-1 w-[80px] font-bold text-slate-400 text-center">Pagamentos</th>
                                     <th className="bg-slate-800 border border-slate-700 p-1 w-[80px] font-bold text-slate-400 text-center">Resg Aplic</th>
                                     <th className="bg-slate-800 border border-slate-700 p-1 w-[80px] font-bold text-slate-400 text-center">Transf</th>
                                     <th className="bg-slate-700 border border-slate-600 p-1 w-[80px] font-bold text-slate-200 text-center">SD Parcial</th>
                                     <th className="bg-slate-800 border border-slate-700 p-1 w-[90px] font-bold text-slate-400 text-center">Recebimento Simulado</th>
                                     <th className="bg-slate-700 border border-slate-600 p-1 w-[80px] font-bold text-slate-200 text-center">SD Final</th>
                                 </React.Fragment>
                             ))}
                         </tr>
                     </thead>
                     <tbody className="bg-slate-900">
                         
                         {/* NESTED STRUCTURE: COMPANY -> BANKS */}
                         {structuredData.map((group) => (
                             <React.Fragment key={group.entity.id}>
                                 {/* Company Row */}
                                 <tr className="bg-slate-800/50 hover:bg-slate-800 border-b border-slate-700">
                                     <td className="sticky left-0 z-10 bg-slate-800/90 border-r border-slate-700 p-1 pl-2 font-bold text-slate-200 border-l-4 border-l-indigo-500 truncate">
                                         {group.entity.name}
                                     </td>
                                     {group.days.map((day, i) => isVisibleIdx(i) && (
                                         <React.Fragment key={i}>
                                             <td className="border border-slate-700 p-1 bg-slate-900/50 border-l-4 border-l-slate-700 text-center font-medium text-slate-300">
                                                 {day.sdInicial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-center text-red-400 font-medium">
                                                 {day.pagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-center text-blue-400 font-medium bg-amber-900/10">
                                                 {day.resg.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-center text-purple-400 font-medium bg-amber-900/10">
                                                 {day.transf.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-600 p-1 text-center font-bold text-slate-200 bg-slate-800">
                                                 {day.sdParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-center text-emerald-400 font-medium">
                                                 {day.receb.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className={`border border-slate-600 p-1 text-center font-bold bg-slate-800 ${day.sdFinal < 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                                 {day.sdFinal.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                         </React.Fragment>
                                     ))}
                                 </tr>

                                 {/* Bank Rows */}
                                 {group.banks.map((bRow) => (
                                     <tr key={`${group.entity.id}-${bRow.bank.id}`} className="hover:bg-slate-800/30 border-b border-slate-800/50">
                                         <td className="sticky left-0 z-10 bg-slate-900 border-r border-slate-700 p-1 pl-6 text-[9px] font-medium text-slate-400 italic flex items-center gap-1">
                                             <span className="text-slate-600">↳</span> {bRow.bank.id}
                                         </td>
                                         {bRow.days.map((day, i) => isVisibleIdx(i) && (
                                             <React.Fragment key={i}>
                                                 <td className="border border-slate-800 p-0 bg-slate-900 border-l-4 border-l-slate-800">
                                                      <CurrencyInput
                                                         className="w-full h-full bg-transparent text-center px-1 text-slate-500 text-[10px] outline-none"
                                                         value={day.sdInicial}
                                                         onCommit={(v) => onManualValueChange && onManualValueChange(day.keySdInicial, v)}
                                                         placeholder="-"
                                                     />
                                                 </td>
                                                 <td className="border border-slate-800 p-1 text-center text-slate-500 text-[10px]">
                                                     {day.pagtos !== 0 ? day.pagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                                                 </td>
                                                 <td className="border border-slate-800 p-0 bg-amber-900/5">
                                                     <CurrencyInput
                                                         className="w-full h-full bg-transparent text-center px-1 text-blue-500/70 text-[10px] outline-none"
                                                         value={day.resg}
                                                         onCommit={(v) => onManualValueChange && onManualValueChange(day.keyResg, v)}
                                                     />
                                                 </td>
                                                 <td className="border border-slate-800 p-0 bg-amber-900/5">
                                                      <CurrencyInput
                                                         className="w-full h-full bg-transparent text-center px-1 text-purple-500/70 text-[10px] outline-none"
                                                         value={day.transf}
                                                         onCommit={(v) => onManualValueChange && onManualValueChange(day.keyTransf, v)}
                                                     />
                                                 </td>
                                                 <td className="border border-slate-700 p-1 text-center font-medium text-slate-400 bg-slate-800/50 text-[10px]">
                                                     {day.sdParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                                 </td>
                                                 <td className="border border-slate-800 p-1 text-center text-slate-500 text-[10px]">
                                                     {day.receb !== 0 ? day.receb.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                                                 </td>
                                                 <td className={`border border-slate-700 p-1 text-center font-medium bg-slate-800/50 text-[10px] ${day.sdFinal < 0 ? 'text-red-500/70' : 'text-blue-500/70'}`}>
                                                     {day.sdFinal.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                                 </td>
                                             </React.Fragment>
                                         ))}
                                     </tr>
                                 ))}
                             </React.Fragment>
                         ))}

                         {/* TOTAL EMPRESAS */}
                         <tr className="bg-[#0f172a] text-white font-bold border-t-4 border-slate-900">
                             <td className="sticky left-0 z-30 bg-[#0f172a] border border-slate-700 p-2 text-center uppercase text-[11px]">TOTAL</td>
                             {companyTotals.map((t, i) => isVisibleIdx(i) && (
                                 <React.Fragment key={i}>
                                     <td className="border border-slate-700 p-1 text-center bg-[#1e293b] border-l-4 border-l-slate-600">{t.sumInicial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-center bg-[#1e293b] text-red-400">{t.sumPagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-center bg-[#1e293b] text-blue-400">{t.sumResg.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-center bg-[#1e293b] text-purple-400">{t.sumTransf.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-center bg-[#0f172a]">{t.sumParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-center bg-[#1e293b] text-emerald-400">{t.sumReceb.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className={`border border-slate-700 p-1 text-center bg-[#0f172a] ${t.sumFinal < 0 ? 'text-red-400' : 'text-blue-400'}`}>{t.sumFinal.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                 </React.Fragment>
                             ))}
                         </tr>
                     </tbody>
                 </table>
             </div>
         </div>
      );
}
