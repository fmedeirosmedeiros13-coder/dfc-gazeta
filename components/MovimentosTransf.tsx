import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react';
import { BANKS_MAPPING, COMPANIES } from '../utils/finance';

// ─── Lançar transferência / mútuo ─────────────────────────────────────────────
// Cada movimento tem ORIGEM (sai o dinheiro) e DESTINO (entra). Ao lançar, as
// duas pontas são somadas nas células Transf do FC Diário (chaves
// sim_transf_{empresa}_{banco}_{dia}) — o resto do sistema (DFC bloco 4,
// Análise, avisos) continua lendo a coluna Transf como sempre. O que for
// digitado direto na célula continua valendo como ajuste manual.
// Os movimentos ficam salvos no navegador (entram no backup: prefixo "fc_").

export type TipoMov = 'MUTUO' | 'INTERNA';
export interface MovimentoTransf {
  id: string; date: string; tipo: TipoMov;
  origemCia: string; origemBanco: string; destinoCia: string; destinoBanco: string;
  valor: number; obs?: string;
}

const LS_KEY = 'fc_movimentos_transf';
export const SIGLA_CIA: Record<string, string> = { '1': 'S/A', '2': 'TVG', '3': 'TVC', '4': 'TVN', '5': 'MIX', '6': 'FM 102', '14': 'VÍDEO', '17': 'DIFUSORA', '18': 'CIDADÃ', '22': 'FM LINH.', '23': 'N. GERAÇÃO' };
export const siglaCia = (id: string) => SIGLA_CIA[String(id).replace(/^0+(?=\d)/, '')] || `Emp ${id}`;
export const keyTransf = (cia: string, banco: string, date: string) => `sim_transf_${cia}_${banco}_${date}`;

export function useMovimentosTransf() {
  const [movs, setMovs] = useState<MovimentoTransf[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(movs)); } catch { /* ignora */ } }, [movs]);
  return [movs, setMovs] as const;
}

/** Variação que um movimento causa em cada célula (origem −valor, destino +valor). */
export const deltasDe = (m: MovimentoTransf, sinal: 1 | -1 = 1): Record<string, number> => ({
  [keyTransf(m.origemCia, m.origemBanco, m.date)]: -sinal * m.valor,
  [keyTransf(m.destinoCia, m.destinoBanco, m.date)]: sinal * m.valor,
});

const fmt = (v: number) => Math.round(v).toLocaleString('pt-BR');
const parseValor = (raw: string) => {
  const t = String(raw || '').replace(/\s/g, '').replace(/^R\$/i, '');
  if (!t) return NaN;
  const norm = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\.(?=\d{3}(\D|$))/g, '');
  return Number(norm);
};

export const MovimentosModal: React.FC<{
  aberto: boolean;
  onFechar: () => void;
  datas: string[];
  dataInicial?: string;
  filtroBanco?: { cia: string; banco: string } | null;
  movs: MovimentoTransf[];
  onSalvar: (novo: MovimentoTransf, antigo: MovimentoTransf | null) => void;
  onExcluir: (m: MovimentoTransf) => void;
  somaTransfDoDia: (date: string) => number;
}> = ({ aberto, onFechar, datas, dataInicial, filtroBanco, movs, onSalvar, onExcluir, somaTransfDoDia }) => {
  const vazio = (d?: string): MovimentoTransf => ({ id: '', date: d || dataInicial || datas[0] || '', tipo: 'MUTUO', origemCia: '1', origemBanco: 'BANESTES', destinoCia: '2', destinoBanco: 'BANESTES', valor: 0, obs: '' });
  const [form, setForm] = useState<MovimentoTransf>(vazio());
  const [valorTxt, setValorTxt] = useState('');
  const [editando, setEditando] = useState<MovimentoTransf | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!aberto) return;
    const base = vazio(dataInicial);
    if (filtroBanco) { base.origemCia = filtroBanco.cia; base.origemBanco = filtroBanco.banco; }
    setForm(base); setValorTxt(''); setEditando(null); setErro('');
  }, [aberto, dataInicial, filtroBanco?.cia, filtroBanco?.banco]);

  const bancosDe = (cia: string) => (BANKS_MAPPING[cia] || []).map(b => b.id);
  const set = (p: Partial<MovimentoTransf>) => setForm(f => {
    const n = { ...f, ...p };
    if (p.origemCia && !bancosDe(p.origemCia).includes(n.origemBanco)) n.origemBanco = bancosDe(p.origemCia)[0] || '';
    if (p.destinoCia && !bancosDe(p.destinoCia).includes(n.destinoBanco)) n.destinoBanco = bancosDe(p.destinoCia)[0] || '';
    if (p.tipo === 'INTERNA') { n.destinoCia = n.origemCia; const outros = bancosDe(n.origemCia).filter(b => b !== n.origemBanco); if (!bancosDe(n.destinoCia).includes(n.destinoBanco) || n.destinoBanco === n.origemBanco) n.destinoBanco = outros[0] || ''; }
    if (n.tipo === 'INTERNA' && p.origemCia) { n.destinoCia = p.origemCia; n.destinoBanco = bancosDe(p.origemCia).find(b => b !== n.origemBanco) || ''; }
    return n;
  });

  const doDia = useMemo(() => movs.filter(m => m.date === form.date && (!filtroBanco ||
    (m.origemCia === filtroBanco.cia && m.origemBanco === filtroBanco.banco) || (m.destinoCia === filtroBanco.cia && m.destinoBanco === filtroBanco.banco))), [movs, form.date, filtroBanco]);

  if (!aberto) return null;

  const salvar = () => {
    const v = parseValor(valorTxt);
    if (!(v > 0)) return setErro('Informe um valor maior que zero (ex.: 100.000).');
    if (v > 100_000_000) return setErro('Valor acima de R$ 100 milhões — confira a digitação.');
    if (!form.date) return setErro('Escolha o dia.');
    if (form.tipo === 'MUTUO' && form.origemCia === form.destinoCia) return setErro('Mútuo é entre empresas DIFERENTES. Para a mesma empresa, use "Interna".');
    if (form.tipo === 'INTERNA' && (form.origemCia !== form.destinoCia || form.origemBanco === form.destinoBanco)) return setErro('Interna é entre dois bancos diferentes da MESMA empresa.');
    if (!form.origemBanco || !form.destinoBanco) return setErro('Escolha os bancos de origem e destino.');
    onSalvar({ ...form, valor: Math.round(v * 100) / 100, id: editando?.id || `mov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }, editando);
    setForm(vazio(form.date)); setValorTxt(''); setEditando(null); setErro('');
  };
  const editar = (m: MovimentoTransf) => { setEditando(m); setForm({ ...m }); setValorTxt(m.valor.toLocaleString('pt-BR')); setErro(''); };
  const soma = somaTransfDoDia(form.date);
  const sel = 'w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-100';
  const lbl = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center pt-16" onMouseDown={onFechar}>
      <div className="w-[640px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-violet-400" />{editando ? 'Editar movimento' : 'Lançar transferência / mútuo'}</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Dia</label>
            <select className={sel} value={form.date} onChange={e => set({ date: e.target.value })}>{datas.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label className={lbl}>Tipo</label>
            <div className="flex rounded overflow-hidden border border-slate-700">
              {(['MUTUO', 'INTERNA'] as TipoMov[]).map(t => (
                <button key={t} onClick={() => set({ tipo: t })} className={`flex-1 py-1.5 text-xs font-bold ${form.tipo === t ? 'bg-violet-700 text-white' : 'text-slate-400'}`}>{t === 'MUTUO' ? 'MÚTUO' : 'INTERNA'}</button>))}
            </div></div>
          <div><label className={lbl}>Origem (sai o dinheiro)</label>
            <div className="flex gap-1">
              <select className={sel} value={form.origemCia} onChange={e => set({ origemCia: e.target.value })}>{COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select className={sel + ' w-28'} value={form.origemBanco} onChange={e => set({ origemBanco: e.target.value })}>{bancosDe(form.origemCia).map(b => <option key={b} value={b}>{b}</option>)}</select>
            </div></div>
          <div><label className={lbl}>Destino (entra o dinheiro)</label>
            <div className="flex gap-1">
              <select className={sel} value={form.destinoCia} disabled={form.tipo === 'INTERNA'} onChange={e => set({ destinoCia: e.target.value })}>{COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <select className={sel + ' w-28'} value={form.destinoBanco} onChange={e => set({ destinoBanco: e.target.value })}>{bancosDe(form.destinoCia).filter(b => form.tipo !== 'INTERNA' || b !== form.origemBanco).map(b => <option key={b} value={b}>{b}</option>)}</select>
            </div></div>
          <div><label className={lbl}>Valor</label>
            <input className={sel} placeholder="ex.: 100.000" value={valorTxt} onChange={e => setValorTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') salvar(); }} /></div>
          <div><label className={lbl}>Observação (opcional)</label>
            <input className={sel} value={form.obs || ''} onChange={e => set({ obs: e.target.value })} /></div>
        </div>
        {erro && <p className="mt-3 text-xs text-rose-400 font-semibold">{erro}</p>}
        <div className="flex justify-end gap-2 mt-4">
          {editando && <button onClick={() => { setEditando(null); setForm(vazio(form.date)); setValorTxt(''); }} className="px-3 py-1.5 rounded text-xs font-bold bg-slate-700 text-slate-200">Cancelar edição</button>}
          <button onClick={salvar} className="px-4 py-1.5 rounded text-xs font-bold bg-violet-700 hover:bg-violet-600 text-white">{editando ? 'Salvar' : 'Lançar'}</button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Origem e destino são lançados juntos na coluna Transf — nunca fica ponta faltando. Valores digitados direto na célula continuam valendo (ajuste manual).</p>

        <h4 className="mt-5 mb-2 text-xs font-bold text-slate-200">Movimentos de {form.date}{filtroBanco ? ` — ${siglaCia(filtroBanco.cia)} › ${filtroBanco.banco}` : ''}</h4>
        {doDia.length === 0 ? <p className="text-xs text-slate-500">Nenhum movimento lançado.</p> : (
          <table className="w-full text-xs border border-slate-800">
            <thead><tr className="bg-slate-800 text-slate-400 text-[10px] uppercase"><th className="p-1.5 text-left">Tipo</th><th className="p-1.5 text-left">Origem</th><th className="p-1.5 text-left">Destino</th><th className="p-1.5 text-right">Valor</th><th className="p-1.5"></th></tr></thead>
            <tbody>{doDia.map(m => (
              <tr key={m.id} className="border-t border-slate-800" title={m.obs || ''}>
                <td className="p-1.5"><span className={`px-1.5 rounded text-[10px] font-extrabold text-white ${m.tipo === 'MUTUO' ? 'bg-rose-700' : 'bg-slate-600'}`}>{m.tipo === 'MUTUO' ? 'MÚTUO' : 'INTERNA'}</span></td>
                <td className="p-1.5 text-slate-300">{siglaCia(m.origemCia)} › {m.origemBanco}</td>
                <td className="p-1.5 text-slate-300">{siglaCia(m.destinoCia)} › {m.destinoBanco}</td>
                <td className="p-1.5 text-right text-slate-100 font-semibold">{fmt(m.valor)}</td>
                <td className="p-1.5 text-center whitespace-nowrap">
                  <button title="Editar" onClick={() => editar(m)} className="text-slate-400 hover:text-white mr-2"><Pencil className="w-3.5 h-3.5 inline" /></button>
                  <button title="Excluir" onClick={() => { if (confirm('Excluir este movimento? As duas pontas saem da coluna Transf.')) onExcluir(m); }} className="text-slate-400 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5 inline" /></button>
                </td></tr>))}
            </tbody>
          </table>)}
        <p className={`mt-2 text-xs font-semibold text-right ${Math.round(soma) === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
          Conferência da coluna Transf em {form.date}: {fmt(soma)} {Math.round(soma) === 0 ? '✓' : '— não fecha em zero (falta uma ponta?)'}
        </p>
      </div>
    </div>
  );
};
