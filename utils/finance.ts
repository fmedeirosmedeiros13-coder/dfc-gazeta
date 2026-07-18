/**
 * utils/finance.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FONTE ÚNICA DA VERDADE para toda lógica financeira compartilhada.
 *
 * Antes deste arquivo, as seguintes utilidades estavam DUPLICADAS em:
 *   • App.tsx
 *   • components/Dashboard.tsx
 *   • components/FluxoCaixaDiario.tsx  (recebia como prop)
 *   • components/VisaoEstrategicaRealizado.tsx
 *   • components/ApresentacaoExecutiva.tsx
 *   • components/ResumoFinanceiro.tsx
 *   • hooks/useTransactionFilters.ts
 *
 * Agora cada um desses arquivos deve importar daqui.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction, TransactionType } from '../types';

// ─── 1. MAPEAMENTO DE EMPRESAS ────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
}

/**
 * Lista canônica de empresas do grupo Gazeta.
 * Usar esta lista para qualquer renderização de "todas as empresas" —
 * nunca derivar a lista dinamicamente de companyCode das transações,
 * pois dados ausentes causariam omissões silenciosas.
 */
export const COMPANIES: readonly Company[] = [
  { id: '1',  name: 'S.A. A GAZETA'  },
  { id: '2',  name: 'TV GAZETA'      },
  { id: '3',  name: 'TV CACHOEIRO'   },
  { id: '4',  name: 'TV NORTE'       },
  { id: '5',  name: 'RD MIX'         },
  { id: '6',  name: 'FM 102'         },
  { id: '14', name: 'VÍDEO'          },
  { id: '17', name: 'DIFUSORA'       },
  { id: '18', name: 'CIDADÃ'         },
  { id: '22', name: 'FM LINHARES'    },
  { id: '23', name: 'RD N. GERAÇÃO'  },
] as const;

// ─── 2. MAPEAMENTO EMPRESA → BANCOS ──────────────────────────────────────────

export interface BankEntry {
  id: string;
}

/**
 * Mapeia cada empresa para os bancos com os quais opera.
 * O BANESTES é sempre o banco padrão (primeiro da lista e fallback
 * quando nenhum outro banco é identificado na descrição da transação).
 *
 * IMPORTANTE: quando o BANESTES não é mencionado explicitamente mas nenhum
 * outro banco reconhecido aparece na descrição, a transação é atribuída ao
 * BANESTES (regra de negócio — ver FluxoCaixaDiario.tsx, getBankTotal).
 */
export const BANKS_MAPPING: Readonly<Record<string, BankEntry[]>> = {
  '1':  [{ id: 'BANESTES' }, { id: 'BB' }, { id: 'CEF'    }, { id: 'ITAU' }           ],
  '2':  [{ id: 'BANESTES' }, { id: 'BB' }, { id: 'ITAU'   }, { id: 'CEF' }, { id: 'BTG' }],
  '3':  [{ id: 'BANESTES' }, { id: 'BB' }, { id: 'BTG'    }                            ],
  '4':  [{ id: 'BANESTES' }, { id: 'BB' }, { id: 'SICOOB' }, { id: 'BTG' }            ],
  '5':  [{ id: 'BANESTES' }, { id: 'BB' }                                              ],
  '6':  [{ id: 'BANESTES' }, { id: 'BB' }                                              ],
  '14': [{ id: 'BANESTES' }                                                            ],
  '17': [{ id: 'BANESTES' }                                                            ],
  '18': [{ id: 'BANESTES' }                                                            ],
  '22': [{ id: 'BANESTES' }                                                            ],
  '23': [{ id: 'BANESTES' }                                                            ],
};

// ─── 3. PARSE DE DATAS ───────────────────────────────────────────────────────

/**
 * Converte qualquer string de data usada no sistema para timestamp Unix (ms).
 * Retorna 0 para entradas inválidas (nunca lança exceção).
 *
 * Formatos suportados:
 *   • "dd/mm/yyyy"  — formato padrão do ERP/TOTVS
 *   • "dd/mm"       — data sem ano (assume ano corrente do sistema)
 *   • "yyyy-mm-dd"  — formato ISO (importações externas)
 *
 * Por que não usar `new Date(str)` diretamente?
 *   O comportamento do construtor Date com strings ambíguas varia entre
 *   navegadores e versões. Esta função garante parsing determinístico.
 */
export function parseDate(d: unknown): number {
  if (!d || typeof d !== 'string') return 0;
  const str = d.trim();

  // dd/mm/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [day, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, day).getTime();
  }

  // dd/mm  (sem ano — assume ano atual)
  if (/^\d{1,2}\/\d{1,2}$/.test(str)) {
    const [day, m] = str.split('/').map(Number);
    return new Date(new Date().getFullYear(), m - 1, day).getTime();
  }

  // yyyy-mm-dd  (ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, day] = str.split('-').map(Number);
    return new Date(y, m - 1, day).getTime();
  }

  return 0;
}

// ─── 4. FORMATAÇÃO DE VALORES ─────────────────────────────────────────────────

const PT_BR = 'pt-BR';

/**
 * Formato monetário completo: "R$ 1.234.567,89"
 * Usar em células de tabela, cards de resumo, tooltips de gráficos.
 */
export function formatCurrency(val: number): string {
  return new Intl.NumberFormat(PT_BR, {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

/**
 * Formato compacto: "R$ 1,2M" / "R$ 450K"
 * Usar em KPI cards e eixos de gráficos onde o espaço é reduzido.
 */
export function formatCompact(val: number): string {
  return 'R$ ' + new Intl.NumberFormat(PT_BR, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(val);
}

/**
 * Formato inteiro sem decimais: "1.234.567"
 * Usar em tabelas de DFC onde a precisão de centavos é ruído visual.
 */
export function formatInteger(val: number): string {
  return new Intl.NumberFormat(PT_BR, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

/**
 * Formata um valor de tabela DFC, exibindo "-" para zero.
 * Padrão de apresentação em todas as views de DFC.
 */
export function formatDFCCell(val: number): string {
  return val !== 0 ? formatInteger(val) : '-';
}

// ─── 5. SEMÂNTICA DE SINAL (MÉTODO DIRETO) ───────────────────────────────────

/**
 * Retorna o valor de uma transação com o sinal correto para cálculo de saldo.
 *
 *   RECEIVABLE  → positivo  (entrada de caixa)
 *   PAYABLE     → negativo  (saída de caixa)
 *   APPLICATION → negativo  (saída para investimento)
 *   outros      → 0         (CALENDAR e FLOW_TYPE são metadados, não afetam caixa)
 *
 * POR QUE ISSO IMPORTA:
 *   Alguns ERPs exportam saídas já com sinal negativo. Se o valor vier negativo
 *   e você subtrair diretamente, o sinal é invertido e o saldo fica errado.
 *   Usar Math.abs() aqui garante que a semântica de sinal é SEMPRE controlada
 *   pelo tipo da transação, não pelo valor numérico bruto.
 */
export function toSignedValue(t: Transaction): number {
  const abs = Math.abs(Number(t.value) || 0);
  switch (t.type) {
    case TransactionType.RECEIVABLE:  return +abs;
    case TransactionType.PAYABLE:     return -abs;
    case TransactionType.APPLICATION: return -abs;
    default:                          return 0;
  }
}

// ─── 6. CHAVES DE ESTADO MANUAL (dfcManualValues) ────────────────────────────

/**
 * Funções geradoras de chave para o mapa dfcManualValues.
 *
 * POR QUE ISSO IMPORTA:
 *   A chave era construída manualmente em 4+ lugares com template strings.
 *   Um typo em qualquer um deles resulta em saldo zero silencioso —
 *   sem erro, sem aviso, apenas dado errado.
 *   Centralizar a geração aqui garante que toda chave produzida
 *   é idêntica em todos os pontos de leitura e escrita.
 */

/** Saldo inicial de uma empresa em uma data específica. */
export function keyInitialBalance(companyId: string, date: string): string {
  return `sim_sd_ini_${companyId}_${date}`;
}

/** Saldo inicial de um banco vinculado a uma empresa em uma data específica. */
export function keyBankInitialBalance(companyId: string, bankId: string, date: string): string {
  return `sim_sd_ini_${companyId}_${bankId}_${date}`;
}

/** Resgate/Aplicação de uma empresa em uma data específica. */
export function keyResgate(companyId: string, date: string): string {
  return `sim_resg_${companyId}_${date}`;
}

/** Resgate/Aplicação de um banco vinculado a uma empresa em uma data. */
export function keyBankResgate(companyId: string, bankId: string, date: string): string {
  return `sim_resg_${companyId}_${bankId}_${date}`;
}

// ─── 7. HELPERS DE SALDO INICIAL ─────────────────────────────────────────────

/**
 * Calcula o saldo inicial de uma empresa somando:
 *   1. O input manual da empresa principal  (keyInitialBalance)
 *   2. Os inputs manuais de cada banco vinculado (keyBankInitialBalance)
 *
 * Esta função replica a lógica que antes existia duplicada em:
 *   • App.tsx  (executiveInitialBalance useMemo)
 *   • Dashboard.tsx  (getSimulationInitialBalance)
 *
 * @param companyId     ID da empresa (ex: '1', '14')
 * @param startDate     Data mais antiga nas transações (string no formato original)
 * @param manualValues  O objeto dfcManualValues do estado global
 */
export function calcInitialBalance(
  companyId: string,
  startDate: string,
  manualValues: Record<string, number>,
): number {
  const safe = manualValues ?? {};
  let total = 0;

  // Input da empresa principal
  total += Number(safe[keyInitialBalance(companyId, startDate)]) || 0;

  // Inputs dos bancos vinculados
  const banks = BANKS_MAPPING[companyId] ?? [];
  for (const bank of banks) {
    total += Number(safe[keyBankInitialBalance(companyId, bank.id, startDate)]) || 0;
  }

  return total;
}

/**
 * Encontra a data do EXTRATO BANCÁRIO MAIS RECENTE já importado para uma
 * empresa (olhando todas as chaves sim_sd_ini_{empresa}_... salvas em
 * dfcManualValues, empresa e por banco).
 *
 * O Saldo Inicial da DFC/DFC Consolidada é ROLANTE: o fluxo é feito toda
 * segunda-feira usando o saldo de sexta; se importado hoje, o saldo inicial
 * de hoje é o de hoje. Ou seja, a referência certa é sempre o dia do último
 * extrato conhecido — NUNCA a data mais antiga do histórico de transações
 * (isso buscava o saldo de janeiro, quando na prática o extrato mais
 * recente já tinha sido importado para uma data bem mais próxima de hoje).
 *
 * Retorna undefined se nenhum extrato foi importado ainda para a empresa.
 */
export function getLatestExtractDate(
  companyId: string,
  manualValues: Record<string, number>,
): string | undefined {
  const prefix = `sim_sd_ini_${companyId}_`;
  let latest: string | undefined;
  let latestNum = -Infinity;
  for (const key of Object.keys(manualValues ?? {})) {
    if (!key.startsWith(prefix)) continue;
    // A data é sempre o último segmento (dd/mm/aaaa), tanto para o formato
    // da empresa (sim_sd_ini_{emp}_{data}) quanto do banco
    // (sim_sd_ini_{emp}_{banco}_{data}).
    const rest = key.slice(prefix.length);
    const parts = rest.split('_');
    const dateStr = parts[parts.length - 1];
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) continue;
    const n = parseDate(dateStr);
    if (n > latestNum) { latestNum = n; latest = dateStr; }
  }
  return latest;
}

/**
 * Extrai a data mais antiga de um conjunto de transações.
 * Retorna undefined se o array for vazio.
 */
export function getStartDate(transactions: Transaction[]): string | undefined {
  if (!transactions.length) return undefined;
  const dates = Array.from(new Set(transactions.map(t => t.date)));
  return dates.sort((a, b) => parseDate(a) - parseDate(b))[0];
}

/**
 * Calcula o total de resgates/aplicações de uma empresa
 * a partir do mapa dfcManualValues.
 *
 * Replica a lógica de getSimulationResgAplicTotal do Dashboard.tsx.
 */
export function calcResgAplicTotal(
  companyId: string,
  manualValues: Record<string, number>,
): number {
  let total = 0;
  for (const [key, val] of Object.entries(manualValues ?? {})) {
    if (key.startsWith('sim_resg_')) {
      // Formato: sim_resg_{companyId}_{...}
      const parts = key.split('_');
      if (parts[2] === companyId) {
        total += Number(val) || 0;
      }
    }
  }
  return total;
}

/**
 * Separa o campo "Resg Aplic" (FC Diário Banco) em resgate e aplicação por
 * sinal — valor positivo = resgate (dinheiro voltando pro caixa), valor
 * negativo = aplicação (dinheiro saindo do caixa pra investimento).
 *
 * Usado no Demonstrativo Financeiro Consolidado pra mostrar o MOVIMENTO real
 * do período (o que foi digitado no FC Diário ou lançado manualmente), e não
 * a posição inteira já existente em Aplicações (que é importada, não é um
 * evento do período).
 */
export function calcResgAplicSplit(
  companyId: 'all' | string,
  manualValues: Record<string, number>,
): { resgates: number; aplicacoes: number } {
  let resgates = 0;
  let aplicacoes = 0;
  for (const [key, val] of Object.entries(manualValues ?? {})) {
    if (!key.startsWith('sim_resg_')) continue;
    if (companyId !== 'all') {
      const parts = key.split('_');
      if (parts[2] !== companyId) continue;
    }
    const v = Number(val) || 0;
    if (v > 0) resgates += v;
    else aplicacoes += Math.abs(v);
  }
  return { resgates, aplicacoes };
}

// ─── 8. ORDENAÇÃO ─────────────────────────────────────────────────────────────

/**
 * Comparador para ordenar strings de data cronologicamente.
 * Compatível com Array.sort().
 *
 * Uso: dates.sort(byDate)
 */
export function byDate(a: string, b: string): number {
  return parseDate(a) - parseDate(b);
}

/**
 * Ordena um array de transações cronologicamente por t.date.
 * Retorna um novo array (não muta o original).
 */
export function sortByDate<T extends Pick<Transaction, 'date'>>(transactions: T[]): T[] {
  return [...transactions].sort((a, b) => parseDate(a.date) - parseDate(b.date));
}

// ─── 9. NORMALIZAÇÃO DE EMPRESA ──────────────────────────────────────────────

/**
 * Normaliza um companyCode para comparação com os IDs canônicos.
 * Remove zeros à esquerda e espaços (ex: "01" → "1", " 14 " → "14").
 */
export function normalizeCompanyId(raw: string | undefined | null): string {
  if (!raw) return '';
  return String(raw).trim().replace(/^0+/, '') || '0';
}

/**
 * Domingo de Páscoa de um ano (algoritmo de Meeus/Jones/Butcher).
 * Base para os feriados móveis (Carnaval, Sexta-feira Santa, Corpus Christi).
 */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=março, 4=abril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Feriados nacionais brasileiros de um ano: fixos + móveis (calculados a
 * partir da Páscoa). Não inclui feriados estaduais/municipais (variam por
 * cidade — Vitória, Cachoeiro, etc. têm datas próprias não cobertas aqui).
 * Retorna um Set de timestamps (meia-noite local) para lookup O(1).
 */
const holidayCache = new Map<number, Set<number>>();
function getNationalHolidays(year: number): Set<number> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const set = new Set<number>();
  const add = (m: number, d: number) => set.add(new Date(year, m - 1, d).getTime());

  // Fixos
  add(1, 1);   // Confraternização Universal
  add(4, 21);  // Tiradentes
  add(5, 1);   // Dia do Trabalho
  add(9, 7);   // Independência
  add(10, 12); // Nossa Senhora Aparecida
  add(11, 2);  // Finados
  add(11, 15); // Proclamação da República
  add(11, 20); // Dia Nacional de Zumbi e da Consciência Negra (Lei 14.759/2023)
  add(12, 25); // Natal

  // Móveis (relativos à Páscoa)
  const easter = getEasterSunday(year);
  const offset = (days: number) => {
    const dt = new Date(easter);
    dt.setDate(dt.getDate() + days);
    set.add(dt.getTime());
  };
  offset(-48); // Segunda-feira de Carnaval
  offset(-47); // Terça-feira de Carnaval
  offset(-2);  // Sexta-feira Santa
  offset(60);  // Corpus Christi

  holidayCache.set(year, set);
  return set;
}

/** Feriado nacional? Aceita Date ou dd/mm/aaaa. */
export function isNationalHoliday(dateOrStr: Date | string): boolean {
  let dt: Date;
  if (typeof dateOrStr === 'string') {
    const parts = dateOrStr.split('/');
    if (parts.length < 2) return false;
    const d = Number(parts[0]);
    const m = Number(parts[1]) - 1;
    const y = parts.length === 3 ? Number(parts[2]) : new Date().getFullYear();
    dt = new Date(y, m, d);
  } else {
    dt = dateOrStr;
  }
  if (isNaN(dt.getTime())) return false;
  return getNationalHolidays(dt.getFullYear()).has(dt.getTime());
}

/**
 * Move uma data (dd/mm/aaaa) para o próximo DIA ÚTIL, pulando sábado,
 * domingo e feriados nacionais — de forma iterativa, então uma sequência
 * (ex.: feriado emendado com fim de semana) é tratada corretamente.
 * Substitui moveWeekendToMonday (mantida abaixo como alias de compatibilidade).
 */
export function moveToNextBusinessDay(dateStr: string): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length < 2) return dateStr;

  const d = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const y = parts.length === 3 ? Number(parts[2]) : new Date().getFullYear();
  const dt = new Date(y, m, d);
  if (isNaN(dt.getTime())) return dateStr;

  // Empurra dia a dia enquanto cair em fim de semana ou feriado nacional.
  // Um teto de 10 iterações evita loop infinito em qualquer cenário bizarro.
  for (let guard = 0; guard < 10; guard++) {
    const dow = dt.getDay(); // 0=DOM, 6=SAB
    const isWeekend = dow === 0 || dow === 6;
    if (!isWeekend && !getNationalHolidays(dt.getFullYear()).has(dt.getTime())) break;
    dt.setDate(dt.getDate() + 1);
  }

  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Move datas de sábado → próxima segunda (+2 dias), domingo → próxima segunda (+1 dia).
 * Formato esperado: dd/mm/yyyy. Retorna a data ajustada no mesmo formato.
 * @deprecated Use moveToNextBusinessDay (também trata feriados nacionais).
 */
export function moveWeekendToMonday(dateStr: string): string {
  return moveToNextBusinessDay(dateStr);
}

/**
 * Classificação tributária: Federal, Estadual ou Municipal.
 *
 * Critério PRIMÁRIO: código do fornecedor (mais preciso).
 * Critério SECUNDÁRIO: palavras-chave em descrição/categoria (fallback).
 *
 * Impostos FEDERAIS tipicamente antecipam (vencimento mais cedo no período).
 * Impostos ESTADUAIS e MUNICIPAIS tipicamente postergam (vencimento mais tarde).
 */
export type TaxLevel = 'FEDERAL' | 'ESTADUAL' | 'MUNICIPAL' | null;

// ─── Fornecedores conhecidos por esfera ───────────────────────────────────────
const FEDERAL_SUPPLIERS = ['61369', '62858'];           // 61369 = Receita Federal, 62858 = INSS
const ESTADUAL_SUPPLIERS = ['30228'];                   // 30228 = ICMS
const MUNICIPAL_SUPPLIERS: string[] = [];               // Preencher conforme necessário

// Código do Tipo de Fluxo (Conta TOTVS) já confirmado como ISS — pega o
// lançamento na hora, mesmo que o nome do fornecedor não bata com nenhuma
// palavra-chave abaixo. Acrescentar aqui outros códigos municipais conforme
// forem aparecendo (alvará, TFF etc.).
const MUNICIPAL_FLOW_CODES = ['21501'];                  // 21501 = ISS

// ─── Palavras-chave (fallback, sem acentos — o texto é normalizado antes) ─────
const FEDERAL_KEYWORDS = [
  'RECEITA FEDERAL', 'IRPJ', 'IRRF', 'PIS', 'COFINS', 'CSLL',
  'INSS', 'FGTS', 'IOF', 'DARF', 'GPS', 'GFIP', 'E-SOCIAL', 'ESOCIAL',
  'RAT', 'FUNRURAL',
];

const ESTADUAL_KEYWORDS = [
  'ICMS', 'DIFAL', 'FECP', 'GNRE', 'SEFAZ',
  'SECRETARIA DA FAZENDA', 'GOVERNO DO ESTADO', 'GOV ESTADO',
];

const MUNICIPAL_KEYWORDS = [
  'PREFEITURA', 'MUNICIPIO', 'MUNICIPAL',
  'ISS', 'IPTU', 'TFF', 'ALVARA',
  'PMV', 'PMSERRA', 'PMVV', 'PMCI', 'SEMFA',
];

/** Remove acentos de um texto (pra matching seguro). */
const stripAccents = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Checa se keyword existe no texto. Keywords curtas (≤4 chars) usam word boundary pra evitar falso positivo (ex: 'ISS' não casa com 'EMISSORAS'). */
const textHasKeyword = (text: string, kw: string): boolean => {
    if (kw.length <= 4) return new RegExp('\\b' + kw + '\\b').test(text);
    return text.includes(kw);
};

export function classifyTax(t: {
  category?: string;
  description?: string;
  supplierCode?: string;
  supplier?: string;
  flowTypeCode?: string;
  flowTypeLevel2?: string;
  species?: string;
}): TaxLevel {
  const code = (t.supplierCode || '').trim();

  // ── 1) Código do fornecedor (mais preciso) ──
  if (code && FEDERAL_SUPPLIERS.includes(code)) return 'FEDERAL';
  if (code && ESTADUAL_SUPPLIERS.includes(code)) return 'ESTADUAL';
  if (code && MUNICIPAL_SUPPLIERS.includes(code)) return 'MUNICIPAL';

  // ── 1b) Código do Tipo de Fluxo (Conta TOTVS) — mais preciso ainda que
  // palavra-chave, cerca o caso mesmo se o nome do fornecedor vier diferente.
  const flowCode = (t.flowTypeCode || '').trim();
  if (MUNICIPAL_FLOW_CODES.includes(flowCode)) return 'MUNICIPAL';

  // ── 2) Keywords em texto (fallback) — sem acentos pra casar "MUNICÍPIO" com "MUNICIPIO" ──
  const text = stripAccents([
    t.category || '',
    t.description || '',
    t.supplier || '',
    t.species || '',
  ].join(' ').toUpperCase());

  const n2 = (t.flowTypeLevel2 || '').trim();
  const isTaxN2 = n2 === '209' || n2 === '215';

  if (!isTaxN2) {
      const hasAnyKeyword = [...FEDERAL_KEYWORDS, ...ESTADUAL_KEYWORDS, ...MUNICIPAL_KEYWORDS]
          .some(kw => textHasKeyword(text, kw));
      if (!hasAnyKeyword) return null;
  }

  if (FEDERAL_KEYWORDS.some(kw => textHasKeyword(text, kw))) return 'FEDERAL';
  if (ESTADUAL_KEYWORDS.some(kw => textHasKeyword(text, kw))) return 'ESTADUAL';
  if (MUNICIPAL_KEYWORDS.some(kw => textHasKeyword(text, kw))) return 'MUNICIPAL';

  // Na faixa tributária (209/215) mas sem keyword específica → NÃO classifica (evita falso positivo)
  return null;
}
