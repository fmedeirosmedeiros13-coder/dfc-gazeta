// ─── Textos da "Análise do Período" (Demonstrativo Executivo) ────────────────
// Quatro redações diferentes sobre os MESMOS números, seguindo os modelos da
// Tesouraria (Resumo Gerencial da gestora e "Principais Recebimentos e
// Pagamentos"). São geradas por regras a partir dos dados do sistema — não há
// modelo de IA externo. Todo texto deve ser revisado antes de circular.

export interface DadosAnalise {
  inicio: string; fim: string;                 // dd/mm/aaaa
  saldoInicial: number; entradas: number; saidasTotal: number; saidasOp: number; capex: number; lucros: number;
  resgPor: Record<string, number>; aplPor: Record<string, number>;
  resgPorDia: Record<string, number>; aplPorDia: Record<string, number>;   // dd/mm
  appIni: number;
  mutuos: { de: string; para: string; valor: number; dias: string[] } | null;   // nomes completos
  zeradas: string[];
  recPorDia: Record<string, number>;
  recParticular: number; recGovF: number; recGovE: number; recGovM: number;
  topClientesParticular: string[];
  recPorSegmento: { tv: number; agDigital: number; radios: number };
  pagPorCategoria: Record<string, number>;     // Folha, Administrativas, Operativas, Impostos…
  rubricas: [string, number][];                // 5 maiores rubricas (Folha, INSS, FIBRA…)
  diaFolha?: string; diaImpostos?: string;
  topFornecedoresNF: string[];
  siglas: Record<string, string>;              // id → sigla (VÍDEO, TVN…)
  necessidade?: { inicio: string; total: number; falta: number; porEmpresa: [string, number][] } | null;   // resgate ainda não lançado (FC Diário)
}

const mil = (v: number) => `R$ ${Math.round(Math.abs(v) / 1000).toLocaleString('pt-BR')} mil`;
const milS = (v: number) => `${v < 0 ? '-' : ''}${mil(v)}`;
const reais = (v: number) => `${v < 0 ? '-' : ''}R$ ${Math.round(Math.abs(v)).toLocaleString('pt-BR')}`;
const pctN = (v: number, t: number) => (t ? (v / t) * 100 : 0);
const pct = (v: number, t: number, casas = 0) => `${pctN(v, t).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const lista = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
const dm = (d: string) => d.slice(0, 5);
const dma = (d: string) => `${d.slice(0, 6)}${d.slice(8, 10)}`;   // dd/mm/aa
const ordDias = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0).sort((a, b) => (a[0].slice(3) + a[0].slice(0, 2)).localeCompare(b[0].slice(3) + b[0].slice(0, 2)));

/** Valor por extenso (inteiro, em reais). Ex.: 1.460.000 → "um milhão, quatrocentos e sessenta mil reais". */
export function porExtenso(valor: number): string {
  const n = Math.round(Math.abs(valor));
  if (n === 0) return 'zero real';
  const u = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const d = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const c = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
  const ate999 = (x: number): string => {
    if (x === 100) return 'cem';
    const p: string[] = [];
    if (x >= 100) { p.push(c[Math.floor(x / 100)]); x %= 100; }
    if (x >= 20) { p.push(d[Math.floor(x / 10)]); x %= 10; }
    if (x > 0) p.push(u[x]);
    return p.join(' e ');
  };
  const grupos: [number, string, string][] = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil'], [1, '', '']];
  const partes: string[] = []; let resto = n;
  for (const [div, sing, plur] of grupos) {
    const q = Math.floor(resto / div); resto %= div;
    if (!q) continue;
    if (div === 1e3 && q === 1) partes.push('mil');
    else partes.push(div === 1 ? ate999(q) : `${ate999(q)} ${q === 1 ? sing : plur}`);
  }
  let txt = partes.length > 1 ? partes.slice(0, -1).join(', ') + (resto < 100 || n % 1000 === 0 || n % 100 === 0 ? ' e ' : ', ') + partes[partes.length - 1] : partes[0];
  if (/(milhão|milhões|bilhão|bilhões)$/.test(txt)) txt += ' de';
  return `${txt} ${n === 1 ? 'real' : 'reais'}`;
}

export function gerarAnalise(variante: number, x: DadosAnalise): string {
  const resultadoOp = x.entradas - x.saidasOp;
  const variacao = resultadoOp - x.capex - x.lucros;
  const totResg = Object.values(x.resgPor).reduce((a, b) => a + b, 0);
  const totApl = Object.values(x.aplPor).reduce((a, b) => a + b, 0);
  const nec = x.necessidade && x.necessidade.total > 0.5 ? x.necessidade : null;
  const necTot = nec?.total || 0;
  const appFim = x.appIni + totApl - totResg - necTot;
  const caixaFim = x.saldoInicial + x.entradas - x.saidasTotal + totResg - totApl + necTot;
  const dispon = caixaFim + appFim;
  const sg = (id: string) => x.siglas[id] || id;
  const det = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c, v]) => `${sg(c)}: ${mil(v)}`).join(' | ');
  const gov = x.recGovF + x.recGovE + x.recGovM;
  const totRec = x.recParticular + gov || x.entradas;
  const [diaTop, vTop] = Object.entries(x.recPorDia).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const cats = Object.entries(x.pagPorCategoria).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top5cats = cats.slice(0, 5); const somaTop5 = top5cats.reduce((a, [, v]) => a + v, 0);
  const encargos = ['Folha', '13º Salário', 'INSS', 'FGTS', 'IR/PIS'];
  const enc = x.rubricas.filter(([g]) => encargos.includes(g)), op = x.rubricas.filter(([g]) => !encargos.includes(g));
  const somaRub = x.rubricas.reduce((a, [, v]) => a + v, 0), somaEnc = enc.reduce((a, [, v]) => a + v, 0);
  const extrasInv = [x.capex > 0 ? `${mil(x.capex)} de CAPEX` : '', x.lucros > 0 ? `${mil(x.lucros)} de distribuição de lucros` : ''].filter(Boolean);

  // frases reaproveitadas
  const fraseResgates = (cheio: boolean) => ordDias(x.resgPorDia).map(([d, v]) => cheio
      ? `resgatar no dia ${dm(d)} o montante de ${reais(v)} (${porExtenso(v)})` : `resgatar ${mil(v)} em ${dm(d)}`);
  const fraseAplic = (cheio: boolean) => ordDias(x.aplPorDia).map(([d, v]) => cheio
      ? `aplicar no dia ${dm(d)} o valor de ${reais(v)} (${porExtenso(v)})` : `aplicar ${mil(v)} em ${dm(d)}`);
  const fraseMutuo = (estilo: 'gestora' | 'curto') => !x.mutuos ? '' : estilo === 'gestora'
      ? `Previsto repasse de mútuo de ${mil(x.mutuos.valor)} da ${x.mutuos.de} para a ${x.mutuos.para}${x.mutuos.dias.length ? ` em ${lista(x.mutuos.dias)}` : ''}. Efeito neutro no caixa consolidado do grupo, mas reduz a disponibilidade da ${x.mutuos.de} e reforça o caixa da ${x.mutuos.para}.`
      : `Também está previsto mútuo de ${reais(x.mutuos.valor)} da ${x.mutuos.de} para a ${x.mutuos.para}${x.mutuos.dias.length ? ` (${lista(x.mutuos.dias)})` : ''}.`;
  const fraseNec = !nec ? '' : `Necessidade total de resgate prevista para a semana: ${mil(nec.total)}, a partir de ${dm(nec.inicio)} (${nec.porEmpresa.map(([n, v]) => `${n} ${mil(v)}`).join(' · ')}). ${nec.falta > 0.5 ? `A aplicação não cobre tudo — falta aporte/mútuo de ${mil(nec.falta)}.` : 'Há saldo em aplicação suficiente.'}`;
  const fraseZeradas = x.zeradas.length ? `Com os resgates previstos, a aplicação da ${lista(x.zeradas)} ficará ZERADA.` : '';
  const govDet = () => {
    const p: string[] = [];
    // só níveis que arredondam para 1% ou mais (evita "0% Gov. Federal")
    if (pctN(x.recGovF, totRec) >= 0.5) p.push(`${pct(x.recGovF, totRec)} Gov. Federal`);
    if (pctN(x.recGovE, totRec) >= 0.5) p.push(`${pct(x.recGovE, totRec)} Gov. Estadual`);
    if (pctN(x.recGovM, totRec) >= 0.5) p.push(`${pct(x.recGovM, totRec)} Gov. Municipal`);
    return p;
  };
  const segmentos = () => {
    const s = x.recPorSegmento, t = s.tv + s.agDigital + s.radios || totRec;
    return `A Televisão contempla ${pct(s.tv, t)} desta previsão, AG Digital ${pct(s.agDigital, t)} e Rádios ${pct(s.radios, t)}.`;
  };
  const catsTxt = () => top5cats.map(([c, v], i) => i === 0 ? `${pct(v, x.saidasTotal)} desse valor refere-se a despesas com ${c}` : `${pct(v, x.saidasTotal)} ${c}`).join(', ')
      + (x.saidasTotal - somaTop5 > 0.5 ? ` e ${pct(x.saidasTotal - somaTop5, x.saidasTotal)} nos demais grupos` : '');
  const debitos = [x.diaFolha ? `Folha de pagamento (dia ${x.diaFolha})` : '', x.diaImpostos ? `Impostos (dia ${x.diaImpostos})` : ''].filter(Boolean);

  const out: string[] = [];
  const v = ((variante - 1) % 4 + 4) % 4 + 1;

  if (v === 1) {
    // ── Modelo da gestora (Resumo Gerencial) ──
    out.push('CAIXA OPERACIONAL E TOTAL DE DISPONIBILIDADES');
    out.push(`Resumo Gerencial: ${resultadoOp >= 0 ? 'Superávit' : 'Déficit'} operacional de ${mil(resultadoOp)} (entradas de ${mil(x.entradas)} vs. saídas de ${mil(x.saidasOp)}). ${extrasInv.length ? `Somando ${lista(extrasInv)}, a` : 'A'} variação líquida de caixa é de ${milS(variacao)}, ${variacao < 0 ? `absorvida pelo saldo inicial em conta corrente${totResg > 0 ? ' e resgates' : ''}` : 'reforçando o saldo em conta corrente'}.`);
    if (x.appIni > 0 || totResg || totApl) {
      const movs = [totResg ? `resgates de ${mil(totResg)} (${det(x.resgPor)})` : '', totApl ? `aplicações de ${mil(totApl)} (${det(x.aplPor)})` : '', necTot ? `o resgate necessário previsto de ${mil(necTot)}` : ''].filter(Boolean);
      out.push(`Saldo em Aplicações: Posição inicial de ${mil(x.appIni)}.${movs.length ? ` Com ${lista(movs)}, o saldo final aplicado encerra em ${mil(appFim)}` : ' Sem aplicações ou resgates previstos, o saldo aplicado se mantém'} — totalizando ${mil(dispon)} em disponibilidades consolidadas.`);
    }
    if (x.entradas > 0 && diaTop) out.push(pctN(vTop, x.entradas) >= 40
      ? `Entradas (${mil(x.entradas)}): Forte concentração no dia ${dm(diaTop)} (${mil(vTop)} | ${pct(vTop, x.entradas, 1)} do total), garantindo liquidez imediata; os demais dias somam ${mil(x.entradas - vTop)} (${pct(x.entradas - vTop, x.entradas, 1)}).`
      : `Entradas (${mil(x.entradas)}): Distribuídas ao longo do período; o maior dia é ${dm(diaTop)} (${mil(vTop)} | ${pct(vTop, x.entradas, 1)} do total).`);
    if (x.rubricas.length) {
      const l = [`Saídas (${mil(x.saidasOp)}): ${pct(somaRub, x.saidasOp, 1)} concentrados em ${x.rubricas.length} rubricas principais:`];
      if (enc.length) l.push(`• Folha e Encargos (${pct(somaEnc, x.saidasOp, 1)}): ${lista(enc.map(([g, val]) => `${g} (${mil(val)})`))}.`);
      const opI = op.map(([g, val]) => `${g} (${mil(val)} | ${pct(val, x.saidasOp, 1)})`);
      const demais = x.saidasOp - somaRub; if (demais > 0.5) opI.push(`demais pagamentos (${mil(demais)} | ${pct(demais, x.saidasOp, 1)})`);
      if (opI.length) l.push(`• Operacional e Outros (${pct(x.saidasOp - somaEnc, x.saidasOp, 1)}): ${lista(opI)}.`);
      out.push(l.join('\n'));
    }
    const dest = [fraseNec, fraseMutuo('gestora'), fraseZeradas].filter(Boolean);
    if (dest.length) out.push(`⚠ ATENÇÃO / DESTAQUE: ${dest.join(' ')}`);
  } else if (v === 2) {
    // ── Modelo "Principais Recebimentos e Pagamentos" ──
    out.push('ANÁLISE GERAL — PRINCIPAIS RECEBIMENTOS E PAGAMENTOS');
    const acoes = [...fraseResgates(true), ...fraseAplic(true)];
    out.push(`Saldo nas Contas-Correntes: O Saldo Inicial é de ${reais(x.saldoInicial)}. A previsão de recebimento é de ${reais(x.entradas)} e a de pagamentos é de ${reais(x.saidasTotal)}, resultando num Saldo Final de ${reais(caixaFim)}.`
      + (acoes.length ? ` Está previsto para este fluxo ${lista(acoes)} para saldar os pagamentos.` : (fraseNec ? '' : ' Não há resgates ou aplicações previstos para esta semana.'))
      + (fraseNec ? ` ⚠ ${fraseNec}` : '') + (x.mutuos ? ` ${fraseMutuo('curto')}` : '') + (fraseZeradas ? ` ${fraseZeradas}` : ''));
    const r = [`Recebimentos:`, `• O total de recebimentos previsto no período de ${dma(x.inicio)} a ${dma(x.fim)} é de ${reais(x.entradas)};`];
    if (totRec) r.push(`• ${pct(x.recParticular, totRec)} estão concentrados na carteira Particular${x.topClientesParticular.length ? ` (os principais clientes são: ${lista(x.topClientesParticular.slice(0, 3))})` : ''}${gov ? ` e Governo: ${pct(gov, totRec)}${govDet().length ? `, sendo ${lista(govDet())}` : ''}` : ''};`);
    r.push(`• ${segmentos()}`);
    out.push(r.join('\n'));
    const p = [`Pagamentos:`, `• O valor estimado para desembolso é de ${reais(x.saidasTotal)};`];
    if (top5cats.length) p.push(`• ${catsTxt()};`);
    if (debitos.length) p.push(`• Esse fluxo contempla os valores de ${lista(debitos)};`);
    if (x.topFornecedoresNF.length) p.push(`• Os principais fornecedores de notas fiscais para pagamento desta semana são: ${lista(x.topFornecedoresNF.slice(0, 4))}.`);
    out.push(p.join('\n'));
  } else if (v === 3) {
    // ── Gestora, redação alternativa (visão executiva) ──
    out.push('POSIÇÃO DE CAIXA E DISPONIBILIDADES DO PERÍODO');
    out.push(`Visão Geral: O período parte de ${mil(x.saldoInicial)} em conta corrente e deve encerrar em ${mil(caixaFim)}. As entradas previstas (${mil(x.entradas)}) ${resultadoOp >= 0 ? 'superam' : 'não cobrem'} as saídas operacionais (${mil(x.saidasOp)}), gerando ${resultadoOp >= 0 ? 'superávit' : 'déficit'} operacional de ${mil(resultadoOp)}${extrasInv.length ? `; com ${lista(extrasInv)}, o caixa varia ${milS(variacao)}` : ''}.`);
    if (x.appIni > 0 || totResg || totApl || necTot) out.push(`Aplicações: O saldo aplicado passa de ${mil(x.appIni)} para ${mil(appFim)}${necTot ? ` (já considerando o resgate necessário de ${mil(necTot)})` : ''}${totResg ? `, com ${mil(totResg)} resgatados (${det(x.resgPor)})` : ''}${totApl ? `${totResg ? ' e' : ', com'} ${mil(totApl)} aplicados (${det(x.aplPor)})` : ''}${!totResg && !totApl && !necTot ? ', sem movimentação prevista' : ''}. As disponibilidades consolidadas somam ${mil(dispon)}.`);
    if (x.entradas > 0 && diaTop) out.push(`Recebimentos: O pico de entradas ocorre em ${dm(diaTop)}, com ${mil(vTop)} (${pct(vTop, x.entradas)} da semana)${x.topClientesParticular.length ? `; os maiores clientes são ${lista(x.topClientesParticular.slice(0, 3))}` : ''}${gov ? `, e o Governo responde por ${pct(gov, totRec)} do previsto` : ''}.`);
    if (x.rubricas.length) out.push(`Desembolsos: ${enc.length ? `Folha e encargos respondem por ${pct(somaEnc, x.saidasOp)} das saídas operacionais (${lista(enc.map(([g, val]) => `${g} ${mil(val)}`))})` : `As cinco maiores rubricas somam ${pct(somaRub, x.saidasOp)} das saídas`}${op.length ? `; entre os demais, destaca-se ${op[0][0]} (${mil(op[0][1])})` : ''}${debitos.length ? `. Datas-chave: ${lista(debitos)}` : ''}.`);
    const dest = [fraseNec, fraseMutuo('gestora'), fraseZeradas].filter(Boolean);
    if (dest.length) out.push(`⚠ PONTO DE ATENÇÃO: ${dest.join(' ')}`);
  } else {
    // ── "Principais Recebimentos e Pagamentos", redação compacta ──
    out.push(`RESUMO DA SEMANA (${dm(x.inicio)} A ${dm(x.fim)})`);
    const acoes = [...fraseResgates(false), ...fraseAplic(false)];
    out.push(`Caixa: Começamos com ${reais(x.saldoInicial)} e devemos fechar com ${reais(caixaFim)}, após receber ${reais(x.entradas)} e pagar ${reais(x.saidasTotal)}.${acoes.length ? ` Para isso, está previsto ${lista(acoes)}.` : ''}${x.mutuos ? ` ${fraseMutuo('curto')}` : ''}`);
    if (totRec) out.push(`Origem das entradas: ${pct(x.recParticular, totRec)} vêm da carteira Particular${x.topClientesParticular.length ? ` (${lista(x.topClientesParticular.slice(0, 3))})` : ''}${gov ? ` e ${pct(gov, totRec)} do Governo` : ''}. Por segmento: TV ${pct(x.recPorSegmento.tv, totRec)}, AG Digital ${pct(x.recPorSegmento.agDigital, totRec)} e Rádios ${pct(x.recPorSegmento.radios, totRec)}.`);
    if (top5cats.length) out.push(`Destino das saídas: ${top5cats.map(([c, val]) => `${c} ${pct(val, x.saidasTotal)}`).join(', ')}${x.saidasTotal - somaTop5 > 0.5 ? `, demais ${pct(x.saidasTotal - somaTop5, x.saidasTotal)}` : ''}.${debitos.length ? ` Atenção às datas de ${lista(debitos)}.` : ''}`);
    if (x.topFornecedoresNF.length) out.push(`Fornecedores em destaque: ${lista(x.topFornecedoresNF)}.`);
    const dest4 = [fraseNec, fraseZeradas].filter(Boolean);
    if (dest4.length) out.push(`⚠ ATENÇÃO: ${dest4.join(' ')}`);
  }
  return out.join('\n\n');
}
