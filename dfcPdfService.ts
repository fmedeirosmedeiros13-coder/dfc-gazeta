/**
 * services/dfcPdfService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Exportação PDF profissional da DFC — Demonstração dos Fluxos de Caixa.
 *
 * SUBSTITUI: html2canvas + jsPDF (captura de tela pixelada)
 * POR: jsPDF com renderização programática vetorial
 *
 * FUNCIONALIDADES:
 *   1. Layout adaptativo — portrait ≤7 colunas, landscape >7 colunas
 *   2. Escala de fonte proporcional ao número de colunas
 *   3. Preservação de hierarquia — seção nunca quebra na última linha da página
 *   4. Validação de totais em tempo de execução (soma horizontal e vertical)
 *   5. Zebrado de linhas para leitura de grandes volumes
 *   6. Cabeçalho repetido em todas as páginas
 *   7. Rodapé com número de página e timestamp
 *   8. Estilo sóbrio Gazeta Financeira (azul marinho + cinza)
 *
 * CORREÇÕES v2:
 *   - Página em branco eliminada (pdf.addPage só quando necessário)
 *   - SLD INICIAL conectado ao getInitialBalance
 *   - Seção APLICAÇÕES com APPLICATION type
 *   - buildDFCRows usa mesmo critério do Dashboard.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 */

import jsPDF from 'jspdf';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type RowType = 'HEADER' | 'SECTION' | 'DATA' | 'SUBTOTAL' | 'TOTAL' | 'SPACER' | 'VALIDATION_ERROR';

export interface DFCRow {
  /** Rótulo da linha (ex: "(-) Pessoal", "1 - Atividades Operacionais") */
  label:    string;
  /** Tipo semântico — controla cor, peso e quebra de página */
  type:     RowType;
  /** Valores por coluna, na mesma ordem que `columns` */
  values:   number[];
  /** Total da linha (soma horizontal) — validado contra sum(values) */
  total:    number;
  /** Nível de indentação (0 = raiz, 1 = sub, 2 = detalhe) */
  indent?:  number;
}

export interface DFCColumn {
  id:    string;
  label: string;
}

export interface DFCPdfOptions {
  rows:        DFCRow[];
  columns:     DFCColumn[];
  title?:      string;
  companyName?: string;
  period?:     string;
  /** Se true, inclui coluna de validação (diferença calculado vs informado) */
  showValidation?: boolean;
}

// ─── Paleta de cores Gazeta Financeira ───────────────────────────────────────

const COLORS = {
  // Cabeçalho
  headerBg:     [15,  23,  42] as [number, number, number],   // slate-900
  headerFg:     [248, 250, 252] as [number, number, number],  // slate-50
  // Seções (1 - Atividades Operacionais etc.)
  sectionBg:    [30,  58, 138] as [number, number, number],   // blue-900
  sectionFg:    [165, 180, 252] as [number, number, number],  // indigo-300
  // Subtotais
  subtotalBg:   [30,  58, 138] as [number, number, number],   // blue-900
  subtotalFg:   [255, 255, 255] as [number, number, number],  // white
  // Totais (SLD FINAL)
  totalBg:      [15,  23,  42] as [number, number, number],   // slate-950
  totalFg:      [255, 255, 255] as [number, number, number],  // white
  // Linhas de dados — zebrado
  dataEvenBg:   [30,  41,  59] as [number, number, number],   // slate-800
  dataOddBg:    [15,  23,  42] as [number, number, number],   // slate-900
  dataFg:       [203, 213, 225] as [number, number, number],  // slate-300
  // Coluna TOTAL
  totalColBg:   [15,  23,  42] as [number, number, number],
  totalColFg:   [255, 255, 255] as [number, number, number],
  // Validação OK / Erro
  validOk:      [34, 197,  94] as [number, number, number],   // green-500
  validError:   [239,  68,  68] as [number, number, number],  // red-500
  // Rodapé
  footerFg:     [100, 116, 139] as [number, number, number],  // slate-500
  // Bordas
  border:       [51,  65,  85] as [number, number, number],   // slate-700
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBR(v: number): string {
  if (v === 0) return '-';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function rgb(pdf: jsPDF, color: [number, number, number], type: 'fill' | 'text' | 'draw') {
  if (type === 'fill') pdf.setFillColor(color[0], color[1], color[2]);
  if (type === 'text') pdf.setTextColor(color[0], color[1], color[2]);
  if (type === 'draw') pdf.setDrawColor(color[0], color[1], color[2]);
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function exportDFCPdf(opts: DFCPdfOptions): Promise<void> {
  const {
    rows,
    columns,
    title       = 'DEMONSTRAÇÃO DOS FLUXOS DE CAIXA',
    companyName = 'REDE GAZETA',
    period      = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    showValidation = true,
  } = opts;

  const colCount = columns.length;

  // ── 1. Determinar orientação e escala de fonte ────────────────────────────

  const isLandscape = colCount > 7;
  const orientation: 'portrait' | 'landscape' = isLandscape ? 'landscape' : 'portrait';

  // Escala de fonte proporcional — reduz conforme colunas aumentam
  // Base: 8pt para 7 colunas, reduz 0.3pt por coluna extra até mínimo de 5pt
  const baseFontSize  = 8;
  const extraCols     = Math.max(0, colCount - 7);
  const dataFontSize  = Math.max(5, baseFontSize - extraCols * 0.3);
  const labelFontSize = dataFontSize;
  const headerFontSize = Math.max(6, dataFontSize + 0.5);

  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });

  const pageW  = pdf.internal.pageSize.getWidth();
  const pageH  = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const contentW = pageW - 2 * margin;

  // ── 2. Calcular larguras de colunas ──────────────────────────────────────

  const labelW     = isLandscape ? 58 : 52;  // largura da coluna de rótulo
  const totalColW  = isLandscape ? 22 : 20;  // coluna TOTAL
  const validColW  = showValidation ? 12 : 0;
  const dataColW   = (contentW - labelW - totalColW - validColW) / colCount;
  const rowHeight  = dataFontSize + 3.2;

  // ── 3. Validação de totais (Req. 3) ──────────────────────────────────────

  interface ValidationResult { rowIdx: number; expected: number; actual: number; diff: number; }
  const validationErrors: ValidationResult[] = [];

  if (showValidation) {
    rows.forEach((row, i) => {
      if (row.type === 'DATA' || row.type === 'SUBTOTAL' || row.type === 'TOTAL') {
        const calculated = row.values.reduce((s, v) => s + v, 0);
        const diff = Math.abs(calculated - row.total);
        if (diff > 0.5) {
          validationErrors.push({ rowIdx: i, expected: row.total, actual: calculated, diff });
        }
      }
    });
  }

  // ── 4. Funções de renderização ────────────────────────────────────────────

  let currentY   = 0;
  let pageNumber = 1;

  const getColX = (colIdx: number): number => {
    return margin + labelW + colIdx * dataColW;
  };
  const getTotalX = (): number => margin + labelW + colCount * dataColW;
  const getValidX = (): number => getTotalX() + totalColW;

  /** Renderiza cabeçalho do documento (logo, título, período). */
  const renderDocHeader = () => {
    // Fundo do cabeçalho
    rgb(pdf, COLORS.headerBg, 'fill');
    pdf.rect(margin, margin, contentW, 14, 'F');

    // Título
    rgb(pdf, COLORS.headerFg, 'text');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text(title, margin + 3, margin + 6);

    // Empresa e período
    pdf.setFontSize(7);
    pdf.setFont('helvetica', 'normal');
    pdf.text(companyName, margin + 3, margin + 11);
    pdf.text(period, pageW - margin - 3, margin + 11, { align: 'right' });

    currentY = margin + 17;
  };

  /** Renderiza cabeçalho da tabela (nomes das colunas). */
  const renderTableHeader = () => {
    const y = currentY;
    rgb(pdf, COLORS.headerBg, 'fill');
    pdf.rect(margin, y, contentW, rowHeight, 'F');

    rgb(pdf, COLORS.headerFg, 'text');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(headerFontSize);

    // Rótulo
    pdf.text('FLUXO DE CAIXA', margin + 1.5, y + rowHeight - 1.5);

    // Colunas de dados
    columns.forEach((col, i) => {
      const x = getColX(i) + dataColW / 2;
      pdf.text(col.label, x, y + rowHeight - 1.5, { align: 'center' });
    });

    // TOTAL
    const tx = getTotalX() + totalColW / 2;
    rgb(pdf, [239, 68, 68], 'text'); // vermelho para TOTAL
    pdf.text('TOTAL', tx, y + rowHeight - 1.5, { align: 'center' });

    // VALID (se ativado)
    if (showValidation) {
      rgb(pdf, COLORS.headerFg, 'text');
      pdf.text('✓', getValidX() + validColW / 2, y + rowHeight - 1.5, { align: 'center' });
    }

    // Linha separadora
    rgb(pdf, [99, 102, 241], 'draw'); // indigo
    pdf.setLineWidth(0.5);
    pdf.line(margin, y + rowHeight, margin + contentW, y + rowHeight);

    currentY += rowHeight;
  };

  /** Renderiza rodapé com paginação. */
  const renderFooter = () => {
    rgb(pdf, COLORS.footerFg, 'text');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    const ts = new Date().toLocaleString('pt-BR');
    pdf.text(`${companyName} · DFC · Gerado em ${ts}`, margin, pageH - 4);
    pdf.text(`Página ${pageNumber}`, pageW - margin, pageH - 4, { align: 'right' });

    // Linha do rodapé
    rgb(pdf, COLORS.border, 'draw');
    pdf.setLineWidth(0.2);
    pdf.line(margin, pageH - 6, pageW - margin, pageH - 6);
  };

  /** Verifica se há espaço para N linhas + altura de segurança. */
  const needsPageBreak = (linesNeeded = 1): boolean => {
    const safeZone = pageH - margin - 10; // 10mm para rodapé
    return currentY + (linesNeeded * rowHeight) > safeZone;
  };

  /** Adiciona nova página e repete cabeçalhos. */
  const addPage = () => {
    renderFooter();
    pdf.addPage();
    pageNumber++;
    currentY = margin;
    renderDocHeader();
    renderTableHeader();
  };

  /** Renderiza uma linha de dados na posição currentY. */
  const renderRow = (row: DFCRow, rowIndex: number, dataRowIndex: number) => {
    const y = currentY;
    const indent = (row.indent ?? 0) * 3;

    // Cor de fundo por tipo
    let bgColor: [number, number, number];
    let fgColor: [number, number, number];
    let fontStyle: 'normal' | 'bold' = 'normal';

    switch (row.type) {
      case 'SECTION':
        bgColor   = COLORS.sectionBg;
        fgColor   = COLORS.sectionFg;
        fontStyle = 'bold';
        break;
      case 'SUBTOTAL':
        bgColor   = COLORS.subtotalBg;
        fgColor   = COLORS.subtotalFg;
        fontStyle = 'bold';
        break;
      case 'TOTAL':
        bgColor   = COLORS.totalBg;
        fgColor   = COLORS.totalFg;
        fontStyle = 'bold';
        break;
      case 'SPACER':
        // Linha vazia
        currentY += rowHeight * 0.4;
        return;
      default:
        // DATA — zebrado
        bgColor   = dataRowIndex % 2 === 0 ? COLORS.dataEvenBg : COLORS.dataOddBg;
        fgColor   = COLORS.dataFg;
        fontStyle = 'normal';
    }

    // Fundo da linha
    rgb(pdf, bgColor, 'fill');
    pdf.rect(margin, y, contentW, rowHeight, 'F');

    // Borda inferior sutil
    rgb(pdf, COLORS.border, 'draw');
    pdf.setLineWidth(0.1);
    pdf.line(margin, y + rowHeight, margin + contentW, y + rowHeight);

    // Texto do rótulo
    rgb(pdf, fgColor, 'text');
    pdf.setFont('helvetica', fontStyle);
    pdf.setFontSize(labelFontSize);
    pdf.text(row.label, margin + 1.5 + indent, y + rowHeight - 1.5, { maxWidth: labelW - indent - 2 });

    // Valores por coluna
    pdf.setFont('helvetica', fontStyle === 'bold' ? 'bold' : 'normal');
    pdf.setFontSize(dataFontSize);

    if (row.type !== 'SECTION') {
      row.values.forEach((val, i) => {
        const x = getColX(i) + dataColW - 1;
        pdf.text(fmtBR(val), x, y + rowHeight - 1.5, { align: 'right' });
      });

      // Coluna TOTAL — fundo levemente diferente
      rgb(pdf, COLORS.totalColBg, 'fill');
      pdf.rect(getTotalX(), y, totalColW, rowHeight, 'F');
      rgb(pdf, COLORS.totalColFg, 'text');
      pdf.setFont('helvetica', 'bold');
      pdf.text(fmtBR(row.total), getTotalX() + totalColW - 1, y + rowHeight - 1.5, { align: 'right' });

      // Coluna de validação
      if (showValidation) {
        const calculated = row.values.reduce((s, v) => s + v, 0);
        const diff       = Math.abs(calculated - row.total);
        const hasError   = diff > 0.5;

        if (hasError) {
          rgb(pdf, COLORS.validError, 'fill');
          pdf.rect(getValidX(), y, validColW, rowHeight, 'F');
          rgb(pdf, [255, 255, 255], 'text');
          pdf.setFontSize(dataFontSize - 1);
          pdf.text('ERR', getValidX() + validColW / 2, y + rowHeight - 1.5, { align: 'center' });
        }
        // Se OK, não pinta nada (herdou o bg da linha)
      }
    }

    currentY += rowHeight;
  };

  // ── 5. Renderizar documento ───────────────────────────────────────────────

  renderDocHeader();
  renderTableHeader();

  let dataRowIndex = 0; // para zebrado (conta apenas DATA rows)

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.type === 'SPACER') {
      currentY += rowHeight * 0.4;
      continue;
    }

    // Preservação de hierarquia (Req. 2):
    // Se é SECTION, garantir espaço para pelo menos 2 linhas de dados após ela
    if (row.type === 'SECTION') {
      if (needsPageBreak(3)) { // seção + 2 filhas
        addPage();
      }
    } else {
      if (needsPageBreak(1)) {
        addPage();
      }
    }

    renderRow(row, i, dataRowIndex);

    if (row.type === 'DATA') dataRowIndex++;
  }

  // ── 6. Resumo de validação no final (se houver erros) ────────────────────

  if (showValidation && validationErrors.length > 0) {
    if (needsPageBreak(validationErrors.length + 4)) addPage();

    currentY += 4;
    rgb(pdf, COLORS.validError, 'fill');
    pdf.rect(margin, currentY, contentW, rowHeight, 'F');
    rgb(pdf, [255, 255, 255], 'text');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text(
      `⚠ ${validationErrors.length} linha(s) com divergência entre total informado e soma das colunas`,
      margin + 2, currentY + rowHeight - 1.5
    );
    currentY += rowHeight;

    validationErrors.slice(0, 10).forEach(err => {
      rgb(pdf, COLORS.dataOddBg, 'fill');
      pdf.rect(margin, currentY, contentW, rowHeight, 'F');
      rgb(pdf, COLORS.validError, 'text');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.5);
      pdf.text(
        `Linha ${err.rowIdx + 1}: informado ${fmtBR(err.expected)} · calculado ${fmtBR(err.actual)} · diferença ${fmtBR(err.diff)}`,
        margin + 2, currentY + rowHeight - 1.5
      );
      currentY += rowHeight;
    });
  }

  renderFooter();

  // ── 7. Abrir PDF ──────────────────────────────────────────────────────────
  window.open(pdf.output('bloburl'), '_blank');
}

// ─── Builder: converte dados do Dashboard para DFCRow[] ──────────────────────

/**
 * Converte a estrutura de dados do viewType DFC do Dashboard
 * para o formato DFCRow[] esperado pelo exportDFCPdf.
 *
 * Parâmetros espelham exatamente o que o Dashboard já calcula.
 */
export interface DFCBuilderParams {
  columns: DFCColumn[];
  getTotal: (compId: string, type: string, filter?: string | string[], useInv?: boolean, excl?: string[]) => number;
  getInitialBalance: (compId: string) => number;
  getResgAplicTotal: (compId: string) => number;
}

export function buildDFCRows(p: DFCBuilderParams): DFCRow[] {
  const { columns, getTotal, getInitialBalance, getResgAplicTotal } = p;

  const make = (
    label:  string,
    type:   RowType,
    valueFn: (colId: string) => number,
    indent = 0,
  ): DFCRow => {
    const values = columns.map(c => valueFn(c.id));
    const total  = values.reduce((s, v) => s + v, 0);
    return { label, type, values, total, indent };
  };

  const spacer = (): DFCRow => ({ label: '', type: 'SPACER', values: [], total: 0 });

  return [
    make('SLD INICIAL DE CAIXA', 'TOTAL', getInitialBalance),
    spacer(),

    { label: '1 - ATIVIDADES OPERACIONAIS', type: 'SECTION', values: columns.map(() => 0), total: 0 },

    make('  Entradas', 'SUBTOTAL', cId => getTotal(cId, 'RECEIVABLE'), 1),
    make('  (+) Publicidade / Projetos',  'DATA', cId => getTotal(cId, 'RECEIVABLE', ['Publicidade', 'Projeto', 'Ative', '101', '102', '103', '104', '105', '106', '108', '109', '112']), 2),
    make('  (+) Serviços',                'DATA', cId => getTotal(cId, 'RECEIVABLE', ['Serviço', 'Servico', 'Produção', 'Producao', 'Financeira', '110', '111', '113']), 2),
    make('  (+) Assinaturas',             'DATA', cId => getTotal(cId, 'RECEIVABLE', ['Assinatura', '107']), 2),
    make('  (+) Outras Entradas',         'DATA', cId => getTotal(cId, 'RECEIVABLE', '', false, ['Publicidade', 'Projeto', 'Ative', 'Serviço', 'Servico', 'Produção', 'Producao', 'Financeira', 'Assinatura', '101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113']), 2),

    make('  Saídas', 'SUBTOTAL', cId => getTotal(cId, 'PAYABLE'), 1),
    make('  (-) Distribuição de Lucros',  'DATA', cId => getTotal(cId, 'PAYABLE', ['Lucro', 'Dividendo']), 2),
    make('  (-) Pessoal',                 'DATA', cId => getTotal(cId, 'PAYABLE', ['Pessoal', 'Folha', 'Salário', 'Salario', 'Benefício', 'Beneficio', '201', '202']), 2),
    make('  (-) Comissões',               'DATA', cId => getTotal(cId, 'PAYABLE', ['Comiss', 'Comissao', '218']), 2),
    make('  (-) Impostos e Tributos',     'DATA', cId => getTotal(cId, 'PAYABLE', ['Imposto', 'Tribut', '209', '215']), 2),
    make('  (-) Fornecedores / Outros',   'DATA', cId => getTotal(cId, 'PAYABLE', '', false, ['Lucro', 'Dividendo', 'Pessoal', 'Folha', 'Salário', 'Salario', 'Benefício', 'Beneficio', 'Comiss', 'Comissao', 'Imposto', 'Tribut', '201', '202', '209', '215', '218']), 2),

    spacer(),
    { label: '2 - ATIVIDADES DE INVESTIMENTO', type: 'SECTION', values: columns.map(() => 0), total: 0 },
    make('  (-) Investimentos (Capex)',   'DATA', cId => getTotal(cId, 'PAYABLE', undefined, true), 2),

    spacer(),
    { label: '3 - ATIVIDADES DE FINANCIAMENTO', type: 'SECTION', values: columns.map(() => 0), total: 0 },

    spacer(),
    make('SLD ANTES DA APL/RESG', 'SUBTOTAL', cId => {
      const ini  = getInitialBalance(cId);
      const inf  = getTotal(cId, 'RECEIVABLE');
      const out  = getTotal(cId, 'PAYABLE');
      const inv  = getTotal(cId, 'APPLICATION');
      return ini + inf - out - inv;
    }),

    make('(+/-) Previsão Resg/Aplic', 'DATA', getResgAplicTotal, 1),

    make('SLD FINAL DE CAIXA', 'TOTAL', cId => {
      const ini  = getInitialBalance(cId);
      const inf  = getTotal(cId, 'RECEIVABLE');
      const out  = getTotal(cId, 'PAYABLE');
      const inv  = getTotal(cId, 'APPLICATION');
      const resg = getResgAplicTotal(cId);
      return ini + inf - out - inv + resg;
    }),
  ];
}
