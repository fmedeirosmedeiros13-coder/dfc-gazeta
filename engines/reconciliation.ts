/**
 * engines/reconciliation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine de conciliação Previsto × Realizado.
 *
 * ANTES: ~200 linhas de lógica inline no Dashboard.tsx (viewType === 'REALIZED'),
 * sem score de confiança, sem separação de responsabilidades.
 *
 * AGORA:
 *   • Algoritmo em 5 fases idêntico ao anterior, mas isolado e testável.
 *   • Cada par conciliado recebe um ConfidenceScore (0–100) com motivo.
 *   • Threshold configurável: pares abaixo de X ficam em revisão manual.
 *   • Função pura — não toca em estado React, fácil de unit-testar.
 *
 * Fases de matching (ordem de prioridade):
 *   EXACT   Fornecedor + Título + Valor           → score 100
 *   1:1     Valor exato dentro do mesmo bucket    → score 90
 *   1:N     Um previsto → vários realizados       → score 75
 *   N:1     Vários previstos → um realizado       → score 75
 *   N:M     Totais iguais dentro do bucket        → score 60
 *   GLOBAL  Valor exato entre buckets diferentes  → score 50
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction } from '../types';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type MatchType = 'EXACT' | '1:1' | '1:N' | 'N:1' | 'N:M' | 'GLOBAL';

export interface MatchGroup {
  prev: Transaction[];
  real: Transaction[];
  /** Diferença valor realizado − valor previsto (positivo = pagou mais). */
  diff: number;
  type: MatchType;
  /** Score de confiança 0–100. Abaixo de REVIEW_THRESHOLD → revisão manual. */
  confidence: number;
  /** Razão legível do score atribuído. */
  confidenceReason: string;
}

export interface ReconciliationResult {
  /** Pares conciliados com score ≥ threshold. */
  matched: MatchGroup[];
  /** Pares conciliados com score < threshold — requerem validação humana. */
  reviewNeeded: MatchGroup[];
  /** Previstos sem par realizado. */
  pending: Transaction[];
  /** Realizados sem par previsto. */
  unexpected: Transaction[];
  /** KPIs agregados. */
  totals: {
    matchedValue: number;
    pendingValue: number;
    unexpectedValue: number;
    coveragePercent: number;   // matchedValue / (matchedValue + pendingValue) * 100
    deviationPercent: number;  // soma dos diffs / matchedValue * 100
  };
}

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Pares com score abaixo deste valor vão para reviewNeeded. */
const REVIEW_THRESHOLD = 70;

/** Tolerância monetária para comparação de valores (R$ 0,02). */
const VALUE_TOLERANCE = 0.02;

/** Profundidade máxima do subset-sum para evitar travamento em buckets grandes. */
const MAX_SUBSET_DEPTH = 5;

/**
 * Lista de exceção para casar entre fornecedores DIFERENTES (fase GLOBAL).
 *
 * Por padrão está VAZIA: se o fornecedor não bater, NÃO casa — vai pra
 * "Em aberto"/"Surpresas". Isso evita os falsos pares "valor igual entre
 * fornecedores diferentes" que apareciam na Revisão.
 *
 * Para autorizar um caso conhecido (ex.: um título lançado num fornecedor mas
 * pago por outro código — holding pagando pela coligada, etc.), adicione AQUI
 * o código do fornecedor (sem zero à esquerda; entra normalizado). Basta que UM
 * dos lados (previsto OU realizado) esteja na lista para o par ser permitido,
 * e o motivo na tela vai dizer quais fornecedores estavam envolvidos.
 *
 * Ex.: const CROSS_SUPPLIER_ALLOWLIST = new Set(['1464', '2667']);
 */
const CROSS_SUPPLIER_ALLOWLIST = new Set<string>([
  // adicione aqui os códigos de fornecedor autorizados a casar entre si
]);

// ─── Helpers internos ─────────────────────────────────────────────────────────

function norm(s: string | undefined | null): string {
  return String(s ?? '').trim().toUpperCase().replace(/^0+/, '');
}

/** Valor efetivo de um item previsto (usa originalTitleValue quando disponível). */
function prevValue(t: Transaction): number {
  if (t.originalTitleValue && Math.abs(t.originalTitleValue) > 0.01) {
    return Math.abs(t.originalTitleValue);
  }
  return Math.abs(Number(t.value) || 0);
}

/** Valor efetivo de um item realizado. */
function realValue(t: Transaction): number {
  return Math.abs(Number(t.value) || 0);
}

/**
 * Valores candidatos de um item para matching: Valor Pagamento e Valor Original.
 * No realizado: value = Valor Pagamento, originalTitleValue = Valor Original.
 * No previsto: value = VL Considerado, originalTitleValue = VL Original do título.
 * Retorna os distintos > 0,01 para que um par case se QUALQUER combinação bater.
 */
function candidateValues(t: Transaction): number[] {
  const out: number[] = [];
  const v = Math.abs(Number(t.value) || 0);
  const o = Math.abs(Number(t.originalTitleValue) || 0);
  if (v > 0.01) out.push(v);
  if (o > 0.01 && Math.abs(o - v) >= VALUE_TOLERANCE) out.push(o);
  return out;
}

/** Verdadeiro se algum valor candidato de a casa com algum de b (± tolerância). */
function valueMatches(a: Transaction, b: Transaction): boolean {
  const va = candidateValues(a);
  const vb = candidateValues(b);
  return va.some(x => vb.some(y => Math.abs(x - y) < VALUE_TOLERANCE));
}

/** Chave de documento composta: Título + Parcela (normalizados). */
function docKey(t: Transaction): string {
  const doc  = norm(t.documentNumber);
  const parc = norm(t.installment);
  return parc ? `${doc}#${parc}` : doc;
}

/**
 * Verdadeiro se dois itens referem o mesmo título.
 * Título precisa bater; se AMBOS têm parcela, a parcela também precisa bater
 * (evita casar parcela 1 com parcela 2). Se um dos lados não tem parcela,
 * casa só pelo título (compatível com layouts sem coluna de parcela).
 */
function sameDocument(p: Transaction, r: Transaction): boolean {
  const pDoc = norm(p.documentNumber);
  const rDoc = norm(r.documentNumber);
  if (!pDoc || !rDoc || pDoc !== rDoc) return false;
  const pParc = norm(p.installment);
  const rParc = norm(r.installment);
  if (pParc && rParc) return pParc === rParc;
  return true;
}

/** Remove itens pelo id de um array (retorna novo array). */
function without(list: Transaction[], items: Transaction[]): Transaction[] {
  const ids = new Set(items.map(t => t.id));
  return list.filter(t => !ids.has(t.id));
}

/**
 * Subset-sum com backtracking.
 * Encontra um subconjunto de `pool` cujos valores somam `target` (± tolerância).
 * Retorna null se não encontrar dentro da profundidade máxima.
 */
function findSubset(
  target: number,
  pool: Transaction[],
  valFn: (t: Transaction) => number,
  maxDepth = MAX_SUBSET_DEPTH,
): Transaction[] | null {
  const candidates = pool.filter(t => valFn(t) <= target + VALUE_TOLERANCE);
  const result: Transaction[] = [];

  function search(startIdx: number, currentSum: number): boolean {
    if (Math.abs(currentSum - target) < VALUE_TOLERANCE) return true;
    if (currentSum > target + VALUE_TOLERANCE)           return false;
    if (result.length >= maxDepth)                       return false;

    for (let i = startIdx; i < candidates.length; i++) {
      result.push(candidates[i]);
      if (search(i + 1, currentSum + valFn(candidates[i]))) return true;
      result.pop();
    }
    return false;
  }

  return search(0, 0) ? result : null;
}

/** Agrupa transações por chave empresa|fornecedor. */
function groupByBucket(
  prevList: Transaction[],
  realList: Transaction[],
): Record<string, { prev: Transaction[]; real: Transaction[] }> {
  const buckets: Record<string, { prev: Transaction[]; real: Transaction[] }> = {};

  const key = (t: Transaction): string => {
    // Normaliza igual ao norm() (tira zero à esquerda): empresa "1" casa com "001",
    // fornecedor "1464" casa com "01464". Sem isso, o mesmo fornecedor cai em
    // buckets diferentes e as fases 2–5 (1:1, 1:N, N:1, N:M) não enxergam o par.
    const emp  = norm(t.companyCode) || 'S/E';
    const forn = norm(t.supplierCode);
    // Sem fornecedor → chave única por id (evita agrupamento indevido)
    if (!forn) return `NOMATCH-${t.id}`;
    return `${emp}|${forn}`;
  };

  for (const t of prevList) {
    const k = key(t);
    if (!buckets[k]) buckets[k] = { prev: [], real: [] };
    buckets[k].prev.push(t);
  }
  for (const t of realList) {
    const k = key(t);
    if (!buckets[k]) buckets[k] = { prev: [], real: [] };
    buckets[k].real.push(t);
  }

  return buckets;
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Executa a conciliação completa entre previstos e realizados.
 *
 * @param planned   Transações previstas (qualquer tipo; a engine filtra PAYABLE).
 * @param realized  Transações realizadas.
 * @returns         Resultado estruturado com pares, pendentes, surpresas e KPIs.
 */
export function reconcile(
  planned: Transaction[],
  realized: Transaction[],
): ReconciliationResult {
  const allMatched: MatchGroup[] = [];
  const pending: Transaction[]   = [];
  const unexpected: Transaction[] = [];

  // ── Fase 0: Filtrar apenas pagamentos ────────────────────────────────────
  const activePrev   = planned.filter(t => t.type === 'PAYABLE');
  let remainingPrev  = [...activePrev];
  let remainingReal  = [...realized];

  // ── Fase 1 (EXACT): Fornecedor + Título + Valor ───────────────────────────
  const afterExactPrev: Transaction[] = [];

  for (const p of remainingPrev) {
    const pForn = norm(p.supplierCode);
    const pDoc  = norm(p.documentNumber);

    // Match perfeito exige fornecedor E documento preenchidos
    if (!pForn || !pDoc) {
      afterExactPrev.push(p);
      continue;
    }

    // 1ª tentativa: fornecedor + título (+ parcela) + valor idênticos → score 100.
    let idx = remainingReal.findIndex(r => {
      const rForn = norm(r.supplierCode);
      return rForn === pForn && sameDocument(p, r) && valueMatches(p, r);
    });
    let byValue = idx > -1;

    // 2ª tentativa: mesmo fornecedor + mesmo título (+ parcela), mas valor difere.
    // É o MESMO título pago com juros/multa/desconto — casa assim mesmo e registra
    // a diferença, em vez de jogar pra "revisar". Score alto (95): a identidade do
    // título é mais confiável que o valor.
    if (idx === -1) {
      idx = remainingReal.findIndex(r => {
        const rForn = norm(r.supplierCode);
        return rForn === pForn && sameDocument(p, r);
      });
    }

    if (idx > -1) {
      const r = remainingReal[idx];
      const withParcela = norm(p.installment) && norm(r.installment);
      const diff = realValue(r) - prevValue(p);
      allMatched.push({
        prev: [p],
        real: [r],
        diff,
        type: 'EXACT',
        confidence: byValue ? 100 : 95,
        confidenceReason: byValue
          ? (withParcela
              ? 'Fornecedor + título + parcela + valor idênticos'
              : 'Fornecedor + título + valor idênticos')
          : (withParcela
              ? `Fornecedor + título + parcela (valor difere R$ ${diff.toFixed(2)} — juros/multa/desconto)`
              : `Fornecedor + título (valor difere R$ ${diff.toFixed(2)} — juros/multa/desconto)`),
      });
      remainingReal.splice(idx, 1);
    } else {
      afterExactPrev.push(p);
    }
  }
  remainingPrev = afterExactPrev;

  // ── Fases 2–5: Por bucket (empresa × fornecedor) ──────────────────────────
  const buckets = groupByBucket(remainingPrev, remainingReal);

  const leftoverPrev: Transaction[] = [];
  const leftoverReal: Transaction[] = [];

  for (const bucket of Object.values(buckets)) {
    let curPrev = [...bucket.prev];
    let curReal = [...bucket.real];

    // Fase 2 (1:1): valor exato dentro do bucket (Valor Pagamento ou Valor Original)
    const nextPrev2: Transaction[] = [];
    for (const p of curPrev) {
      const idx  = curReal.findIndex(r => valueMatches(p, r));
      if (idx > -1) {
        const r = curReal[idx];
        // Explica POR QUE ficou em 90% (não chegou a Exato): o valor bateu no
        // mesmo fornecedor, mas o título não pôde ser confirmado.
        const pDoc = norm(p.documentNumber);
        const rDoc = norm(r.documentNumber);
        let reason: string;
        if (!pDoc && !rDoc) {
          reason = 'Casou pelo valor no mesmo fornecedor — sem número de título nos dois lados';
        } else if (!pDoc || !rDoc) {
          reason = 'Casou pelo valor no mesmo fornecedor — título ausente em um dos lados';
        } else {
          reason = `Casou pelo valor no mesmo fornecedor — título não confere (previsto ${p.documentNumber} × realizado ${r.documentNumber})`;
        }
        allMatched.push({
          prev: [p], real: [r],
          diff: realValue(r) - prevValue(p),
          type: '1:1',
          confidence: 90,
          confidenceReason: reason,
        });
        curReal.splice(idx, 1);
      } else {
        nextPrev2.push(p);
      }
    }
    curPrev = nextPrev2;

    // Fase 3 (1:N): um previsto → vários realizados
    if (curPrev.length > 0 && curReal.length > 1) {
      const nextPrev3: Transaction[] = [];
      for (const p of curPrev) {
        const pVal   = prevValue(p);
        const subset = findSubset(pVal, curReal, realValue);
        if (subset) {
          allMatched.push({
            prev: [p], real: subset,
            diff: subset.reduce((s, r) => s + realValue(r), 0) - pVal,
            type: '1:N',
            confidence: 75,
            confidenceReason: `${subset.length} realizados somam o previsto`,
          });
          curReal = without(curReal, subset);
        } else {
          nextPrev3.push(p);
        }
      }
      curPrev = nextPrev3;
    }

    // Fase 4 (N:1): vários previstos → um realizado
    if (curReal.length > 0 && curPrev.length > 1) {
      const nextReal4: Transaction[] = [];
      for (const r of curReal) {
        const rVal   = realValue(r);
        const subset = findSubset(rVal, curPrev, prevValue);
        if (subset) {
          allMatched.push({
            prev: subset, real: [r],
            diff: rVal - subset.reduce((s, p) => s + prevValue(p), 0),
            type: 'N:1',
            confidence: 75,
            confidenceReason: `${subset.length} previstos somam o realizado`,
          });
          curPrev = without(curPrev, subset);
        } else {
          nextReal4.push(r);
        }
      }
      curReal = nextReal4;
    }

    // Fase 5 (N:M): totais iguais — casa tudo que sobrou no bucket
    if (curPrev.length > 0 && curReal.length > 0) {
      const sumP = curPrev.reduce((s, p) => s + prevValue(p), 0);
      const sumR = curReal.reduce((s, r) => s + realValue(r), 0);
      if (Math.abs(sumR - sumP) < VALUE_TOLERANCE) {
        allMatched.push({
          prev: curPrev, real: curReal,
          diff: sumR - sumP,
          type: 'N:M',
          confidence: 60,
          confidenceReason: 'Totais iguais no bucket (sem rastreio individual)',
        });
        curPrev = [];
        curReal = [];
      }
    }

    leftoverPrev.push(...curPrev);
    leftoverReal.push(...curReal);
  }

  // ── Fase 6 (GLOBAL): match por valor entre fornecedores DIFERENTES ────────
  // Só ocorre se UM dos lados estiver na CROSS_SUPPLIER_ALLOWLIST. Lista vazia
  // por padrão → fornecedor que não bate NÃO casa (vai pra Em aberto/Surpresas).
  const finalPrev: Transaction[] = [];

  for (const p of leftoverPrev) {
    const pForn = norm(p.supplierCode);
    const allowedP = CROSS_SUPPLIER_ALLOWLIST.has(pForn);

    const idx = leftoverReal.findIndex(r => {
      if (!valueMatches(p, r)) return false;
      const rForn = norm(r.supplierCode);
      // permite só se p OU r estiver autorizado na lista de exceção
      return allowedP || CROSS_SUPPLIER_ALLOWLIST.has(rForn);
    });

    if (idx > -1) {
      const r = leftoverReal[idx];
      allMatched.push({
        prev: [p], real: [r],
        diff: realValue(r) - prevValue(p),
        type: 'GLOBAL',
        confidence: 50,
        confidenceReason: `Fornecedores diferentes autorizados (previsto ${p.supplier ?? pForn} × realizado ${r.supplier ?? norm(r.supplierCode)}) — verificar`,
      });
      leftoverReal.splice(idx, 1);
    } else {
      finalPrev.push(p);
    }
  }

  pending.push(...finalPrev);
  unexpected.push(...leftoverReal);

  // ── Separar por threshold de confiança ───────────────────────────────────
  const matched: MatchGroup[]      = [];
  const reviewNeeded: MatchGroup[] = [];

  for (const g of allMatched) {
    if (g.confidence >= REVIEW_THRESHOLD) {
      matched.push(g);
    } else {
      reviewNeeded.push(g);
    }
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const matchedValue     = matched.reduce((s, g) => s + g.real.reduce((r, t) => r + realValue(t), 0), 0);
  const reviewValue      = reviewNeeded.reduce((s, g) => s + g.real.reduce((r, t) => r + realValue(t), 0), 0);
  const pendingValue     = pending.reduce((s, t) => s + prevValue(t), 0);
  const unexpectedValue  = unexpected.reduce((s, t) => s + realValue(t), 0);
  const totalExpected    = matchedValue + reviewValue + pendingValue;
  const totalDiff        = allMatched.reduce((s, g) => s + Math.abs(g.diff), 0);

  return {
    matched,
    reviewNeeded,
    pending,
    unexpected,
    totals: {
      matchedValue,
      pendingValue,
      unexpectedValue,
      coveragePercent:   totalExpected > 0 ? (matchedValue / totalExpected) * 100 : 0,
      deviationPercent:  matchedValue > 0  ? (totalDiff / matchedValue) * 100      : 0,
    },
  };
}

/** Retorna o label de cor semântico para um score de confiança. */
export function confidenceColor(score: number): 'green' | 'amber' | 'red' {
  if (score >= 90) return 'green';
  if (score >= 60) return 'amber';
  return 'red';
}

/** Retorna a porcentagem de cobertura como string formatada. */
export function formatCoverage(result: ReconciliationResult): string {
  return result.totals.coveragePercent.toFixed(1) + '%';
}
