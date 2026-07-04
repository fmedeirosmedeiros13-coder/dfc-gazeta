/**
 * hooks/useApplicationSnapshots.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Guarda cada importação da planilha de Aplicações Financeiras como uma
 * POSIÇÃO datada (o saldo total por empresa naquele momento).
 *
 * PROBLEMA QUE RESOLVE:
 *   Aplicação (TransactionType.APPLICATION) não tinha noção de período — cada
 *   import só ia se somando ao anterior no array de `transactions`. Se você
 *   importasse a planilha de julho sem apagar a de junho, "SALDO ATUAL" na
 *   DFC Consolidada mostraria junho + julho somados (dobrado).
 *
 *   A correção em duas partes:
 *   1) Em App.tsx, ao importar Aplicações, as APPLICATION antigas são
 *      REMOVIDAS do array de `transactions` antes de entrar a nova leva — o
 *      sistema sempre trabalha só com a posição mais recente (sem dobra).
 *   2) Este hook guarda uma FOTO de cada importação (por empresa e total),
 *      independente do array `transactions` — é o histórico usado no
 *      relatório de evolução mês a mês.
 *
 * "GANHO" = variação bruta do saldo entre duas posições consecutivas. Como o
 * usuário confirmou que a planilha já vem líquida de aportes/resgates, essa
 * variação NÃO é rendimento puro — é aportes + resgates + rendimento juntos.
 * A UI deve rotular isso como "Variação do saldo", nunca como "Rendimento".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction } from '../types';

export interface ApplicationSnapshot {
  id:          string;   // = dateISO (uma posição por dia; reimportar no mesmo dia substitui)
  importedAt:  number;
  dateISO:     string;              // yyyy-mm-dd — data da posição (dia da importação)
  label:       string;              // dd/mm/yyyy
  totalGeral:  number;
  porEmpresa:  Record<string, number>; // companyCode -> total
}

export interface UseApplicationSnapshotsResult {
  snapshots: ApplicationSnapshot[]; // ordenado por data crescente
  isLoading: boolean;
  /** Recebe as APPLICATION recém-importadas e grava a posição do dia. */
  capture:   (imported: Transaction[]) => Promise<void>;
  remove:    (id: string) => Promise<void>;
  clear:     () => Promise<void>;
}

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 5; // sincronizado com usePrevistoSnapshots/useRealizadoSnapshots
const STORE      = 'application-positions';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions'))       db.createObjectStore('transactions');
      if (!db.objectStoreNames.contains('realized'))           db.createObjectStore('realized');
      if (!db.objectStoreNames.contains('manual-values'))      db.createObjectStore('manual-values');
      if (!db.objectStoreNames.contains('snapshots'))          db.createObjectStore('snapshots', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('previsto-periods'))   db.createObjectStore('previsto-periods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('realizado-periods'))  db.createObjectStore('realizado-periods', { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE))                db.createObjectStore(STORE, { keyPath: 'id' });
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

const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toBR = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export function useApplicationSnapshots(): UseApplicationSnapshotsResult {
  const [snapshots, setSnapshots] = useState<ApplicationSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    dbGetAll<ApplicationSnapshot>(STORE)
      .then(list => { if (alive) setSnapshots(list.sort((a, b) => a.dateISO.localeCompare(b.dateISO))); })
      .catch(() => {})
      .finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, []);

  const capture = useCallback(async (imported: Transaction[]) => {
    if (imported.length === 0) return;
    // Data da posição = dia da importação (as próprias transações já vêm
    // datadas assim — ver GestaoLancamentos.tsx, import de Aplicações).
    const dateISO = todayISO();
    const porEmpresa: Record<string, number> = {};
    let totalGeral = 0;
    imported.forEach(t => {
      const cc = t.companyCode || 'SEM_EMPRESA';
      porEmpresa[cc] = (porEmpresa[cc] || 0) + (Number(t.value) || 0);
      totalGeral += Number(t.value) || 0;
    });

    const snap: ApplicationSnapshot = {
      id: dateISO,
      importedAt: Date.now(),
      dateISO,
      label: toBR(dateISO),
      totalGeral,
      porEmpresa,
    };

    await dbPut(STORE, snap);
    setSnapshots(prev => {
      const next = prev.filter(s => s.id !== dateISO);
      next.push(snap);
      return next.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    });
  }, []);

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
