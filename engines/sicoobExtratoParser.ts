/**
 * engines/sicoobExtratoParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrai o saldo de fechamento de um extrato Sicoob (Plataforma SISBR —
 * "EXTRATO CONTA CORRENTE").
 *
 * SALDO USADO: a última linha "SALDO DO DIA" do histórico de movimentação —
 * mesmo critério dos demais bancos (fechamento realizado dos lançamentos
 * listados). No extrato de teste esse valor coincidiu com "SALDO EM CONTA" e
 * "SALDO DISPONÍVEL" do resumo, então não há a mesma divergência vista no BB
 * e no Itaú — mas o critério "usa a linha do histórico, não o resumo" segue
 * o mesmo padrão por consistência.
 *
 * Sem movimento no período (sem linha "SALDO DO DIA"): usa "SALDO ANTERIOR".
 *
 * A data de referência é o fim do período do extrato ("PERÍODO: ... até
 * DD/MM/AAAA"), mesmo quando o último lançamento é de data anterior.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveCompanyFromContaSicoob } from '../utils/sicoobDePara';

export interface SicoobAccountBalance {
  conta:      string;
  companyId:  string;
  saldo:      number;
  origem:     'SALDO DO DIA (realizado)' | 'SALDO ANTERIOR (sem movimento no período)';
}

export interface SicoobExtratoParseResult {
  dateISO: string | null;
  balance: SicoobAccountBalance | null;
  contaNaoMapeada: string | null;
}

const parseNum = (numStr: string, sign: string): number => {
  const v = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
  return sign === 'D' ? -v : v;
};

export function parseSicoobExtrato(rawText: string): SicoobExtratoParseResult {
  const flat = rawText.replace(/\s+/g, ' ');

  const contaMatch = flat.match(/CONTA:\s*([\d.\-]+)/i);
  if (!contaMatch) return { dateISO: null, balance: null, contaNaoMapeada: null };
  const conta = contaMatch[1];

  // Data: "PERÍODO: DD/MM/AAAA - DD/MM/AAAA" — usa a data final.
  let dateISO: string | null = null;
  const periodoMatch = flat.match(/PER.ODO:\s*\d{2}\/\d{2}\/\d{4}\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (periodoMatch) dateISO = `${periodoMatch[3]}-${periodoMatch[2]}-${periodoMatch[1]}`;

  const companyId = resolveCompanyFromContaSicoob(conta);
  if (!companyId) return { dateISO, balance: null, contaNaoMapeada: conta };

  // Só considera valores com sufixo C/D (crédito/débito) — ignora linhas com
  // "*" (valores bloqueados, não são saldo de fato).
  const saldoDiaMatches = [...flat.matchAll(/SALDO DO DIA\s*([\d.,]+)\s*([CD])/gi)];
  if (saldoDiaMatches.length > 0) {
    const last = saldoDiaMatches[saldoDiaMatches.length - 1];
    return {
      dateISO,
      balance: { conta, companyId, saldo: parseNum(last[1], last[2]), origem: 'SALDO DO DIA (realizado)' },
      contaNaoMapeada: null,
    };
  }

  const anteriorMatch = flat.match(/\bSALDO ANTERIOR\s*([\d.,]+)\s*([CD])/i);
  if (anteriorMatch) {
    return {
      dateISO,
      balance: { conta, companyId, saldo: parseNum(anteriorMatch[1], anteriorMatch[2]), origem: 'SALDO ANTERIOR (sem movimento no período)' },
      contaNaoMapeada: null,
    };
  }

  return { dateISO, balance: null, contaNaoMapeada: null };
}
