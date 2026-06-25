/**
 * services/erpConnector.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Conector de ERP para importação automática de transações.
 *
 * PROBLEMA QUE RESOLVE:
 *   O maior ponto de fricção operacional é o upload manual de CSV toda segunda.
 *   Este módulo define a arquitetura para integração direta com ERPs,
 *   eliminando completamente a etapa manual.
 *
 * ABORDAGEM DE INTEGRAÇÃO:
 *
 *   OPÇÃO A — API REST (TOTVS Fluig / SAP Business One):
 *     Chamada direta à API do ERP via CORS proxy ou middleware.
 *     Necessita: URL base, credenciais OAuth2 ou Basic Auth.
 *     Vantagem: tempo real, sem lag.
 *
 *   OPÇÃO B — CSV via SFTP (TOTVS RM, sistemas legados):
 *     Job agendado no servidor baixa o CSV via SFTP e faz parse.
 *     Necessita: host SFTP, credenciais, path dos arquivos.
 *     Vantagem: compatível com qualquer ERP que exporte arquivo.
 *
 *   OPÇÃO C — Webhook Push (sistemas modernos):
 *     O ERP envia dados para um endpoint do backend ao confirmar pagamentos.
 *     Vantagem: atualização em tempo real sem polling.
 *
 * ARQUITETURA (sem backend próprio — only frontend):
 *   Como este projeto é um SPA sem backend, a integração direta
 *   com ERP requer um proxy CORS. As opções são:
 *
 *   1. Vercel Edge Function (serverless) — recomendado para MVP
 *   2. Cloudflare Worker
 *   3. Backend Express/Fastify em Node.js (para produção completa)
 *
 *   O conector aqui é o CLIENT SIDE. O proxy/backend receberá as chamadas
 *   e fará as requisições ao ERP em servidor (sem CORS issues).
 *
 * NOTAS PARA IMPLANTAÇÃO:
 *   Configurar as variáveis no .env.local:
 *     VITE_ERP_PROXY_URL=https://seu-proxy.vercel.app/api/erp
 *     VITE_ERP_TYPE=totvs_rm | totvs_fluig | sap_b1 | generic_csv
 *     VITE_ERP_COMPANY_CODES=1,2,3,4,5,6,14,17,18,22,23
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Transaction, TransactionType } from '../types';
import { parseRealizedCSV }             from '../engines/csvParser';
import { auditLog }                     from '../engines/auditLog';

// ─── Tipos de configuração ────────────────────────────────────────────────────

export type ERPType =
  | 'totvs_rm'      // TOTVS RM — exporta CSV via relatório agendado
  | 'totvs_fluig'   // TOTVS Fluig — API REST
  | 'sap_b1'        // SAP Business One — Service Layer REST
  | 'generic_csv'   // Qualquer ERP que exporte CSV via HTTP
  | 'mock';         // Dados mockados para desenvolvimento/demo

export interface ERPConfig {
  type:         ERPType;
  /** URL do proxy/backend que intermediará as chamadas. */
  proxyUrl:     string;
  /** IDs das empresas a sincronizar. */
  companyCodes: string[];
  /** Período a buscar (dias atrás). Padrão: 14. */
  lookbackDays?: number;
  /** Headers extras para autenticação no proxy. */
  authHeaders?:  Record<string, string>;
}

export interface SyncResult {
  success:     boolean;
  imported:    Transaction[];
  skipped:     number;
  errors:      string[];
  syncedAt:    Date;
  source:      ERPType;
}

// ─── Payloads por tipo de ERP ─────────────────────────────────────────────────

/** Payload padrão enviado ao proxy para TOTVS RM. */
interface TOTVSRMRequest {
  endpoint:     'contas_pagar' | 'contas_receber';
  companyCodes: string[];
  dateFrom:     string;   // dd/mm/yyyy
  dateTo:       string;
  status:       'LIQUIDADO' | 'ABERTO' | 'TODOS';
}

/** Payload padrão enviado ao proxy para TOTVS Fluig API. */
interface TOTVSFluigRequest {
  resource:     '/financeiro/pagamentos' | '/financeiro/recebimentos';
  filters: {
    dataInicio:   string; // YYYY-MM-DD
    dataFim:      string;
    empresas:     string[];
    status:       string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateNDaysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function formatDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Normalização de resposta por ERP ────────────────────────────────────────

/**
 * Normaliza a resposta TOTVS RM (array de objetos JSON) para Transaction[].
 * O proxy deve retornar os dados já como JSON (não como CSV).
 */
function normalizeTOTVSRM(data: Record<string, unknown>[]): Transaction[] {
  return data
    .map((row, i): Transaction | null => {
      const value = Math.abs(parseFloat(String(row['VLR_LIQUIDO'] ?? row['VLR_CONSIDERADO'] ?? 0)));
      if (!value) return null;

      return {
        id:             `erp-rm-${Date.now()}-${i}`,
        date:           String(row['DT_PAGAMENTO'] ?? row['DT_LIQUIDACAO'] ?? ''),
        description:    String(row['NOME_ABREVIADO'] ?? row['HISTORICO'] ?? 'ERP Import'),
        value,
        type:           TransactionType.PAYABLE,
        status:         'REALIZADO',
        category:       String(row['CENTRO_CUSTO'] ?? 'Realizado'),
        businessUnit:   String(row['UNIDADE'] ?? ''),
        supplierCode:   String(row['COD_FORNECEDOR'] ?? ''),
        supplier:       String(row['NOME_FORNECEDOR'] ?? ''),
        companyCode:    String(row['EMPRESA'] ?? ''),
        documentNumber: String(row['TITULO'] ?? ''),
        species:        String(row['ESPECIE'] ?? ''),
        establishment:  String(row['ESTABELECIMENTO'] ?? ''),
      };
    })
    .filter((t): t is Transaction => t !== null);
}

/**
 * Normaliza a resposta SAP Business One para Transaction[].
 */
function normalizeSAPB1(data: Record<string, unknown>[]): Transaction[] {
  return data
    .map((row, i): Transaction | null => {
      const value = Math.abs(parseFloat(String(row['DocTotal'] ?? row['PaidToDate'] ?? 0)));
      if (!value) return null;

      return {
        id:             `erp-sap-${Date.now()}-${i}`,
        date:           String(row['DocDate'] ?? ''),
        description:    String(row['CardName'] ?? 'SAP Import'),
        value,
        type:           TransactionType.PAYABLE,
        status:         'REALIZADO',
        category:       'Realizado',
        businessUnit:   '',
        supplierCode:   String(row['CardCode'] ?? ''),
        supplier:       String(row['CardName'] ?? ''),
        companyCode:    String(row['BPL_IDAssignedToInvoice'] ?? ''),
        documentNumber: String(row['DocNum'] ?? ''),
      };
    })
    .filter((t): t is Transaction => t !== null);
}

// ─── Dados mock para desenvolvimento ─────────────────────────────────────────

function generateMockTransactions(config: ERPConfig): Transaction[] {
  const result: Transaction[] = [];
  const today = new Date();

  for (const companyCode of config.companyCodes.slice(0, 3)) {
    for (let d = 0; d < (config.lookbackDays ?? 14); d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const dateStr = formatDateBR(date);

      // Simular 1–3 pagamentos por dia por empresa
      const count = Math.floor(Math.random() * 3) + 1;
      for (let i = 0; i < count; i++) {
        const value = Math.round((Math.random() * 50000 + 1000) * 100) / 100;
        result.push({
          id:             `mock-${companyCode}-${d}-${i}`,
          date:           dateStr,
          description:    `Pagamento Mock ${i + 1}`,
          value,
          type:           TransactionType.PAYABLE,
          status:         'REALIZADO',
          category:       ['Fornecedores', 'Pessoal', 'Impostos', 'Despesas Operativas'][i % 4],
          businessUnit:   '100',
          supplierCode:   `FORN${String(i).padStart(4, '0')}`,
          supplier:       `Fornecedor Mock ${i + 1}`,
          companyCode,
          documentNumber: `DOC${Date.now()}${i}`,
        });
      }
    }
  }

  return result;
}

// ─── Sincronizador principal ──────────────────────────────────────────────────

/**
 * Sincroniza transações realizadas diretamente do ERP.
 *
 * Para ambiente sem backend:
 *   - Use `type: 'mock'` para testes
 *   - Implante o proxy Vercel em /api/erp e configure VITE_ERP_PROXY_URL
 *
 * @param config           Configuração do conector
 * @param existingTx       Transações já no estado (para deduplicação)
 * @returns                SyncResult com imported[], skipped e errors[]
 */
export async function syncFromERP(
  config:     ERPConfig,
  existingTx: Transaction[],
): Promise<SyncResult> {
  const errors:  string[]    = [];
  const imported: Transaction[] = [];
  let skipped = 0;

  try {
    // ── Mock mode ───────────────────────────────────────────────────────────
    if (config.type === 'mock') {
      const mock = generateMockTransactions(config);
      imported.push(...mock);

      await auditLog.record({
        action:  'ERP_SYNC',
        subject: 'mock',
        after:   { count: mock.length, source: 'mock' },
        reason:  'Sincronização com dados de demonstração',
      });

      return { success: true, imported, skipped: 0, errors: [], syncedAt: new Date(), source: 'mock' };
    }

    // ── Validar proxy URL ────────────────────────────────────────────────────
    if (!config.proxyUrl) {
      throw new Error('VITE_ERP_PROXY_URL não configurada. Veja a documentação em services/erpConnector.ts.');
    }

    const lookback    = config.lookbackDays ?? 14;
    const dateFrom    = dateNDaysAgo(lookback);
    const dateTo      = new Date();

    // ── Montar payload por tipo de ERP ────────────────────────────────────
    let payload: unknown;

    if (config.type === 'totvs_rm') {
      payload = {
        endpoint:     'contas_pagar',
        companyCodes: config.companyCodes,
        dateFrom:     formatDateBR(dateFrom),
        dateTo:       formatDateBR(dateTo),
        status:       'LIQUIDADO',
      } satisfies TOTVSRMRequest;
    } else if (config.type === 'totvs_fluig') {
      payload = {
        resource: '/financeiro/pagamentos',
        filters: {
          dataInicio: formatDateISO(dateFrom),
          dataFim:    formatDateISO(dateTo),
          empresas:   config.companyCodes,
          status:     'LIQUIDADO',
        },
      } satisfies TOTVSFluigRequest;
    } else if (config.type === 'sap_b1') {
      payload = {
        resource:    '/OutgoingPayments',
        dateFrom:    formatDateISO(dateFrom),
        dateTo:      formatDateISO(dateTo),
        companyCodes: config.companyCodes,
      };
    } else {
      // generic_csv — espera que o proxy retorne CSV bruto
      payload = {
        type:         'csv',
        companyCodes: config.companyCodes,
        dateFrom:     formatDateISO(dateFrom),
        dateTo:       formatDateISO(dateTo),
      };
    }

    // ── Chamada ao proxy ──────────────────────────────────────────────────
    const response = await fetch(config.proxyUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.authHeaders,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Proxy respondeu ${response.status}: ${await response.text()}`);
    }

    // ── Normalizar resposta ────────────────────────────────────────────────
    let rawTransactions: Transaction[] = [];

    if (config.type === 'generic_csv') {
      const csvText = await response.text();
      const parsed  = parseRealizedCSV(csvText, existingTx, '', 'all');
      rawTransactions = parsed.valid.map(r => r.transaction);
      skipped += parsed.duplicates.length + parsed.rejected.length;
    } else {
      const data = await response.json() as Record<string, unknown>[];
      if (config.type === 'totvs_rm' || config.type === 'totvs_fluig') {
        rawTransactions = normalizeTOTVSRM(data);
      } else if (config.type === 'sap_b1') {
        rawTransactions = normalizeSAPB1(data);
      }
    }

    // ── Deduplicação ──────────────────────────────────────────────────────
    const existing = new Set(
      existingTx.map(t => `${t.supplierCode ?? ''}-${t.documentNumber ?? ''}-${t.value}`)
    );

    for (const t of rawTransactions) {
      const key = `${t.supplierCode ?? ''}-${t.documentNumber ?? ''}-${t.value}`;
      if (existing.has(key)) {
        skipped++;
      } else {
        imported.push(t);
        existing.add(key);
      }
    }

    await auditLog.record({
      action:  'ERP_SYNC',
      subject: config.type,
      after:   { imported: imported.length, skipped, source: config.type },
      reason:  `Sincronização automática — ${imported.length} transações importadas`,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    console.error('[erpConnector]', err);

    await auditLog.record({
      action:  'ERP_SYNC',
      subject: config.type,
      reason:  `ERRO na sincronização: ${msg}`,
      meta:    { error: msg },
    });
  }

  return {
    success:  errors.length === 0,
    imported,
    skipped,
    errors,
    syncedAt: new Date(),
    source:   config.type,
  };
}

// ─── Configuração padrão a partir de variáveis de ambiente ───────────────────

/**
 * Monta ERPConfig a partir das variáveis de ambiente VITE_*.
 * Útil para chamar diretamente no App.tsx sem repetir configuração.
 */
export function getERPConfigFromEnv(): ERPConfig | null {
  const proxyUrl     = import.meta.env.VITE_ERP_PROXY_URL;
  const erpType      = import.meta.env.VITE_ERP_TYPE as ERPType ?? 'mock';
  const companyCodes = (import.meta.env.VITE_ERP_COMPANY_CODES ?? '1,2,3,4,5,6,14,17,18,22,23')
    .split(',').map((s: string) => s.trim());

  if (!proxyUrl && erpType !== 'mock') return null;

  return {
    type:         erpType,
    proxyUrl:     proxyUrl ?? '',
    companyCodes,
    lookbackDays: 14,
  };
}

// ─── Documentação do proxy Vercel ─────────────────────────────────────────────
/**
 * EXEMPLO DE PROXY VERCEL (api/erp.ts):
 *
 * ```typescript
 * import type { VercelRequest, VercelResponse } from '@vercel/node';
 *
 * export default async function handler(req: VercelRequest, res: VercelResponse) {
 *   if (req.method !== 'POST') return res.status(405).end();
 *
 *   const { endpoint, companyCodes, dateFrom, dateTo, status } = req.body;
 *
 *   // Credenciais do ERP ficam aqui, no servidor — não expostas ao client
 *   const ERP_URL  = process.env.ERP_URL;       // ex: https://rm.rede-gazeta.local
 *   const ERP_USER = process.env.ERP_USER;
 *   const ERP_PASS = process.env.ERP_PASS;
 *
 *   const response = await fetch(`${ERP_URL}/api/financeiro/${endpoint}`, {
 *     method: 'POST',
 *     headers: {
 *       'Authorization': 'Basic ' + Buffer.from(`${ERP_USER}:${ERP_PASS}`).toString('base64'),
 *       'Content-Type': 'application/json',
 *     },
 *     body: JSON.stringify({ companyCodes, dateFrom, dateTo, status }),
 *   });
 *
 *   const data = await response.json();
 *   res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL ?? '*');
 *   res.json(data);
 * }
 * ```
 *
 * Variáveis no Vercel Dashboard (não no .env do frontend):
 *   ERP_URL   = URL interna do servidor TOTVS
 *   ERP_USER  = usuário com permissão de leitura
 *   ERP_PASS  = senha
 *   APP_URL   = URL do frontend (ex: https://dfc.rede-gazeta.com.br)
 */
