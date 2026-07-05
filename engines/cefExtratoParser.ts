/**
 * engines/cefExtratoParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrai o saldo de fechamento de um extrato CEF ("Gerenciador CAIXA").
 *
 * ATENÇÃO — cobertura parcial por enquanto: os extratos recebidos até agora
 * só mostraram o caso SEM movimento no período ("NÃO CONSTA LANÇAMENTO NESTE
 * PERIODO"), onde o saldo de fechamento é o próprio "Saldo anterior ao
 * período solicitado" (nada mudou). Ainda não vimos um extrato CEF COM
 * lançamentos, então não sabemos o formato exato da linha de saldo final
 * nesse caso — em vez de adivinhar (e arriscar gravar um valor errado), o
 * parser sinaliza `precisaExemploComMovimento: true` e não grava nada para
 * essa conta. Assim que um extrato CEF com movimento for recebido, é só
 * completar esta função.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveCompanyFromCNPJ } from '../utils/cnpjDePara';

export interface CEFAccountBalance {
  cnpj:       string;
  companyId:  string;
  saldo:      number;
  origem:     'Saldo anterior (sem movimento no período)';
}

export interface CEFExtratoParseResult {
  dateISO:  string | null;
  balance:  CEFAccountBalance | null;
  cnpjNaoMapeado: string | null;
  precisaExemploComMovimento: boolean; // true = conta tem lançamentos e o parser ainda não sabe ler esse formato
}

const parseNum = (s: string, sign: string): number => {
  const v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return sign === 'D' ? -v : v;
};

export function parseCEFExtrato(rawText: string): CEFExtratoParseResult {
  const flat = rawText.replace(/\s+/g, ' ');

  const cnpjMatch = flat.match(/CNPJ:\s*([\d.\/\-]+)/);
  const cnpj = cnpjMatch?.[1] ?? null;

  // Data: "Extrato no período de DD/MM/AAAA à DD/MM/AAAA" — usa a data final.
  let dateISO: string | null = null;
  const periodoMatch = flat.match(
    /Extrato no per.odo de\s*\d{2}\/\d{2}\/\d{4}\s*.\s*(\d{2})\/(\d{2})\/(\d{4})/i
  );
  if (periodoMatch) dateISO = `${periodoMatch[3]}-${periodoMatch[2]}-${periodoMatch[1]}`;

  if (!cnpj) return { dateISO, balance: null, cnpjNaoMapeado: null, precisaExemploComMovimento: false };

  const companyId = resolveCompanyFromCNPJ(cnpj);
  if (!companyId) return { dateISO, balance: null, cnpjNaoMapeado: cnpj, precisaExemploComMovimento: false };

  const semMovimento = /N.O CONSTA LAN.AMENTO/i.test(flat);

  if (semMovimento) {
    const saldoMatch = flat.match(/Saldo anterior ao per.odo solicitado\s*R\$\s*([\d.,]+)\s*([CD])/i);
    if (saldoMatch) {
      return {
        dateISO,
        balance: { cnpj, companyId, saldo: parseNum(saldoMatch[1], saldoMatch[2]), origem: 'Saldo anterior (sem movimento no período)' },
        cnpjNaoMapeado: null,
        precisaExemploComMovimento: false,
      };
    }
  }

  // Tem lançamento no período — formato da linha de saldo final ainda
  // desconhecido. Não chuta: sinaliza pra pedir um exemplo real.
  return { dateISO, balance: null, cnpjNaoMapeado: null, precisaExemploComMovimento: true };
}
