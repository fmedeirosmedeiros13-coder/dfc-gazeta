/**
 * engines/indirectMethod.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine do Método Indireto de Demonstração dos Fluxos de Caixa (DFC).
 *
 * CONCEITO:
 *   O método indireto parte do Lucro Líquido do período e o reconcilia com
 *   o caixa gerado pelas operações através de ajustes. É obrigatório pela
 *   NBC TG 03 (CPC 03 R2) para demonstrações contábeis societárias.
 *
 * REGRA DE SINAIS (a inversão que confunde todo mundo):
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │ Variação de ATIVO     → sinal INVERTIDO em relação ao balanço  │
 *   │   Aumento de ativo    → consome caixa  (sinal negativo no DFC) │
 *   │   Redução de ativo    → libera caixa   (sinal positivo no DFC) │
 *   │                                                                 │
 *   │ Variação de PASSIVO   → mesmo sinal que o balanço              │
 *   │   Aumento de passivo  → gera caixa     (sinal positivo no DFC) │
 *   │   Redução de passivo  → consome caixa  (sinal negativo no DFC) │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * EXEMPLO PRÁTICO:
 *   Contas a Receber aumentou R$ 100k → cliente ainda não pagou →
 *   o lucro contábil inclui esse valor mas o caixa NÃO entrou →
 *   ajuste: -R$ 100k no DFC.
 *
 *   Fornecedores aumentou R$ 50k → compramos mas ainda não pagamos →
 *   o lucro deduz esse custo mas o caixa NÃO saiu →
 *   ajuste: +R$ 50k no DFC.
 *
 * ESTRUTURA DE SAÍDA:
 *   1. Atividades Operacionais
 *      (+) Lucro Líquido
 *      Ajustes não-caixa: Depreciação, Amortização, Provisões
 *      Variação de Capital de Giro: Contas a Receber, Estoques, Fornecedores...
 *      = Caixa Líquido das Operações
 *   2. Atividades de Investimento
 *      Aquisição/venda de imobilizado, aplicações financeiras
 *      = Caixa Líquido de Investimento
 *   3. Atividades de Financiamento
 *      Captações e amortizações de empréstimos, dividendos
 *      = Caixa Líquido de Financiamento
 *   4. Variação Líquida de Caixa  (1 + 2 + 3)
 *   5. Saldo Inicial / Final de Caixa
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction, TransactionType } from '../types';

// ─── Tipos de entrada ─────────────────────────────────────────────────────────

/**
 * Snapshot de balanço patrimonial simplificado.
 * Forneça os saldos do início e fim do período para calcular as variações.
 * Todos os valores em R$ positivos (o engine aplica os sinais corretos).
 */
export interface BalanceSnapshot {
  // Ativo Circulante
  caixaEBancos: number;
  contasAReceber: number;
  estoques: number;
  despesasAntecipadas: number;
  outrosAtivosCirculantes: number;

  // Passivo Circulante
  fornecedores: number;
  salarioEEncargosAPagar: number;
  impostosAPagar: number;
  outrosPassivosCirculantes: number;

  // Não-circulante (para ajustes no método indireto)
  imobilizadoLiquido: number;     // Para calcular depreciação implícita
  emprestimosLongoPrazo: number;
}

export interface IndirectMethodInput {
  /** Lucro Líquido do período (pode ser negativo = prejuízo). */
  netIncome: number;

  /** Depreciação e amortização do período (sempre positivo — ajuste não-caixa). */
  depreciationAndAmortization: number;

  /** Provisões constituídas no período (devedores duvidosos, processos, etc.). */
  provisions: number;

  /** Resultado de equivalência patrimonial (positivo = ganho; negativo = perda). */
  equityPickup: number;

  /** Resultado na venda de ativo permanente (positivo = ganho). */
  gainOnAssetSale: number;

  /** Saldo do balanço no início do período. */
  openingBalance: BalanceSnapshot;

  /** Saldo do balanço no fim do período. */
  closingBalance: BalanceSnapshot;

  /** Transações do período (para extrair atividades de investimento e financiamento). */
  transactions: Transaction[];
}

// ─── Tipos de saída ───────────────────────────────────────────────────────────

export interface IndirectMethodLine {
  label: string;
  value: number;
  /** Sinal esperado no DFC. Útil para validação e cor visual. */
  expectedSign: 'positive' | 'negative' | 'neutral';
  /** Explicação da regra de sinal para fins educativos / auditoria. */
  rule: string;
  isSubtotal?: boolean;
  isTotal?: boolean;
}

export interface IndirectMethodSection {
  title: string;
  lines: IndirectMethodLine[];
  subtotal: number;
}

export interface IndirectMethodResult {
  operatingActivities: IndirectMethodSection;
  investingActivities: IndirectMethodSection;
  financingActivities: IndirectMethodSection;
  /** Variação líquida = soma dos três subtotais. */
  netCashChange: number;
  /** Saldo inicial de caixa (openingBalance.caixaEBancos). */
  openingCash: number;
  /** Saldo final calculado = openingCash + netCashChange. */
  closingCash: number;
  /** Saldo final real (closingBalance.caixaEBancos). Deve ser ≈ closingCash. */
  closingCashActual: number;
  /** Diferença entre calculado e real — deve ser próximo de zero se os dados estiverem completos. */
  reconciliationDiff: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Variação de um item do balanço: closing − opening. */
function delta(opening: number, closing: number): number {
  return closing - opening;
}

/**
 * Ajuste DFC para variação de ATIVO.
 * Aumento de ativo → consome caixa → negativo no DFC.
 * Redução de ativo → libera caixa → positivo no DFC.
 */
function assetAdjustment(opening: number, closing: number): number {
  return -delta(opening, closing); // sinal invertido
}

/**
 * Ajuste DFC para variação de PASSIVO.
 * Aumento de passivo → gera caixa → positivo no DFC.
 * Redução de passivo → consome caixa → negativo no DFC.
 */
function liabilityAdjustment(opening: number, closing: number): number {
  return delta(opening, closing); // mesmo sinal
}

// ─── Função principal ─────────────────────────────────────────────────────────

export function calcIndirectMethod(input: IndirectMethodInput): IndirectMethodResult {
  const { openingBalance: ob, closingBalance: cb, transactions } = input;

  // ── 1. Atividades Operacionais ────────────────────────────────────────────

  // 1a. Ajustes não-caixa (somam de volta ao lucro porque não saíram como caixa)
  const operatingLines: IndirectMethodLine[] = [
    {
      label: 'Lucro Líquido do Período',
      value: input.netIncome,
      expectedSign: 'neutral',
      rule: 'Ponto de partida do método indireto.',
    },
    {
      label: '(+) Depreciação e Amortização',
      value: +Math.abs(input.depreciationAndAmortization),
      expectedSign: 'positive',
      rule: 'Despesa não-caixa: reduz o lucro contábil mas não sai do caixa.',
    },
    {
      label: '(+) Provisões Constituídas',
      value: +Math.abs(input.provisions),
      expectedSign: 'positive',
      rule: 'Despesa reconhecida contabilmente mas ainda não paga.',
    },
    {
      label: '(±) Resultado de Equivalência Patrimonial',
      value: -input.equityPickup, // sinal invertido: ganho = receita sem caixa
      expectedSign: 'neutral',
      rule: 'Resultado não realizado em caixa. Ganho → negativo; Perda → positivo.',
    },
    {
      label: '(±) Resultado na Venda de Ativo',
      value: -input.gainOnAssetSale,
      expectedSign: 'neutral',
      rule: 'Reclassificado para Atividades de Investimento.',
    },
  ];

  // 1b. Variação de Capital de Giro (Working Capital)
  const workingCapitalLines: IndirectMethodLine[] = [
    // ATIVOS — sinal invertido
    {
      label: '(±) Variação em Contas a Receber',
      value: assetAdjustment(ob.contasAReceber, cb.contasAReceber),
      expectedSign: cb.contasAReceber > ob.contasAReceber ? 'negative' : 'positive',
      rule: 'ATIVO: aumento → cliente não pagou → consome caixa (−). Redução → libera caixa (+).',
    },
    {
      label: '(±) Variação em Estoques',
      value: assetAdjustment(ob.estoques, cb.estoques),
      expectedSign: cb.estoques > ob.estoques ? 'negative' : 'positive',
      rule: 'ATIVO: aumento de estoque → compra paga → consome caixa (−).',
    },
    {
      label: '(±) Variação em Despesas Antecipadas',
      value: assetAdjustment(ob.despesasAntecipadas, cb.despesasAntecipadas),
      expectedSign: 'neutral',
      rule: 'ATIVO: pré-pagamento já saiu do caixa mas ainda não foi à resultado.',
    },
    {
      label: '(±) Variação em Outros Ativos Circulantes',
      value: assetAdjustment(ob.outrosAtivosCirculantes, cb.outrosAtivosCirculantes),
      expectedSign: 'neutral',
      rule: 'ATIVO: regra geral — aumento consome caixa (−), redução libera (+).',
    },
    // PASSIVOS — mesmo sinal
    {
      label: '(±) Variação em Fornecedores',
      value: liabilityAdjustment(ob.fornecedores, cb.fornecedores),
      expectedSign: cb.fornecedores > ob.fornecedores ? 'positive' : 'negative',
      rule: 'PASSIVO: aumento → comprou mas não pagou → gera caixa (+). Redução → pagou → consome (−).',
    },
    {
      label: '(±) Variação em Salários e Encargos a Pagar',
      value: liabilityAdjustment(ob.salarioEEncargosAPagar, cb.salarioEEncargosAPagar),
      expectedSign: cb.salarioEEncargosAPagar > ob.salarioEEncargosAPagar ? 'positive' : 'negative',
      rule: 'PASSIVO: despesa reconhecida mas ainda não paga → gera caixa temporariamente.',
    },
    {
      label: '(±) Variação em Impostos a Pagar',
      value: liabilityAdjustment(ob.impostosAPagar, cb.impostosAPagar),
      expectedSign: cb.impostosAPagar > ob.impostosAPagar ? 'positive' : 'negative',
      rule: 'PASSIVO: obrigação fiscal reconhecida mas pendente de pagamento.',
    },
    {
      label: '(±) Variação em Outros Passivos Circulantes',
      value: liabilityAdjustment(ob.outrosPassivosCirculantes, cb.outrosPassivosCirculantes),
      expectedSign: 'neutral',
      rule: 'PASSIVO: regra geral — aumento gera caixa (+), redução consome (−).',
    },
  ];

  const allOperatingLines = [...operatingLines, ...workingCapitalLines];
  const operatingSubtotal = allOperatingLines.reduce((s, l) => s + l.value, 0);

  // ── 2. Atividades de Investimento ─────────────────────────────────────────

  // Extrai pagamentos de investimento das transações (APPLICATION type)
  const investmentTx = transactions.filter(t => t.type === TransactionType.APPLICATION);
  const investmentCashOut = investmentTx.reduce((s, t) => s + Math.abs(Number(t.value) || 0), 0);

  // Ganho na venda de ativo (reclassificado das operacionais)
  const assetSaleProceeds = input.gainOnAssetSale;

  const investingLines: IndirectMethodLine[] = [
    {
      label: '(−) Aquisição de Imobilizado e Intangível',
      value: -investmentCashOut,
      expectedSign: 'negative',
      rule: 'Saída de caixa para expansão da capacidade produtiva.',
    },
    {
      label: '(+) Recebimento na Venda de Ativo',
      value: +assetSaleProceeds,
      expectedSign: 'positive',
      rule: 'Entrada de caixa pelo desinvestimento. O ganho/perda foi revertido nas operacionais.',
    },
  ];

  const investingSubtotal = investingLines.reduce((s, l) => s + l.value, 0);

  // ── 3. Atividades de Financiamento ────────────────────────────────────────

  const loanVariation = liabilityAdjustment(ob.emprestimosLongoPrazo, cb.emprestimosLongoPrazo);

  const financingLines: IndirectMethodLine[] = [
    {
      label: '(±) Variação em Empréstimos e Financiamentos',
      value: loanVariation,
      expectedSign: loanVariation >= 0 ? 'positive' : 'negative',
      rule: 'Captação (+) ou amortização (−) de dívida de longo prazo.',
    },
  ];

  const financingSubtotal = financingLines.reduce((s, l) => s + l.value, 0);

  // ── 4. Reconciliação ──────────────────────────────────────────────────────

  const netCashChange  = operatingSubtotal + investingSubtotal + financingSubtotal;
  const openingCash    = ob.caixaEBancos;
  const closingCash    = openingCash + netCashChange;
  const closingActual  = cb.caixaEBancos;
  const reconcDiff     = closingActual - closingCash;

  return {
    operatingActivities: {
      title: '1. Atividades Operacionais',
      lines: allOperatingLines,
      subtotal: operatingSubtotal,
    },
    investingActivities: {
      title: '2. Atividades de Investimento',
      lines: investingLines,
      subtotal: investingSubtotal,
    },
    financingActivities: {
      title: '3. Atividades de Financiamento',
      lines: financingLines,
      subtotal: financingSubtotal,
    },
    netCashChange,
    openingCash,
    closingCash,
    closingCashActual: closingActual,
    reconciliationDiff: reconcDiff,
  };
}

// ─── Helpers de apresentação ──────────────────────────────────────────────────

/**
 * Retorna cor semântica para um valor do DFC dado seu sinal esperado.
 * Útil para detectar linhas "invertidas" que merecem atenção do analista.
 */
export function lineColor(
  value: number,
  expected: IndirectMethodLine['expectedSign'],
): 'emerald' | 'rose' | 'amber' | 'slate' {
  if (expected === 'neutral') return 'slate';
  const isPositive = value >= 0;
  if (expected === 'positive') return isPositive ? 'emerald' : 'rose';
  if (expected === 'negative') return isPositive ? 'rose' : 'emerald';
  return 'slate';
}

/**
 * Verifica se a diferença de reconciliação é aceitável.
 * Uma diferença > 0,1% do caixa final indica dados incompletos.
 */
export function isReconciliationOk(result: IndirectMethodResult): boolean {
  if (result.closingCashActual === 0) return true;
  return Math.abs(result.reconciliationDiff / result.closingCashActual) < 0.001;
}
