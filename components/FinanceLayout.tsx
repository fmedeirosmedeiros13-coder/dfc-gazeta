import React from 'react';

interface FinanceLayoutProps {
  col1: React.ReactNode;
  col2: React.ReactNode;
  col3: React.ReactNode;
  col4: React.ReactNode;
  col5: React.ReactNode;
  className?: string;
  isSlide?: boolean;
}

export const FinanceLayout: React.FC<FinanceLayoutProps> = ({ col1, col2, col3, col4, col5, className = '', isSlide = false }) => {
  // No slide (Demonstrativo): altura FIXA de 420px, igual ao tamanho do
  // export (16:9) — as colunas cortam o que passar (overflow-hidden) para não
  // estourar. Cada painel mostra só os itens que cabem. Na tela normal (app):
  // altura maior com rolagem.
  const heightClass = isSlide ? 'h-[420px] items-stretch' : 'h-[600px]';
  const colClass = 'overflow-hidden min-h-0';
  return (
    <div className={`grid grid-cols-12 gap-4 ${heightClass} ${className}`}>
      {/* Col 1: Lista 1 */}
      <div className={`col-span-3 ${colClass}`}>
        {col1}
      </div>
      
      {/* Col 2: Lista 2 */}
      <div className={`col-span-3 ${colClass}`}>
        {col2}
      </div>
      
      {/* Col 3: Cards Empilhados */}
      <div className={`col-span-2 ${colClass}`}>
        {col3}
      </div>
      
      {/* Col 4: Gráfico */}
      <div className={`col-span-3 ${colClass}`}>
        {col4}
      </div>
      
      {/* Col 5: VL Dia */}
      <div className={`col-span-1 ${colClass}`}>
        {col5}
      </div>
    </div>
  );
};
