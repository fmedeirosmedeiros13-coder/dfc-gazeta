/**
 * engines/auditLog.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Registro imutável de alterações para conformidade contábil.
 *
 * PROBLEMA QUE RESOLVE:
 *   Hoje não há rastreamento de QUEM alterou QUAL valor, QUANDO e POR QUÊ.
 *   Para auditoria externa e conformidade com NBC TG 03:
 *   "As demonstrações financeiras devem apresentar com base comparativa
 *    as informações do período anterior." (parágrafo 38)
 *
 * O QUE É RASTREADO:
 *   • Importações de CSV (quantas linhas, quais rejeitadas)
 *   • Alterações de valores manuais (saldos iniciais, resgates)
 *   • Geração de análise IA (prompt enviado + resultado)
 *   • Exportações (PDF, PPTX, CSV)
 *   • Limpeza de dados
 *   • Alertas gerados automaticamente
 *
 * DESIGN:
 *   Event sourcing simplificado — cada entrada é append-only.
 *   Nunca atualiza, nunca deleta (salvo por retenção de política).
 *   Persiste no IndexedDB store "audit-log".
 *
 * USO:
 *   import { auditLog } from '../engines/auditLog';
 *
 *   // Registrar uma ação
 *   await auditLog.record({
 *     action:  'MANUAL_VALUE_CHANGE',
 *     subject: 'sim_sd_ini_1_23/12/2025',
 *     before:  0,
 *     after:   150000,
 *     reason:  'Saldo inicial informado pela tesouraria',
 *   });
 *
 *   // Consultar o log
 *   const entries = await auditLog.query({ action: 'MANUAL_VALUE_CHANGE', limit: 50 });
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'CSV_IMPORT'               // Importação de CSV realizado
  | 'CSV_IMPORT_ERROR'         // Importação com erros/rejeições
  | 'MANUAL_VALUE_CHANGE'      // Alteração de saldo/resgate manual
  | 'TRANSACTION_ADD'          // Lançamento adicionado
  | 'TRANSACTION_DELETE'       // Lançamento excluído
  | 'TRANSACTION_EDIT'         // Lançamento editado
  | 'DATA_CLEAR'               // Limpeza de dados
  | 'AI_ANALYSIS_GENERATED'    // Análise IA gerada
  | 'EXPORT_PDF'               // Exportação PDF
  | 'EXPORT_PPTX'              // Exportação PowerPoint
  | 'EXPORT_CSV'               // Exportação CSV
  | 'SNAPSHOT_CAPTURED'        // Snapshot automático
  | 'ERP_SYNC'                 // Sincronização com ERP
  | 'ALERT_TRIGGERED'          // Alerta disparado automaticamente
  | 'SESSION_START';           // Sessão iniciada (app aberto)

export interface AuditEntry {
  /** UUID único da entrada. */
  id:          string;
  /** Timestamp Unix ms. */
  timestamp:   number;
  /** Data/hora formatada em pt-BR para exibição. */
  displayTime: string;
  /** Ação realizada. */
  action:      AuditAction;
  /** Objeto/chave afetada (ex: ID da transação, chave do dfcManualValues). */
  subject:     string;
  /** Valor anterior (undefined se criação). */
  before?:     unknown;
  /** Valor posterior (undefined se exclusão). */
  after?:      unknown;
  /** Motivo/contexto da alteração (opcional, mas recomendado). */
  reason?:     string;
  /** Metadados extras por tipo de ação. */
  meta?:       Record<string, unknown>;
  /** Sessão do usuário (gerada na abertura do app). */
  sessionId:   string;
}

export interface AuditQueryOptions {
  action?:     AuditAction;
  subject?:    string;
  fromDate?:   Date;
  toDate?:     Date;
  limit?:      number;
  /** Ordem de retorno. Default: 'desc' (mais recente primeiro). */
  order?:      'asc' | 'desc';
}

export interface AuditStats {
  totalEntries:        number;
  entriesByAction:     Record<string, number>;
  oldestEntry:         string;
  newestEntry:         string;
  manualChangesToday:  number;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 3;
const STORE      = 'audit-log';

function openAuditDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // Garantir stores das fases anteriores
      for (const s of ['transactions', 'realized', 'manual-values', 'snapshots']) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp',  'timestamp');
        store.createIndex('action',     'action');
        store.createIndex('subject',    'subject');
        store.createIndex('sessionId',  'sessionId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(record: AuditEntry): Promise<void> {
  const db = await openAuditDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbGetAll(): Promise<AuditEntry[]> {
  const db = await openAuditDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => { resolve(req.result as AuditEntry[]); db.close(); };
    req.onerror   = () => { reject(req.error); db.close(); };
  });
}

async function idbClear(): Promise<void> {
  const db = await openAuditDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    db.close();
  });
}

// ─── Session ID ───────────────────────────────────────────────────────────────

/** Gera ou recupera o ID da sessão atual (persiste na sessionStorage). */
function getSessionId(): string {
  const key = 'dfc-session-id';
  let sid   = sessionStorage.getItem(key);
  if (!sid) {
    sid = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, sid);
  }
  return sid;
}

/** Gera um UUID simples. */
function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Classe AuditLog ─────────────────────────────────────────────────────────

class AuditLogService {
  private sessionId = getSessionId();
  private buffer:  AuditEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isAvailable = true;

  constructor() {
    // Registrar início de sessão de forma não-bloqueante
    this.record({ action: 'SESSION_START', subject: 'app', reason: 'Aplicação aberta' })
      .catch(() => { this.isAvailable = false; });
  }

  // ── API pública ────────────────────────────────────────────────────────

  /**
   * Registra uma entrada no audit log.
   * O write é debounced em 500ms para batch de entradas em sequência.
   */
  async record(params: {
    action:   AuditAction;
    subject:  string;
    before?:  unknown;
    after?:   unknown;
    reason?:  string;
    meta?:    Record<string, unknown>;
  }): Promise<void> {
    if (!this.isAvailable) return;

    const entry: AuditEntry = {
      id:          uuid(),
      timestamp:   Date.now(),
      displayTime: new Date().toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      action:      params.action,
      subject:     params.subject,
      before:      params.before,
      after:       params.after,
      reason:      params.reason,
      meta:        params.meta,
      sessionId:   this.sessionId,
    };

    this.buffer.push(entry);
    this.scheduleFLush();
  }

  private scheduleFLush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 500);
  }

  private async flush() {
    if (!this.buffer.length) return;
    const toWrite = [...this.buffer];
    this.buffer = [];
    try {
      for (const entry of toWrite) await idbPut(entry);
    } catch (err) {
      console.warn('[auditLog] Falha ao persistir:', err);
      this.isAvailable = false;
    }
  }

  /**
   * Consulta o log com filtros.
   */
  async query(opts: AuditQueryOptions = {}): Promise<AuditEntry[]> {
    if (!this.isAvailable) return [];
    await this.flush(); // garantir que o buffer está persistido antes de consultar

    let entries = await idbGetAll();

    if (opts.action)   entries = entries.filter(e => e.action  === opts.action);
    if (opts.subject)  entries = entries.filter(e => e.subject.includes(opts.subject!));
    if (opts.fromDate) entries = entries.filter(e => e.timestamp >= opts.fromDate!.getTime());
    if (opts.toDate)   entries = entries.filter(e => e.timestamp <= opts.toDate!.getTime());

    entries.sort((a, b) => opts.order === 'asc'
      ? a.timestamp - b.timestamp
      : b.timestamp - a.timestamp
    );

    return opts.limit ? entries.slice(0, opts.limit) : entries;
  }

  /**
   * Estatísticas agregadas do log.
   */
  async stats(): Promise<AuditStats> {
    if (!this.isAvailable) return {
      totalEntries: 0, entriesByAction: {}, oldestEntry: '', newestEntry: '', manualChangesToday: 0,
    };

    const entries = await idbGetAll();
    const today   = new Date();
    today.setHours(0, 0, 0, 0);

    const byAction: Record<string, number> = {};
    let oldest = Infinity, newest = 0;

    for (const e of entries) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1;
      if (e.timestamp < oldest) oldest = e.timestamp;
      if (e.timestamp > newest) newest = e.timestamp;
    }

    const manualChangesToday = entries.filter(e =>
      e.action === 'MANUAL_VALUE_CHANGE' && e.timestamp >= today.getTime()
    ).length;

    return {
      totalEntries:       entries.length,
      entriesByAction:    byAction,
      oldestEntry:        oldest === Infinity ? '' : new Date(oldest).toLocaleDateString('pt-BR'),
      newestEntry:        newest === 0        ? '' : new Date(newest).toLocaleDateString('pt-BR'),
      manualChangesToday,
    };
  }

  /**
   * Remove entradas mais antigas que N dias (política de retenção).
   * Retorna quantas foram removidas.
   */
  async prune(keepDays = 365): Promise<number> {
    if (!this.isAvailable) return 0;
    const entries   = await idbGetAll();
    const cutoff    = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const toKeep    = entries.filter(e => e.timestamp >= cutoff);
    const removed   = entries.length - toKeep.length;
    if (removed > 0) {
      await idbClear();
      for (const e of toKeep) await idbPut(e);
    }
    return removed;
  }

  /**
   * Exporta o log completo como CSV para download.
   */
  async exportCSV(): Promise<string> {
    const entries = await this.query({ order: 'asc' });
    const header  = 'Data/Hora;Ação;Objeto;Antes;Depois;Motivo;Sessão';
    const rows    = entries.map(e => [
      e.displayTime,
      e.action,
      e.subject,
      e.before !== undefined ? JSON.stringify(e.before) : '',
      e.after  !== undefined ? JSON.stringify(e.after)  : '',
      e.reason ?? '',
      e.sessionId,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
    return [header, ...rows].join('\n');
  }

  /** Limpa todo o log. Use apenas em desenvolvimento. */
  async clearAll(): Promise<void> {
    if (!this.isAvailable) return;
    await idbClear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/**
 * Instância global do audit log.
 * Usar diretamente nos handlers do App.tsx e nos engines.
 *
 * Exemplo:
 *   import { auditLog } from '../engines/auditLog';
 *   await auditLog.record({ action: 'MANUAL_VALUE_CHANGE', subject: key, before: old, after: newVal });
 */
export const auditLog = new AuditLogService();

// ─── Helpers de conveniência ──────────────────────────────────────────────────

/** Label pt-BR para exibição de uma ação no log. */
export function actionLabel(action: AuditAction): string {
  const labels: Record<AuditAction, string> = {
    CSV_IMPORT:             'Importação CSV',
    CSV_IMPORT_ERROR:       'Importação CSV (com erros)',
    MANUAL_VALUE_CHANGE:    'Alteração de valor manual',
    TRANSACTION_ADD:        'Lançamento adicionado',
    TRANSACTION_DELETE:     'Lançamento excluído',
    TRANSACTION_EDIT:       'Lançamento editado',
    DATA_CLEAR:             'Limpeza de dados',
    AI_ANALYSIS_GENERATED:  'Análise IA gerada',
    EXPORT_PDF:             'Exportação PDF',
    EXPORT_PPTX:            'Exportação PowerPoint',
    EXPORT_CSV:             'Exportação CSV',
    SNAPSHOT_CAPTURED:      'Snapshot automático',
    ERP_SYNC:               'Sincronização ERP',
    ALERT_TRIGGERED:        'Alerta automático',
    SESSION_START:          'Sessão iniciada',
  };
  return labels[action] ?? action;
}

/** Ícone Lucide recomendado para cada tipo de ação (retorna string com nome). */
export function actionIcon(action: AuditAction): string {
  const icons: Partial<Record<AuditAction, string>> = {
    CSV_IMPORT:           'FileUp',
    CSV_IMPORT_ERROR:     'FileWarning',
    MANUAL_VALUE_CHANGE:  'PencilLine',
    TRANSACTION_ADD:      'PlusCircle',
    TRANSACTION_DELETE:   'Trash2',
    TRANSACTION_EDIT:     'Edit2',
    DATA_CLEAR:           'Eraser',
    AI_ANALYSIS_GENERATED:'BrainCircuit',
    EXPORT_PDF:           'FileDown',
    EXPORT_PPTX:          'Presentation',
    EXPORT_CSV:           'Table',
    SNAPSHOT_CAPTURED:    'Camera',
    ERP_SYNC:             'RefreshCw',
    ALERT_TRIGGERED:      'Bell',
    SESSION_START:        'LogIn',
  };
  return icons[action] ?? 'Activity';
}
