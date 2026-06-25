/**
 * services/deployService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dispara um novo deploy na Vercel usando a API oficial.
 * O token é lido de VITE_VERCEL_DEPLOY_TOKEN (variável de ambiente da Vercel).
 * O project slug é lido de VITE_VERCEL_PROJECT_SLUG (padrão: "dfc").
 * O team slug é lido de VITE_VERCEL_TEAM_SLUG.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type DeployStatus = 'idle' | 'deploying' | 'success' | 'error';

export interface DeployResult {
  success: boolean;
  message: string;
  deployUrl?: string;
}

/**
 * Dispara um redeploy do último deployment de produção.
 * Usa o endpoint POST /v13/deployments da Vercel API.
 */
export async function triggerRedeploy(): Promise<DeployResult> {
  const token       = import.meta.env.VITE_VERCEL_DEPLOY_TOKEN;
  const projectSlug = import.meta.env.VITE_VERCEL_PROJECT_SLUG ?? 'dfc';
  const teamSlug    = import.meta.env.VITE_VERCEL_TEAM_SLUG ?? 'fabios-projects-3395b63c';

  if (!token) {
    return {
      success: false,
      message: 'Token de deploy não configurado. Adicione VITE_VERCEL_DEPLOY_TOKEN nas variáveis de ambiente da Vercel.',
    };
  }

  try {
    // 1. Buscar o último deployment de produção para pegar o ID
    const listRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${projectSlug}&teamId=${teamSlug}&target=production&limit=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Erro ao buscar deployments: ${listRes.status} — ${err}`);
    }

    const listData = await listRes.json();
    const lastDeployment = listData.deployments?.[0];

    if (!lastDeployment) {
      throw new Error('Nenhum deployment anterior encontrado para redeployar.');
    }

    // 2. Disparar redeploy
    const redeployRes = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${teamSlug}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deploymentId: lastDeployment.uid,
          name:         projectSlug,
          target:       'production',
        }),
      }
    );

    if (!redeployRes.ok) {
      const err = await redeployRes.text();
      throw new Error(`Erro ao disparar deploy: ${redeployRes.status} — ${err}`);
    }

    const redeployData = await redeployRes.json();

    return {
      success:   true,
      message:   'Deploy iniciado com sucesso! O sistema estará atualizado em cerca de 1 minuto.',
      deployUrl: redeployData.url ? `https://${redeployData.url}` : undefined,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[deployService]', err);
    return {
      success: false,
      message: `Falha ao publicar: ${message}`,
    };
  }
}

/** Retorna true se o token de deploy está configurado. */
export function hasDeployToken(): boolean {
  return !!import.meta.env.VITE_VERCEL_DEPLOY_TOKEN;
}
