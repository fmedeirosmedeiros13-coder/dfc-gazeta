/**
 * services/pptxNativeSlides.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gera os slides de Contas a Pagar e Contas a Receber de forma PROGRAMÁTICA
 * usando pptxgenjs — sem html2canvas.
 *
 * Cada elemento (KPI, barra horizontal, card, gráfico de empresa, VL Dia)
 * é desenhado como objeto nativo do PowerPoint: texto real, formas vetoriais,
 * gráficos editáveis. Resultado: nada corta, tudo fica nítido e editável.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import PptxGenJS from 'pptxgenjs';
import { Transaction, TransactionType } from '../types';
import { classifyTax } from '../utils/finance';

// ─── PALETA & CONSTANTES ──────────────────────────────────────────────────────
const BG           = '0f172a';
const CARD_BG      = '1e293b';
const BORDER       = '334155';
const BORDER_INNER = '475569';
const TXT_MUTED    = '94a3b8';
const TXT_LIGHT    = 'cbd5e1';
const TXT_WHITE    = 'e2e8f0';
const FONT         = 'Arial';
const PAD          = 0.3;   // margem lateral do slide

// ─── CORES POR CONTEXTO ──────────────────────────────────────────────────────
const PAGAR = {
  kpiBg: '450a0a', kpiBorder: 'ef4444',
  bar1: '0284c7', val1: '7dd3fc',           // sky — Acima 35k
  bar2: '4f46e5', val2: 'a5b4fc',           // indigo — Abaixo 35k
  company: 'f97316', companyLabel: 'fb923c', // orange
  cat: ['f97316', 'ef4444', 'f59e0b'],       // invest, imposto, comissão border
};
const RECEBER = {
  kpiBg: '0f4c75', kpiBorder: '3282b8',
  bar1: '0d9488', val1: '5eead4',           // teal
  bar2: '0891b2', val2: '67e8f9',           // cyan
  company: '38bdf8', companyLabel: 'e2e8f0',
  cat: ['3b82f6', '10b981', '6366f1'],      // federal, estadual, municipal border
};

const COMPANIES_MAP: Record<string, string> = {
  '1': 'S.A. A GAZETA', '2': 'TV GAZETA', '3': 'TV CACHOEIRO',
  '4': 'TV NORTE', '5': 'RD MIX', '6': 'FM 102',
  '14': 'VÍDEO', '17': 'DIFUSORA', '18': 'CIDADÃ',
  '22': 'FM LINHARES', '23': 'RD N. GERAÇÃO',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtVal = (v: number) => Math.round(v).toLocaleString('pt-BR');
const fmtFull = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trunc  = (s: string, max: number) => s.length > max ? s.substring(0, max - 1) + '…' : s;

const normalizeCategory = (cat?: string) => {
  if (!cat) return '';
  return cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
};

interface AggItem { id: string; name: string; value: number }

function aggregate(txs: Transaction[], keyFn: (t: Transaction) => string, nameFn: (t: Transaction) => string): AggItem[] {
  const map: Record<string, AggItem> = {};
  txs.forEach(t => {
    const k = keyFn(t);
    if (!map[k]) map[k] = { id: k, name: nameFn(t), value: 0 };
    map[k].value += Number(t.value) || 0;
  });
  return Object.values(map);
}

// ─── BUILDING BLOCKS ──────────────────────────────────────────────────────────

function drawHeader(slide: PptxGenJS.Slide, pres: PptxGenJS, title: string, dateRange: string) {
  slide.background = { color: BG };

  slide.addText('REDE GAZETA', {
    x: PAD, y: 0.15, w: 4, h: 0.18,
    fontSize: 7, color: TXT_MUTED, fontFace: FONT, bold: false,
  });
  slide.addText(title, {
    x: PAD, y: 0.28, w: 6, h: 0.26,
    fontSize: 15, color: TXT_WHITE, fontFace: FONT, bold: true,
  });
  slide.addText(dateRange, {
    x: 6.5, y: 0.33, w: 3.2, h: 0.22,
    fontSize: 9, color: TXT_LIGHT, fontFace: FONT, align: 'right',
  });
  // separador
  slide.addShape(pres.ShapeType.rect, {
    x: PAD, y: 0.64, w: 10 - 2 * PAD, h: 0.008,
    fill: { color: BORDER },
  });
}

function drawKpis(
  slide: PptxGenJS.Slide, pres: PptxGenJS,
  kpis: { label: string; value: number }[],
  bgColor: string, borderColor: string,
) {
  const y = 0.72;
  const h = 0.36;
  const totalW = 10 - 2 * PAD;
  const gap = 0.1;
  const n = kpis.length;
  const bw = (totalW - (n - 1) * gap) / n;

  kpis.forEach((kpi, i) => {
    const x = PAD + i * (bw + gap);

    slide.addShape(pres.ShapeType.roundRect, {
      x, y, w: bw, h, fill: { color: bgColor }, rectRadius: 0.04,
    });
    // borda inferior colorida
    slide.addShape(pres.ShapeType.rect, {
      x: x + 0.02, y: y + h - 0.025, w: bw - 0.04, h: 0.025,
      fill: { color: borderColor }, rectRadius: 0.01,
    });
    slide.addText(kpi.label, {
      x, y: y + 0.03, w: bw, h: 0.13,
      fontSize: 5.5, color: TXT_LIGHT, fontFace: FONT, bold: true, align: 'center',
    });
    slide.addText(`R$ ${fmtVal(kpi.value)}`, {
      x, y: y + 0.14, w: bw, h: 0.16,
      fontSize: 9, color: 'FFFFFF', fontFace: FONT, bold: true, align: 'center',
    });
  });
}

/**
 * Desenha uma coluna com lista de barras horizontais (Acima/Abaixo de R$ 35 mil).
 * Layout idêntico ao "TOTAL POR EMPRESA": nome à esquerda, barra, valor à direita.
 */
function drawBarList(
  slide: PptxGenJS.Slide, pres: PptxGenJS,
  title: string, items: AggItem[],
  x: number, y: number, w: number, h: number,
  barColor: string, valueColor: string,
) {
  // Card background
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: CARD_BG },
    line: { color: BORDER, width: 0.5 },
    rectRadius: 0.06,
  });

  // Título
  slide.addText(title, {
    x, y: y + 0.06, w, h: 0.18,
    fontSize: 7, color: TXT_LIGHT, fontFace: FONT, bold: true, align: 'center',
  });

  const display = items.slice(0, 15);
  if (display.length === 0) {
    slide.addText('Nenhum registro.', {
      x, y: y + h * 0.4, w, h: 0.2,
      fontSize: 6, color: '64748b', fontFace: FONT, align: 'center',
    });
    return;
  }

  const maxVal = Math.max(...display.map(t => t.value));
  const startY = y + 0.32;
  const availH = h - 0.40;
  const rowH = Math.min(availH / display.length, 0.26);

  // Mesmo padrão do TOTAL POR EMPRESA: nome | barra | valor
  const nameColW = 0.85;
  const valColW  = 0.48;
  const gapInner = 0.06;
  const padLeft  = 0.06;
  const padRight = 0.06;
  const barAreaW = w - padLeft - nameColW - gapInner - valColW - padRight;

  display.forEach((item, i) => {
    const iy = startY + i * rowH;

    // Nome (esquerda, truncado)
    slide.addText(trunc(item.name, 18), {
      x: x + padLeft, y: iy, w: nameColW, h: rowH,
      fontSize: 5, color: TXT_MUTED, fontFace: FONT, bold: true, valign: 'middle',
    });

    // Barra (só preenchimento, sem fundo — igual TOTAL POR EMPRESA)
    const barH = Math.min(rowH * 0.55, 0.14);
    const barY = iy + (rowH - barH) / 2;
    const barX = x + padLeft + nameColW + gapInner;
    const pct = Math.max(item.value / maxVal, 0.03);

    slide.addShape(pres.ShapeType.rect, {
      x: barX, y: barY, w: barAreaW * pct, h: barH,
      fill: { color: barColor }, rectRadius: 0.03,
    });

    // Valor (direita)
    slide.addText(fmtVal(item.value), {
      x: x + w - valColW - padRight, y: iy, w: valColW, h: rowH,
      fontSize: 5.5, color: valueColor, fontFace: FONT, bold: true,
      align: 'right', valign: 'middle',
    });
  });
}

/**
 * Desenha a coluna 3 com mini-cards empilhados (categorias específicas).
 */
function drawStackedCards(
  slide: PptxGenJS.Slide, pres: PptxGenJS,
  cards: { title: string; items: AggItem[]; borderColor: string }[],
  x: number, y: number, w: number, h: number,
) {
  const gap = 0.05;
  const cardH = (h - (cards.length - 1) * gap) / cards.length;

  cards.forEach((card, ci) => {
    const cy = y + ci * (cardH + gap);

    // Fundo do card
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: cy, w, h: cardH,
      fill: { color: CARD_BG },
      line: { color: BORDER, width: 0.5 },
      rectRadius: 0.05,
    });

    // Título do card
    slide.addText(card.title, {
      x, y: cy + 0.03, w, h: 0.14,
      fontSize: 6, color: TXT_LIGHT, fontFace: FONT, bold: true, align: 'center',
    });
    slide.addShape(pres.ShapeType.rect, {
      x: x + 0.05, y: cy + 0.19, w: w - 0.1, h: 0.003,
      fill: { color: BORDER },
    });

    const display = card.items.slice(0, 6);
    if (display.length === 0) {
      slide.addText('Sem registros.', {
        x, y: cy + cardH * 0.4, w, h: 0.15,
        fontSize: 5, color: '64748b', fontFace: FONT, align: 'center',
      });
      return;
    }

    const itemStartY = cy + 0.22;
    const itemAvailH = cardH - 0.26;
    const itemH = Math.min(itemAvailH / display.length, 0.22);

    display.forEach((item, ii) => {
      const iy = itemStartY + ii * itemH;

      // Borda esquerda colorida
      slide.addShape(pres.ShapeType.rect, {
        x: x + 0.05, y: iy + 0.005, w: 0.025, h: itemH - 0.01,
        fill: { color: card.borderColor }, rectRadius: 0.008,
      });

      // Fundo do item
      slide.addShape(pres.ShapeType.roundRect, {
        x: x + 0.05, y: iy + 0.005, w: w - 0.10, h: itemH - 0.01,
        fill: { color: '334155' }, rectRadius: 0.025,
      });

      // Nome
      slide.addText(trunc(item.name, 20), {
        x: x + 0.10, y: iy + 0.005, w: (w - 0.10) * 0.58, h: itemH - 0.01,
        fontSize: 5, color: TXT_LIGHT, fontFace: FONT, bold: true, valign: 'middle',
      });

      // Valor
      slide.addText(fmtVal(item.value), {
        x: x + 0.10 + (w - 0.10) * 0.53, y: iy + 0.005,
        w: (w - 0.10) * 0.42, h: itemH - 0.01,
        fontSize: 5, color: TXT_WHITE, fontFace: FONT, bold: true,
        align: 'right', valign: 'middle',
      });
    });
  });
}

/**
 * Desenha a coluna "Total por Empresa" como barras horizontais manuais.
 */
function drawCompanyBars(
  slide: PptxGenJS.Slide, pres: PptxGenJS,
  data: { name: string; value: number }[],
  x: number, y: number, w: number, h: number,
  barColor: string, labelColor: string,
) {
  // Card
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: CARD_BG },
    line: { color: BORDER, width: 0.5 },
    rectRadius: 0.06,
  });

  slide.addText('TOTAL POR EMPRESA', {
    x, y: y + 0.06, w, h: 0.18,
    fontSize: 7, color: TXT_LIGHT, fontFace: FONT, bold: true, align: 'center',
  });

  const display = data.slice(0, 10);
  if (display.length === 0) return;

  const maxVal = Math.max(...display.map(d => d.value));
  const startY = y + 0.35;
  const availH = h - 0.45;
  const rowH = Math.min(availH / display.length, 0.38);

  const nameColW = 0.6;
  const valColW = 0.55;
  const barAreaW = w - nameColW - valColW - 0.24;

  display.forEach((d, i) => {
    const iy = startY + i * rowH;

    // Nome empresa
    slide.addText(trunc(d.name, 12), {
      x: x + 0.06, y: iy, w: nameColW, h: rowH,
      fontSize: 5.5, color: TXT_MUTED, fontFace: FONT, bold: true, valign: 'middle',
    });

    // Barra
    const barH = Math.min(rowH * 0.55, 0.16);
    const barY = iy + (rowH - barH) / 2;
    const barX = x + 0.06 + nameColW + 0.04;
    const pct = Math.max(d.value / maxVal, 0.03);

    slide.addShape(pres.ShapeType.rect, {
      x: barX, y: barY, w: barAreaW * pct, h: barH,
      fill: { color: barColor }, rectRadius: 0.03,
    });

    // Valor
    slide.addText(`R$ ${fmtVal(d.value)}`, {
      x: x + w - valColW - 0.06, y: iy, w: valColW, h: rowH,
      fontSize: 5.5, color: labelColor, fontFace: FONT, bold: true,
      align: 'right', valign: 'middle',
    });
  });
}

/**
 * Desenha a coluna "VL DIA" (valores diários).
 */
function drawVlDia(
  slide: PptxGenJS.Slide, pres: PptxGenJS,
  data: { date: string; value: number }[],
  x: number, y: number, w: number, h: number,
) {
  // Card
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: CARD_BG },
    line: { color: BORDER, width: 0.5 },
    rectRadius: 0.06,
  });

  // Título
  slide.addShape(pres.ShapeType.rect, {
    x: x + 0.01, y, w: w - 0.02, h: 0.22,
    fill: { color: '0f172a' }, rectRadius: 0.05,
  });
  slide.addText('VL DIA', {
    x, y: y + 0.02, w, h: 0.18,
    fontSize: 7, color: TXT_LIGHT, fontFace: FONT, bold: true, align: 'center',
  });

  const display = data.slice(0, 10);
  const startY = y + 0.28;
  const availH = h - 0.35;
  const cardH = Math.min(availH / display.length, 0.38);

  display.forEach((d, i) => {
    const iy = startY + i * cardH;

    slide.addShape(pres.ShapeType.roundRect, {
      x: x + 0.04, y: iy, w: w - 0.08, h: cardH - 0.03,
      fill: { color: '334155' },
      line: { color: BORDER_INNER, width: 0.3 },
      rectRadius: 0.03,
    });

    slide.addText(`DIA ${d.date}`, {
      x: x + 0.04, y: iy + 0.02, w: w - 0.08, h: 0.10,
      fontSize: 4.5, color: TXT_MUTED, fontFace: FONT, bold: true, align: 'right',
    });
    slide.addText(fmtFull(d.value), {
      x: x + 0.04, y: iy + 0.12, w: w - 0.08, h: cardH - 0.18,
      fontSize: 6, color: TXT_WHITE, fontFace: FONT, bold: true, align: 'right', valign: 'top',
    });
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE: CONTAS A PAGAR
// ═══════════════════════════════════════════════════════════════════════════════

export function generatePayablesSlide(
  pres: PptxGenJS,
  transactions: Transaction[],
  realizedTransactions: Transaction[],
  dateRange: string,
) {
  const slide = pres.addSlide();

  // ── Dados ───────────────────────────────────────────────────────────────
  const allPayables = transactions.filter(t => t.type === TransactionType.PAYABLE && t.status === 'PREVISTO');
  const chartPayables = [
    ...transactions.filter(t => t.type === TransactionType.PAYABLE),
    ...realizedTransactions.filter(t => t.type === TransactionType.PAYABLE),
  ];
  const totalPayables = allPayables.reduce((s, t) => s + (Number(t.value) || 0), 0);

  // Categorias
  const getSumByCat = (filter: string) => {
    const nf = normalizeCategory(filter);
    return allPayables.filter(t => normalizeCategory(t.category).includes(nf))
      .reduce((s, t) => s + (Number(t.value) || 0), 0);
  };
  const valPessoal = getSumByCat('Pessoal') + getSumByCat('Folha');
  const valInvest  = getSumByCat('Investimento') + getSumByCat('Obra');
  const valImpost  = allPayables.filter(t => classifyTax(t) !== null).reduce((s, t) => s + (Number(t.value) || 0), 0);
  const valComiss  = allPayables.filter(t => normalizeCategory(t.category).includes('COMISS') && classifyTax(t) === null)
                      .reduce((s, t) => s + (Number(t.value) || 0), 0);
  const valFornec  = totalPayables - valPessoal - valInvest - valComiss - valImpost;

  // Agregação de fornecedores
  const agg = aggregate(
    allPayables,
    t => t.supplierCode || t.supplier || t.description || 'Desconhecido',
    t => t.supplier || t.description || 'Desconhecido',
  );
  const highValue = agg.filter(t => t.value > 35000).sort((a, b) => b.value - a.value);
  const lowValue  = agg.filter(t => t.value <= 35000).sort((a, b) => b.value - a.value);

  // Empresas
  const companyMap: Record<string, number> = {};
  chartPayables.forEach(t => {
    const code = String(t.companyCode || '').trim();
    const k = COMPANIES_MAP[code] || (code ? `Emp ${code}` : 'N/D');
    companyMap[k] = (companyMap[k] || 0) + (Number(t.value) || 0);
  });
  const companyData = Object.entries(companyMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // VL Dia
  const dailyMap: Record<string, number> = {};
  allPayables.forEach(t => { dailyMap[t.date] = (dailyMap[t.date] || 0) + (Number(t.value) || 0); });
  const vlDia = Object.entries(dailyMap).map(([date, value]) => ({ date, value })).sort((a, b) => b.value - a.value);

  // Mini-cards de categoria
  const catInvest = agg.filter(it => {
    const p = allPayables.find(pp => (pp.supplierCode || pp.supplier || pp.description || 'Desconhecido') === it.id);
    return p ? (normalizeCategory(p.category).includes('INVESTIMENTO') || normalizeCategory(p.category).includes('OBRA')) : false;
  }).sort((a, b) => b.value - a.value);

  const catImpost = agg.filter(it => {
    const p = allPayables.find(pp => (pp.supplierCode || pp.supplier || pp.description || 'Desconhecido') === it.id);
    return p ? classifyTax(p) !== null : false;
  }).sort((a, b) => b.value - a.value);

  const catComiss = agg.filter(it => {
    const p = allPayables.find(pp => (pp.supplierCode || pp.supplier || pp.description || 'Desconhecido') === it.id);
    return p ? (normalizeCategory(p.category).includes('COMISS') && classifyTax(p) === null) : false;
  }).sort((a, b) => b.value - a.value);

  // ── Desenho ─────────────────────────────────────────────────────────────
  drawHeader(slide, pres, 'CONTAS A PAGAR', dateRange);

  drawKpis(slide, pres, [
    { label: 'FORNECEDORES', value: valFornec },
    { label: 'PESSOAL',      value: valPessoal },
    { label: 'INVESTIMENTO', value: valInvest },
    { label: 'COMISSÕES',    value: valComiss },
    { label: 'IMPOSTOS',     value: valImpost },
    { label: 'TOTAL',        value: totalPayables },
  ], PAGAR.kpiBg, PAGAR.kpiBorder);

  // Layout das colunas
  const mainY = 1.2;
  const mainH = 4.2;
  const c1x = 0.30, c1w = 2.25;
  const c2x = 2.65, c2w = 2.25;
  const c3x = 5.00, c3w = 1.55;
  const c4x = 6.65, c4w = 2.15;
  const c5x = 8.90, c5w = 0.80;

  drawBarList(slide, pres, 'ACIMA DE R$ 35 MIL', highValue, c1x, mainY, c1w, mainH, PAGAR.bar1, PAGAR.val1);
  drawBarList(slide, pres, 'ABAIXO DE R$ 35 MIL', lowValue, c2x, mainY, c2w, mainH, PAGAR.bar2, PAGAR.val2);

  drawStackedCards(slide, pres, [
    { title: 'INVESTIMENTO', items: catInvest, borderColor: PAGAR.cat[0] },
    { title: 'IMPOSTOS',     items: catImpost, borderColor: PAGAR.cat[1] },
    { title: 'COMISSÕES',    items: catComiss, borderColor: PAGAR.cat[2] },
  ], c3x, mainY, c3w, mainH);

  drawCompanyBars(slide, pres, companyData, c4x, mainY, c4w, mainH, PAGAR.company, PAGAR.companyLabel);
  drawVlDia(slide, pres, vlDia, c5x, mainY, c5w, mainH);
}


// ═══════════════════════════════════════════════════════════════════════════════
// SLIDE: CONTAS A RECEBER
// ═══════════════════════════════════════════════════════════════════════════════

export function generateReceivablesSlide(
  pres: PptxGenJS,
  transactions: Transaction[],
  dateRange: string,
) {
  const slide = pres.addSlide();

  // ── Dados ───────────────────────────────────────────────────────────────
  const allRec = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
  const totalInflow = allRec.reduce((s, t) => s + (Number(t.value) || 0), 0);

  // Aggregate por cliente
  const agg = aggregate(
    allRec,
    t => t.customerCode || t.customer || t.description || 'Desconhecido',
    t => t.customer || t.description || 'Desconhecido',
  );

  // Governo
  const filterGov = (codes: string[], terms: string[]) => {
    const filtered = allRec.filter(t => {
      const port = (t.portfolio || '').toUpperCase();
      if (codes.some(c => port.includes(c))) return true;
      const text = ((t.customer || '') + (t.description || '') + (t.category || '')).toUpperCase();
      return terms.some(term => text.includes(term));
    });
    return aggregate(
      filtered,
      t => t.customerCode || t.customer || t.description || 'Desconhecido',
      t => t.customer || t.description || 'Desconhecido',
    ).sort((a, b) => b.value - a.value);
  };

  const govFed = filterGov(['GFE'], ['FEDERAL', 'UNIAO', 'MINISTERIO']);
  const govEst = filterGov(['GES'], ['ESTADO', 'ESTADUAL', 'GOVERNO DO', 'SECOM']);
  const govMun = filterGov(['GMU'], ['PREFEITURA', 'MUNICIPAL', 'MUNICIPIO']);
  const valGovFed = govFed.reduce((s, t) => s + t.value, 0);
  const valGovEst = govEst.reduce((s, t) => s + t.value, 0);
  const valGovMun = govMun.reduce((s, t) => s + t.value, 0);
  const valGov = valGovFed + valGovEst + valGovMun;

  // Assinatura
  const isAssinatura = (t: Transaction) => {
    const sp = (t.species || '').toUpperCase().trim();
    const n2 = (t.flowTypeLevel2 || '').trim();
    const fc = (t.flowTypeCode || '').trim();
    return sp === 'ASS' || n2 === '107' || fc.startsWith('107');
  };
  const valAssinatura = allRec.filter(isAssinatura).reduce((s, t) => s + (Number(t.value) || 0), 0);

  // Particular
  const idsGov = new Set([...govFed, ...govEst, ...govMun].map(t => t.id));
  const valParticular = allRec.filter(t => {
    const key = t.customerCode || t.customer || t.description || 'Desconhecido';
    return !idsGov.has(key) && !isAssinatura(t);
  }).reduce((s, t) => s + (Number(t.value) || 0), 0);

  // Top 10
  const top10 = [...agg].sort((a, b) => b.value - a.value).slice(0, 10);
  const valTop10 = top10.reduce((s, t) => s + t.value, 0);

  // Listas Acima/Abaixo 35k
  const highValue = agg.filter(t => t.value > 35000).sort((a, b) => b.value - a.value);
  const lowValue  = agg.filter(t => t.value <= 35000).sort((a, b) => b.value - a.value);

  // Empresas
  const companyMap: Record<string, number> = {};
  allRec.forEach(t => {
    const code = String(t.companyCode || '').trim();
    const k = COMPANIES_MAP[code] || (code ? `Emp ${code}` : 'N/D');
    companyMap[k] = (companyMap[k] || 0) + (Number(t.value) || 0);
  });
  const companyData = Object.entries(companyMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // VL Dia
  const dailyMap: Record<string, number> = {};
  allRec.forEach(t => { dailyMap[t.date] = (dailyMap[t.date] || 0) + (Number(t.value) || 0); });
  const vlDia = Object.entries(dailyMap).map(([date, value]) => ({ date, value })).sort((a, b) => b.value - a.value);

  // ── Desenho ─────────────────────────────────────────────────────────────
  drawHeader(slide, pres, 'CONTAS A RECEBER', dateRange);

  drawKpis(slide, pres, [
    { label: 'TOP 10',         value: valTop10 },
    { label: 'PARTICULAR',     value: valParticular },
    { label: 'ASSINATURA',     value: valAssinatura },
    { label: 'GOVERNO',        value: valGov },
    { label: 'TOTAL PREVISTO', value: totalInflow },
  ], RECEBER.kpiBg, RECEBER.kpiBorder);

  // Colunas
  const mainY = 1.2;
  const mainH = 4.2;
  const c1x = 0.30, c1w = 2.25;
  const c2x = 2.65, c2w = 2.25;
  const c3x = 5.00, c3w = 1.55;
  const c4x = 6.65, c4w = 2.15;
  const c5x = 8.90, c5w = 0.80;

  drawBarList(slide, pres, 'ACIMA DE R$ 35 MIL', highValue, c1x, mainY, c1w, mainH, RECEBER.bar1, RECEBER.val1);
  drawBarList(slide, pres, 'ABAIXO DE R$ 35 MIL', lowValue, c2x, mainY, c2w, mainH, RECEBER.bar2, RECEBER.val2);

  drawStackedCards(slide, pres, [
    { title: 'GOV. FEDERAL',   items: govFed, borderColor: RECEBER.cat[0] },
    { title: 'GOV. ESTADUAL',  items: govEst, borderColor: RECEBER.cat[1] },
    { title: 'GOV. MUNICIPAL', items: govMun, borderColor: RECEBER.cat[2] },
  ], c3x, mainY, c3w, mainH);

  drawCompanyBars(slide, pres, companyData, c4x, mainY, c4w, mainH, RECEBER.company, RECEBER.companyLabel);
  drawVlDia(slide, pres, vlDia, c5x, mainY, c5w, mainH);
}
