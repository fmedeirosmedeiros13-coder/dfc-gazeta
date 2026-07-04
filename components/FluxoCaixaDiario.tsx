import React, { useMemo, useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseBanestesExtrato, type BanestesExtratoParseResult } from '../engines/banestesExtratoParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { Transaction, TransactionType, ManualValues } from '../types';
import { parseDate, BANKS_MAPPING, byDate, moveWeekendToMonday, COMPANIES } from '../utils/finance';
import { Calculator } from 'lucide-react';

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
  // parseDateGlobal e banksMapping removidos — importados de utils/finance.ts
}

export const FluxoCaixaDiario: React.FC<FluxoCaixaDiarioProps> = ({
  transactions,
  dfcManualValues,
  onManualValueChange,
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
      const [hidePast, setHidePast] = useState(false);
      const todayStart = (() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); })();
      const anyFuture = displayDates.some(d => parseDate(d) >= todayStart);
      const effectiveHide = hidePast && anyFuture; // não esconde tudo se não houver dia >= hoje
      const isVisibleIdx = (i: number) => !effectiveHide || parseDate(displayDates[i]) >= todayStart;

      // Importação do extrato Banestes: extrai o saldo de fechamento de cada
      // conta e grava como o fechamento daquele dia (mesma chave sim_close_
      // usada pelo encadeamento normal) — o dia útil seguinte já herda sozinho.
      const [banestesResult, setBanestesResult] = useState<BanestesExtratoParseResult | null>(null);
      const [isImportingBanestes, setIsImportingBanestes] = useState(false);

      const handleImportBanestesExtrato = async (e: React.ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setIsImportingBanestes(true);
          try {
              const buf = await file.arrayBuffer();
              const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
              let fullText = '';
              for (let i = 1; i <= doc.numPages; i++) {
                  const page = await doc.getPage(i);
                  const content = await page.getTextContent();
                  fullText += content.items.map((it: any) => it.str).join('\n') + '\n';
              }
              const result = parseBanestesExtrato(fullText);
              if (result.dateISO && result.balances.length > 0) {
                  result.balances.forEach(b => {
                      onManualValueChange(`sim_close_${b.companyId}_BANESTES_${result.dateISO}`, b.saldo);
                  });
              }
              setBanestesResult(result);
          } catch (err) {
              alert('Não foi possível ler o PDF do extrato. Confira se é o extrato consolidado Banestes.');
              console.error(err);
          } finally {
              setIsImportingBanestes(false);
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

      return (
         <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden flex flex-col h-full animate-fadeIn">
             {/* Header Toolbar */}
             <div className="p-2 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                 <h2 className="text-xs font-bold uppercase pl-2 text-slate-200 flex items-center gap-2">
                     <Calculator className="w-4 h-4 text-indigo-400" />
                     Fluxo de Caixa - Simulação Diária
                 </h2>
                 <div className="flex gap-2">
                     <label className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors border cursor-pointer ${isImportingBanestes ? 'bg-slate-700 text-slate-500 border-slate-600 cursor-wait' : 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700'}`}>
                         {isImportingBanestes ? 'Lendo extrato...' : 'Importar Extrato Banestes'}
                         <input
                             type="file"
                             accept="application/pdf"
                             className="hidden"
                             disabled={isImportingBanestes}
                             onChange={handleImportBanestesExtrato}
                         />
                     </label>
                     <button
                         onClick={() => setHidePast(v => !v)}
                         className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors border ${hidePast ? 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700' : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'}`}
                         title="Mostra só o dia corrente em diante, ocultando os dias anteriores"
                     >
                         {hidePast ? 'Mostrar dias anteriores' : 'Ocultar dias anteriores'}
                     </button>
                     <button className="px-3 py-1 bg-blue-600 text-white rounded text-[10px] font-bold uppercase hover:bg-blue-700">
                         Exportar Excel
                     </button>
                 </div>
             </div>

             {/* Resumo da importação do extrato Banestes */}
             {banestesResult && (
                 <div className="mx-2 mt-2 bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-[11px]">
                     <div className="flex justify-between items-start mb-2">
                         <div>
                             <p className="text-slate-200 font-bold">
                                 Extrato Banestes — fechamento de {banestesResult.dateISO ? banestesResult.dateISO.split('-').reverse().join('/') : '(data não identificada)'}
                             </p>
                             <p className="text-slate-500">
                                 {banestesResult.balances.length} conta(s) atualizada(s) — o próximo dia útil já herda esses saldos automaticamente.
                             </p>
                         </div>
                         <button onClick={() => setBanestesResult(null)} className="text-slate-500 hover:text-slate-300">✕</button>
                     </div>
                     <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                         {banestesResult.balances.map(b => (
                             <div key={b.conta} className="bg-slate-900/60 rounded px-2 py-1.5">
                                 <p className="text-slate-500">{COMPANIES.find(c => c.id === b.companyId)?.name || b.companyId}</p>
                                 <p className="text-slate-200 font-medium">{b.saldo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                             </div>
                         ))}
                     </div>
                     {banestesResult.skippedAccounts.length > 0 && (
                         <p className="text-slate-600 mt-2">
                             Contas-caixa auxiliares ignoradas: {banestesResult.skippedAccounts.join(', ')}
                         </p>
                     )}
                 </div>
             )}

             <div className="flex-1 overflow-auto custom-scrollbar bg-slate-900 relative">
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
                                             <td className="border border-slate-700 p-1 bg-slate-900/50 border-l-4 border-l-slate-700 text-right font-medium text-slate-300">
                                                 {day.sdInicial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-right text-red-400 font-medium">
                                                 {day.pagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-right text-blue-400 font-medium bg-amber-900/10">
                                                 {day.resg.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-right text-purple-400 font-medium bg-amber-900/10">
                                                 {day.transf.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-600 p-1 text-right font-bold text-slate-200 bg-slate-800">
                                                 {day.sdParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className="border border-slate-700 p-1 text-right text-emerald-400 font-medium">
                                                 {day.receb.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                             </td>
                                             <td className={`border border-slate-600 p-1 text-right font-bold bg-slate-800 ${day.sdFinal < 0 ? 'text-red-400' : 'text-blue-400'}`}>
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
                                                      <input 
                                                         type="number" 
                                                         className="w-full h-full bg-transparent text-right px-1 text-slate-500 text-[10px] outline-none"
                                                         value={day.sdInicial || ''}
                                                         onChange={(e) => onManualValueChange && onManualValueChange(day.keySdInicial, parseFloat(e.target.value))}
                                                         placeholder="-"
                                                     />
                                                 </td>
                                                 <td className="border border-slate-800 p-1 text-right text-slate-500 text-[10px]">
                                                     {day.pagtos !== 0 ? day.pagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                                                 </td>
                                                 <td className="border border-slate-800 p-0 bg-amber-900/5">
                                                     <input 
                                                         type="number" 
                                                         className="w-full h-full bg-transparent text-right px-1 text-blue-500/70 text-[10px] outline-none"
                                                         value={day.resg || ''}
                                                         onChange={(e) => onManualValueChange && onManualValueChange(day.keyResg, parseFloat(e.target.value))}
                                                     />
                                                 </td>
                                                 <td className="border border-slate-800 p-0 bg-amber-900/5">
                                                      <input 
                                                         type="number" 
                                                         className="w-full h-full bg-transparent text-right px-1 text-purple-500/70 text-[10px] outline-none"
                                                         value={day.transf || ''}
                                                         onChange={(e) => onManualValueChange && onManualValueChange(day.keyTransf, parseFloat(e.target.value))}
                                                     />
                                                 </td>
                                                 <td className="border border-slate-700 p-1 text-right font-medium text-slate-400 bg-slate-800/50 text-[10px]">
                                                     {day.sdParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}
                                                 </td>
                                                 <td className="border border-slate-800 p-1 text-right text-slate-500 text-[10px]">
                                                     {day.receb !== 0 ? day.receb.toLocaleString('pt-BR', {minimumFractionDigits: 0}) : '-'}
                                                 </td>
                                                 <td className={`border border-slate-700 p-1 text-right font-medium bg-slate-800/50 text-[10px] ${day.sdFinal < 0 ? 'text-red-500/70' : 'text-blue-500/70'}`}>
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
                                     <td className="border border-slate-700 p-1 text-right bg-[#1e293b] border-l-4 border-l-slate-600">{t.sumInicial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-right bg-[#1e293b] text-red-400">{t.sumPagtos.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-right bg-[#1e293b] text-blue-400">{t.sumResg.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-right bg-[#1e293b] text-purple-400">{t.sumTransf.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-right bg-[#0f172a]">{t.sumParcial.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className="border border-slate-700 p-1 text-right bg-[#1e293b] text-emerald-400">{t.sumReceb.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                     <td className={`border border-slate-700 p-1 text-right bg-[#0f172a] ${t.sumFinal < 0 ? 'text-red-400' : 'text-blue-400'}`}>{t.sumFinal.toLocaleString('pt-BR', {minimumFractionDigits: 0})}</td>
                                 </React.Fragment>
                             ))}
                         </tr>
                     </tbody>
                 </table>
             </div>
         </div>
      );
}
