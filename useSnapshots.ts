/**
 * hooks/useSnapshots.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Histórico de snapshots diários do DFC.
 *
 * PROBLEMA QUE RESOLVE:
 *   Hoje o sistema só mostra o estado ATUAL. Não há memória de:
 *   - Como o saldo evoluiu semana a semana
 *   - Se o desvio previsto×realizado está melhorando ou piorando
 *   - Qual foi o melhor e o pior mês dos últimos 90 dias
 *
 * COMO FUNCIONA:
 *   A cada abertura do app (ou manualmente), o estado financeiro atual é
 *   "fotografado" e salvo no IndexedDB com timestamp. Com N snapshots
 *   acumulados, conseguimos: tendências, comparativos e alimentar a projeção.
 *
 * ESTRUTURA DE UM SNAPSHOT:
 *   {
 *     id:          string (ISO date — um por dia)
 *     capturedAt:  timestamp
 *     period:      { start, end } das transações
 *     summary:     { totalInflow, totalOutflow, balance, ... }
 *     byCompany:   Record<companyId, CompanySnapshot>
 *     alerts:      contagem por severidade
 *     deviation:   desvio previsto×realizado em %
 *   }
 *
 * USO:
 *   const snap = useSnapshots();
 *   await snap.capture(summary, transactions, realized, alerts);
 *   const series = snap.timeSeries('balance', 30); // últimos 30 dias
 *   const trend = snap.trend('totalOutflow');       // 'up' | 'down' | 'stable'
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useState } from 'react';
import { Transaction, TransactionType, FinancialSummary } from '../types';
import { parseDate, COMPANIES } from '../utils/finance';
import type { Alert, AlertSeverity } from '../engines/alerts';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CompanySnapshot {
  companyId:   string;
  companyName: string;
  inflow:      number;
  outflow:     number;
  balance:     number;
  txCount:     number;
}

export interface DFCSnapshot {
  /** Um snapshot por dia — ID = data ISO (ex: "2026-05-18"). */
  id:          string;
  capturedAt:  number;  // Unix ms
  period: {
    start: string;
    end:   string;
  };
  summary: {
    totalInflow:       number;
    totalOutflow:      number;
    totalInvested:     number;
    balance:           number;
    totalRealizedOutflow: number;
  };
  byCompany:   CompanySnapshot[];
  alertCounts: Record<AlertSeverity, number>;
  /** Desvio percentual previsto×realizado (signed). */
  deviationPct: number;
  /** Número de transações previstas. */
  txCount: number;
}

export type TrendDirection = 'up' | 'down' | 'stable';

export interface TimeSeriesPoint {
  date:  string;
  value: number;
}

export interface UseSnapshotsResult {
  /** Snapshots carregados, ordem cronológica. */
  snapshots:    DFCSnapshot[];
  /** true enquanto o banco está sendo lido na montagem. */
  isLoading:    boolean;
  /** Captura um snapshot do estado atual. Substitui o do mesmo dia se existir. */
  capture:      (
    summary:      FinancialSummary,
    transactions: Transaction[],
    realized:     Transaction[],
    alerts:       Alert[],
  ) => Promise<void>;
  /** Série temporal de um campo numérico do summary. */
  timeSeries:   (field: keyof DFCSnapshot['summary'], days?: number) => TimeSeriesPoint[];
  /** Série temporal por empresa. */
  timeSeriesByCompany: (companyId: string, field: keyof CompanySnapshot, days?: number) => TimeSeriesPoint[];
  /** Direção de tendência dos últimos N snapshots. */
  trend:        (field: keyof DFCSnapshot['summary'], window?: number) => TrendDirection;
  /** Melhor e pior valor de um campo nos últimos N dias. */
  range:        (field: keyof DFCSnapshot['summary'], days?: number) => { min: number; max: number; minDate: string; maxDate: string };
  /** Remove snapshots mais antigos que N dias. */
  prune:        (keepDays?: number) => Promise<number>;
  /** Apaga todo o histórico. */
  clearHistory: () => Promise<void>;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME    = 'dfc-gazeta';
const DB_VERSION = 2;   // bump para criar a store de snapshots
const STORE      = 'snapshots';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('transactions'))  db.createObjectStore('transactions');
      if (!db.objectStoreNames.contains('realized'))      db.createObjectStore('realized');
      if (!db.objectStoreNames.contains('manual-values')) db.createObjectStore('manual-values');
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('capturedAt', 'capturedAt');
      }
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
    req.onsuccess = () => { resolve(req.result as T[]); db.close(); };
    req.onerror   = () => { reject(req.error); db.close(); };
  });
}

async function dbPut<T>(storeName: string, record: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function dbClear(storeName: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ─── Helpers de construção ────────────────────────────────────────────────────

function buildCompanySnapshots(
  transactions: Transaction[],
  realized:     Transaction[],
): CompanySnapshot[] {
  const all = [...transactions, ...realized];
  const byId: Record<string, CompanySnapshot> = {};

  for (const t of all) {
    const id   = t.companyCode ?? 'N/D';
    const name = COMPANIES.find(c => c.id === id)?.name ?? `Empresa ${id}`;
    if (!byId[id]) byId[id] = { companyId: id, companyName: name, inflow: 0, outflow: 0, balance: 0, txCount: 0 };
    const val = Math.abs(Number(t.value) || 0);
    if (t.type === TransactionType.RECEIVABLE)  byId[id].inflow  += val;
    if (t.type === TransactionType.PAYABLE)     byId[id].outflow += val;
    if (t.type === TransactionType.APPLICATION) byId[id].outflow += val;
    byId[id].txCount++;
  }

  for (const s of Object.values(byId)) s.balance = s.inflow - s.outflow;
  return Object.values(byId).sort((a, b) => b.outflow - a.outflow);
}

function calcDeviationPct(transactions: Transaction[], realized: Transaction[]): number {
  const planned  = transactions.filter(t => t.type === TransactionType.PAYABLE)
                               .reduce((s, t) => s + (Number(t.value) || 0), 0);
  const actual   = realized.filter(t => t.type === TransactionType.PAYABLE)
                            .reduce((s, t) => s + (Number(t.value) || 0), 0);
  if (!planned) return 0;
  return ((actual - planned) / planned) * 100;
}

function getPeriod(transactions: Transaction[]): { start: string; end: string } {
  if (!transactions.length) return { start: '', end: '' };
  const sorted = [...transactions].sort((a, b) => parseDate(a.date) - parseDate(b.date));
  return { start: sorted[0].date, end: sorted[sorted.length - 1].date };
}

// ─── Hook principal ───────────────────────────────────────────────────────────

export function useSnapshots(): UseSnapshotsResult {
  const [snapshots,  setSnapshots]  = useState<DFCSnapshot[]>([]);
  const [isLoading,  setIsLoading]  = useState(true);

  // Carregar histórico na montagem
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const all = await dbGetAll<DFCSnapshot>(STORE);
        if (!cancelled) {
          setSnapshots(all.sort((a, b) => a.capturedAt - b.capturedAt));
        }
      } catch (err) {
        console.warn('[useSnapshots] IndexedDB indisponível:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Capturar snapshot ────────────────────────────────────────────────────
  const capture = useCallback(async (
    summary:      FinancialSummary,
    transactions: Transaction[],
    realized:     Transaction[],
    alerts:       Alert[],
  ) => {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const alertCounts = alerts.reduce(
      (acc, a) => { acc[a.severity]++; return acc; },
      { critical: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>,
    );

    const snapshot: DFCSnapshot = {
      id:          today,
      capturedAt:  Date.now(),
      period:      getPeriod(transactions),
      summary: {
        totalInflow:          summary.totalInflow,
        totalOutflow:         summary.totalOutflow,
        totalInvested:        summary.totalInvested,
        balance:              summary.balance,
        totalRealizedOutflow: summary.totalRealizedOutflow ?? 0,
      },
      byCompany:    buildCompanySnapshots(transactions, realized),
      alertCounts,
      deviationPct: calcDeviationPct(transactions, realized),
      txCount:      transactions.length,
    };

    try {
      await dbPut(STORE, snapshot);
      setSnapshots(prev => {
        const without = prev.filter(s => s.id !== today);
        return [...without, snapshot].sort((a, b) => a.capturedAt - b.capturedAt);
      });
    } catch (err) {
      console.error('[useSnapshots] Falha ao salvar snapshot:', err);
    }
  }, []);

  // ── Série temporal ────────────────────────────────────────────────────────
  const timeSeries = useCallback((
    field: keyof DFCSnapshot['summary'],
    days  = 90,
  ): TimeSeriesPoint[] => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots
      .filter(s => s.capturedAt >= cutoff)
      .map(s => ({ date: s.id, value: s.summary[field] }));
  }, [snapshots]);

  const timeSeriesByCompany = useCallback((
    companyId: string,
    field:     keyof CompanySnapshot,
    days = 90,
  ): TimeSeriesPoint[] => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots
      .filter(s => s.capturedAt >= cutoff)
      .map(s => {
        const company = s.byCompany.find(c => c.companyId === companyId);
        return { date: s.id, value: Number(company?.[field] ?? 0) };
      });
  }, [snapshots]);

  // ── Tendência ─────────────────────────────────────────────────────────────
  const trend = useCallback((
    field:  keyof DFCSnapshot['summary'],
    window = 5,
  ): TrendDirection => {
    const recent = snapshots.slice(-window);
    if (recent.length < 2) return 'stable';

    const first = recent[0].summary[field];
    const last  = recent[recent.length - 1].summary[field];
    const diff  = last - first;
    const pct   = first !== 0 ? Math.abs(diff / first) : 0;

    if (pct < 0.03) return 'stable'; // menos de 3% de variação
    return diff > 0 ? 'up' : 'down';
  }, [snapshots]);

  // ── Min/Max ───────────────────────────────────────────────────────────────
  const range = useCallback((
    field: keyof DFCSnapshot['summary'],
    days  = 30,
  ) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const filtered = snapshots.filter(s => s.capturedAt >= cutoff);
    if (!filtered.length) return { min: 0, max: 0, minDate: '', maxDate: '' };

    let min = Infinity, max = -Infinity, minDate = '', maxDate = '';
    for (const s of filtered) {
      const v = s.summary[field];
      if (v < min) { min = v; minDate = s.id; }
      if (v > max) { max = v; maxDate = s.id; }
    }
    return { min, max, minDate, maxDate };
  }, [snapshots]);

  // ── Poda ──────────────────────────────────────────────────────────────────
  const prune = useCallback(async (keepDays = 180): Promise<number> => {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const toDelete = snapshots.filter(s => s.capturedAt < cutoff);
    for (const s of toDelete) await dbDelete(STORE, s.id);
    setSnapshots(prev => prev.filter(s => s.capturedAt >= cutoff));
    return toDelete.length;
  }, [snapshots]);

  const clearHistory = useCallback(async () => {
    await dbClear(STORE);
    setSnapshots([]);
  }, []);

  return {
    snapshots,
    isLoading,
    capture,
    timeSeries,
    timeSeriesByCompany,
    trend,
    range,
    prune,
    clearHistory,
  };
}
