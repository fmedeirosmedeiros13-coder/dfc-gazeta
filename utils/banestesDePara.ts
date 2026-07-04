// GERADO de Empresas_e_Contas_correntes.xlsx.
// Mapeia o número da conta corrente Banestes para o código de empresa.
//
// IMPORTANTE: o extrato Banestes traz o CNPJ/razão social de cada conta, mas
// esse nome às vezes é uma razão social antiga/diferente da usada no sistema
// (ex.: a conta da TV Norte aparece no extrato como "SISTEMA N DE R E T LTDA").
// Por isso o casamento é SEMPRE pelo número da conta, nunca pelo nome.
//
// Cada empresa tem, além da conta principal listada aqui, uma "conta caixa"
// auxiliar no mesmo extrato (usada para movimentação interna). Contas que não
// aparecem neste De-Para são consideradas auxiliares e são ignoradas na
// importação — não alimentam o SD Inicial.

export const BANESTES_CONTA_TO_COMPANY: Record<string, string> = {
  '1824663':  '1',  // S/A GAZETA
  '1825330':  '2',  // TV GAZETA
  '7100464':  '3',  // TV CACHOEIRO
  '5694195':  '4',  // TV NORTE
  '3854742':  '5',  // RÁDIO MIX
  '3728847':  '6',  // FM 102
  '11468493': '14', // VÍDEO
  '16650368': '17', // DIFUSORA
  '19266964': '18', // CIDADÃ
  '28962694': '22', // FM LINHARES
  '26070987': '23', // RD NOVA GERAÇÃO
};

/** Resolve o companyCode a partir do número da conta (aceita com ou sem pontuação). */
export function resolveCompanyFromContaBanestes(conta: string | undefined | null): string | null {
  if (!conta) return null;
  const digits = String(conta).replace(/\D/g, '').replace(/^0+/, '');
  return BANESTES_CONTA_TO_COMPANY[digits] ?? null;
}
