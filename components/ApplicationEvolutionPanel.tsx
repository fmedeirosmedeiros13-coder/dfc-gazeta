import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { ApplicationSnapshot } from '../hooks/useApplicationSnapshots';
import { formatCurrency, COMPANIES } from '../utils/finance';

interface Props {
  snapshots: ApplicationSnapshot[]; // já vem ordenado por data crescente
}

/**
 * Evolução das Aplicações Financeiras mês a mês.
 *
 * IMPORTANTE sobre o que a coluna "Variação" significa: é a diferença bruta
 * entre o saldo de uma posição e o da posição anterior (saldo novo − saldo
 * anterior). O usuário confirmou que a planilha importada já vem líquida de
 * aportes e resgates — ou seja, essa variação mistura rendimento + aportes +
 * resgates, NÃO é rendimento puro. Por isso o rótulo é "Variação do saldo",
 * nunca "Rendimento".
 */
export const ApplicationEvolutionPanel: React.FC<Props> = ({ snapshots }) => {
  const [untilId, setUntilId] = useState<string>(snapshots[snapshots.length - 1]?.id ?? '');

  const untilIdx = Math.max(0, snapshots.findIndex(s => s.id === untilId));
  const visible = snapshots.slice(0, untilIdx + 1);

  const rows = useMemo(() => visible.map((s, i) => {
    const prev = i > 0 ? visible[i - 1] : null;
    const diff = prev ? s.totalGeral - prev.totalGeral : 0;
    const pct  = prev && prev.totalGeral !== 0 ? (diff / prev.totalGeral) * 100 : 0;
    return { ...s, diff, pct, isFirst: i === 0 };
  }), [visible]);

  const chartData = rows.map(r => ({ label: r.label, saldo: r.totalGeral }));

  const last = rows[rows.length - 1];
  const first = rows[0];
  const variacaoTotal = last && first ? last.totalGeral - first.totalGeral : 0;
  const variacaoTotalPct = first && first.totalGeral !== 0 ? (variacaoTotal / first.totalGeral) * 100 : 0;

  return (
    <div className="bg-slate-900/40 border border-slate-800/60 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-200">Evolução das Aplicações</h3>
          <p className="text-[11px] text-slate-500">
            Variação bruta do saldo entre importações — inclui aportes, resgates e rendimento juntos (a planilha já vem líquida disso).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Consultar até:</span>
          <select
            value={untilId}
            onChange={e => setUntilId(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-slate-700 bg-slate-950 text-slate-200 text-xs"
          >
            {snapshots.map(s => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {rows.length < 2 ? (
        <p className="text-xs text-slate-500 italic">
          Só há uma posição importada até aqui ({first?.label}) — a evolução aparece a partir da segunda importação de um mês diferente.
        </p>
      ) : (
        <>
          <div className="h-32 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(v) => `R$ ${(v / 1_000_000).toFixed(1)}mi`}
                  width={62}
                />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [formatCurrency(v), 'Saldo']}
                />
                <Line type="monotone" dataKey="saldo" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Variação total do período ({first.label} → {last.label}):</span>
            <span className={`font-bold flex items-center gap-1 ${variacaoTotal > 0 ? 'text-emerald-400' : variacaoTotal < 0 ? 'text-red-400' : 'text-slate-400'}`}>
              {variacaoTotal > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : variacaoTotal < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {formatCurrency(variacaoTotal)} ({variacaoTotalPct >= 0 ? '+' : ''}{variacaoTotalPct.toFixed(1)}%)
            </span>
          </div>

          <details className="text-[11px] text-slate-600">
            <summary className="cursor-pointer hover:text-slate-400">Ver posições por importação ({rows.length})</summary>
            <div className="overflow-auto max-h-48 rounded-lg border border-slate-800/60 mt-2">
              <table className="w-full text-xs">
                <thead className="bg-slate-800/60 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 text-slate-400 font-medium">Posição</th>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium">Saldo total</th>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium">Variação</th>
                    <th className="text-right px-3 py-2 text-slate-400 font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map(r => (
                    <tr key={r.id} className="border-t border-slate-800/60">
                      <td className="px-3 py-2 text-slate-300">{r.label}</td>
                      <td className="px-3 py-2 text-right text-slate-200 font-medium">{formatCurrency(r.totalGeral)}</td>
                      <td className={`px-3 py-2 text-right font-medium ${r.isFirst ? 'text-slate-600' : r.diff > 0 ? 'text-emerald-400' : r.diff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {r.isFirst ? '—' : `${r.diff >= 0 ? '+' : ''}${formatCurrency(r.diff)}`}
                      </td>
                      <td className={`px-3 py-2 text-right font-medium ${r.isFirst ? 'text-slate-600' : r.pct > 0 ? 'text-emerald-400' : r.pct < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {r.isFirst ? '—' : `${r.pct >= 0 ? '+' : ''}${r.pct.toFixed(1)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details className="text-[11px] text-slate-600">
            <summary className="cursor-pointer hover:text-slate-400">Por empresa (posição mais recente até {last.label})</summary>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(last.porEmpresa)
                .filter(([, v]) => v !== 0)
                .sort((a, b) => b[1] - a[1])
                .map(([cc, v]) => {
                  const name = COMPANIES.find(c => c.id === cc)?.name || cc;
                  return (
                    <div key={cc} className="bg-slate-800/40 rounded px-2 py-1.5">
                      <p className="text-slate-500">{name}</p>
                      <p className="text-slate-300 font-medium">{formatCurrency(v)}</p>
                    </div>
                  );
                })}
            </div>
          </details>
        </>
      )}
    </div>
  );
};
