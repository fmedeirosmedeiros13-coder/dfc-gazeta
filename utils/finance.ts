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
 * Move datas de sábado → próxima segunda (+2 dias), domingo → próxima segunda (+1 dia).
 * Formato esperado: dd/mm/yyyy. Retorna a data ajustada no mesmo formato.
 */
export function moveWeekendToMonday(dateStr: string): string {
  if (!dateStr) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length < 2) return dateStr;

  const d = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const y = parts.length === 3 ? Number(parts[2]) : new Date().getFullYear();
  const dt = new Date(y, m, d);

  if (isNaN(dt.getTime())) return dateStr;

  const dow = dt.getDay(); // 0=DOM, 6=SAB
  if (dow === 6) dt.setDate(dt.getDate() + 2);       // SAB → SEG
  else if (dow === 0) dt.setDate(dt.getDate() + 1);   // DOM → SEG

  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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
