import PptxGenJS from "pptxgenjs";
import { FinancialSummary, Transaction, TransactionType } from "../types";

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
    // SLIDE 1: CAPA / RESUMO DFC
    // ==========================================
    let slide1 = pres.addSlide();
    slide1.background = { color: "F1F5F9" };
    
    // Barra Lateral Decorativa
    slide1.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 1.0, h: "100%", fill: { color: COLOR_PRIMARY } });
    
    // Título
    slide1.addText("Demonstrativo de Fluxo de Caixa", {
        x: 1.5, y: 0.8, w: 8, fontSize: 36, color: COLOR_PRIMARY, bold: true, fontFace: "Arial"
    });
    slide1.addText(`Posição Consolidada Semanal`, {
        x: 1.5, y: 1.5, fontSize: 18, color: "64748B", fontFace: "Arial"
    });

    // Tabela Resumo
    const rows: any[] = [
        [
            { text: "Indicador", options: { fill: { color: COLOR_PRIMARY }, color: "FFFFFF", bold: true, align: "center" as const } },
            { text: "Valor (R$)", options: { fill: { color: COLOR_PRIMARY }, color: "FFFFFF", bold: true, align: "right" as const } }
        ],
        ["Saldo Inicial (Estimado)", { text: initialBalance.toLocaleString("pt-BR", {minimumFractionDigits: 2}), options: { align: "right" as const } }],
        ["(+) Entradas", { text: totalRec.toLocaleString("pt-BR", {minimumFractionDigits: 2}), options: { align: "right" as const, color: "15803d", bold: true } }], // Green
        ["(-) Saídas", { text: totalPay.toLocaleString("pt-BR", {minimumFractionDigits: 2}), options: { align: "right" as const, color: "b91c1c", bold: true } }], // Red
        ["(-) Investimentos", { text: totalInv.toLocaleString("pt-BR", {minimumFractionDigits: 2}), options: { align: "right" as const, color: "1e40af" } }], // Blue
        ["(=) Saldo Final", { text: summary.balance.toLocaleString("pt-BR", {minimumFractionDigits: 2}), options: { align: "right" as const, bold: true, fill: { color: "E2E8F0" } } }]
    ];

    slide1.addTable(rows, {
        x: 2.5, y: 2.5, w: 6, rowH: 0.5,
        border: { pt: 1, color: "CBD5E1" },
        fill: { color: "FFFFFF" },
        fontSize: 14,
        align: "left"
    });

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
