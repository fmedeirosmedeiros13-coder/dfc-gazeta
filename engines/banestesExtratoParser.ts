/**
 * engines/banestesExtratoParser.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrai o saldo de fechamento de cada conta do extrato consolidado Banestes
 * (relatório "SERVICO DE EXTRATOS BANESTES — LANCAMENTOS ULTIMO DIA").
 *
 * O texto vindo do pdfjs-dist chega com os tokens quebrados em várias linhas
 * (cada "célula" do relatório é um item de texto separado) — por isso a
 * primeira coisa que se faz é achatar todo whitespace em espaço único.
 *
 * SALDO USADO: "S A L D O ..........." — o fechamento REALIZADO do dia, antes
 * dos "LANCAMENTOS PREVISTOS" (débitos futuros que ainda não caíram). Quando a
 * conta não tem nenhum previsto, essa linha não existe no relatório — nesse
 * caso "SALDO CONTA CORRENTE" já É o saldo realizado (não há nada a descontar).
 *
 * CONTAS-CAIXA AUXILIARES: cada empresa tem, além da conta principal, uma
 * conta interna de uso operacional no mesmo extrato. Contas que não estão no
 * De-Para (utils/banestesDePara.ts) são ignoradas — não alimentam o SD Inicial.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { resolveCompanyFromContaBanestes } from '../utils/banestesDePara';

export interface BanestesAccountBalance {
  conta:      string;
  companyId:  string;
  saldo:      number;
  origem:     'S A L D O (realizado)' | 'SALDO CONTA CORRENTE (sem previstos)';
}

export interface BanestesExtratoParseResult {
  dateISO:  string | null;   // data do fechamento (yyyy-mm-dd), null se não identificada
  balances: BanestesAccountBalance[];
  skippedAccounts: string[]; // contas encontradas no PDF mas fora do De-Para (contas-caixa)
}

const parseNum = (s: string): number =>
  parseFloat(s.replace(/\./g, '').replace(',', '.'));

export function parseBanestesExtrato(rawText: string): BanestesExtratoParseResult {
  const flat = rawText.replace(/\s+/g, ' ');

  // Data do fechamento: "EXTRATO CONSOLIDADO ATE DD/MM" + ano de "DATA E HORA: DD/MM/AAAA".
  let dateISO: string | null = null;
  const ateMatch = flat.match(/EXTRATO CONSOLIDADO ATE\s*(\d{2})\/(\d{2})/);
  const horaMatch = flat.match(/DATA E HORA:\s*\d{2}\/\d{2}\/(\d{4})/);
  if (ateMatch && horaMatch) {
    dateISO = `${horaMatch[1]}-${ateMatch[2]}-${ateMatch[1]}`;
  }

  // Cada conta começa em "CONTA : <número>" — divide o texto em blocos por conta.
  const blocks = flat.split(/(?=CONTA\s*:\s*[\d.]+)/).filter(b => /CONTA\s*:/.test(b));

  const balances: BanestesAccountBalance[] = [];
  const skippedAccounts: string[] = [];

  for (const block of blocks) {
    const contaMatch = block.match(/CONTA\s*:\s*([\d.]+)/);
    if (!contaMatch) continue;
    const conta = contaMatch[1].replace(/\./g, '');

    const companyId = resolveCompanyFromContaBanestes(conta);
    if (!companyId) { skippedAccounts.push(conta); continue; } // conta-caixa auxiliar

    const temPrevistos = /LANCAMENTOS PREVISTOS/.test(block);
    const sMatch = block.match(/S\s+A\s+L\s+D\s+O\s*\.+\s*([\d.,]+)/);

    let saldo: number | null = null;
    let origem: BanestesAccountBalance['origem'] | null = null;

    if (sMatch) {
      saldo = parseNum(sMatch[1]);
      origem = 'S A L D O (realizado)';
    } else if (!temPrevistos) {
      const ccMatch = block.match(/SALDO CONTA CORRENTE\s*([\d.,]+)/);
      if (ccMatch) {
        saldo = parseNum(ccMatch[1]);
        origem = 'SALDO CONTA CORRENTE (sem previstos)';
      }
    }

    if (saldo !== null && origem) {
      balances.push({ conta, companyId, saldo, origem });
    }
  }

  return { dateISO, balances, skippedAccounts };
}
