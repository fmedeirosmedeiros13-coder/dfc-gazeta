/**
 * hooks/useDrillDown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gerencia o estado de drill-down: clique em gráfico → filtro na tabela.
 *
 * PROBLEMA QUE RESOLVE:
 *   Hoje clicar em qualquer gráfico não faz nada.
 *   O controlador vê "Fornecedores: R$ 2,3M" mas não consegue
 *   expandir para ver QUAIS fornecedores compõem esse valor.
 *
 * FLUXO:
 *   Gráfico (BarChart, PieChart) → onClick → drillInto(level, filter)
 *   → tabela abaixo filtra automaticamente
 *   → breadcrumb mostra o caminho (ex: "Tudo > Empresa 1 > Fornecedores")
 *   → botão "voltar" desfaz um nível
 *
 * NÍVEIS DE DRILL-DOWN:
 *   Nível 0 (root):    Visão consolidada — todas as empresas, todas as categorias
 *   Nível 1 (empresa): Filtrado por uma empresa
 *   Nível 2 (categoria): Empresa + categoria de despesa/receita
 *   Nível 3 (entidade): Empresa + categoria + fornecedor/cliente específico
 *
 * USO:
 *   const drill = useDrillDown();
 *
 *   // No gráfico:
 *   <Bar onClick={(data) => drill.into('empresa', data.companyId, data.name)} />
 *
 *   // Na tabela:
 *   const filtered = drill.applyFilter(transactions);
 *
 *   // No breadcrumb:
 *   drill.trail.map(step => <BreadcrumbItem label={step.label} onClick={step.goBack} />)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useState } from 'react';
import { Transaction, TransactionType } from '../types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DrillLevel = 'root' | 'empresa' | 'categoria' | 'entidade';

export interface DrillStep {
  level:   DrillLevel;
  /** Valor do filtro (ex: companyCode, category, supplierCode). */
  value:   string;
  /** Label legível para o breadcrumb. */
  label:   string;
}

export interface DrillDownState {
  /** Histórico de passos (índice 0 = root sempre existe). */
  trail: DrillStep[];
  /** Passo atual (último do trail). */
  current: DrillStep;
  /** true se não está no root. */
  isDrilled: boolean;
}

export interface DrillDownActions {
  /** Entra em um nível. Empilha no trail. */
  into: (level: DrillLevel, value: string, label: string) => void;
  /** Volta um nível. Remove o último passo do trail. */
  back: () => void;
  /** Volta ao root. */
  reset: () => void;
  /** Aplica os filtros ativos a um array de transações. */
  applyFilter: (transactions: Transaction[]) => Transaction[];
  /** Gera dados de série temporal para o nível atual. */
  buildChartData: (
    transactions: Transaction[],
    groupBy: 'date' | 'company' | 'category' | 'supplier',
  ) => ChartDataPoint[];
}

export interface ChartDataPoint {
  label:   string;
  value:   string;   // raw key para o próximo drill
  inflow:  number;
  outflow: number;
  net:     number;
  count:   number;
}

export type UseDrillDown = DrillDownState & DrillDownActions;

// ─── Constante ROOT ───────────────────────────────────────────────────────────

const ROOT_STEP: DrillStep = {
  level: 'root',
  value: '__root__',
  label: 'Visão Geral',
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDrillDown(): UseDrillDown {
  const [trail, setTrail] = useState<DrillStep[]>([ROOT_STEP]);

  const current   = trail[trail.length - 1];
  const isDrilled = trail.length > 1;

  // ── Navegar para baixo ───────────────────────────────────────────────────
  const into = useCallback((level: DrillLevel, value: string, label: string) => {
    setTrail(prev => [...prev, { level, value, label }]);
  }, []);

  // ── Voltar um nível ──────────────────────────────────────────────────────
  const back = useCallback(() => {
    setTrail(prev => prev.length > 1 ? prev.slice(0, -1) : prev);
  }, []);

  // ── Voltar ao root ────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    setTrail([ROOT_STEP]);
  }, []);

  // ── Aplicar filtros ao array de transações ────────────────────────────────
  const applyFilter = useCallback((transactions: Transaction[]): Transaction[] => {
    if (!isDrilled) return transactions;

    return transactions.filter(t => {
      for (const step of trail.slice(1)) { // skip root
        switch (step.level) {
          case 'empresa':
            if (String(t.companyCode ?? '') !== step.value) return false;
            break;
          case 'categoria':
            if ((t.category ?? '') !== step.value) return false;
            break;
          case 'entidade': {
            const entityMatch =
              (t.supplierCode ?? t.supplier ?? '') === step.value ||
              (t.customerCode ?? t.customer ?? '') === step.value;
            if (!entityMatch) return false;
            break;
          }
        }
      }
      return true;
    });
  }, [trail, isDrilled]);

  // ── Construir dados para gráfico no nível atual ───────────────────────────
  const buildChartData = useCallback((
    transactions: Transaction[],
    groupBy: 'date' | 'company' | 'category' | 'supplier',
  ): ChartDataPoint[] => {
    const filtered = applyFilter(transactions);
    const groups: Record<string, { label: string; inflow: number; outflow: number; count: number }> = {};

    const getKey = (t: Transaction): { key: string; label: string } => {
      switch (groupBy) {
        case 'date':
          return { key: t.date, label: t.date };
        case 'company':
          return { key: t.companyCode ?? 'N/D', label: `Empresa ${t.companyCode ?? 'N/D'}` };
        case 'category':
          return { key: t.category ?? 'Sem categoria', label: t.category ?? 'Sem categoria' };
        case 'supplier':
          return {
            key:   t.supplierCode ?? t.supplier ?? t.customerCode ?? t.customer ?? 'N/D',
            label: t.supplier ?? t.customer ?? t.description ?? 'N/D',
          };
      }
    };

    for (const t of filtered) {
      const { key, label } = getKey(t);
      if (!groups[key]) groups[key] = { label, inflow: 0, outflow: 0, count: 0 };

      const val = Math.abs(Number(t.value) || 0);
      if (t.type === TransactionType.RECEIVABLE)   groups[key].inflow  += val;
      if (t.type === TransactionType.PAYABLE)      groups[key].outflow += val;
      if (t.type === TransactionType.APPLICATION)  groups[key].outflow += val;
      groups[key].count++;
    }

    return Object.entries(groups)
      .map(([value, data]) => ({
        label:   data.label,
        value,
        inflow:  data.inflow,
        outflow: data.outflow,
        net:     data.inflow - data.outflow,
        count:   data.count,
      }))
      .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
  }, [applyFilter]);

  return {
    trail,
    current,
    isDrilled,
    into,
    back,
    reset,
    applyFilter,
    buildChartData,
  };
}

// ─── Componente Breadcrumb (JSX helper) ──────────────────────────────────────

/**
 * Dados para renderizar o breadcrumb de drill-down.
 * Retorna um array de { label, isActive, onClick }.
 *
 * Uso:
 *   const crumbs = buildBreadcrumb(drill);
 *   crumbs.map(c => <button onClick={c.onClick}>{c.label}</button>)
 */
export function buildBreadcrumb(drill: DrillDownState & Pick<DrillDownActions, 'reset' | 'back'>) {
  return drill.trail.map((step, idx) => ({
    label:    step.label,
    isActive: idx === drill.trail.length - 1,
    onClick:  idx === 0
      ? drill.reset
      : () => { /* go back to this level */ },
  }));
}

/**
 * Retorna o próximo nível de drill-down dado o atual.
 * Útil para saber qual dimensão mostrar no próximo clique.
 */
export function nextDrillLevel(current: DrillLevel): DrillLevel | null {
  const sequence: DrillLevel[] = ['root', 'empresa', 'categoria', 'entidade'];
  const idx = sequence.indexOf(current);
  return idx < sequence.length - 1 ? sequence[idx + 1] : null;
}
