import React from 'react';
import { Transaction, TransactionType } from '../types';
import { Pencil, Trash2, Check } from 'lucide-react';
import { classifyTax } from '../utils/finance';

interface LancamentosProps {
  transactions: Transaction[];
  onEdit: (t: Transaction) => void;
  onDelete: (id: string) => void;
  activeTab?: string; // Opcional, para manter compatibilidade visual se necessário, ou para decidir colunas
}

export const Lancamentos: React.FC<LancamentosProps> = ({ transactions, onEdit, onDelete, activeTab }) => {
  
  // Helper para decidir qual cabeçalho mostrar. 
  // Se tivermos tipos misturados, precisamos de uma estratégia.
  // O usuário pediu filtro "todos | pagamentos | recebimentos".
  // Se "todos", vamos mostrar um layout genérico ou tentar inferir.
  // Por simplicidade, vamos verificar o tipo do primeiro item ou usar um layout padrão unificado se misturado.
  
  const hasPayables = transactions.some(t => t.type === TransactionType.PAYABLE);
  const hasReceivables = transactions.some(t => t.type === TransactionType.RECEIVABLE);
  const isMixed = hasPayables && hasReceivables;
  
  // Se a lista estiver vazia, mostramos mensagem
  if (transactions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500">
        <p>Nenhum registro encontrado.</p>
      </div>
    );
  }

  // Definindo o modo de visualização da tabela
  // Se for misturado ou "todos", usamos um layout mais genérico.
  // Se for só pagamentos, layout de pagamentos.
  // Se for só recebimentos, layout de recebimentos.
  // Aplicações, Calendário e Tipo Fluxo têm layouts específicos.
  
  // Vamos tentar detectar o "modo predominante" ou usar o activeTab se passado, 
  // mas o filtro de tipo deve ter precedência.
  
  // Para simplificar e atender ao pedido "Não alterar estrutura do sistema", 
  // vamos tentar manter os layouts existentes.
  
  const renderHeader = () => {
    // Se todos os itens forem do mesmo tipo, usa o cabeçalho específico
    const firstType = transactions[0].type;
    const allSameType = transactions.every(t => t.type === firstType);

    if (allSameType) {
        if (firstType === TransactionType.PAYABLE) {
            return (
                <thead className="bg-slate-800/50 border-b border-slate-700 text-slate-300 font-bold uppercase sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 border-r border-slate-700 min-w-[80px]">Dt Prev Pagt</th>
                      <th className="px-2 py-2 border-r border-slate-700">Empresa</th>
                      <th className="px-2 py-2 border-r border-slate-700">Fornecedor</th>
                      <th className="px-2 py-2 border-r border-slate-700 min-w-[200px]">Nome Fornecedor</th>
                      <th className="px-2 py-2 border-r border-slate-700">Espécie</th>
                      <th className="px-2 py-2 border-r border-slate-700">Titulo</th>
                      <th className="px-2 py-2 border-r border-slate-700">Parc</th>
                      <th className="px-2 py-2 border-r border-slate-700">Tipo de Fluxo</th>
                      <th className="px-2 py-2 border-r border-slate-700 min-w-[150px]">Nome Tipo de Fluxo</th>
                      <th className="px-2 py-2 bg-yellow-900/20 border-r border-slate-700 text-right min-w-[100px]">Valor</th>
                      <th className="px-2 py-2 border-r border-slate-700 bg-yellow-900/10">Fluxo N2</th>
                      <th className="px-2 py-2 text-center">Ação</th>
                    </tr>
                </thead>
            );
        } else if (firstType === TransactionType.RECEIVABLE) {
            return (
                <thead className="bg-emerald-900/20 border-b border-emerald-900/30 text-emerald-300 font-bold uppercase sticky top-0 z-10">
                     <tr>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Dt Prev</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Emp</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Estab</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Cliente (Cód)</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 min-w-[150px]">Nome Cliente</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Esp</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Sér</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Título</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Parc</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Cart</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">UN</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 min-w-[120px]">Nome UN</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Tp Fluxo</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 min-w-[120px]">Nome Tp Fluxo</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Dt Emissão</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Dt Venc</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30">Dt Liq</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 text-right">Vl Saldo</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 text-right">Vl Orig</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 text-right font-bold bg-emerald-900/40">Vl Consid</th>
                       <th className="px-2 py-2 border-r border-emerald-900/30 bg-yellow-900/10">Fluxo Nível 2</th>
                       <th className="px-2 py-2 text-center">Ação</th>
                     </tr>
                </thead>
            );
        } else if (firstType === TransactionType.CALENDAR) {
            return (
                  <thead className="bg-purple-900/20 border-b border-purple-900/30 text-purple-300 font-bold uppercase sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 border-r border-purple-900/30 min-w-[80px]">Dt Prev Pagt</th>
                      <th className="px-2 py-2 border-r border-purple-900/30">Empresa</th>
                      <th className="px-2 py-2 border-r border-purple-900/30">Fornecedor</th>
                      <th className="px-2 py-2 border-r border-purple-900/30 min-w-[200px]">Nome Fornecedor</th>
                      <th className="px-2 py-2 border-r border-purple-900/30">Espécie</th>
                      <th className="px-2 py-2 border-r border-purple-900/30">Título</th>
                      <th className="px-2 py-2 border-r border-purple-900/30">Tipo de Fluxo</th>
                      <th className="px-2 py-2 bg-yellow-900/20 border-r border-purple-900/30 text-right min-w-[100px]">Valor</th>
                      <th className="px-2 py-2 border-r border-purple-900/30 bg-yellow-900/10">Fluxo N2</th>
                      <th className="px-2 py-2 border-r border-purple-900/30 text-center">Check</th>
                      <th className="px-2 py-2 text-center">Ação</th>
                    </tr>
                  </thead>
            );
        } else if (firstType === TransactionType.FLOW_TYPE) {
            return (
                   <thead className="bg-orange-900/20 border-b border-orange-900/30 text-orange-300 font-bold uppercase sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-3 border-r border-orange-900/30">Conta TOTVS</th>
                      <th className="px-4 py-3 border-r border-orange-900/30">Fluxo Nível 3</th>
                      <th className="px-4 py-3 border-r border-orange-900/30">Fluxo Nível 2</th>
                      <th className="px-4 py-3 border-r border-orange-900/30">Descrição</th>
                      <th className="px-4 py-3 border-r border-orange-900/30">Seção</th>
                      <th className="px-4 py-3 border-r border-orange-900/30">Fluxo</th>
                      <th className="px-4 py-3 text-center">Ação</th>
                    </tr>
                  </thead>
            );
        } else if (firstType === TransactionType.APPLICATION) {
            return (
                   <thead className="bg-blue-900/20 border-b border-blue-900/30 text-blue-300 font-bold uppercase sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 border-r border-blue-900/30">Operação</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Data</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Vencimento</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Empresa</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Banco</th>
                      <th className="px-2 py-2 border-r border-blue-900/30 min-w-[130px]">C/C Padrão</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Produto</th>
                      <th className="px-2 py-2 border-r border-blue-900/30">Situação</th>
                      <th className="px-2 py-2 text-right min-w-[100px]">Valor</th>
                      <th className="px-2 py-2 text-center">Ação</th>
                    </tr>
                  </thead>
            );
        }
    }

    // Fallback para misto ou outros tipos (genérico)
    return (
        <thead className="bg-slate-800/50 border-b border-slate-700 text-slate-400 uppercase sticky top-0 z-10">
            <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Descrição / Nome</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Ação</th>
            </tr>
        </thead>
    );
  };

  const renderRow = (t: Transaction) => {
      // Renderização condicional baseada no tipo da transação individual
      if (t.type === TransactionType.PAYABLE) {
          return (
            <>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.date}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.companyCode}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.supplierCode}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 font-medium truncate max-w-[200px] text-slate-300" title={t.supplier}>{t.supplier}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.species}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.documentNumber}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.installment}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.flowTypeCode}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 truncate max-w-[150px] text-slate-300">
                {t.category}
                {(() => {
                  const tax = classifyTax(t);
                  if (!tax) return null;
                  const cfg = tax === 'FEDERAL' ? { label: 'FED ↑', cls: 'bg-blue-900/40 text-blue-300 border-blue-700/50', title: 'Imposto Federal — antecipa' }
                            : tax === 'ESTADUAL' ? { label: 'EST ↓', cls: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/50', title: 'Imposto Estadual — posterga' }
                            : { label: 'MUN ↓', cls: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/50', title: 'Imposto Municipal — posterga' };
                  return <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-bold border ${cfg.cls}`} title={cfg.title}>{cfg.label}</span>;
                })()}
              </td>
              <td className="px-2 py-2 bg-yellow-900/20 text-right font-bold text-slate-200">
                {t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center bg-yellow-900/10 font-mono text-slate-400">{t.flowTypeLevel2}</td>
            </>
          );
      } else if (t.type === TransactionType.RECEIVABLE) {
          return (
              <>
                <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.date}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.companyCode}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.establishment}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.customerCode}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 truncate max-w-[150px] text-slate-300" title={t.customer}>{t.customer}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.species}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.series}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.documentNumber}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.installment}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.portfolio}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.businessUnitCode}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 truncate max-w-[100px] text-slate-300">{t.businessUnit}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.flowTypeCode}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 truncate max-w-[100px] text-slate-300">{t.category}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.emissionDate}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.dueDate}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.liquidationDate}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-right text-slate-300">{t.balanceTitleValue?.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                <td className="px-2 py-2 border-r border-slate-800/50 text-right text-slate-300">{t.originalTitleValue?.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
                <td className="px-2 py-2 bg-emerald-900/40 text-right font-bold text-emerald-400">
                    {t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-2 py-2 border-r border-slate-800/50 bg-yellow-900/10 text-center font-mono text-slate-400">{t.flowTypeLevel2}</td>
              </>
          );
      } else if (t.type === TransactionType.CALENDAR) {
          return (
            <>
               <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.date}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.companyCode}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.supplierCode}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 font-medium truncate max-w-[200px] text-slate-300" title={t.supplier}>{t.supplier}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.species}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.documentNumber}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.flowTypeCode}</td>
               <td className="px-2 py-2 bg-yellow-900/20 text-right font-bold border-r border-slate-800/50 text-slate-200">{t.value > 0 ? t.value.toLocaleString('pt-BR', {minimumFractionDigits: 2}) : '-'}</td>
               <td className="px-2 py-2 border-r border-slate-800/50 text-center bg-yellow-900/10 font-mono text-slate-400">{t.flowTypeLevel2}</td>
               <td className={`px-2 py-2 text-center border-r border-slate-800/50 font-bold ${t.calendarStatus === 'GERADO' ? 'text-blue-400' : t.calendarStatus === 'OK' ? (t.calendarValueDivergence ? 'bg-amber-900/20 text-amber-400' : 'bg-green-900/20 text-green-400') : 'text-slate-500'}`}
                   title={t.calendarValueDivergence ? 'Pagamento real encontrado, mas o valor diverge da média do calendário em mais de 30%' : undefined}>
                   {t.calendarStatus === 'OK'
                       ? <span className="flex items-center gap-1 justify-center">
                             <Check className="w-3 h-3"/> OK{t.calendarValueDivergence ? ' ⚠️ valor diverge' : ''}
                         </span>
                       : (t.calendarStatus || '-')}
               </td>
            </>
          );
      } else if (t.type === TransactionType.FLOW_TYPE) {
          return (
             <>
               <td className="px-4 py-3 border-r border-slate-800/50 font-mono text-slate-400">{t.accountCode || '-'}</td>
               <td className="px-4 py-3 border-r border-slate-800/50 font-mono font-bold text-orange-400">{t.flowTypeCode}</td>
               <td className="px-4 py-3 border-r border-slate-800/50 font-mono text-slate-400">{t.species}</td>
               <td className="px-4 py-3 border-r border-slate-800/50 text-slate-300 font-medium">{t.description}</td>
               <td className="px-4 py-3 border-r border-slate-800/50 text-slate-400">{t.category}</td>
               <td className="px-4 py-3 border-r border-slate-800/50 text-slate-400">
                 <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.costCenter?.toUpperCase().includes('ENTRADA') ? 'bg-emerald-900/20 text-emerald-400' : 'bg-red-900/20 text-red-400'}`}>
                    {t.costCenter}
                 </span>
               </td>
             </>
          );
      } else if (t.type === TransactionType.APPLICATION) {
          return (
            <>
              <td className="px-2 py-2 border-r border-slate-800/50 font-mono text-slate-300">{t.documentNumber || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.emissionDate || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.dueDate || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center text-slate-300">{t.companyCode || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-center font-mono text-slate-400">{t.accountCode || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-300">{t.establishment || '-'}</td>
              <td className="px-2 py-2 border-r border-slate-800/50"><span className="bg-slate-800 px-2 py-1 rounded text-[10px] text-slate-300">{t.category || '-'}</span></td>
              <td className="px-2 py-2 border-r border-slate-800/50 text-slate-400">{t.species || '-'}</td>
              <td className="px-2 py-2 text-right font-bold text-blue-400">
                {t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </td>
            </>
          );
      } else {
          // Genérico (Fallback)
          return (
            <>
               <td className="px-4 py-3 text-slate-300">{t.date}</td>
               <td className="px-4 py-3 text-slate-300 text-xs">{t.type}</td>
               <td className="px-4 py-3 font-bold text-slate-400 text-center">{t.companyCode || '-'}</td>
              <td className="px-4 py-3 font-medium text-slate-300">{t.description}</td>
              <td className="px-4 py-3"><span className="bg-slate-800 px-2 py-1 rounded text-xs text-slate-300">{t.category}</span></td>
              <td className="px-4 py-3 text-right font-bold text-blue-400">
                {t.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </td>
            </>
          );
      }
  };

  return (
    <table className="w-full text-xs text-left whitespace-nowrap">
      {renderHeader()}
      <tbody className="divide-y divide-slate-800/50">
        {transactions.map((t) => (
          <tr
            key={t.id}
            title={t.generatedFromCalendarId ? 'Gerado pelo Calendário (criado após a importação do previsto)' : undefined}
            className={`transition-colors ${t.generatedFromCalendarId ? 'bg-violet-500/10 hover:bg-violet-500/20 border-l-2 border-violet-400/50' : 'hover:bg-slate-800/40'}`}
          >
            {renderRow(t)}
            <td className="px-2 py-2 text-center min-w-[60px]">
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => onEdit(t)} className="text-slate-500 hover:text-blue-400 cursor-pointer" title="Editar">
                   <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => onDelete(t.id)} className="text-slate-500 hover:text-red-400 cursor-pointer" title="Excluir">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
