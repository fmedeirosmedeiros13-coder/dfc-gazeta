/**
 * engines/itauExtratoParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrai o saldo de fechamento de um extrato Itaú (itaú BBA — "Lançamentos
 * do período").
 *
 * SALDO USADO: a ÚLTIMA linha "SALDO TOTAL DISPONÍVEL DIA" da lista de
 * lançamentos (confirmado com o usuário) — não o "Saldo total" do cabeçalho,
 * que reflete a consulta ao vivo e pode incluir aplicação automática ainda
 * não refletida na lista de lançamentos (chegou a divergir mais de R$ 1.000
 * num dos extratos de teste).
 *
 * Quando não há nenhuma linha "SALDO TOTAL DISPONÍVEL DIA" (sem movimento
 * no período), usa-se "SALDO ANTERIOR" — mesma lógica de fallback do
 * Banestes/BB: sem movimento, o saldo não mudou.
 *
 * A data de referência do fechamento é sempre o fim do período do extrato
 * ("Lançamentos do período: ... até DD/MM/AAAA"), mesmo quando o último
 * lançamento listado é de uma data anterior (conta pouco movimentada) —
 * mesmo critério já usado no Banestes/BB pra contas paradas.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveCompanyFromCNPJ } from '../utils/cnpjDePara';

export interface ItauAccountBalance {
  cnpj:      string;
  companyId: string;
  saldo:     number;
  origem:    'SALDO TOTAL DISPONÍVEL DIA (realizado)' | 'SALDO ANTERIOR (sem movimento no período)';
}

export interface ItauExtratoParseResult {
  dateISO: string | null;
  balance: ItauAccountBalance | null;
  cnpjNaoMapeado: string | null;
}

const parseNum = (s: string): number => parseFloat(s.replace(/\./g, '').replace(',', '.'));

export function parseItauExtrato(rawText: string): ItauExtratoParseResult {
  const flat = rawText.replace(/\s+/g, ' ');

  const cnpjMatch = flat.match(/CNPJ\s+([\d.\/\-]+)/);
  const cnpj = cnpjMatch?.[1] ?? null;

  // Data: "Lançamentos do período: DD/MM/AAAA até DD/MM/AAAA" — usa o "até".
  let dateISO: string | null = null;
  const periodoMatch = flat.match(
    /Lan.amentos do per.odo:\s*\d{2}\/\d{2}\/\d{4}\s*at.\s*(\d{2})\/(\d{2})\/(\d{4})/i
  );
  if (periodoMatch) dateISO = `${periodoMatch[3]}-${periodoMatch[2]}-${periodoMatch[1]}`;

  if (!cnpj) return { dateISO, balance: null, cnpjNaoMapeado: null };

  const companyId = resolveCompanyFromCNPJ(cnpj);
  if (!companyId) return { dateISO, balance: null, cnpjNaoMapeado: cnpj };

  // Pega a ÚLTIMA ocorrência de "SALDO TOTAL DISPONÍVEL DIA" (pode haver uma
  // por dia com movimento; a mais recente é a que vale).
  const saldoDiaMatches = [...flat.matchAll(/SALDO TOTAL DISPON.VEL DIA\s*([\d.,]+)/gi)];
  if (saldoDiaMatches.length > 0) {
    const last = saldoDiaMatches[saldoDiaMatches.length - 1];
    return {
      dateISO,
      balance: { cnpj, companyId, saldo: parseNum(last[1]), origem: 'SALDO TOTAL DISPONÍVEL DIA (realizado)' },
      cnpjNaoMapeado: null,
    };
  }

  // Sem movimento no período: usa o SALDO ANTERIOR (nada mudou).
  const anteriorMatch = flat.match(/SALDO ANTERIOR\s*([\d.,]+)/i);
  if (anteriorMatch) {
    return {
      dateISO,
      balance: { cnpj, companyId, saldo: parseNum(anteriorMatch[1]), origem: 'SALDO ANTERIOR (sem movimento no período)' },
      cnpjNaoMapeado: null,
    };
  }

  return { dateISO, balance: null, cnpjNaoMapeado: null };
}
