/**
 * services/pdfNativeSlides.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gera as páginas de Contas a Pagar e Contas a Receber diretamente no jsPDF
 * usando desenho nativo (rect, text, roundedRect) — sem html2canvas.
 * Layout e coordenadas idênticos ao pptxNativeSlides.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type jsPDF from 'jspdf';
import { Transaction, TransactionType } from '../types';
import { classifyTax } from '../utils/finance';

// ─── PALETA ───────────────────────────────────────────────────────────────────
const BG           = [15, 23, 42];     // #0f172a
const CARD_BG      = [30, 41, 59];     // #1e293b
const BORDER       = [51, 65, 85];     // #334155
const ITEM_BG      = [51, 65, 85];     // #334155
const TXT_MUTED    = [148, 163, 184];  // #94a3b8
const TXT_LIGHT    = [203, 213, 225];  // #cbd5e1
const TXT_WHITE    = [226, 232, 240];  // #e2e8f0

const PAGAR = {
  kpiBg: [69, 10, 10], kpiBorder: [239, 68, 68],
  bar1: [2, 132, 199], val1: [125, 211, 252],
  bar2: [79, 70, 229],  val2: [165, 180, 252],
  company: [249, 115, 22], companyLabel: [251, 146, 60],
  cat: [[249,115,22],[239,68,68],[245,158,11]],
};
const RECEBER = {
  kpiBg: [15, 76, 117], kpiBorder: [50, 130, 184],
  bar1: [13, 148, 136], val1: [94, 234, 212],
  bar2: [8, 145, 178],  val2: [103, 232, 249],
  company: [56, 189, 248], companyLabel: [226, 232, 240],
  cat: [[59,130,246],[16,185,129],[99,102,241]],
};

const COMPANIES_MAP: Record<string, string> = {
  '1':'S.A. A GAZETA','2':'TV GAZETA','3':'TV CACHOEIRO',
  '4':'TV NORTE','5':'RD MIX','6':'FM 102',
  '14':'VÍDEO','17':'DIFUSORA','18':'CIDADÃ',
  '22':'FM LINHARES','23':'RD N. GERAÇÃO',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtVal = (v: number) => Math.round(v).toLocaleString('pt-BR');
const fmtFull = (v: number) => v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const trunc = (s: string, max: number) => s.length > max ? s.substring(0, max-1)+'…' : s;
const normalizeCategory = (cat?: string) => (cat||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();

type RGB = number[];

function setFill(pdf: jsPDF, c: RGB) { pdf.setFillColor(c[0],c[1],c[2]); }
function setText(pdf: jsPDF, c: RGB) { pdf.setTextColor(c[0],c[1],c[2]); }

/** Desenha texto centralizado vertical e horizontalmente numa caixa */
function textInBox(pdf: jsPDF, text: string, x: number, y: number, w: number, h: number, opts: {
  size: number; color: RGB; bold?: boolean; align?: 'left'|'center'|'right';
}) {
  setText(pdf, opts.color);
  pdf.setFontSize(opts.size);
  pdf.setFont('Helvetica', opts.bold ? 'bold' : 'normal');
  const textY = y + h/2 + opts.size * 0.013; // approx vertical center
  const align = opts.align || 'left';
  let textX = x;
  if (align === 'center') textX = x + w/2;
  else if (align === 'right') textX = x + w;
  pdf.text(text, textX, textY, { align });
}

/** Retangulo arredondado preenchido */
function roundRect(pdf: jsPDF, x: number, y: number, w: number, h: number, r: number, fill: RGB, stroke?: RGB) {
  setFill(pdf, fill);
  if (stroke) {
    pdf.setDrawColor(stroke[0],stroke[1],stroke[2]);
    pdf.setLineWidth(0.005);
    pdf.roundedRect(x, y, w, h, r, r, 'FD');
  } else {
    pdf.roundedRect(x, y, w, h, r, r, 'F');
  }
}

interface AggItem { id: string; name: string; value: number }

function aggregate(txs: Transaction[], keyFn: (t:Transaction)=>string, nameFn: (t:Transaction)=>string): AggItem[] {
  const map: Record<string,AggItem> = {};
  txs.forEach(t => { const k=keyFn(t); if(!map[k]) map[k]={id:k,name:nameFn(t),value:0}; map[k].value+=Number(t.value)||0; });
  return Object.values(map);
}

// ─── BUILDING BLOCKS ──────────────────────────────────────────────────────────
const PAD = 0.3;

function drawHeader(pdf: jsPDF, title: string, dateRange: string) {
  // Background
  setFill(pdf, BG);
  pdf.rect(0, 0, 10, 5.625, 'F');

  textInBox(pdf,'REDE GAZETA', PAD, 0.15, 4, 0.18, {size:7, color:TXT_MUTED});
  textInBox(pdf, title, PAD, 0.28, 6, 0.26, {size:15, color:TXT_WHITE, bold:true});
  textInBox(pdf, dateRange, 6.5, 0.33, 3.2, 0.22, {size:9, color:TXT_LIGHT, align:'right'});

  setFill(pdf, BORDER);
  pdf.rect(PAD, 0.64, 10-2*PAD, 0.008, 'F');
}

function drawKpis(pdf: jsPDF, kpis:{label:string;value:number}[], bgColor:RGB, borderColor:RGB) {
  const y=0.72, h=0.36, n=kpis.length, totalW=10-2*PAD, gap=0.1;
  const bw = (totalW-(n-1)*gap)/n;

  kpis.forEach((kpi,i) => {
    const x = PAD + i*(bw+gap);
    roundRect(pdf, x, y, bw, h, 0.04, bgColor);
    setFill(pdf, borderColor);
    pdf.roundedRect(x+0.02, y+h-0.025, bw-0.04, 0.025, 0.01, 0.01, 'F');
    textInBox(pdf, kpi.label, x, y+0.03, bw, 0.13, {size:5.5, color:TXT_LIGHT, bold:true, align:'center'});
    textInBox(pdf, `R$ ${fmtVal(kpi.value)}`, x, y+0.14, bw, 0.16, {size:9, color:[255,255,255], bold:true, align:'center'});
  });
}

function drawBarList(pdf: jsPDF, title: string, items: AggItem[], x: number, y: number, w: number, h: number, barColor: RGB, valueColor: RGB) {
  roundRect(pdf, x, y, w, h, 0.06, CARD_BG, BORDER);
  textInBox(pdf, title, x, y+0.06, w, 0.18, {size:7, color:TXT_LIGHT, bold:true, align:'center'});

  const display = items.slice(0,15);
  if (!display.length) {
    textInBox(pdf,'Nenhum registro.', x, y+h*0.4, w, 0.2, {size:6, color:[100,116,139], align:'center'});
    return;
  }

  const maxVal = Math.max(...display.map(t=>t.value));
  const startY = y+0.32, availH = h-0.40;
  const rowH = Math.min(availH/display.length, 0.26);
  const nameColW=0.85, valColW=0.48, gapInner=0.06, padL=0.06, padR=0.06;
  const barAreaW = w-padL-nameColW-gapInner-valColW-padR;

  display.forEach((item,i) => {
    const iy = startY + i*rowH;
    textInBox(pdf, trunc(item.name,18), x+padL, iy, nameColW, rowH, {size:5, color:TXT_MUTED, bold:true});

    const barH = Math.min(rowH*0.55, 0.14);
    const barY = iy+(rowH-barH)/2;
    const barX = x+padL+nameColW+gapInner;
    const pct = Math.max(item.value/maxVal, 0.03);
    setFill(pdf, barColor);
    pdf.roundedRect(barX, barY, barAreaW*pct, barH, 0.03, 0.03, 'F');

    textInBox(pdf, fmtVal(item.value), x+w-valColW-padR, iy, valColW, rowH, {size:5.5, color:valueColor, bold:true, align:'right'});
  });
}

function drawStackedCards(pdf: jsPDF, cards:{title:string;items:AggItem[];borderColor:RGB}[], x: number, y: number, w: number, h: number) {
  const gap=0.05, cardH=(h-(cards.length-1)*gap)/cards.length;

  cards.forEach((card,ci) => {
    const cy = y+ci*(cardH+gap);
    roundRect(pdf, x, cy, w, cardH, 0.05, CARD_BG, BORDER);
    textInBox(pdf, card.title, x, cy+0.03, w, 0.14, {size:6, color:TXT_LIGHT, bold:true, align:'center'});
    setFill(pdf, BORDER);
    pdf.rect(x+0.05, cy+0.19, w-0.1, 0.003, 'F');

    const display = card.items.slice(0,6);
    if (!display.length) {
      textInBox(pdf,'Sem registros.', x, cy+cardH*0.4, w, 0.15, {size:5, color:[100,116,139], align:'center'});
      return;
    }
    const itemStartY = cy+0.22, itemAvailH = cardH-0.26;
    const itemH = Math.min(itemAvailH/display.length, 0.22);

    display.forEach((item,ii) => {
      const iy = itemStartY+ii*itemH;
      // Borda esquerda colorida
      setFill(pdf, card.borderColor);
      pdf.roundedRect(x+0.05, iy+0.005, 0.025, itemH-0.01, 0.008, 0.008, 'F');
      // Fundo item
      roundRect(pdf, x+0.05, iy+0.005, w-0.10, itemH-0.01, 0.025, ITEM_BG);
      textInBox(pdf, trunc(item.name,20), x+0.10, iy+0.005, (w-0.10)*0.58, itemH-0.01, {size:5, color:TXT_LIGHT, bold:true});
      textInBox(pdf, fmtVal(item.value), x+0.10+(w-0.10)*0.53, iy+0.005, (w-0.10)*0.42, itemH-0.01, {size:5, color:TXT_WHITE, bold:true, align:'right'});
    });
  });
}

function drawCompanyBars(pdf: jsPDF, data:{name:string;value:number}[], x: number, y: number, w: number, h: number, barColor: RGB, labelColor: RGB) {
  roundRect(pdf, x, y, w, h, 0.06, CARD_BG, BORDER);
  textInBox(pdf,'TOTAL POR EMPRESA', x, y+0.06, w, 0.18, {size:7, color:TXT_LIGHT, bold:true, align:'center'});

  const display = data.slice(0,10);
  if (!display.length) return;
  const maxVal = Math.max(...display.map(d=>d.value));
  const startY=y+0.35, availH=h-0.45, rowH=Math.min(availH/display.length,0.38);
  const nameColW=0.6, valColW=0.55, barAreaW=w-nameColW-valColW-0.24;

  display.forEach((d,i) => {
    const iy=startY+i*rowH;
    textInBox(pdf, trunc(d.name,12), x+0.06, iy, nameColW, rowH, {size:5.5, color:TXT_MUTED, bold:true});
    const barH=Math.min(rowH*0.55,0.16), barY=iy+(rowH-barH)/2, barX=x+0.06+nameColW+0.04;
    const pct=Math.max(d.value/maxVal,0.03);
    setFill(pdf, barColor);
    pdf.roundedRect(barX, barY, barAreaW*pct, barH, 0.03, 0.03, 'F');
    textInBox(pdf, `R$ ${fmtVal(d.value)}`, x+w-valColW-0.06, iy, valColW, rowH, {size:5.5, color:labelColor, bold:true, align:'right'});
  });
}

function drawVlDia(pdf: jsPDF, data:{date:string;value:number}[], x: number, y: number, w: number, h: number) {
  roundRect(pdf, x, y, w, h, 0.06, CARD_BG, BORDER);
  setFill(pdf, BG);
  pdf.roundedRect(x+0.01, y, w-0.02, 0.22, 0.05, 0.05, 'F');
  textInBox(pdf,'VL DIA', x, y+0.02, w, 0.18, {size:7, color:TXT_LIGHT, bold:true, align:'center'});

  const display=data.slice(0,10);
  const startY=y+0.28, availH=h-0.35, cardH=Math.min(availH/display.length,0.38);

  display.forEach((d,i) => {
    const iy=startY+i*cardH;
    roundRect(pdf, x+0.04, iy, w-0.08, cardH-0.03, 0.03, ITEM_BG, BORDER);
    textInBox(pdf, `DIA ${d.date}`, x+0.04, iy+0.02, w-0.08, 0.10, {size:4.5, color:TXT_MUTED, bold:true, align:'right'});
    textInBox(pdf, fmtFull(d.value), x+0.04, iy+0.12, w-0.08, cardH-0.18, {size:6, color:TXT_WHITE, bold:true, align:'right'});
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: CONTAS A PAGAR
// ═══════════════════════════════════════════════════════════════════════════════

export function drawPayablesPage(
  pdf: jsPDF,
  transactions: Transaction[],
  realizedTransactions: Transaction[],
  dateRange: string,
) {
  const allPayables = transactions.filter(t => t.type===TransactionType.PAYABLE && t.status==='PREVISTO');
  const chartPayables = [...transactions.filter(t=>t.type===TransactionType.PAYABLE),...realizedTransactions.filter(t=>t.type===TransactionType.PAYABLE)];
  const totalPayables = allPayables.reduce((s,t)=>s+(Number(t.value)||0),0);

  const getSumByCat = (filter:string) => {
    const nf=normalizeCategory(filter);
    return allPayables.filter(t=>normalizeCategory(t.category).includes(nf)).reduce((s,t)=>s+(Number(t.value)||0),0);
  };
  const valPessoal=getSumByCat('Pessoal')+getSumByCat('Folha');
  const valInvest=getSumByCat('Investimento')+getSumByCat('Obra');
  const valImpost=allPayables.filter(t=>classifyTax(t)!==null).reduce((s,t)=>s+(Number(t.value)||0),0);
  const valComiss=allPayables.filter(t=>normalizeCategory(t.category).includes('COMISS')&&classifyTax(t)===null).reduce((s,t)=>s+(Number(t.value)||0),0);
  const valFornec=totalPayables-valPessoal-valInvest-valComiss-valImpost;

  const agg = aggregate(allPayables, t=>t.supplierCode||t.supplier||t.description||'Desconhecido', t=>t.supplier||t.description||'Desconhecido');
  const highValue = agg.filter(t=>t.value>35000).sort((a,b)=>b.value-a.value);
  const lowValue = agg.filter(t=>t.value<=35000).sort((a,b)=>b.value-a.value);

  const companyMap: Record<string,number>={};
  chartPayables.forEach(t=>{const code=String(t.companyCode||'').trim();const k=COMPANIES_MAP[code]||(code?`Emp ${code}`:'N/D');companyMap[k]=(companyMap[k]||0)+(Number(t.value)||0);});
  const companyData=Object.entries(companyMap).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);

  const dailyMap:Record<string,number>={};
  allPayables.forEach(t=>{dailyMap[t.date]=(dailyMap[t.date]||0)+(Number(t.value)||0);});
  const vlDia=Object.entries(dailyMap).map(([date,value])=>({date,value})).sort((a,b)=>b.value-a.value);

  const catInvest=agg.filter(it=>{const p=allPayables.find(pp=>(pp.supplierCode||pp.supplier||pp.description||'Desconhecido')===it.id);return p?(normalizeCategory(p.category).includes('INVESTIMENTO')||normalizeCategory(p.category).includes('OBRA')):false;}).sort((a,b)=>b.value-a.value);
  const catImpost=agg.filter(it=>{const p=allPayables.find(pp=>(pp.supplierCode||pp.supplier||pp.description||'Desconhecido')===it.id);return p?classifyTax(p)!==null:false;}).sort((a,b)=>b.value-a.value);
  const catComiss=agg.filter(it=>{const p=allPayables.find(pp=>(pp.supplierCode||pp.supplier||pp.description||'Desconhecido')===it.id);return p?(normalizeCategory(p.category).includes('COMISS')&&classifyTax(p)===null):false;}).sort((a,b)=>b.value-a.value);

  // ── Desenho ─────────────────────────────────────────────────────────────
  drawHeader(pdf, 'CONTAS A PAGAR', dateRange);
  drawKpis(pdf, [
    {label:'FORNECEDORES',value:valFornec},{label:'PESSOAL',value:valPessoal},
    {label:'INVESTIMENTO',value:valInvest},{label:'COMISSÕES',value:valComiss},
    {label:'IMPOSTOS',value:valImpost},{label:'TOTAL',value:totalPayables},
  ], PAGAR.kpiBg, PAGAR.kpiBorder);

  const mainY=1.2, mainH=4.2;
  drawBarList(pdf,'ACIMA DE R$ 35 MIL',highValue, 0.30,mainY,2.25,mainH, PAGAR.bar1,PAGAR.val1);
  drawBarList(pdf,'ABAIXO DE R$ 35 MIL',lowValue, 2.65,mainY,2.25,mainH, PAGAR.bar2,PAGAR.val2);
  drawStackedCards(pdf,[
    {title:'INVESTIMENTO',items:catInvest,borderColor:PAGAR.cat[0]},
    {title:'IMPOSTOS',items:catImpost,borderColor:PAGAR.cat[1]},
    {title:'COMISSÕES',items:catComiss,borderColor:PAGAR.cat[2]},
  ], 5.00,mainY,1.55,mainH);
  drawCompanyBars(pdf,companyData, 6.65,mainY,2.15,mainH, PAGAR.company,PAGAR.companyLabel);
  drawVlDia(pdf,vlDia, 8.90,mainY,0.80,mainH);
}


// ═══════════════════════════════════════════════════════════════════════════════
// PÁGINA: CONTAS A RECEBER
// ═══════════════════════════════════════════════════════════════════════════════

export function drawReceivablesPage(
  pdf: jsPDF,
  transactions: Transaction[],
  dateRange: string,
) {
  const allRec = transactions.filter(t=>t.type===TransactionType.RECEIVABLE);
  const totalInflow = allRec.reduce((s,t)=>s+(Number(t.value)||0),0);

  const agg = aggregate(allRec, t=>t.customerCode||t.customer||t.description||'Desconhecido', t=>t.customer||t.description||'Desconhecido');

  const filterGov = (codes:string[],terms:string[]) => {
    const filtered=allRec.filter(t=>{const port=(t.portfolio||'').toUpperCase();if(codes.some(c=>port.includes(c)))return true;const text=((t.customer||'')+(t.description||'')+(t.category||'')).toUpperCase();return terms.some(term=>text.includes(term));});
    return aggregate(filtered, t=>t.customerCode||t.customer||t.description||'Desconhecido', t=>t.customer||t.description||'Desconhecido').sort((a,b)=>b.value-a.value);
  };
  const govFed=filterGov(['GFE'],['FEDERAL','UNIAO','MINISTERIO']);
  const govEst=filterGov(['GES'],['ESTADO','ESTADUAL','GOVERNO DO','SECOM']);
  const govMun=filterGov(['GMU'],['PREFEITURA','MUNICIPAL','MUNICIPIO']);
  const valGov=govFed.reduce((s,t)=>s+t.value,0)+govEst.reduce((s,t)=>s+t.value,0)+govMun.reduce((s,t)=>s+t.value,0);

  const isAssinatura=(t:Transaction)=>{const sp=(t.species||'').toUpperCase().trim();const n2=(t.flowTypeLevel2||'').trim();const fc=(t.flowTypeCode||'').trim();return sp==='ASS'||n2==='107'||fc.startsWith('107');};
  const valAssinatura=allRec.filter(isAssinatura).reduce((s,t)=>s+(Number(t.value)||0),0);

  const idsGov=new Set([...govFed,...govEst,...govMun].map(t=>t.id));
  const valParticular=allRec.filter(t=>{const key=t.customerCode||t.customer||t.description||'Desconhecido';return !idsGov.has(key)&&!isAssinatura(t);}).reduce((s,t)=>s+(Number(t.value)||0),0);

  const top10=[...agg].sort((a,b)=>b.value-a.value).slice(0,10);
  const valTop10=top10.reduce((s,t)=>s+t.value,0);
  const highValue=agg.filter(t=>t.value>35000).sort((a,b)=>b.value-a.value);
  const lowValue=agg.filter(t=>t.value<=35000).sort((a,b)=>b.value-a.value);

  const companyMap:Record<string,number>={};
  allRec.forEach(t=>{const code=String(t.companyCode||'').trim();const k=COMPANIES_MAP[code]||(code?`Emp ${code}`:'N/D');companyMap[k]=(companyMap[k]||0)+(Number(t.value)||0);});
  const companyData=Object.entries(companyMap).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);

  const dailyMap:Record<string,number>={};
  allRec.forEach(t=>{dailyMap[t.date]=(dailyMap[t.date]||0)+(Number(t.value)||0);});
  const vlDia=Object.entries(dailyMap).map(([date,value])=>({date,value})).sort((a,b)=>b.value-a.value);

  // ── Desenho ─────────────────────────────────────────────────────────────
  drawHeader(pdf, 'CONTAS A RECEBER', dateRange);
  drawKpis(pdf, [
    {label:'TOP 10',value:valTop10},{label:'PARTICULAR',value:valParticular},
    {label:'ASSINATURA',value:valAssinatura},{label:'GOVERNO',value:valGov},
    {label:'TOTAL PREVISTO',value:totalInflow},
  ], RECEBER.kpiBg, RECEBER.kpiBorder);

  const mainY=1.2, mainH=4.2;
  drawBarList(pdf,'ACIMA DE R$ 35 MIL',highValue, 0.30,mainY,2.25,mainH, RECEBER.bar1,RECEBER.val1);
  drawBarList(pdf,'ABAIXO DE R$ 35 MIL',lowValue, 2.65,mainY,2.25,mainH, RECEBER.bar2,RECEBER.val2);
  drawStackedCards(pdf,[
    {title:'GOV. FEDERAL',items:govFed,borderColor:RECEBER.cat[0]},
    {title:'GOV. ESTADUAL',items:govEst,borderColor:RECEBER.cat[1]},
    {title:'GOV. MUNICIPAL',items:govMun,borderColor:RECEBER.cat[2]},
  ], 5.00,mainY,1.55,mainH);
  drawCompanyBars(pdf,companyData, 6.65,mainY,2.15,mainH, RECEBER.company,RECEBER.companyLabel);
  drawVlDia(pdf,vlDia, 8.90,mainY,0.80,mainH);
}
