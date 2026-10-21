import React, { useMemo } from 'react';
import { Transaction, TransactionType } from '../types';
import { ApplicationSnapshot } from '../hooks/useApplicationSnapshots';
import { COMPANIES, BANKS_MAPPING, formatCurrency, parseDate } from '../utils/finance';

interface Props {
  transactions: Transaction[];
  dfcManualValues: Record<string, number>;
  applicationSnapshots: ApplicationSnapshot[];
  onManualValueChange: (key: string, value: number) => void;
}

/**
 * Tela "Sugestão de Aplicação / Resgate" (PREVISÃO) — por empresa:
 *   saldo em banco + a receber previsto − a pagar previsto = saldo projetado.
 * Comparado à reserva mínima cadastrada de cada empresa → sugere aplicar o
 * excedente ou resgatar a diferença. Antes era uma página do Demonstrativo.
 */
export const SuggestionView: React.FC<Props> = ({ transactions, dfcManualValues, applicationSnapshots, onManualValueChange }) => {
  const rows = useMemo(() => {
    const norm = (c: any) => (String(c ?? '').replace(/^0+/, '') || '0');
    const latestCloseFor = (companyId: string, bankId: string): number => {
      const prefix = `sim_close_${companyId}_${bankId}_`;
      let best = 0, bestT = -Infinity;
      for (const k of Object.keys(dfcManualValues || {})) {
        if (!k.startsWith(prefix)) continue;
        const t = parseDate(k.slice(prefix.length));
        if (t && t > bestT) { bestT = t; best = Number(dfcManualValues[k]) || 0; }
      }
      return best;
    };
    const lastSnap = (applicationSnapshots && applicationSnapshots.length)
      ? [...applicationSnapshots].sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))[0]
      : null;
    const aplicPorEmpresa: Record<string, number> = (lastSnap && lastSnap.porEmpresa) || {};

    return COMPANIES.map(co => {
      const banco = (BANKS_MAPPING[co.id] || []).reduce((s, b) => s + latestCloseFor(co.id, b.id), 0);
      let receber = 0, pagar = 0;
      transactions.forEach(t => {
        if (norm(t.companyCode) !== norm(co.id)) return;
        if (t.status !== 'PREVISTO') return;
        const v = Number(t.value) || 0;
        if (t.type === TransactionType.RECEIVABLE) receber += v;
        else if (t.type === TransactionType.PAYABLE) pagar += v;
      });
      const projetado = banco + receber - pagar;
      const reserva = Number(dfcManualValues?.[`reserva_min_${co.id}`]) || 0;
      const excedente = projetado - reserva;
      const aplicacoes = Number(aplicPorEmpresa[co.id] ?? aplicPorEmpresa[norm(co.id)] ?? 0);
      return { id: co.id, name: co.name, banco, receber, pagar, projetado, reserva, excedente, aplicacoes };
    });
  }, [transactions, dfcManualValues, applicationSnapshots]);

  const totals = useMemo(() => {
    const aplicar = rows.filter(r => r.excedente > 0).reduce((s, r) => s + r.excedente, 0);
    const resgatar = rows.filter(r => r.excedente < 0).reduce((s, r) => s + Math.abs(r.excedente), 0);
    return { aplicar, resgatar, liquido: aplicar - resgatar };
  }, [rows]);

  const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((s, r) => s + f(r), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-slate-100">Sugestão de Aplicação / Resgate</h2>
        <span className="text-[11px] font-bold tracking-wider text-amber-300 bg-amber-900/30 border border-amber-700/50 rounded-full px-3 py-0.5">Previsão</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Total a Aplicar</p>
          <p className="text-2xl font-extrabold text-emerald-400">{formatCurrency(totals.aplicar)}</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Total a Resgatar</p>
          <p className="text-2xl font-extrabold text-rose-400">{formatCurrency(totals.resgatar)}</p>
        </div>
        <div className="bg-slate-800/60 border border-slate-700 rounded-lg px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Efeito líquido no caixa</p>
          <p className="text-2xl font-extrabold text-slate-100">{formatCurrency(totals.liquido)}</p>
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-200">
              <th className="text-left px-3 py-2 font-bold">Empresa</th>
              <th className="text-right px-3 py-2 font-bold">Saldo Banco</th>
              <th className="text-right px-3 py-2 font-bold">(+) A Receber</th>
              <th className="text-right px-3 py-2 font-bold">(−) A Pagar</th>
              <th className="text-right px-3 py-2 font-bold">Saldo Projetado</th>
              <th className="text-right px-3 py-2 font-bold">Reserva Mín.</th>
              <th className="text-left px-3 py-2 font-bold">Sugestão</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-slate-800">
                <td className="px-3 py-2 font-semibold text-slate-100">{r.name}</td>
                <td className="px-3 py-2 text-right text-slate-300">{formatCurrency(r.banco)}</td>
                <td className="px-3 py-2 text-right text-emerald-400">{formatCurrency(r.receber)}</td>
                <td className="px-3 py-2 text-right text-rose-400">{formatCurrency(r.pagar)}</td>
                <td className="px-3 py-2 text-right font-bold text-slate-100">{formatCurrency(r.projetado)}</td>
                <td className="px-3 py-2 text-right">
                  <input
                    type="number"
                    value={r.reserva || ''}
                    placeholder="0"
                    onChange={e => onManualValueChange(`reserva_min_${r.id}`, parseFloat(e.target.value) || 0)}
                    className="w-28 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-right text-slate-200 text-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  {r.excedente > 1 ? (
                    <span className="font-bold text-emerald-400 bg-emerald-900/30 rounded px-2 py-1 whitespace-nowrap">Aplicar {formatCurrency(r.excedente)}</span>
                  ) : r.excedente < -1 ? (
                    <span className="font-bold text-rose-400 bg-rose-900/30 rounded px-2 py-1 whitespace-nowrap">Resgatar {formatCurrency(Math.abs(r.excedente))}</span>
                  ) : (
                    <span className="font-medium text-slate-400 bg-slate-800/60 rounded px-2 py-1 whitespace-nowrap">Dentro da reserva</span>
                  )}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-600 bg-slate-800/60">
              <td className="px-3 py-2 font-extrabold text-slate-100">CONSOLIDADO</td>
              <td className="px-3 py-2 text-right font-bold text-slate-200">{formatCurrency(sum(r => r.banco))}</td>
              <td className="px-3 py-2 text-right font-bold text-emerald-400">{formatCurrency(sum(r => r.receber))}</td>
              <td className="px-3 py-2 text-right font-bold text-rose-400">{formatCurrency(sum(r => r.pagar))}</td>
              <td className="px-3 py-2 text-right font-extrabold text-slate-100">{formatCurrency(sum(r => r.projetado))}</td>
              <td className="px-3 py-2 text-right font-bold text-slate-200">{formatCurrency(sum(r => r.reserva))}</td>
              <td className="px-3 py-2 font-extrabold text-slate-100 whitespace-nowrap">Aplicar líq. {formatCurrency(totals.liquido)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500 italic">
        Previsão baseada no saldo de banco de cada empresa + títulos previstos (a receber e a pagar) do período, comparado à reserva mínima cadastrada de cada empresa. Não é recomendação de investimento — valide antes de executar.
      </p>
    </div>
  );
};

export default SuggestionView;
