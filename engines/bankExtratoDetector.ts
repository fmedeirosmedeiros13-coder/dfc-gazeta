/**
 * engines/bankExtratoDetector.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Recebe o texto extraído de um PDF de extrato (via pdfjs-dist) e identifica
 * a qual banco ele pertence, pela assinatura textual própria de cada layout.
 *
 * Isso permite um único botão de importação aceitar vários arquivos de
 * bancos diferentes de uma vez — cada arquivo é roteado automaticamente pro
 * parser certo, sem o usuário precisar separar por banco.
 *
 * Para adicionar um banco novo: acrescentar sua assinatura aqui e o parser
 * correspondente no dispatcher (components/FluxoCaixaDiario.tsx).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type BankId = 'BANESTES' | 'BB' | 'CEF' | 'ITAU' | 'BTG' | 'SICOOB';

export function detectBank(rawText: string): BankId | null {
  const flat = rawText.replace(/\s+/g, ' ').toUpperCase();

  if (flat.includes('SERVICO DE EXTRATOS BANESTES')) return 'BANESTES';
  if (flat.includes('CONSULTAS - EXTRATO DE CONTA CORRENTE')) return 'BB';
  if (flat.includes('SAC CAIXA') && flat.includes('EXTRATO NO PER')) return 'CEF';
  if (flat.includes('ITAU.COM.BR')) return 'ITAU';
  if (flat.includes('SICOOB') && flat.includes('SISBR')) return 'SICOOB';
  // BTG: assinatura a acrescentar quando o extrato desse banco for recebido
  // e o parser correspondente for implementado.

  return null;
}
