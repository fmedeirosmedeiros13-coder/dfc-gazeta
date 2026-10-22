// ─── Banco local (IndexedDB) — configuração ÚNICA ─────────────────────────────
// Todas as partes do app abrem o MESMO banco 'dfc-gazeta'. Antes, cada uma usava
// uma versão diferente (1, 2, 3 e 5): quem pedia versão menor que a já existente
// recebia "VersionError" e ficava SEM salvar — por isso os valores digitados no
// FC Diário (Resg Aplic, Transf, SD Inicial) e os lançamentos sumiam ao
// recarregar a página. Agora todos usam esta versão e criam todas as tabelas.

export const DB_NAME = 'dfc-gazeta';
export const DB_VERSION = 6;

/** Cria qualquer tabela (store) que ainda não exista. Não mexe nas existentes. */
export function ensureAllStores(db: IDBDatabase): void {
  const plain = ['transactions', 'realized', 'manual-values'];
  for (const s of plain) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);

  if (!db.objectStoreNames.contains('snapshots')) {
    const st = db.createObjectStore('snapshots', { keyPath: 'id' });
    st.createIndex('capturedAt', 'capturedAt');
  }
  for (const s of ['previsto-periods', 'realizado-periods', 'application-positions']) {
    if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('audit-log')) {
    const st = db.createObjectStore('audit-log', { keyPath: 'id' });
    st.createIndex('timestamp', 'timestamp');
    st.createIndex('action', 'action');
    st.createIndex('subject', 'subject');
    st.createIndex('sessionId', 'sessionId');
  }
}

// ─── Outra aba aberta segurando o banco ───────────────────────────────────────
// Se uma aba ANTIGA do app estiver aberta, o navegador não deixa a aba nova usar
// o banco até a antiga ser fechada — e nesse meio tempo NADA é salvo (os valores
// se perdem ao recarregar). Avisa o usuário uma vez para fechar as outras abas.
let blockedWarned = false;
export function warnDbBlocked(): void {
  if (blockedWarned) return;
  blockedWarned = true;
  console.warn('[idb] Banco bloqueado por outra aba do app.');
  try {
    alert('Há outra aba do DFC Gestão aberta.\n\nFeche as OUTRAS abas do sistema e deixe só esta — enquanto houver outra aberta, o que você digitar NÃO fica salvo.');
  } catch { /* ignore */ }
}

/** Ao abrir o banco: se uma versão mais nova do app pedir, esta aba libera na hora. */
export function releaseOnUpgrade(db: IDBDatabase): IDBDatabase {
  db.onversionchange = () => db.close();
  return db;
}
