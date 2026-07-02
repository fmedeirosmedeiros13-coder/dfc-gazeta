/**
 * hooks/usePrevistoSnapshots.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Guarda cada importação de Previsto (contas a pagar/receber) como uma "foto"
 * do período, para poder confrontar depois com o Realizado do MESMO período.
 *
 * PROBLEMA QUE RESOLVE:
 *   O Previsto é acumulativo (cada importação soma ao anterior, sem noção de
 *   período). Ao trazer o Realizado de um mês, a reconciliação comparava
 *   contra TODO o previsto acumulado (junho + julho + agosto...), misturando
 *   períodos. Isso guarda o previsto de cada importação separado por período,
 *   para a tela Previsto vs Realizado poder escolher "qual período conferir".
 *
 * COMO O PERÍODO É IDENTIFICADO:
 *   Automaticamente, pelo intervalo de datas (menor e maior data de vencimento)
 *   dos lançamentos do próprio arquivo importado. Sem digitação manual.
 *
 * REIMPORTAÇÃO DO MESMO PERÍODO:
 *   Se o novo intervalo for exatamente igual a um já salvo, o snapshot anterior
 *   é substituído (evita duplicar o mesmo período duas vezes).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction, TransactionType } from '../types';
import { parseDate } from '../utils/finance';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PrevistoSnapshot {
  /** ID único = `${startISO}_${endISO}_${importedAt}`. */
  id:          string;
  importedAt:  number;   // Unix ms — quando essa leva foi importada
  period: {
    start: string;  // ISO yyyy-mm-dd
    end:   string;  // ISO yyyy-mm-dd
  };
  /** Rótulo automático para exibir, ex.: "01/06/2026 – 08/06/2026". */
  label:        string;
  /** Os lançamentos de Previsto (PAYABLE/RECEIVABLE) daquele período. */
  transactions: Transaction[];
}

export interface UsePrevistoSnapshotsResult {
  snapshots:  PrevistoSnapshot[];   // mais recente primeiro
  isLoading:  boolean;
  /** Cria (ou substitui, se período idêntico) um snapshot a partir do lote importado. */
  capture:    (imported: Transaction[]) => Promise<void>;
  remove:     (id: string) => Promise<void>;
  clear:      () => Promise<void>;
}

// ─── IDB (mesmo banco do usePersistence/useSnapshots, nova store) ────────────

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 3; // bump para criar a store 'previsto-periods'
const STORE      = 'previsto-periods';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions'))  db.createObjectStore('transactions');
      if (!db.objectStoreNames.contains('realized'))      db.createObjectStore('realized');
      if (!db.objectStoreNames.contains('manual-values')) db.createObjectStore('manual-values');
      if (!db.objectStoreNames.contains('snapshots'))     db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE))           db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(storeName: string, record: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

const toISO = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toBR = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePrevistoSnapshots(): UsePrevistoSnapshotsResult {
  const [snapshots, setSnapshots] = useState<PrevistoSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    dbGetAll<PrevistoSnapshot>(STORE)
      .then(list => { if (alive) setSnapshots(list.sort((a, b) => b.importedAt - a.importedAt)); })
      .catch(() => { /* IndexedDB indisponível — segue sem histórico de períodos */ })
      .finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, []);

  const capture = useCallback(async (imported: Transaction[]) => {
    // Só entra no snapshot o que é efetivamente Previsto (a pagar/receber).
    const previsto = imported.filter(t =>
      (t.type === TransactionType.PAYABLE || t.type === TransactionType.RECEIVABLE)
      && (!t.status || t.status === 'PREVISTO')
    );
    if (previsto.length === 0) return;

    const dates = previsto.map(t => parseDate(t.date)).filter(d => d > 0);
    if (dates.length === 0) return;

    const startISO = toISO(Math.min(...dates));
    const endISO   = toISO(Math.max(...dates));
    const importedAt = Date.now();

    // Reimportação do MESMO intervalo substitui o snapshot anterior daquele período.
    const existing = snapshots.find(s => s.period.start === startISO && s.period.end === endISO);
    const id = existing ? existing.id : `${startISO}_${endISO}_${importedAt}`;

    const snap: PrevistoSnapshot = {
      id,
      importedAt,
      period: { start: startISO, end: endISO },
      label: startISO === endISO ? toBR(startISO) : `${toBR(startISO)} – ${toBR(endISO)}`,
      transactions: previsto,
    };

    await dbPut(STORE, snap);
    setSnapshots(prev => {
      const next = prev.filter(s => s.id !== id);
      next.push(snap);
      return next.sort((a, b) => b.importedAt - a.importedAt);
    });
  }, [snapshots]);

  const remove = useCallback(async (id: string) => {
    await dbDelete(STORE, id);
    setSnapshots(prev => prev.filter(s => s.id !== id));
  }, []);

  const clear = useCallback(async () => {
    await dbClear(STORE);
    setSnapshots([]);
  }, []);

  return { snapshots, isLoading, capture, remove, clear };
}
