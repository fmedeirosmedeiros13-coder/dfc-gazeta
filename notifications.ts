/**
 * services/notifications.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquestrador de notificações proativas.
 *
 * CANAIS SUPORTADOS:
 *   1. Browser Notifications (Web Push API)
 *      Funciona em desktop e mobile sem app instalado.
 *      Requer permissão do usuário.
 *      Exibe mesmo com o tab em segundo plano.
 *
 *   2. E-mail via API (Resend / SendGrid)
 *      Briefing diário às 8h com resumo do DFC.
 *      Alerta imediato para críticos.
 *      Requer backend/serverless para não expor API key.
 *
 *   3. In-app Toast
 *      Notificação dentro da própria interface.
 *      Funciona sem permissão e sem backend.
 *      Implementado diretamente aqui via callback.
 *
 * REGRAS DE DISPARO:
 *   • Vencimento crítico (≤3 dias):  notificação imediata, todos os canais
 *   • Saldo negativo projetado:      notificação imediata, todos os canais
 *   • Desvio >30%:                   notificação imediata
 *   • Briefing diário:               enviado às 8h se app estiver aberto
 *   • Concentração >50%:             aviso semanal
 *
 * USO:
 *   import { notificationService } from './notifications';
 *
 *   // Configurar na inicialização do App
 *   notificationService.init({ onToast: (msg) => addToast(msg) });
 *
 *   // Processar alertas — dispara notificações conforme as regras
 *   await notificationService.processAlerts(alerts);
 *
 *   // Enviar briefing matinal
 *   await notificationService.sendDailyBriefing(summary, aiAnalysis);
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Alert, AlertSeverity }    from '../engines/alerts';
import type { ExecutiveAnalysis }       from './claudeService';
import type { FinancialSummary }        from '../types';
import { auditLog }                     from '../engines/auditLog';
import { formatCurrency }               from '../utils/finance';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ToastMessage {
  id:        string;
  severity:  AlertSeverity;
  title:     string;
  body:      string;
  action?:   { label: string; onClick: () => void };
  duration?: number; // ms, default 5000
}

export interface NotificationConfig {
  /** Callback para exibir toast in-app. */
  onToast?: (msg: ToastMessage) => void;
  /** URL do endpoint de email (Vercel Function, etc). */
  emailEndpoint?: string;
  /** Endereço de e-mail do destinatário. */
  emailTo?: string;
  /** Habilitar Browser Notifications. Default: true. */
  enableBrowser?: boolean;
}

// ─── Deduplicação de notificações ─────────────────────────────────────────────

/** Evita repetir a mesma notificação na mesma sessão. */
const notifiedIds = new Set<string>();

function wasNotified(alertId: string): boolean {
  return notifiedIds.has(alertId);
}
function markNotified(alertId: string): void {
  notifiedIds.add(alertId);
}

// ─── Browser Notifications ────────────────────────────────────────────────────

async function requestBrowserPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted')  return true;
  if (Notification.permission === 'denied')   return false;

  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

function sendBrowserNotification(
  title:   string,
  body:    string,
  options?: { icon?: string; tag?: string; requireInteraction?: boolean },
): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  new Notification(title, {
    body,
    icon:                '/favicon.ico',
    badge:               '/favicon.ico',
    tag:                 options?.tag,
    requireInteraction:  options?.requireInteraction ?? false,
  });
}

// ─── E-mail via backend ───────────────────────────────────────────────────────

interface EmailPayload {
  to:      string;
  subject: string;
  html:    string;
}

async function sendEmail(endpoint: string, payload: EmailPayload): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.warn('[notifications] Falha ao enviar e-mail:', err);
    return false;
  }
}

function buildAlertEmailHTML(alerts: Alert[]): string {
  const critical = alerts.filter(a => a.severity === 'critical');
  const warnings = alerts.filter(a => a.severity === 'warning');

  const rows = (items: Alert[], color: string) =>
    items.map(a => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:${color};font-weight:500">${a.title}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;color:#64748b">${a.description}</td>
        <td style="padding:8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#334155">
          ${formatCurrency(a.impactValue)}
        </td>
      </tr>`).join('');

  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e293b;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#f8fafc;margin:0;font-size:20px">⚠ Alertas DFC — Rede Gazeta</h1>
        <p style="color:#94a3b8;margin:8px 0 0">${new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
        ${critical.length > 0 ? `
          <h2 style="color:#be123c;font-size:14px;text-transform:uppercase;letter-spacing:.05em">
            🚨 Críticos (${critical.length})
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
            <thead>
              <tr style="background:#fef2f2">
                <th style="padding:8px;text-align:left;color:#7f1d1d;font-size:12px">Alerta</th>
                <th style="padding:8px;text-align:left;color:#7f1d1d;font-size:12px">Descrição</th>
                <th style="padding:8px;text-align:right;color:#7f1d1d;font-size:12px">Impacto</th>
              </tr>
            </thead>
            <tbody>${rows(critical, '#be123c')}</tbody>
          </table>` : ''}
        ${warnings.length > 0 ? `
          <h2 style="color:#b45309;font-size:14px;text-transform:uppercase;letter-spacing:.05em">
            ⚠ Atenção (${warnings.length})
          </h2>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#fffbeb">
                <th style="padding:8px;text-align:left;color:#78350f;font-size:12px">Alerta</th>
                <th style="padding:8px;text-align:left;color:#78350f;font-size:12px">Descrição</th>
                <th style="padding:8px;text-align:right;color:#78350f;font-size:12px">Impacto</th>
              </tr>
            </thead>
            <tbody>${rows(warnings, '#b45309')}</tbody>
          </table>` : ''}
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;text-align:center">
          DFC Gazeta · Controladoria · ${new Date().toLocaleString('pt-BR')}
        </p>
      </div>
    </div>`;
}

function buildDailyBriefingHTML(
  summary:  FinancialSummary,
  analysis: ExecutiveAnalysis | null,
): string {
  const net = summary.totalInflow - summary.totalOutflow;
  const netColor = net >= 0 ? '#15803d' : '#be123c';

  return `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1e293b;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#f8fafc;margin:0;font-size:20px">📊 Briefing DFC — Rede Gazeta</h1>
        <p style="color:#94a3b8;margin:8px 0 0">${new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
          <div style="background:#fff;padding:16px;border-radius:8px;text-align:center;border:1px solid #e2e8f0">
            <div style="color:#15803d;font-size:18px;font-weight:600">${formatCurrency(summary.totalInflow)}</div>
            <div style="color:#64748b;font-size:12px;margin-top:4px">Entradas</div>
          </div>
          <div style="background:#fff;padding:16px;border-radius:8px;text-align:center;border:1px solid #e2e8f0">
            <div style="color:#be123c;font-size:18px;font-weight:600">${formatCurrency(summary.totalOutflow)}</div>
            <div style="color:#64748b;font-size:12px;margin-top:4px">Saídas</div>
          </div>
          <div style="background:#fff;padding:16px;border-radius:8px;text-align:center;border:1px solid #e2e8f0">
            <div style="color:${netColor};font-size:18px;font-weight:600">${formatCurrency(net)}</div>
            <div style="color:#64748b;font-size:12px;margin-top:4px">Resultado</div>
          </div>
        </div>
        ${analysis ? `
          <div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #e2e8f0;margin-bottom:16px">
            <h3 style="color:#1e293b;font-size:14px;margin:0 0 8px">Análise Executiva</h3>
            <p style="color:#475569;font-size:13px;line-height:1.6;margin:0">${analysis.summary}</p>
          </div>
          ${analysis.actionItems?.length > 0 ? `
            <div style="background:#fff;padding:16px;border-radius:8px;border:1px solid #e2e8f0">
              <h3 style="color:#1e293b;font-size:14px;margin:0 0 8px">Ações Recomendadas</h3>
              ${analysis.actionItems.slice(0, 3).map(a =>
                `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
                  <span style="font-size:11px;color:${a.priority === 'alta' ? '#be123c' : a.priority === 'média' ? '#b45309' : '#64748b'};
                    font-weight:600;text-transform:uppercase">${a.priority}</span>
                  <span style="color:#334155;font-size:13px;margin-left:8px">${a.description}</span>
                  <span style="color:#94a3b8;font-size:11px;display:block;margin-top:2px">${a.area} · ${a.deadline}</span>
                </div>`
              ).join('')}
            </div>` : ''}` : ''}
        <p style="color:#94a3b8;font-size:12px;margin-top:24px;text-align:center">
          DFC Gazeta · Controladoria · ${new Date().toLocaleString('pt-BR')}
        </p>
      </div>
    </div>`;
}

// ─── Serviço principal ────────────────────────────────────────────────────────

class NotificationService {
  private config: NotificationConfig = {};
  private dailyBriefingSent = false;
  private dailyBriefingDate = '';

  /** Inicializa o serviço com configuração. Solicita permissão browser. */
  async init(config: NotificationConfig): Promise<void> {
    this.config = config;
    if (config.enableBrowser !== false) {
      await requestBrowserPermission();
    }
  }

  /** Exibe um toast in-app. */
  toast(msg: Omit<ToastMessage, 'id'>): void {
    if (!this.config.onToast) return;
    this.config.onToast({ ...msg, id: `toast-${Date.now()}` });
  }

  /**
   * Processa uma lista de alertas e dispara notificações conforme as regras.
   * Chame sempre que os alertas forem recalculados.
   */
  async processAlerts(alerts: Alert[]): Promise<void> {
    const criticals = alerts.filter(a => a.severity === 'critical' && !wasNotified(a.id));
    const warnings  = alerts.filter(a => a.severity === 'warning'  && !wasNotified(a.id));

    // In-app toast para cada crítico
    for (const alert of criticals) {
      this.toast({
        severity: 'critical',
        title:    alert.title,
        body:     alert.description,
        duration: 8000,
      });
      sendBrowserNotification(
        `⚠ ${alert.title}`,
        alert.description,
        { requireInteraction: true, tag: alert.id },
      );
      markNotified(alert.id);
    }

    // Toast agrupado para avisos
    if (warnings.length > 0) {
      this.toast({
        severity: 'warning',
        title:    `${warnings.length} aviso(s) financeiro(s)`,
        body:     warnings[0].title + (warnings.length > 1 ? ` e mais ${warnings.length - 1}...` : ''),
        duration: 5000,
      });
      warnings.forEach(a => markNotified(a.id));
    }

    // E-mail de alertas críticos (quando configurado)
    if (criticals.length > 0 && this.config.emailEndpoint && this.config.emailTo) {
      await sendEmail(this.config.emailEndpoint, {
        to:      this.config.emailTo,
        subject: `🚨 DFC Gazeta — ${criticals.length} alerta(s) crítico(s)`,
        html:    buildAlertEmailHTML(criticals),
      });
    }
  }

  /**
   * Envia o briefing diário às 8h.
   * Deve ser chamado periodicamente (ex: a cada minuto).
   * Só envia uma vez por dia.
   */
  async sendDailyBriefing(
    summary:  FinancialSummary,
    analysis: ExecutiveAnalysis | null,
  ): Promise<boolean> {
    const now   = new Date();
    const today = now.toISOString().slice(0, 10);
    const hour  = now.getHours();

    // Só envia entre 8h e 9h, uma vez por dia
    if (hour < 8 || hour >= 9) return false;
    if (this.dailyBriefingSent && this.dailyBriefingDate === today) return false;

    // Browser notification
    sendBrowserNotification(
      '📊 Briefing DFC — Bom dia!',
      `Resultado do período: ${formatCurrency(summary.totalInflow - summary.totalOutflow)}`,
      { tag: 'daily-briefing' },
    );

    // E-mail
    let emailSent = false;
    if (this.config.emailEndpoint && this.config.emailTo) {
      emailSent = await sendEmail(this.config.emailEndpoint, {
        to:      this.config.emailTo,
        subject: `📊 DFC Gazeta — Briefing ${now.toLocaleDateString('pt-BR')}`,
        html:    buildDailyBriefingHTML(summary, analysis),
      });
    }

    this.dailyBriefingSent = true;
    this.dailyBriefingDate = today;

    await auditLog.record({
      action:  'SESSION_START',
      subject: 'daily-briefing',
      reason:  `Briefing diário ${emailSent ? 'enviado por e-mail' : 'exibido localmente'}`,
    });

    return true;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const notificationService = new NotificationService();
