import { useMemo } from 'react';
import { Transaction, TransactionType } from '../types';

export interface TransactionFilters {
  empresa: string;
  fornecedor: string[];
  cliente: string[];
  tipoFluxo: string;
  dataDe?: string;
  dataAte?: string;
}

export function useTransactionFilters(
  transactions: Transaction[],
  filtros: TransactionFilters,
  activeType: TransactionType
) {
  return useMemo(() => {
    return transactions.filter(t => {
      // 1. Filtrar por tipo
      if (t.type !== activeType) {
        return false;
      }

      // 2. Empresa
      if (filtros.empresa !== 'all' && t.companyCode !== filtros.empresa) {
        return false;
      }

      // 3. Fornecedor
      if (filtros.fornecedor.length > 0) {
        if (activeType === TransactionType.PAYABLE) {
          const supplierCode = t.supplierCode || '';
          if (!filtros.fornecedor.includes(supplierCode)) return false;
        } else if (activeType !== TransactionType.RECEIVABLE) {
           // Para outros tipos que usam fornecedor
           const code = t.supplierCode || t.description || '';
           if (!filtros.fornecedor.includes(code)) return false;
        }
      }

      // 4. Cliente (Apenas Recebimentos)
      if (activeType === TransactionType.RECEIVABLE && filtros.cliente.length > 0) {
          const customerCode = t.customerCode || '';
          if (!filtros.cliente.includes(customerCode)) return false;
      }

      // 5. Tipo de Fluxo
      if (filtros.tipoFluxo !== 'all' && filtros.tipoFluxo !== '') {
        const flowCode = t.flowTypeCode || '';
        if (flowCode !== filtros.tipoFluxo) return false;
      }

      // 5. Período
      if (filtros.dataDe || filtros.dataAte) {
        // Assumindo formato dd/mm/yyyy nas transações
        const parseDate = (d: string) => {
          if (!d) return 0;
          const parts = d.split('/');
          if (parts.length === 3) {
            const [day, month, year] = parts;
            return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
          }
          return new Date(d).getTime();
        };
        
        const tTime = parseDate(t.date);
        
        if (filtros.dataDe) {
          const start = new Date(filtros.dataDe).getTime();
          if (tTime < start) return false;
        }
        if (filtros.dataAte) {
          const end = new Date(filtros.dataAte).getTime();
          if (tTime > end) return false;
        }
      }

      return true;
    });
  }, [transactions, filtros, activeType]);
}
