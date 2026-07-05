/**
 * engines/bbExtratoParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrai o saldo de fechamento de UM extrato de conta corrente do Banco do
 * Brasil ("Consultas - Extrato de conta corrente"). Diferente do Banestes, o
 * BB exporta UM PDF POR CONTA — a importação recebe vários arquivos de uma vez
 * (um por empresa) e cada um é parseado individualmente por esta função.
 *
 * SALDO USADO: a linha "999 S A L D O" — o fechamento dos lançamentos listados
 * no dia (confirmado com o usuário, mesmo critério do Banestes: fechamento
 * realizado, não a posição "Saldo Atual"/"Saldo" que no BB pode já refletir a
 * aplicação automática overnight do banco).
 *
 * Quando a conta não teve movimento no período ("A CONTA NAO FOI
 * MOVIMENTADA"), não existe linha "999 S A L D O" — nesse caso usa-se
 * "Saldo Anterior", que é idêntico ao saldo atual (nada mudou).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveCompanyFromContaBB } from '../utils/bbDePara';

export interface BBAccountBalance {
  conta:      string;
  companyId:  string;
  saldo:      number;
  origem:     'S A L D O (realizado)' | 'Saldo Anterior (sem movimento)';
}

export interface BBExtratoParseResult {
  dateISO:   string | null;
  balance:   BBAccountBalance | null;
  contaNaoMapeada: string | null; // conta encontrada mas fora do De-Para
}

const parseNum = (s: string, sign: string): number => {
  const v = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  return sign === 'D' ? -v : v;
};

export function parseBBExtrato(rawText: string): BBExtratoParseResult {
  const flat = rawText.replace(/\s+/g, ' ');

  // Data: "Período do extrato de DD / MM / AAAA até DD / MM / AAAA" — usa o "até".
  let dateISO: string | null = null;
  const periodoMatch = flat.match(
    /Per.odo do extrato\s*de\s*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})\s*at.\s*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})/i
  );
  if (periodoMatch) {
    dateISO = `${periodoMatch[6]}-${periodoMatch[5]}-${periodoMatch[4]}`;
  }

  const contaMatch = flat.match(/Conta corrente\s+([\d.\-]+)/);
  if (!contaMatch) return { dateISO, balance: null, contaNaoMapeada: null };
  const conta = contaMatch[1];

  const companyId = resolveCompanyFromContaBB(conta);
  if (!companyId) return { dateISO, balance: null, contaNaoMapeada: conta };

  let saldo: number | null = null;
  let origem: BBAccountBalance['origem'] | null = null;

  const saldoMatch = flat.match(/999\s*S\s*A\s*L\s*D\s*O\s*([\d.,]+)\s*([CD])/);
  if (saldoMatch) {
    saldo = parseNum(saldoMatch[1], saldoMatch[2]);
    origem = 'S A L D O (realizado)';
  } else {
    const anteriorMatch = flat.match(/Saldo Anterior\s*([\d.,]+)\s*([CD])/);
    if (anteriorMatch) {
      saldo = parseNum(anteriorMatch[1], anteriorMatch[2]);
      origem = 'Saldo Anterior (sem movimento)';
    }
  }

  if (saldo === null || !origem) return { dateISO, balance: null, contaNaoMapeada: null };

  return { dateISO, balance: { conta, companyId, saldo, origem }, contaNaoMapeada: null };
}
