import PptxGenJS from "pptxgenjs";
import { FinancialSummary, Transaction, TransactionType } from "../types";
import { COVER_TEMPLATE } from "./coverTemplate";

export async function downloadPPTX(summary: FinancialSummary, transactions: Transaction[]) {
    const pres = new PptxGenJS();
    
    // Configurações Gerais
    // 2) Garanta que o layout seja exatamente 16:9 padrão: width: 10, height: 5.625
    pres.defineLayout({ name:'GAZETA_STANDARD', width: 10, height: 5.625 });
    pres.layout = 'GAZETA_STANDARD';
    
    pres.author = "Gazeta Gestão";
    pres.company = "Rede Gazeta";
    pres.title = "DFC Semanal";

    // Cores Corporativas
    const COLOR_PRIMARY = "1e3a8a"; // Azul Marinho
    const COLOR_SEC = "0f766e";     // Teal
    const COLOR_ACCENT = "be123c";  // Rose
    const COLOR_TEXT = "334155";    // Slate

    // --- DADOS ---
    const receivables = transactions.filter(t => t.type === TransactionType.RECEIVABLE);
    const payables = transactions.filter(t => t.type === TransactionType.PAYABLE);
    
    const totalRec = summary.totalInflow;
    const totalPay = summary.totalOutflow;
    const totalInv = summary.totalInvested;
    // Estimativa de saldo inicial (Final - Entradas + Saidas - Investimentos)
    const initialBalance = summary.balance - totalRec + totalPay + totalInv;

    // ==========================================
    // SLIDE 1: CAPA DINÂMICA
    //   Fundo = arte 3D (azul claro) com os campos de valor em branco.
    //   Os textos abaixo são escritos a cada relatório com os dados do período importado.
    // ==========================================
    const slide1 = pres.addSlide();
    slide1.background = { color: "020610" };
    // Arte de fundo full-bleed (16:9 = 10 x 5.625)
    slide1.addImage({ data: COVER_TEMPLATE, x: 0, y: 0, w: 10, h: 5.625 });

    // --- Dados dinâmicos da capa ---
    const fmtMi = (v: number): string => {
        const a = Math.abs(v);
        if (a >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " mi";
        if (a >= 1e3) return "R$ " + (v / 1e3).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " mil";
        return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const parseD = (s?: string): Date | null => {
        if (!s) return null;
        const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return null;
        let y = +m[3]; if (y < 100) y += 2000;
        return new Date(y, +m[2] - 1, +m[1]);
    };
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmtD = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const dts = transactions.map(t => parseD(t.date)).filter((d): d is Date => !!d).map(d => +d);
    const periodIni = dts.length ? fmtD(new Date(Math.min(...dts))) : "—";
    const periodFim = dts.length ? fmtD(new Date(Math.max(...dts))) : "—";
    const hoje = fmtD(new Date());
    const netFlow = summary.totalInflow - summary.totalOutflow - (summary.totalInvested || 0);

    // Cores da capa (azul claro)
    const C_VAL = "DCE9FF", C_ACC = "8FC6FF", C_DIM = "6FA6D6";
    // Opções base dos valores da barra de KPIs.
    // >>> AJUSTE FINO: se algum valor ficar levemente acima/abaixo do slot, mude apenas o "y" (em polegadas). <<<
    const kv = { fontFace: "Arial", bold: true, color: C_VAL, fontSize: 13, align: "left" as const, valign: "middle" as const };

    // Pílula de período (topo, ao lado do ícone de calendário)
    slide1.addText(`${periodIni}  A  ${periodFim}`, { x: 4.31, y: 1.58, w: 3.3, h: 0.40, fontFace: "Arial", bold: true, color: C_ACC, fontSize: 14, align: "left", valign: "middle" });

    // Barra de KPIs (apenas os VALORES; rótulos/ícones já estão na arte)
    slide1.addText(fmtMi(summary.balance),      { ...kv, x: 2.42, y: 4.67, w: 1.35, h: 0.34 }); // SALDO PREVISTO
    slide1.addText(fmtMi(summary.totalInflow),  { ...kv, x: 3.62, y: 4.67, w: 1.35, h: 0.34 }); // ENTRADAS
    slide1.addText(fmtMi(summary.totalOutflow), { ...kv, x: 4.82, y: 4.67, w: 1.35, h: 0.34 }); // SAÍDAS
    slide1.addText(fmtMi(netFlow),              { ...kv, x: 6.34, y: 4.67, w: 1.35, h: 0.34 }); // FLUXO LÍQUIDO

    // Coluna PERÍODO (2 linhas)
    slide1.addText(periodIni,      { x: 7.54, y: 4.62, w: 1.7, h: 0.26, fontFace: "Arial", bold: true, color: C_ACC, fontSize: 11, align: "left", valign: "middle" });
    slide1.addText("a " + periodFim, { x: 7.54, y: 4.84, w: 1.7, h: 0.26, fontFace: "Arial", bold: true, color: C_ACC, fontSize: 11, align: "left", valign: "middle" });

    // Rodapé: data de geração
    slide1.addText(`GERADO EM ${hoje} • VERSÃO 1.0`, { x: 6.36, y: 5.28, w: 3.45, h: 0.22, fontFace: "Arial", bold: true, color: C_DIM, fontSize: 8, align: "left", valign: "middle" });

    // ==========================================
    // SLIDE 2: RECEBIMENTOS
    // ==========================================
    let slide2 = pres.addSlide();
    slide2.background = { color: "FFFFFF" };
    
    slide2.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLOR_SEC } });
    slide2.addText("Análise de Recebimentos", { x: 0.5, y: 0.25, fontSize: 24, color: "FFFFFF", bold: true });
    slide2.addText(`Total: R$ ${totalRec.toLocaleString("pt-BR", {notation: 'compact'})}`, { x: 8, y: 0.35, fontSize: 16, color: "FFFFFF", align: "right" });

    // Agrupar Recebimentos por Cliente/Descrição
    const groupedRec = receivables.reduce((acc, t) => {
        const name = (t.customer || t.description || "Outros").substring(0, 20);
        acc[name] = (acc[name] || 0) + t.value;
        return acc;
    }, {} as Record<string, number>);
    
    const topRecData = Object.entries(groupedRec)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    if (topRecData.length > 0) {
        const chartDataRec = [
            {
                name: "Recebimentos",
                labels: topRecData.map(d => d[0]),
                values: topRecData.map(d => d[1])
            }
        ];
        
        slide2.addChart(pres.ChartType.bar, chartDataRec, {
            x: 0.5, y: 1.5, w: 9, h: 5,
            barDir: 'bar',
            barGrouping: 'clustered',
            chartColors: [COLOR_SEC],
            valAxisLabelFormatCode: "R$ #,##0",
            dataLabelFormatCode: "R$ #,##0_,-",
            showValue: true,
            showLegend: false,
            title: "Top Maiores Recebimentos"
        });
    } else {
        slide2.addText("Sem dados de recebimentos para exibir.", { x: 1, y: 3, color: "94a3b8" });
    }

    // ==========================================
    // SLIDE 3: PAGAMENTOS
    // ==========================================
    let slide3 = pres.addSlide();
    slide3.background = { color: "FFFFFF" };
    
    slide3.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: COLOR_ACCENT } });
    slide3.addText("Detalhamento de Pagamentos", { x: 0.5, y: 0.25, fontSize: 24, color: "FFFFFF", bold: true });
    slide3.addText(`Total: R$ ${totalPay.toLocaleString("pt-BR", {notation: 'compact'})}`, { x: 8, y: 0.35, fontSize: 16, color: "FFFFFF", align: "right" });

    // Agrupar Pagamentos por Fornecedor
    const groupedPay = payables.reduce((acc, t) => {
        const name = (t.supplier || t.description || "Outros").substring(0, 25);
        acc[name] = (acc[name] || 0) + t.value;
        return acc;
    }, {} as Record<string, number>);

    const topPayData = Object.entries(groupedPay)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    if (topPayData.length > 0) {
        const chartDataPay = [
            {
                name: "Pagamentos",
                labels: topPayData.map(d => d[0]),
                values: topPayData.map(d => d[1])
            }
        ];

        slide3.addChart(pres.ChartType.bar, chartDataPay, {
            x: 0.5, y: 1.5, w: 9, h: 5,
            barDir: 'bar',
            chartColors: [COLOR_ACCENT],
            valAxisLabelFormatCode: "R$ #,##0",
            dataLabelFormatCode: "R$ #,##0",
            showValue: true,
            showLegend: false,
            title: "Top Maiores Saídas"
        });
    } else {
        slide3.addText("Sem dados de pagamentos para exibir.", { x: 1, y: 3, color: "94a3b8" });
    }

    // ==========================================
    // SLIDE 4: APLICAÇÕES
    // ==========================================
    let slide4 = pres.addSlide();
    slide4.background = { color: "FFFFFF" };
    
    // Header
    slide4.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: "100%", h: 1.0, fill: { color: "1e40af" } }); // Blue 800
    slide4.addText("Posição de Investimentos", { x: 0.5, y: 0.25, fontSize: 24, color: "FFFFFF", bold: true });

    // Conteúdo Central
    slide4.addShape(pres.ShapeType.rect, { x: 2, y: 2, w: 6, h: 2.5, fill: { color: "F1F5F9" }, line: { color: "1e40af", width: 2 } });
    
    slide4.addText("Saldo Total Aplicado", {
        x: 2, y: 2.5, w: 6, fontSize: 18, color: "64748B", align: "center"
    });

    slide4.addText(`R$ ${totalInv.toLocaleString("pt-BR", {minimumFractionDigits: 2})}`, {
        x: 2, y: 3.2, w: 6, fontSize: 40, color: "1e40af", bold: true, align: "center"
    });

    slide4.addText("Valores consolidados em fundos de liquidez diária e aplicações automáticas.", {
        x: 2, y: 5.5, w: 6, fontSize: 12, color: "94a3b8", align: "center", italic: true
    });
    
    // Gerar e Baixar
    await pres.writeFile({ fileName: "Apresentacao_Financeira_Gazeta.pptx" });
}
