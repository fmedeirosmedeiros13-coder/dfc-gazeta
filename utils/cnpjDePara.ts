// De-Para por CNPJ — cobre as 11 empresas do grupo. Ao contrário do número de
// conta (que muda de banco pra banco e às vezes de agência pra agência), o
// CNPJ é fixo e serve pra qualquer banco que traga esse dado no extrato
// (confirmado com a Caixa — CEF traz CNPJ direto no cabeçalho).
//
// Fonte: Empresas_e_Contas_correntes.xlsx.

export const CNPJ_TO_COMPANY: Record<string, string> = {
  '28133619000193': '1',  // S/A GAZETA
  '27063726000120': '2',  // TV GAZETA
  '31494693000140': '3',  // TV CACHOEIRO
  '32465841000160': '4',  // TV NORTE
  '32417164000105': '5',  // RÁDIO MIX
  '32418014000116': '6',  // FM 102
  '32435315000158': '14', // VÍDEO
  '27468008000133': '17', // DIFUSORA
  '01772939000137': '18', // CIDADÃ
  '10978533000104': '22', // FM LINHARES
  '27736586000103': '23', // RD NOVA GERAÇÃO
};

/** Resolve o companyCode a partir do CNPJ (aceita formatado ou só dígitos). */
export function resolveCompanyFromCNPJ(cnpj: string | undefined | null): string | null {
  if (!cnpj) return null;
  const digits = String(cnpj).replace(/\D/g, '');
  return CNPJ_TO_COMPANY[digits] ?? null;
}
