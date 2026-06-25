/**
 * services/claudeService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Análise financeira executiva via Claude API.
 *
 * DIFERENÇA em relação ao geminiService.ts anterior:
 *
 *   ANTES (Gemini):
 *     • Enviava apenas 50 transações brutas
 *     • Prompt genérico ("atue como CFO")
 *     • Retornava: summary, risks[], opportunities[]
 *
 *   AGORA (Claude):
 *     • Envia visão consolidada por empresa + concentração de fornecedores
 *     • Envia histórico de desvios previsto×realizado quando disponível
 *     • Envia alertas de vencimentos críticos já calculados
 *     • Prompt estruturado como briefing de conselho (Board-level)
 *     • Retorna: executiveSummary, actionItems[], risks[], opportunities[],
 *                cashProjection, watchlist[], sentiment
 *     • Streaming opcional para feedback imediato na UI
 *
 * USO:
 *   import { analyzeFinancialData, streamAnalysis } from './claudeService';
 *
 *   // Análise completa (await)
 *   const result = await analyzeFinancialData({ summary, transactions, realized, alerts });
 *
 *   // Análise com streaming (para mostrar texto conforme chega)
 *   await streamAnalysis({ summary, transactions }, (chunk) => setBuffer(b => b + chunk));
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  FinancialSummary,
  Transaction,
  TransactionType,
  AIAnalysisResult,
} from '../types';
import { formatCurrency, formatCompact, parseDate, COMPANIES } from '../utils/finance';
import type { Alert } from '../engines/alerts';

// ─── Tipos estendidos de resposta ─────────────────────────────────────────────

export interface ExecutiveAnalysis extends AIAnalysisResult {
  /** Itens de ação prioritários com responsável e prazo sugerido. */
  actionItems: ActionItem[];
  /** Projeção narrativa de caixa para os próximos 30 dias. */
  cashProjection: string;
  /**
   * Fornecedores/clientes que merecem atenção especial
   * (alta concentração, inadimplência, crescimento anômalo).
   */
  watchlist: WatchlistItem[];
  /** Sentimento geral: positive | neutral | negative | critical */
  sentiment: 'positive' | 'neutral' | 'negative' | 'critical';
}

export interface ActionItem {
  priority: 'alta' | 'média' | 'baixa';
  description: string;
  area: string;        // ex: "Contas a Pagar", "Tesouraria", "Controladoria"
  deadline: string;    // ex: "Até sexta-feira", "Esta semana"
}

export interface WatchlistItem {
  name: string;
  type: 'fornecedor' | 'cliente' | 'empresa';
  value: number;
  reason: string;
}

// ─── Helpers de contexto ──────────────────────────────────────────────────────

interface AnalysisInput {
  summary: FinancialSummary;
  transactions: Transaction[];
  realizedTransactions?: Transaction[];
  alerts?: Alert[];
  companyFilter?: string;
}

/** Agrega transações por empresa para dar contexto ao modelo. */
function buildCompanyContext(transactions: Transaction[]): string {
  const byCompany: Record<string, { inflow: number; outflow: number; count: number }> = {};

  for (const t of transactions) {
    const id = t.companyCode ?? 'N/D';
    if (!byCompany[id]) byCompany[id] = { inflow: 0, outflow: 0, count: 0 };
    if (t.type === TransactionType.RECEIVABLE) byCompany[id].inflow  += Number(t.value) || 0;
    if (t.type === TransactionType.PAYABLE)    byCompany[id].outflow += Number(t.value) || 0;
    byCompany[id].count++;
  }

  const companyName = (id: string) =>
    COMPANIES.find(c => c.id === id)?.name ?? `Empresa ${id}`;

  return Object.entries(byCompany)
    .sort(([, a], [, b]) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
    .slice(0, 8)
    .map(([id, data]) =>
      `  ${companyName(id)}: Entradas ${formatCompact(data.inflow)} | Saídas ${formatCompact(data.outflow)} | ${data.count} lançamentos`
    )
    .join('\n');
}

/** Top fornecedores por volume de pagamento. */
function buildSupplierContext(transactions: Transaction[]): string {
  const bySupplier: Record<string, number> = {};
  const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
  const total    = payables.reduce((s, t) => s + (Number(t.value) || 0), 0);

  for (const t of payables) {
    const key = t.supplier ?? t.description ?? 'Desconhecido';
    bySupplier[key] = (bySupplier[key] ?? 0) + (Number(t.value) || 0);
  }

  return Object.entries(bySupplier)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, val]) => {
      const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
      return `  ${name}: ${formatCompact(val)} (${pct}% das saídas)`;
    })
    .join('\n');
}

/** Desvio previsto × realizado. */
function buildDeviationContext(
  transactions: Transaction[],
  realized: Transaction[],
): string {
  if (!realized.length) return '  (Dados realizados não importados neste período)';

  const plannedTotal  = transactions
    .filter(t => t.type === TransactionType.PAYABLE)
    .reduce((s, t) => s + (Number(t.value) || 0), 0);

  const realizedTotal = realized
    .filter(t => t.type === TransactionType.PAYABLE)
    .reduce((s, t) => s + (Number(t.value) || 0), 0);

  const diff    = realizedTotal - plannedTotal;
  const diffPct = plannedTotal > 0 ? ((diff / plannedTotal) * 100).toFixed(1) : '0';
  const sign    = diff >= 0 ? '+' : '';

  return `  Previsto: ${formatCurrency(plannedTotal)} | Realizado: ${formatCurrency(realizedTotal)} | Desvio: ${sign}${formatCurrency(diff)} (${sign}${diffPct}%)`;
}

/** Resumo dos alertas ativos. */
function buildAlertContext(alerts: Alert[]): string {
  if (!alerts.length) return '  Nenhum alerta ativo';
  return alerts
    .slice(0, 6)
    .map(a => `  [${a.severity.toUpperCase()}] ${a.title}: ${a.description}`)
    .join('\n');
}

// ─── Construção do prompt ─────────────────────────────────────────────────────

function buildPrompt(input: AnalysisInput): string {
  const { summary, transactions, realizedTransactions = [], alerts = [] } = input;
  const net = summary.totalInflow - summary.totalOutflow;

  return `Você é o CFO de um grupo de mídia brasileiro (Rede Gazeta, ES) analisando o Fluxo de Caixa semanal para o conselho de administração.

## DADOS DO PERÍODO

**Resumo Consolidado:**
  Entradas:     ${formatCurrency(summary.totalInflow)}
  Saídas:       ${formatCurrency(summary.totalOutflow)}
  Resultado:    ${formatCurrency(net)} ${net >= 0 ? '✓' : '⚠ NEGATIVO'}
  Investimentos: ${formatCurrency(summary.totalInvested)}
  Saldo período: ${formatCurrency(summary.balance)}

**Posição por Empresa:**
${buildCompanyContext(transactions)}

**Concentração de Fornecedores (Top 5 saídas):**
${buildSupplierContext(transactions)}

**Previsto × Realizado:**
${buildDeviationContext(transactions, realizedTransactions)}

**Alertas Ativos do Sistema:**
${buildAlertContext(alerts)}

**Total de Lançamentos:** ${transactions.length} previsto(s), ${realizedTransactions.length} realizado(s)

---

## INSTRUÇÕES

Gere uma análise executiva estruturada e objetiva. Seja direto — conselheiros leem em 90 segundos.

Responda APENAS com JSON válido neste formato exato (sem markdown, sem texto antes ou depois):

{
  "summary": "2 parágrafos. Primeiro: situação atual de caixa em linguagem executiva. Segundo: dinâmica principal do período (quem puxou entradas, quem pressionou saídas).",
  "actionItems": [
    {
      "priority": "alta|média|baixa",
      "description": "Ação específica e mensurável",
      "area": "área responsável",
      "deadline": "prazo sugerido"
    }
  ],
  "risks": ["Risco 1 com impacto financeiro estimado", "Risco 2", "Risco 3"],
  "opportunities": ["Oportunidade 1 com potencial de ganho", "Oportunidade 2"],
  "cashProjection": "Projeção narrativa de 30 dias baseada nos dados. Mencione vencimentos relevantes e tendências.",
  "watchlist": [
    {
      "name": "nome do fornecedor/cliente/empresa",
      "type": "fornecedor|cliente|empresa",
      "value": 0,
      "reason": "motivo de atenção"
    }
  ],
  "sentiment": "positive|neutral|negative|critical",
  "lastUpdated": "${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}"
}`;
}

// ─── Serviço principal ────────────────────────────────────────────────────────

const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/** Fallback para quando a API não está configurada. */
function unavailableResult(reason: string): ExecutiveAnalysis {
  return {
    summary:         `Análise indisponível: ${reason}`,
    actionItems:     [],
    risks:           [],
    opportunities:   [],
    cashProjection:  '',
    watchlist:       [],
    sentiment:       'neutral',
    lastUpdated:     new Date().toLocaleTimeString('pt-BR'),
  };
}

/**
 * Análise financeira executiva completa (sem streaming).
 * Retorna ExecutiveAnalysis — compatível com AIAnalysisResult por extensão.
 */
export async function analyzeFinancialData(
  summary: FinancialSummary,
  transactions: Transaction[],
  realizedTransactions?: Transaction[],
  alerts?: Alert[],
): Promise<ExecutiveAnalysis> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('[claudeService] VITE_ANTHROPIC_API_KEY não configurada.');
    return unavailableResult('Chave de API Anthropic não configurada (VITE_ANTHROPIC_API_KEY).');
  }

  const prompt = buildPrompt({ summary, transactions, realizedTransactions, alerts });

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';

    // Limpar possíveis fences de markdown
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(clean) as ExecutiveAnalysis;

    return parsed;

  } catch (err) {
    console.error('[claudeService] Erro na análise:', err);
    return unavailableResult('Não foi possível conectar à API. Verifique a chave e a conexão.');
  }
}

/**
 * Análise com streaming — ideal para mostrar o texto conforme chega na UI.
 *
 * @param input     Dados financeiros para análise
 * @param onChunk   Callback chamado a cada fragmento de texto recebido
 * @returns         O texto completo ao final
 */
export async function streamAnalysis(
  input: AnalysisInput,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    const msg = 'Chave de API não configurada.';
    onChunk(msg);
    return msg;
  }

  const prompt = buildPrompt(input);
  let fullText = '';

  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            apiKey,
        'anthropic-version':    '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      CLAUDE_MODEL,
        max_tokens: 2000,
        stream:     true,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.body) throw new Error('Sem stream na resposta.');

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      // SSE: cada linha começa com "data: "
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta') {
            const text = event.delta?.text ?? '';
            fullText += text;
            onChunk(text);
          }
        } catch { /* linha SSE parcial — ignorar */ }
      }
    }

    return fullText;

  } catch (err) {
    console.error('[claudeService] Erro no stream:', err);
    const msg = 'Erro ao gerar análise em streaming.';
    onChunk(msg);
    return msg;
  }
}

/**
 * Re-exporta AIAnalysisResult para compatibilidade com componentes
 * que ainda importam do serviço original.
 */
export type { AIAnalysisResult };
