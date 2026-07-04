/**
 * hooks/useRealizadoSnapshots.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mesmo mecanismo do usePrevistoSnapshots.ts, só que para o REALIZADO.
 *
 * Antes, o Realizado era só um blob acumulado sem noção de período — a tela
 * Previsto vs Realizado filtrava o realizado por data derivada do período do
 * Previsto escolhido. Isso guarda cada importação de Realizado como uma foto
 * de período própria, para a tela poder escolher os dois períodos de forma
 * explícita e simétrica (ex.: Previsto 29/06–06/07 vs Realizado 29/06–06/07).
 *
 * O período é detectado automaticamente pelo intervalo de datas (menor/maior
 * data) dos lançamentos do próprio arquivo importado — mesmo critério do
 * Previsto, sem digitação manual.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction } from '../types';
import { parseDate } from '../utils/finance';

export interface RealizadoSnapshot {
  id:          string;
  importedAt:  number;
  period: { start: string; end: string }; // ISO yyyy-mm-dd
  label:        string;                    // ex.: "29/06/2026 – 06/07/2026"
  transactions: Transaction[];
}

export interface UseRealizadoSnapshotsResult {
  snapshots: RealizadoSnapshot[]; // mais recente primeiro
  isLoading: boolean;
  capture:   (imported: Transaction[]) => Promise<void>;
  remove:    (id: string) => Promise<void>;
  clear:     () => Promise<void>;
}

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 5; // sincronizado com useApplicationSnapshots.ts // bump para criar a store 'realizado-periods'
const STORE      = 'realizado-periods';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions'))     db.createObjectStore('transactions');
      if (!db.objectStoreNames.contains('realized'))         db.createObjectStore('realized');
      if (!db.objectStoreNames.contains('manual-values'))    db.createObjectStore('manual-values');
      if (!db.objectStoreNames.contains('snapshots'))        db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('previsto-periods')) db.createObjectStore('previsto-periods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE))              db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(storeName: string, record: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

const toISO = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toBR = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export function useRealizadoSnapshots(): UseRealizadoSnapshotsResult {
  const [snapshots, setSnapshots] = useState<RealizadoSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    dbGetAll<RealizadoSnapshot>(STORE)
      .then(list => { if (alive) setSnapshots(list.sort((a, b) => b.importedAt - a.importedAt)); })
      .catch(() => {})
      .finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, []);

  const capture = useCallback(async (imported: Transaction[]) => {
    if (imported.length === 0) return;
    const dates = imported.map(t => parseDate(t.date)).filter(d => d > 0);
    if (dates.length === 0) return;

    const startISO = toISO(Math.min(...dates));
    const endISO   = toISO(Math.max(...dates));
    const importedAt = Date.now();

    const existing = snapshots.find(s => s.period.start === startISO && s.period.end === endISO);
    const id = existing ? existing.id : `${startISO}_${endISO}_${importedAt}`;

    const snap: RealizadoSnapshot = {
      id,
      importedAt,
      period: { start: startISO, end: endISO },
      label: startISO === endISO ? toBR(startISO) : `${toBR(startISO)} – ${toBR(endISO)}`,
      transactions: imported,
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
