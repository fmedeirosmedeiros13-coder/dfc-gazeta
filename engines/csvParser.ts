/**
 * engines/csvParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine de importação e validação de CSV de realizados.
 *
 * ANTES (App.tsx):
 *   • Erros silenciados com `return null`
 *   • Nenhum relatório de linhas rejeitadas
 *   • Sem preview antes de confirmar
 *   • Layout de colunas fixo
 *
 * AGORA:
 *   • Relatório completo: linhas válidas, inválidas e motivo de cada rejeição
 *   • Detecção automática de separador (; ou ,)
 *   • Suporte a múltiplos layouts de ERP via mapeamento configurável
 *   • Detecção de duplicatas (mesmo fornecedor + documento + valor já importado)
 *   • Preview: retorna os dados sem confirmar — o caller decide se salva
 *   • Encoding: UTF-8 e ISO-8859-1 (o caller passa o texto já decodificado)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction, TransactionType } from '../types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface ParsedRow {
  lineNumber: number;
  transaction: Transaction;
}

export interface RejectedRow {
  lineNumber: number;
  rawLine: string;
  reason: string;
}

export interface DuplicateRow {
  lineNumber: number;
  transaction: Transaction;
  /** ID da transação existente que conflita. */
  conflictsWithId: string;
  reason: string;
}

export interface CSVParseResult {
  /** Transações válidas e prontas para importar. */
  valid: ParsedRow[];
  /** Linhas rejeitadas com motivo. */
  rejected: RejectedRow[];
  /** Transações duplicadas (baseado em comparação com existentes). */
  duplicates: DuplicateRow[];
  /** Metadados do arquivo. */
  meta: {
    totalLines: number;
    separator: ';' | ',';
    detectedColumns: string[];
    encoding: 'utf-8' | 'iso-8859-1' | 'unknown';
  };
}

// ─── Layouts de ERP ──────────────────────────────────────────────────────────

/**
 * Define como mapear colunas de diferentes layouts de ERP.
 * Adicionar novos layouts aqui sem tocar no parser principal.
 */
export interface ERPColumnLayout {
  name: string;
  /** Lista de possíveis nomes de coluna para cada campo (case-insensitive, sem acentos). */
  columns: {
    date:         string[];
    value:        string[];
    description:  string[];
    supplier:     string[];
    company:      string[];
    establishment?: string[];
    species?:     string[];
    document?:    string[];
    installment?: string[];
    valueOriginal?: string[];
    businessUnit?: string[];
    customer?:    string[];
  };
}

export const ERP_LAYOUTS: ERPColumnLayout[] = [
  {
    name: 'TOTVS Contas a Pagar',
    columns: {
      date:         ['DATA PAGAMENTO', 'DATA PAGTO', 'DT PAGTO', 'DT LIQUIDACAO', 'DATA'],
      value:        ['VALOR PAGAMENTO', 'VLR PAGO', 'VLR LIQUIDO', 'VALOR'],
      description:  ['NOME ABREVIADO', 'HISTORICO', 'DESCRICAO', 'NOME'],
      supplier:     ['FORNECEDOR', 'COD FORNECEDOR', 'COD FORNEC', 'FORNEC'],
      company:      ['EMPRESA', 'COD EMPRESA', 'EMP'],
      establishment:['ESTABELECIMENTO', 'ESTAB', 'EST'],
      species:      ['ESPECIE DOCUMENTO', 'ESPECIE', 'TP DOCTO', 'ESP'],
      document:     ['TITULO', 'DOCUMENTO', 'NUMERO', 'NF'],
      installment:  ['PARCELA', 'PARC', '/P'],
      valueOriginal:['VALOR ORIGINAL', 'VL ORIGINAL', 'VLR ORIGINAL', 'VL ORIGINAL TITULO'],
      businessUnit: ['UNIDADE DE NEGOCIO', 'UNID NEGOCIO', 'UNIDADE', 'CENTRO DE CUSTO'],
    },
  },
  {
    name: 'TOTVS Contas a Receber',
    columns: {
      date:         ['DATA RECEBIMENTO', 'DT RECEBTO', 'DT LIQUIDACAO'],
      value:        ['VALOR RECEBIDO', 'VLR RECEBIDO', 'VLR LIQUIDO'],
      description:  ['NOME CLIENTE', 'CLIENTE', 'NOME'],
      supplier:     ['CLIENTE', 'COD CLIENTE'],
      company:      ['EMPRESA', 'COD EMPRESA'],
      document:     ['TITULO', 'NOTA', 'NF'],
      customer:     ['CLIENTE', 'NOME CLIENTE'],
    },
  },
  {
    name: 'Exportação Genérica',
    columns: {
      date:         ['DATA', 'DATE', 'DT'],
      value:        ['VALOR', 'VALUE', 'AMOUNT', 'TOTAL'],
      description:  ['DESCRICAO', 'DESCRIPTION', 'HISTORICO', 'MEMO'],
      supplier:     ['FORNECEDOR', 'SUPPLIER', 'VENDOR'],
      company:      ['EMPRESA', 'COMPANY'],
    },
  },
];

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** Normaliza string de cabeçalho para comparação. */
function normalizeHeader(h: string): string {
  return h
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .trim();
}

/** Parser de linha CSV respeitando aspas. */
function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/** Remove aspas e espaços de uma célula. */
function cleanCell(s: string): string {
  return s.replace(/^"|"$/g, '').trim();
}

/** Converte valor monetário brasileiro para número. */
function parseBRValue(raw: string): number | null {
  if (!raw) return null;
  const v = raw.replace(/^R\$\s?/, '').replace(/\s/g, '');
  if (!v) return null;
  let parsed: number;
  if (v.includes(',') && v.includes('.')) {
    // Formato: 1.000,00
    parsed = parseFloat(v.replace(/\./g, '').replace(',', '.'));
  } else if (v.includes(',')) {
    // Formato: 1000,00
    parsed = parseFloat(v.replace(',', '.'));
  } else {
    parsed = parseFloat(v);
  }
  return isNaN(parsed) ? null : parsed;
}

/** Detecta separador analisando o cabeçalho. */
function detectSeparator(headerLine: string): ';' | ',' {
  const countSemi  = (headerLine.match(/;/g) ?? []).length;
  const countComma = (headerLine.match(/,/g) ?? []).length;
  return countSemi >= countComma ? ';' : ',';
}

/**
 * Detecta se as datas vêm em ordem BR (DD/MM) ou US (MM/DD).
 * Export TOTVS "Por Estabelecimento" sai em MM/DD/AA; o CSV antigo em DD/MM/AAAA.
 */
function detectDateOrder(samples: string[]): 'BR' | 'US' {
  for (const s of samples) {
    const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) continue;
    if (+m[1] > 12) return 'BR'; // 1º campo > 12 => só pode ser dia
    if (+m[2] > 12) return 'US'; // 2º campo > 12 => só pode ser dia => mês vem 1º
  }
  // Ambíguo: ano com 2 dígitos é o export novo (US); 4 dígitos é o padrão antigo (BR).
  return samples.some(s => /\/\d{2}$/.test(s || '')) ? 'US' : 'BR';
}

/** Normaliza data slash para DD/MM/AAAA (formato esperado por parseDate). */
function toBRDate(raw: string, order: 'BR' | 'US'): string {
  const m = (raw || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return raw; // formato desconhecido — mantém como veio
  const day  = order === 'US' ? m[2] : m[1];
  const mon  = order === 'US' ? m[1] : m[2];
  const year = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${day.padStart(2, '0')}/${mon.padStart(2, '0')}/${year}`;
}

/** Encontra índice de coluna usando as listas de possíveis nomes. */
function findColumnIndex(headers: string[], names: string[]): number {
  let idx = headers.findIndex(h => names.some(n => h === normalizeHeader(n)));
  if (idx !== -1) return idx;
  idx = headers.findIndex(h => names.some(n => h.startsWith(normalizeHeader(n))));
  if (idx !== -1) return idx;
  return headers.findIndex(h => names.some(n => h.includes(normalizeHeader(n))));
}

/** Seleciona o melhor layout para o arquivo baseado na cobertura de colunas obrigatórias. */
function selectLayout(headers: string[]): ERPColumnLayout {
  let bestLayout = ERP_LAYOUTS[ERP_LAYOUTS.length - 1]; // fallback: genérico
  let bestScore  = 0;

  for (const layout of ERP_LAYOUTS) {
    const required = [layout.columns.date, layout.columns.value, layout.columns.description];
    const score    = required.filter(names => findColumnIndex(headers, names) !== -1).length;
    if (score > bestScore) {
      bestScore  = score;
      bestLayout = layout;
    }
  }

  return bestLayout;
}

/** Verifica duplicata comparando com transações já existentes. */
function findDuplicate(
  t: Transaction,
  existing: Transaction[],
): Transaction | null {
  const normDoc  = (t.documentNumber  ?? '').replace(/\D/g, '');
  const normParc = (t.installment     ?? '').replace(/\D/g, '');
  const normForn = (t.supplierCode    ?? '').replace(/\D/g, '');
  const tVal     = Math.abs(t.value);

  return existing.find(e => {
    const eDoc  = (e.documentNumber  ?? '').replace(/\D/g, '');
    const eParc = (e.installment     ?? '').replace(/\D/g, '');
    const eForn = (e.supplierCode    ?? '').replace(/\D/g, '');
    const eVal  = Math.abs(e.value);

    // Título igual; se ambos têm parcela, ela também precisa bater.
    const sameDoc  = normDoc  && eDoc  && normDoc  === eDoc;
    const sameParc = (!normParc || !eParc) || normParc === eParc;
    const sameForn = normForn && eForn && normForn === eForn;
    const sameVal  = Math.abs(tVal - eVal) < 0.02;

    return (sameDoc && sameParc && sameForn && sameVal) || (sameDoc && sameParc && sameVal && !normForn);
  }) ?? null;
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Parseia e valida um CSV de transações realizadas.
 *
 * @param csvText          Conteúdo do arquivo já decodificado (UTF-8 ou ISO-8859-1).
 * @param existingTx       Transações já no estado — usadas para detecção de duplicatas.
 * @param defaultCompanyId ID da empresa selecionada no filtro global (fallback quando CSV não tem coluna empresa).
 * @param selectedCompany  'all' ou ID — determina se o fallback é aplicado.
 * @returns                Resultado completo com válidos, rejeitados e duplicatas.
 */
export function parseRealizedCSV(
  csvText: string,
  existingTx: Transaction[],
  defaultCompanyId: string,
  selectedCompany: string,
): CSVParseResult {
  const valid:      ParsedRow[]    = [];
  const rejected:   RejectedRow[]  = [];
  const duplicates: DuplicateRow[] = [];

  const lines = csvText.split(/\r\n|\n/).filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      valid, rejected, duplicates,
      meta: {
        totalLines: lines.length,
        separator: ';',
        detectedColumns: [],
        encoding: 'unknown',
      },
    };
  }

  const headerLine = lines[0];
  const sep        = detectSeparator(headerLine);
  const headers    = parseCSVLine(headerLine, sep).map(normalizeHeader);
  const layout     = selectLayout(headers);

  const cols = {
    date:         findColumnIndex(headers, layout.columns.date),
    value:        findColumnIndex(headers, layout.columns.value),
    description:  findColumnIndex(headers, layout.columns.description),
    supplier:     findColumnIndex(headers, layout.columns.supplier),
    company:      findColumnIndex(headers, layout.columns.company),
    establishment:findColumnIndex(headers, layout.columns.establishment ?? []),
    species:      findColumnIndex(headers, layout.columns.species       ?? []),
    document:     findColumnIndex(headers, layout.columns.document      ?? []),
    installment:  findColumnIndex(headers, layout.columns.installment   ?? []),
    valueOriginal:findColumnIndex(headers, layout.columns.valueOriginal ?? []),
    businessUnit: findColumnIndex(headers, layout.columns.businessUnit  ?? []),
    customer:     findColumnIndex(headers, layout.columns.customer      ?? []),
  };

  // Validar colunas obrigatórias
  const missingRequired: string[] = [];
  if (cols.date  === -1) missingRequired.push('Data');
  if (cols.value === -1) missingRequired.push('Valor');

  // Detecta a ordem das datas (BR DD/MM vs US MM/DD) a partir de uma amostra das linhas.
  const dateSamples: string[] = [];
  if (cols.date >= 0) {
    for (let i = 1; i < lines.length && dateSamples.length < 60; i++) {
      const c = parseCSVLine(lines[i], sep);
      const d = cleanCell(c[cols.date] ?? '');
      if (d) dateSamples.push(d);
    }
  }
  const dateOrder = detectDateOrder(dateSamples);

  for (let i = 1; i < lines.length; i++) {
    const rawLine    = lines[i];
    const lineNumber = i + 1; // 1-based para o usuário
    const cells      = parseCSVLine(rawLine, sep);
    const getCell    = (idx: number) => idx >= 0 ? cleanCell(cells[idx] ?? '') : '';

    // Validações obrigatórias
    if (missingRequired.length > 0) {
      rejected.push({
        lineNumber,
        rawLine,
        reason: `Colunas obrigatórias não encontradas: ${missingRequired.join(', ')}`,
      });
      continue;
    }

    const rawDate  = getCell(cols.date);
    const rawValue = getCell(cols.value);

    if (!rawDate) {
      rejected.push({ lineNumber, rawLine, reason: 'Data ausente ou vazia' });
      continue;
    }

    const parsedValue = parseBRValue(rawValue);
    if (parsedValue === null || parsedValue === 0) {
      rejected.push({
        lineNumber,
        rawLine,
        reason: `Valor inválido ou zero: "${rawValue}"`,
      });
      continue;
    }

    const docNum     = getCell(cols.document);
    const parcela    = getCell(cols.installment);
    const estab      = getCell(cols.establishment);
    const desc       = getCell(cols.description) || 'Importado';
    const companyRaw = getCell(cols.company);
    // companyCode: coluna EMPRESA quando existe; senão Estabelecimento (CSV de realizados
    // TOTVS não traz EMPRESA, e o Estabelecimento corresponde ao companyCode do previsto);
    // por último, o filtro global selecionado.
    const companyId  = companyRaw || estab || (selectedCompany !== 'all' ? defaultCompanyId : '');

    // Valor Original do título — usado como critério secundário de matching na conciliação.
    const origRaw    = getCell(cols.valueOriginal);
    const origVal    = parseBRValue(origRaw);

    const transaction: Transaction = {
      id:            `real-${Date.now()}-${i}`,
      date:          toBRDate(rawDate, dateOrder),
      description:   desc,
      value:         Math.abs(parsedValue),
      type:          TransactionType.PAYABLE,
      category:      'Realizado',
      status:        'REALIZADO',
      businessUnit:  getCell(cols.businessUnit),
      supplierCode:  getCell(cols.supplier),
      supplier:      getCell(cols.description),
      companyCode:   companyId,
      establishment: estab,
      species:       getCell(cols.species),
      documentNumber: docNum,
      installment:   parcela,
      originalTitleValue: origVal !== null ? Math.abs(origVal) : undefined,
      customer:      getCell(cols.customer),
    };

    // Detectar duplicata
    const dup = findDuplicate(transaction, existingTx);
    if (dup) {
      duplicates.push({
        lineNumber,
        transaction,
        conflictsWithId: dup.id,
        reason: `Possível duplicata: mesmo documento "${docNum}" e valor R$ ${Math.abs(parsedValue).toFixed(2)} já existe (ID: ${dup.id})`,
      });
      continue; // não adiciona em valid — caller decide o que fazer com duplicatas
    }

    valid.push({ lineNumber, transaction });
  }

  return {
    valid,
    rejected,
    duplicates,
    meta: {
      totalLines: lines.length - 1,
      separator:  sep,
      detectedColumns: headers,
      encoding: csvText.includes('Ã') || csvText.includes('Ç') ? 'iso-8859-1' : 'utf-8',
    },
  };
}

/** Gera um resumo legível do resultado para exibição no toast/modal. */
export function summarizeParseResult(result: CSVParseResult): string {
  const parts: string[] = [];
  if (result.valid.length > 0)
    parts.push(`✓ ${result.valid.length} transação(ões) válida(s)`);
  if (result.duplicates.length > 0)
    parts.push(`⚠ ${result.duplicates.length} possível(is) duplicata(s)`);
  if (result.rejected.length > 0)
    parts.push(`✗ ${result.rejected.length} linha(s) rejeitada(s)`);
  return parts.join(' · ');
}
