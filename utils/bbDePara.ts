// De-Para: conta corrente Banco do Brasil (agência 3431-2) -> código de empresa.
// Cada empresa tem seu extrato em um PDF separado (diferente do Banestes, que
// vem consolidado num único arquivo com todas as contas).

export const BB_CONTA_TO_COMPANY: Record<string, string> = {
  '46558': '1',  // SA A GAZETA — conta 4655-8
  '36013': '2',  // A GAZETA DO ESP SANTO RAD (TV Gazeta) — conta 3601-3
  '70734': '3',  // TELEVISAO CACHOEIRO LTDA — conta 7073-4
  '40711': '4',  // SISTEMA NORTE RADIO E TV (TV Norte) — conta 4071-1
  '51233': '6',  // RADIO FM 102 LTDA — conta 5123-3
  // RD MIX (5) também tem conta BB pelo cadastro de bancos, mas ainda não
  // recebemos o extrato dela — adicionar aqui quando vier.
};

/** Resolve o companyCode a partir do número da conta (aceita com ou sem hífen). */
export function resolveCompanyFromContaBB(conta: string | undefined | null): string | null {
  if (!conta) return null;
  const digits = String(conta).replace(/\D/g, '').replace(/^0+/, '');
  return BB_CONTA_TO_COMPANY[digits] ?? null;
}
