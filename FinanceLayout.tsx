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
  // No slide: altura fixa pra caber no 16:9. Na tela: altura maior pra mostrar mais conteúdo.
  const heightClass = isSlide ? 'h-[420px]' : 'h-[600px]';
  return (
    <div className={`grid grid-cols-12 gap-4 ${heightClass} ${className}`}>
      {/* Col 1: Lista 1 */}
      <div className="col-span-3 overflow-hidden min-h-0">
        {col1}
      </div>
      
      {/* Col 2: Lista 2 */}
      <div className="col-span-3 overflow-hidden min-h-0">
        {col2}
      </div>
      
      {/* Col 3: Cards Empilhados */}
      <div className="col-span-2 overflow-hidden min-h-0">
        {col3}
      </div>
      
      {/* Col 4: Gráfico */}
      <div className="col-span-3 overflow-hidden min-h-0">
        {col4}
      </div>
      
      {/* Col 5: VL Dia */}
      <div className="col-span-1 overflow-hidden min-h-0">
        {col5}
      </div>
    </div>
  );
};
