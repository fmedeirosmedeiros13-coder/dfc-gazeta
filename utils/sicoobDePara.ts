// De-Para: conta corrente Sicoob -> código de empresa.
// Pelo cadastro de bancos do grupo (BANKS_MAPPING em utils/finance.ts), só a
// TV Norte tem conta no Sicoob — por isso o mapa tem uma única entrada.
// Se outra empresa vier a abrir conta Sicoob, é só acrescentar aqui.

export const SICOOB_CONTA_TO_COMPANY: Record<string, string> = {
  '727130': '4', // SISTEMA NORTE DE RADIO E TELEVISAO LTDA (TV Norte) — conta 72.713-0
};

/** Resolve o companyCode a partir do número da conta (aceita com ou sem pontuação/hífen). */
export function resolveCompanyFromContaSicoob(conta: string | undefined | null): string | null {
  if (!conta) return null;
  const digits = String(conta).replace(/\D/g, '').replace(/^0+/, '');
  return SICOOB_CONTA_TO_COMPANY[digits] ?? null;
}
