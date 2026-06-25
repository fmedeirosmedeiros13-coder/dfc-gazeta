import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, Check, X } from 'lucide-react';

interface Option {
  label: string;
  value: string;
}

interface MultiSelectProps {
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  selected,
  onChange,
  placeholder = "Selecionar"
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filtrar opções baseado na busca
  const filteredOptions = useMemo(() => {
    if (!searchTerm) return options;
    const lowerTerm = searchTerm.toLowerCase();
    return options.filter(opt => 
      opt.label.toLowerCase().includes(lowerTerm)
    );
  }, [options, searchTerm]);

  // Verificar se todos os visíveis estão selecionados
  const allVisibleSelected = useMemo(() => {
    if (filteredOptions.length === 0) return false;
    return filteredOptions.every(opt => selected.includes(opt.value));
  }, [filteredOptions, selected]);

  // Handler para Selecionar Todos
  const handleSelectAll = () => {
    if (allVisibleSelected) {
      // Desmarcar todos os visíveis
      const visibleValues = new Set(filteredOptions.map(o => o.value));
      const newSelected = selected.filter(v => !visibleValues.has(v));
      onChange(newSelected);
    } else {
      // Marcar todos os visíveis
      const newSelected = [...selected];
      filteredOptions.forEach(opt => {
        if (!newSelected.includes(opt.value)) {
          newSelected.push(opt.value);
        }
      });
      onChange(newSelected);
    }
  };

  // Handler para seleção individual
  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  // Limpar seleção
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* Botão Principal */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm text-left bg-[#1e293b] border border-slate-700 rounded-md hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-200 transition-colors"
      >
        <span className="truncate mr-2">
          {selected.length === 0 
            ? placeholder 
            : selected.length === options.length 
              ? "Todos selecionados"
              : `${selected.length} selecionado(s)`}
        </span>
        <div className="flex items-center gap-1">
          {selected.length > 0 && (
            <div 
              onClick={handleClear}
              className="p-0.5 hover:bg-slate-700 rounded-full cursor-pointer text-slate-400 hover:text-white transition-colors"
              title="Limpar filtro"
            >
              <X size={14} />
            </div>
          )}
          <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[#1e293b] border border-slate-700 rounded-md shadow-xl max-h-[400px] flex flex-col">
          
          {/* Campo de Busca */}
          <div className="p-2 border-b border-slate-700 sticky top-0 bg-[#1e293b] z-10">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar..."
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-[#0f172a] border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>
          </div>

          {/* Lista de Opções */}
          <div className="overflow-y-auto flex-1 p-1 custom-scrollbar">
            {/* Opção Selecionar Todos */}
            {filteredOptions.length > 0 && (
              <div 
                onClick={handleSelectAll}
                className="flex items-center px-2 py-1.5 cursor-pointer hover:bg-slate-700/50 rounded text-sm text-slate-200 select-none group"
              >
                <div className={`
                  w-4 h-4 mr-2 rounded border flex items-center justify-center transition-colors
                  ${allVisibleSelected 
                    ? 'bg-blue-600 border-blue-600' 
                    : 'border-slate-600 group-hover:border-slate-500'}
                `}>
                  {allVisibleSelected && <Check size={12} className="text-white" />}
                </div>
                <span className="font-medium">(Selecionar Tudo)</span>
              </div>
            )}

            {/* Lista Filtrada */}
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-slate-500">
                Nenhum resultado encontrado
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <div
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className="flex items-center px-2 py-1.5 cursor-pointer hover:bg-slate-700/50 rounded text-sm text-slate-300 select-none group"
                  >
                    <div className={`
                      w-4 h-4 mr-2 rounded border flex items-center justify-center transition-colors
                      ${isSelected 
                        ? 'bg-blue-600 border-blue-600' 
                        : 'border-slate-600 group-hover:border-slate-500'}
                    `}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                    <span className="truncate">{option.label}</span>
                  </div>
                );
              })
            )}
          </div>
          
          {/* Rodapé com contagem */}
          <div className="px-3 py-2 border-t border-slate-700 text-xs text-slate-500 bg-[#1e293b] rounded-b-md flex justify-between">
            <span>{selected.length} selecionado(s)</span>
            <span>Total: {options.length}</span>
          </div>
        </div>
      )}
    </div>
  );
};
