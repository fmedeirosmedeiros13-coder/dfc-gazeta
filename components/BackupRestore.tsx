import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { DB_NAME, DB_VERSION, ensureAllStores } from '../utils/idb';

// ─── Backup / Restaurar ───────────────────────────────────────────────────────
// Os dados do DFC ficam no banco do NAVEGADOR (IndexedDB). Este backup baixa um
// arquivo .json com TUDO (lançamentos, calendário, aplicações, extratos, valores
// digitados no FC Diário, histórico do previsto/realizado, auditoria e as
// preferências de tela) e permite restaurar depois — no mesmo computador ou em
// outro. Restaurar SUBSTITUI os dados atuais pelos do arquivo.

const STORES = ['transactions', 'realized', 'manual-values', 'snapshots', 'previsto-periods', 'realizado-periods', 'application-positions', 'audit-log'];
const LS_PREFIX = 'fc_';   // preferências do FC Diário (período, "Ocultar antes de"…)
const FORMATO = 'dfc-gazeta-backup';

const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => ensureAllStores(req.result);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
  req.onblocked = () => reject(new Error('Feche as outras abas do DFC Gestão e tente de novo.'));
});

type StoreDump = { key?: IDBValidKey; value: unknown }[];

async function exportAll(): Promise<Record<string, StoreDump>> {
  const db = await openDb();
  const out: Record<string, StoreDump> = {};
  try {
    for (const name of STORES) {
      if (!db.objectStoreNames.contains(name)) continue;
      out[name] = await new Promise<StoreDump>((resolve, reject) => {
        const st = db.transaction(name, 'readonly').objectStore(name);
        const rows: StoreDump = [];
        const inline = !!st.keyPath;
        const cur = st.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve(rows);
          rows.push(inline ? { value: c.value } : { key: c.key, value: c.value });
          c.continue();
        };
        cur.onerror = () => reject(cur.error);
      });
    }
  } finally { db.close(); }
  return out;
}

async function importAll(stores: Record<string, StoreDump>): Promise<void> {
  const db = await openDb();
  try {
    const names = STORES.filter(n => db.objectStoreNames.contains(n));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(names, 'readwrite');
      names.forEach(n => {
        const st = tx.objectStore(n);
        st.clear();
        (stores[n] || []).forEach(r => { if (st.keyPath) st.put(r.value); else st.put(r.value, r.key as IDBValidKey); });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const countOf = (stores: Record<string, StoreDump>) => {
  const tx = (stores['transactions']?.[0]?.value as any[]) || [];
  const by = (t: string) => tx.filter((x: any) => x?.type === t).length;
  const mv = (stores['manual-values']?.[0]?.value as Record<string, number>) || {};
  return {
    pagamentos: by('PAYABLE'), recebimentos: by('RECEIVABLE'), aplicacoes: by('APPLICATION'), calendario: by('CALENDAR'),
    valoresDigitados: Object.keys(mv).filter(k => k.startsWith('sim_') && !k.startsWith('sim_close_')).length,
    realizados: ((stores['realized']?.[0]?.value as any[]) || []).length,
    periodosPrevisto: (stores['previsto-periods'] || []).length,
  };
};

export const BackupRestore: React.FC = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const salvar = async () => {
    setBusy(true);
    try {
      const stores = await exportAll();
      const prefs: Record<string, string> = {};
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith(LS_PREFIX)) prefs[k] = localStorage.getItem(k) || ''; } } catch { /* ignora */ }
      const now = new Date();
      const payload = { formato: FORMATO, versao: 1, geradoEm: now.toISOString(), resumo: countOf(stores), stores, prefs };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const a = document.createElement('a');
      const p2 = (n: number) => String(n).padStart(2, '0');
      a.href = URL.createObjectURL(blob);
      a.download = `DFC_backup_${p2(now.getDate())}-${p2(now.getMonth() + 1)}-${now.getFullYear()}_${p2(now.getHours())}h${p2(now.getMinutes())}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e: any) {
      alert('Não foi possível gerar o backup.\n\n' + (e?.message || e));
    } finally { setBusy(false); }
  };

  const restaurar = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (data?.formato !== FORMATO || !data?.stores) throw new Error('Este arquivo não é um backup do DFC Gestão.');
      const r = data.resumo || countOf(data.stores);
      const quando = data.geradoEm ? new Date(data.geradoEm).toLocaleString('pt-BR') : 'data desconhecida';
      const ok = confirm(
        `RESTAURAR BACKUP de ${quando}\n\n` +
        `• Pagamentos: ${r.pagamentos}\n• Recebimentos: ${r.recebimentos}\n• Aplicações: ${r.aplicacoes}\n• Calendário: ${r.calendario}\n` +
        `• Valores digitados no FC Diário: ${r.valoresDigitados}\n• Realizados: ${r.realizados}\n• Períodos do previsto: ${r.periodosPrevisto}\n\n` +
        `Os dados ATUAIS do sistema serão SUBSTITUÍDOS pelos do backup. Deseja continuar?`);
      if (!ok) return;
      await importAll(data.stores);
      try {
        Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX)).forEach(k => localStorage.removeItem(k));
        Object.entries(data.prefs || {}).forEach(([k, v]) => localStorage.setItem(k, String(v)));
      } catch { /* ignora */ }
      alert('Backup restaurado. O sistema vai recarregar agora.');
      window.location.reload();
    } catch (e: any) {
      alert('Não foi possível restaurar o backup.\n\n' + (e?.message || e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2" title="Cópia de segurança de todos os dados do sistema (guardados neste navegador)">
      <button onClick={salvar} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-60">
        <Download className="w-4 h-4" /> Salvar backup
      </button>
      <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-bold bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-60">
        <Upload className="w-4 h-4" /> Restaurar backup
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" data-backup-input=""
        onChange={e => { const f = e.target.files?.[0]; if (f) restaurar(f); }} />
    </div>
  );
};
