// GERADO a partir da Base_Aplicação.xlsx (relatório TOTVS de operações financeiras).
// Mapeia o "C/C Padrão" (identificador da conta de aplicação) para o código de
// empresa do sistema — necessário porque o relatório não traz a empresa direto,
// só um mnemônico de conta.
//
// Confirmado com o usuário em 02/07/2026:
//   - Todos os sufixos abaixo mapeiam pela empresa indicada pelo próprio nome.
//   - "Banest-CBN" foi confirmado explicitamente como RD MIX ('5').
//   - "BANES-TEMP", "BANESAMALF", "Banes-PF" e "Banes-TM2" NÃO têm empresa
//     definida — ficam de fora do mapa de propósito. Não adivinhar aqui:
//     o import pergunta ao usuário quando encontrar uma conta não mapeada.

export const CC_PADRAO_TO_COMPANY: Record<string, string> = {
  'BANES-CIDA':  '18', // Cidadã
  'BANES-DIFU':  '17', // Difusora
  'BANES-NGER':  '23', // Rádio Nova Geração
  'BANESVIDEO':  '14', // Vídeo
  'BANES-TVCV':  '3',  // TV Cachoeiro
  'BANES-TVG':   '2',  // TV Gazeta
  'BANES-TVN':   '4',  // TV Norte
  'BANESFM102':  '6',  // FM 102
  'USB-TVG':     '2',
  'USB-TVC':     '3',
  'USB-TVN':     '4',
  'USB-VIDEO':   '14',
  'BANEST-CBN':  '5',  // RD MIX — confirmado explicitamente pelo usuário
};

/** Normaliza um C/C Padrão para lookup (remove espaços/hífen/case). */
function normCC(cc: string): string {
  return String(cc || '').trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '-');
}

/**
 * Resolve o código de empresa a partir do C/C Padrão.
 * Retorna null quando a conta não está mapeada (o import deve perguntar
 * ao usuário, nunca chutar).
 */
export function resolveCompanyFromCCPadrao(ccPadrao: string | undefined | null): string | null {
  if (!ccPadrao) return null;
  const key = normCC(ccPadrao);
  // Tenta igualdade exata primeiro (após normalizar espaços/case).
  for (const [k, v] of Object.entries(CC_PADRAO_TO_COMPANY)) {
    if (normCC(k) === key) return v;
  }
  return null;
}
