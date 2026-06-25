/**
 * hooks/usePersistence.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Persistência automática de estado no IndexedDB.
 *
 * PROBLEMA QUE RESOLVE:
 *   Ao recarregar a página, todo o trabalho é perdido:
 *   - Transações importadas (CSV previsto)
 *   - Realizados importados
 *   - Saldos iniciais e resgates digitados manualmente (dfcManualValues)
 *
 * POR QUE IndexedDB (e não localStorage)?
 *   localStorage tem limite de ~5MB e é síncrono (bloqueia a thread).
 *   IndexedDB é assíncrono, sem limite prático para dados financeiros
 *   e suporta transações ACID — se o browser fechar no meio de um save,
 *   o dado anterior é preservado (não fica corrompido).
 *
 * DEPENDÊNCIA:
 *   Instalar: npm install idb
 *   Docs: https://github.com/jakearchibald/idb
 *
 * ESTRUTURA DO BANCO:
 *   Database: "dfc-gazeta"
 *   Stores:
 *     "transactions"      → Transaction[]  (previstas)
 *     "realized"          → Transaction[]  (realizadas)
 *     "manual-values"     → ManualValues   (saldos e resgates)
 *     "snapshots"         → Snapshot[]     (histórico diário — Fase 4)
 *
 * USO:
 *   const { isReady, saveAll, clearAll } = usePersistence({
 *     transactions, realizedTransactions, manualValues,
 *     setTransactions, setRealizedTransactions, setManualValues,
 *   });
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Transaction, ManualValues } from '../types';

// ─── Configuração do banco ────────────────────────────────────────────────────

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 1;

const STORES = {
  transactions:  'transactions',
  realized:      'realized',
  manualValues:  'manual-values',
} as const;

// ─── IDB wrapper mínimo (evita adicionar dependência pesada) ─────────────────

/**
 * Abre (ou cria) o banco IndexedDB.
 * Retorna uma Promise que resolve com a instância IDBDatabase.
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Criar stores na primeira abertura (ou upgrade)
      for (const storeName of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Salva um valor em um store pelo key. */
async function dbPut<T>(store: string, key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** Lê um valor de um store pelo key. Retorna undefined se não existir. */
async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => { resolve(req.result as T); db.close(); };
    req.onerror   = () => { reject(req.error); db.close(); };
  });
}

/** Limpa todos os registros de um store. */
async function dbClear(store: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── Tipos do hook ────────────────────────────────────────────────────────────

interface UsePersistenceParams {
  transactions:         Transaction[];
  realizedTransactions: Transaction[];
  manualValues:         ManualValues;
  setTransactions:         (ts: Transaction[]) => void;
  setRealizedTransactions: (ts: Transaction[]) => void;
  setManualValues:         (mv: ManualValues)  => void;
}

interface UsePersistenceResult {
  /** true quando o estado inicial foi restaurado do banco. */
  isReady:  boolean;
  /** Salva manualmente todo o estado (normalmente feito de forma automática). */
  saveAll:  () => Promise<void>;
  /** Apaga todos os dados persistidos e zera o estado. */
  clearAll: () => Promise<void>;
  /** Timestamp do último save bem-sucedido. null se nunca salvou. */
  lastSaved: Date | null;
  /** true se um save está em andamento. */
  isSaving:  boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Gerencia a persistência automática de estado no IndexedDB.
 *
 * Fluxo:
 *   1. Na montagem: restaura o estado salvo anteriormente.
 *   2. A cada mudança de estado: agenda um debounce de 1,5s antes de salvar.
 *      (evita writes excessivos durante importações em lote)
 *   3. Antes de desmontar: cancela o timer pendente.
 *
 * Tratamento de erros:
 *   Se o IndexedDB não estiver disponível (modo privado em alguns browsers),
 *   o hook falha silenciosamente — a app funciona normalmente sem persistência.
 */
export function usePersistence({
  transactions,
  realizedTransactions,
  manualValues,
  setTransactions,
  setRealizedTransactions,
  setManualValues,
}: UsePersistenceParams): UsePersistenceResult {
  const [isReady,   setIsReady]   = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving,  setIsSaving]  = useState(false);

  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender  = useRef(true);
  const isDBAvailable  = useRef(true);

  // ── Restaurar estado na montagem ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const [savedTx, savedReal, savedMV] = await Promise.all([
          dbGet<Transaction[]>(STORES.transactions, 'data'),
          dbGet<Transaction[]>(STORES.realized,     'data'),
          dbGet<ManualValues> (STORES.manualValues, 'data'),
        ]);

        if (cancelled) return;

        if (savedTx   && savedTx.length   > 0) setTransactions(savedTx);
        if (savedReal && savedReal.length  > 0) setRealizedTransactions(savedReal);
        if (savedMV   && Object.keys(savedMV).length > 0) setManualValues(savedMV);
      } catch (err) {
        console.warn('[usePersistence] IndexedDB não disponível — funcionando sem persistência.', err);
        isDBAvailable.current = false;
      } finally {
        if (!cancelled) setIsReady(true);
      }
    }

    restore();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Só na montagem

  // ── Auto-save com debounce ────────────────────────────────────────────────
  useEffect(() => {
    // Não salvar na primeira renderização (é a restauração chegando)
    if (isFirstRender.current) {
      if (isReady) isFirstRender.current = false;
      return;
    }
    if (!isDBAvailable.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await Promise.all([
          dbPut(STORES.transactions, 'data', transactions),
          dbPut(STORES.realized,     'data', realizedTransactions),
          dbPut(STORES.manualValues, 'data', manualValues),
        ]);
        setLastSaved(new Date());
      } catch (err) {
        console.error('[usePersistence] Falha ao salvar:', err);
      } finally {
        setIsSaving(false);
      }
    }, 1500); // 1,5s debounce

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [transactions, realizedTransactions, manualValues, isReady]);

  // ── API pública ───────────────────────────────────────────────────────────

  const saveAll = useCallback(async () => {
    if (!isDBAvailable.current) return;
    setIsSaving(true);
    try {
      await Promise.all([
        dbPut(STORES.transactions, 'data', transactions),
        dbPut(STORES.realized,     'data', realizedTransactions),
        dbPut(STORES.manualValues, 'data', manualValues),
      ]);
      setLastSaved(new Date());
    } finally {
      setIsSaving(false);
    }
  }, [transactions, realizedTransactions, manualValues]);

  const clearAll = useCallback(async () => {
    if (!isDBAvailable.current) return;
    await Promise.all([
      dbClear(STORES.transactions),
      dbClear(STORES.realized),
      dbClear(STORES.manualValues),
    ]);
    setTransactions([]);
    setRealizedTransactions([]);
    setManualValues({});
    setLastSaved(null);
  }, [setTransactions, setRealizedTransactions, setManualValues]);

  return { isReady, saveAll, clearAll, lastSaved, isSaving };
}
