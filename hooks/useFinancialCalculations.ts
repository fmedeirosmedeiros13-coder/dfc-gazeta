/**
 * hooks/useFinancialCalculations.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centraliza todos os cálculos financeiros derivados do estado global.
 *
 * ANTES: 5 useMemos espalhados no App.tsx, com lógica de saldo inicial
 * duplicada entre App.tsx e Dashboard.tsx.
 *
 * AGORA: um único hook que expõe uma API limpa. Qualquer view pode importar
 * e consumir sem precisar conhecer os detalhes de cálculo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react';
import { Transaction, TransactionType, FinancialSummary, ManualValues } from '../types';
import {
  parseDate,
  calcInitialBalance,
  calcResgAplicTotal,
  calcResgAplicSplit,
  getStartDate,
  getLatestExtractDate,
  BANKS_MAPPING,
  normalizeCompanyId,
  byDate,
} from '../utils/finance';

interface UseFinancialCalculationsParams {
  transactions: Transaction[];
  realizedTransactions: Transaction[];
  selectedCompany: string;
  manualValues: ManualValues;
}

interface UseFinancialCalculationsResult {
  /** Transações previstas filtradas pela empresa selecionada. */
  filteredTransactions: Transaction[];
  /** Transações realizadas filtradas pela empresa selecionada. */
  filteredRealized: Transaction[];
  /** IDs únicos de empresas presentes em ambas as listas, ordenados numericamente. */
  uniqueCompanies: string[];
  /** Resumo financeiro consolidado (previsto). */
  summary: FinancialSummary;
  /**
   * Saldo inicial consolidado para a Apresentação Executiva.
   * Soma os saldos manuais de todas as empresas (ou só da selecionada)
   * na data mais antiga das transações.
   */
  executiveInitialBalance: number;
  /**
   * Total de resgates manuais de todas as empresas.
   * Usado no FC Diário e na Apresentação Executiva.
   */
  totalManualResgates: number;
  totalManualAplicacoes: number;
}

export function useFinancialCalculations({
  transactions,
  realizedTransactions,
  selectedCompany,
  manualValues,
}: UseFinancialCalculationsParams): UseFinancialCalculationsResult {

  // ─── Filtros por empresa ─────────────────────────────────────────────────

  const filteredTransactions = useMemo(() => {
    if (selectedCompany === 'all') return transactions;
    return transactions.filter(
      t => normalizeCompanyId(t.companyCode) === selectedCompany
    );
  }, [transactions, selectedCompany]);

  const filteredRealized = useMemo(() => {
    if (selectedCompany === 'all') return realizedTransactions;
    return realizedTransactions.filter(
      t => normalizeCompanyId(t.companyCode) === selectedCompany
    );
  }, [realizedTransactions, selectedCompany]);

  // ─── Lista de empresas únicas ────────────────────────────────────────────

  const uniqueCompanies = useMemo(() => {
    const companies = new Set<string>();
    transactions.forEach(t => {
      const id = normalizeCompanyId(t.companyCode);
      if (id) companies.add(id);
    });
    realizedTransactions.forEach(t => {
      const id = normalizeCompanyId(t.companyCode);
      if (id) companies.add(id);
    });
    return Array.from(companies).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [transactions, realizedTransactions]);

  // ─── Resumo financeiro ───────────────────────────────────────────────────

  const summary = useMemo<FinancialSummary>(() => {
    const totalInflow = filteredTransactions
      .filter(t => t.type === TransactionType.RECEIVABLE)
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    const totalInvested = filteredTransactions
      .filter(t => t.type === TransactionType.APPLICATION)
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    // Previsto: apenas filteredTransactions com status PREVISTO
    const totalOutflow = filteredTransactions
      .filter(t => t.type === TransactionType.PAYABLE && t.status === 'PREVISTO')
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    // Realizado: apenas filteredRealized
    const totalRealizedOutflow = filteredRealized
      .filter(t => t.type === TransactionType.PAYABLE)
      .reduce((acc, t) => acc + (Number(t.value) || 0), 0);

    return {
      totalInflow,
      totalOutflow,
      totalInvested,
      totalRealizedOutflow,
      balance: totalInflow - totalOutflow,
    };
  }, [filteredTransactions, filteredRealized]);

  // ─── Saldo inicial executivo ─────────────────────────────────────────────

  // ─── Saldo inicial executivo ─────────────────────────────────────────────
  // Referência ROLANTE: o extrato mais recente importado de cada empresa
  // (fluxo semanal — segunda usa o saldo de sexta, hoje usa o de hoje).
  // Só cai para a data mais antiga das transações se a empresa ainda não
  // teve nenhum extrato importado.

  const executiveInitialBalance = useMemo(() => {
    const fallbackDate = getStartDate(filteredTransactions);

    const companiesToSum = selectedCompany === 'all' ? uniqueCompanies : [selectedCompany];

    return companiesToSum.reduce((acc, compId) => {
      const refDate = getLatestExtractDate(compId, manualValues) ?? fallbackDate;
      if (!refDate) return acc;
      return acc + calcInitialBalance(compId, refDate, manualValues);
    }, 0);
  }, [filteredTransactions, selectedCompany, uniqueCompanies, manualValues]);

  // ─── Total de resgates/aplicações manuais (Resg Aplic no FC Diário) ──────
  // Separa por sinal: positivo = resgate (volta pro caixa), negativo =
  // aplicação (sai do caixa). É o MOVIMENTO real do período, diferente da
  // posição inteira já existente em Aplicações (que é importada).

  const { totalManualResgates, totalManualAplicacoes } = useMemo(() => {
    const { resgates, aplicacoes } = calcResgAplicSplit(selectedCompany, manualValues);
    return { totalManualResgates: resgates, totalManualAplicacoes: aplicacoes };
  }, [manualValues, selectedCompany]);

  return {
    filteredTransactions,
    filteredRealized,
    uniqueCompanies,
    summary,
    executiveInitialBalance,
    totalManualResgates,
    totalManualAplicacoes,
  };
}
