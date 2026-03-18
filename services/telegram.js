const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const { execFileSync } = require('child_process');
const { assistantIA } = require('./assistant');
const { analyseOCRFacture, analyseOCRPaiement } = require('./ocr');

const sessions = new Map();
const historyLog = [];
const PASSWORD = 'DZM2026';

function money(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA';
}
function addHistory(type, summary, details = {}) {
  historyLog.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, summary, details, at: new Date().toISOString() });
  if (historyLog.length > 60) historyLog.length = 60;
}
function setSession(chatId, patch) {
  const current = sessions.get(chatId) || {};
  sessions.set(chatId, { ...current, ...patch });
}
function clearSession(chatId) {
  const current = sessions.get(chatId) || {};
  if (current.tempFiles) current.tempFiles.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  sessions.delete(chatId);
}
function detectStructure(input) {
  const v = String(input || '').toUpperCase();
  return v.includes('DZM B') ? 'DZM B' : 'DZM A';
}
function getBaseUrl() {
  return (process.env.BACKEND_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 3001}`).replace(/\/$/, '');
}
function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📊 Statut', '⚡ À traiter'],
        ['🧾 Nouvelle facture', '💳 Nouveau paiement'],
        ['📦 Retour emballages', '🎁 Paiement ristourne'],
        ['🔄 Rapprochements', '🚨 Alertes'],
        ['🌅 Brief du matin', '🌙 Bilan du soir'],
        ['⚖️ Comparer A/B', '🧭 Copilote'],
        ['🤖 Assistant IA', '📝 Décision'],
        ['📋 Réunion', '🕘 Historique'],
        ['📄 Document intelligent', '📤 Exports'],
        ['🔊 Brief vocal', '🎙️ Bilan vocal'],
        ['ℹ️ Aide'],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };
}
function getInlineMenu() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: '📊 Statut', callback_data: 'menu:status' },
        { text: '⚡ À traiter', callback_data: 'menu:todo' },
      ], [
        { text: '🧾 Factures', callback_data: 'menu:factures' },
        { text: '💳 Paiements', callback_data: 'menu:paiements' },
      ]],
    },
  };
}
async function apiGet(pathname, responseType = 'json') {
  const res = await axios.get(`${getBaseUrl()}${pathname}`, { responseType });
  return res.data;
}
async function apiPost(pathname, payload) {
  const res = await axios.post(`${getBaseUrl()}${pathname}`, payload);
  return res.data;
}
async function apiPostFile(pathname, filePath, fields = {}) {
  const form = new FormData();
  form.append('image', fs.createReadStream(filePath));
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  const res = await axios.post(`${getBaseUrl()}${pathname}`, form, { headers: form.getHeaders(), maxBodyLength: Infinity });
  return res.data;
}
async function quickStatus(supabase) {
  const [{ data: factures }, { data: paiements }, { data: mouvements }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(50),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(50),
    supabase.from('emballages_mouvements').select('*').order('date_mouvement', { ascending: false }).limit(50),
  ]);
  const anomalies = (factures || []).filter((f) => String(f.statut || '').toLowerCase() === 'anomalie').length;
  const attente = (paiements || []).filter((p) => String(p.statut || '').toLowerCase() === 'en attente');
  const totalAttente = attente.reduce((s, p) => s + Number(p.montant || 0), 0);
  const recusA = (factures || []).filter((f) => detectStructure(f.structure) === 'DZM A').reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const recusB = (factures || []).filter((f) => detectStructure(f.structure) === 'DZM B').reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const renvAInvoice = (factures || []).filter((f) => detectStructure(f.structure) === 'DZM A').reduce((s, f) => s + Number(f.casiers_retournes || 0), 0);
  const renvBInvoice = (factures || []).filter((f) => detectStructure(f.structure) === 'DZM B').reduce((s, f) => s + Number(f.casiers_retournes || 0), 0);
  const renvA = (mouvements || []).filter((m) => detectStructure(m.structure) === 'DZM A').reduce((s, m) => s + Number(m.emballages_vides || 0), 0) + renvAInvoice;
  const renvB = (mouvements || []).filter((m) => detectStructure(m.structure) === 'DZM B').reduce((s, m) => s + Number(m.emballages_vides || 0), 0) + renvBInvoice;
  return [
    '📊 Statut DZM',
    `• Factures récentes : ${(factures || []).length}`,
    `• Paiements récents : ${(paiements || []).length}`,
    `• Paiements en attente : ${attente.length} (${money(totalAttente)})`,
    `• Anomalies facture : ${anomalies}`,
    `• Solde emballages DZM A : ${recusA - renvA}`,
    `• Solde emballages DZM B : ${recusB - renvB}`,
  ].join('\n');
}
async function sendVoice(bot, chatId, text, name) {
  const base = path.join(os.tmpdir(), `${name || 'dzm'}-${Date.now()}`);
  const wav = `${base}.wav`;
  const ogg = `${base}.ogg`;
  try {
    execFileSync('espeak', ['-v', 'fr', '-s', '145', '-w', wav, text], { stdio: 'ignore' });
    execFileSync('ffmpeg', ['-y', '-i', wav, '-acodec', 'libopus', ogg], { stdio: 'ignore' });
    await bot.sendVoice(chatId, fs.createReadStream(ogg));
  } finally {
    [wav, ogg].forEach((f) => { try { fs.unlinkSync(f); } catch {} });
  }
}
async function downloadTelegramFile(bot, msg) {
  const fileId = msg.photo?.[msg.photo.length - 1]?.file_id || msg.document?.file_id;
  if (!fileId) return null;
  const link = await bot.getFileLink(fileId);
  const ext = path.extname(new URL(link).pathname) || (msg.document?.mime_type?.includes('png') ? '.png' : '.jpg');
  const out = path.join(os.tmpdir(), `tg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`);
  const res = await axios.get(link, { responseType: 'arraybuffer' });
  fs.writeFileSync(out, Buffer.from(res.data));
  return out;
}
function summarizeInvoice(ocr) {
  const colis = Number(ocr.colis || (ocr.produits || []).reduce((s, p) => s + Number(p.quantite || 0), 0));
  const embPlein = Number(ocr.emb_plein || ocr.nombre_casiers || 0);
  const embVide = Number(ocr.emb_vide || ocr.casiers_retournes || 0);
  return [
    '🧾 Facture détectée',
    `• N° : ${ocr.numero_facture || '—'}`,
    `• Structure : ${detectStructure(ocr.structure)}`,
    `• Client : ${ocr.client || '—'}`,
    `• Date : ${ocr.date_facture || '—'}`,
    `• Total TTC : ${money(ocr.total_ttc || 0)}`,
    `• Casiers / EMB Plein : ${embPlein}`,
    `• EMB Vide : ${embVide}`,
    `• Solde emballages facture : ${embPlein - embVide}`,
    `• Colis : ${colis}`,
    `• Confiance : ${ocr.confiance || 0}%`,
  ].join('\n');
}
function summarizePayment(ocr) {
  return [
    '💳 Paiement détecté',
    `• Transaction : ${ocr.transaction_id || '—'}`,
    `• Structure : ${detectStructure(ocr.structure)}`,
    `• Montant : ${money(ocr.montant || 0)}`,
    `• Référence facture : ${ocr.reference_facture || '—'}`,
    `• Bénéficiaire : ${ocr.beneficiaire || '—'}`,
    `• Date : ${ocr.date_paiement || '—'}`,
    `• Opérateur : ${ocr.operateur || '—'}`,
    `• Confiance : ${ocr.confiance || 0}%`,
  ].join('\n');
}
async function savePendingInvoice(bot, chatId, session) {
  const uploaded = await apiPostFile('/api/files/upload', session.tempFiles[0], { type: 'facture' }).catch(() => null);
  const o = session.pendingInvoice;
  const payload = {
    ...o,
    structure: detectStructure(o.structure),
    source: 'telegram',
    produits: (o.produits || []).map((line) => ({
      produit: String(line.produit || '').trim(),
      quantite: Number(line.quantite || 0),
      prix_unitaire: Number(line.prix_unitaire ?? line.prixUnitaire ?? 0),
      total: Number(line.total || 0),
    })),
    image_url: uploaded?.url || null,
    image_public_id: uploaded?.public_id || null,
  };
  await apiPost('/api/factures/from-ocr', payload);
  addHistory('invoice', `Facture ${o.numero_facture || 'sans numéro'} enregistrée`, { structure: detectStructure(o.structure), total: o.total_ttc || 0 });
  await bot.sendMessage(chatId, `✅ Facture enregistrée avec succès.\n${summarizeInvoice(o)}`, getMainMenu());
  clearSession(chatId);
}
async function savePendingPayment(bot, chatId, session) {
  const uploaded = await apiPostFile('/api/files/upload', session.tempFiles[0], { type: 'paiement' }).catch(() => null);
  const p = session.pendingPayment;
  const payload = { ...p, structure: detectStructure(p.structure), source: 'telegram', image_url: uploaded?.url || null, image_public_id: uploaded?.public_id || null };
  await apiPost('/api/paiements/from-ocr', payload);
  addHistory('payment', `Paiement ${p.transaction_id || 'sans ID'} enregistré`, { structure: detectStructure(p.structure), montant: p.montant || 0 });
  await bot.sendMessage(chatId, `✅ Paiement enregistré avec succès.\n${summarizePayment(p)}`, getMainMenu());
  clearSession(chatId);
}
async function buildToDoMessage(supabase) {
  const status = await quickStatus(supabase);
  const [rapprochements, ristournes] = await Promise.all([
    apiGet('/api/rapprochements').catch(() => []),
    apiGet('/api/ristournes').catch(() => []),
  ]);
  const pendingRappro = (rapprochements || []).filter((r) => r.statut !== 'rapproché').length;
  const pendingRist = (ristournes || []).filter((r) => r.statut !== 'payée').length;
  return `${status}\n\n⚡ À traiter\n• Rapprochements à valider : ${pendingRappro}\n• Ristournes non soldées : ${pendingRist}`;
}
function ask(bot, chatId, text) { return bot.sendMessage(chatId, text, getMainMenu()); }
async function handleExportCallback(bot, chatId, table) {
  const buffer = await apiGet(`/api/export/${table}`, 'arraybuffer');
  await bot.sendDocument(chatId, Buffer.from(buffer), {}, { filename: `DZM_${table}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
module.exports = function setupTelegram(bot, supabase) {
  if (!bot) return;

  bot.onText(/\/start/, async (msg) => {
    clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'Bienvenue sur le bot DZM V3. Choisis une fonction dans le menu ci-dessous.', getMainMenu());
  });
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, 'Bot DZM V3\n• Utilise les boutons pour agir vite\n• Tu peux envoyer directement une photo après “Nouvelle facture” ou “Nouveau paiement”\n• Les actions importantes demandent toujours confirmation', getMainMenu());
  });
  bot.onText(/\/status/, async (msg) => ask(bot, msg.chat.id, await quickStatus(supabase)));
  bot.onText(/\/brief/, async (msg) => ask(bot, msg.chat.id, await assistantIA('Prépare un brief du matin clair, pédagogique et orienté action pour DZM A et DZM B.', [], supabase)));
  bot.onText(/\/bilan/, async (msg) => ask(bot, msg.chat.id, await assistantIA('Prépare un bilan du soir clair, pédagogique et orienté action pour DZM A et DZM B.', [], supabase)));
  bot.onText(/\/alertes/, async (msg) => ask(bot, msg.chat.id, await assistantIA('Résume les alertes critiques, anomalies, paiements à rapprocher, ristournes et emballages à surveiller.', [], supabase)));
  bot.onText(/\/ia (.+)/, async (msg, match) => ask(bot, msg.chat.id, `Reformulation : tu veux une analyse métier.\n\n${await assistantIA((match?.[1] || '').trim(), [], supabase)}`));

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data || '';
    try {
      if (data.startsWith('rappr:')) {
        const [, paiement_id, facture_id, montant] = data.split(':');
        await apiPost('/api/rapprochements', { paiement_id, facture_id, montant_impute: Number(montant || 0), source: 'telegram', score: 95 });
        addHistory('decision', `Rapprochement validé via Telegram`, { paiement_id, facture_id });
        await bot.answerCallbackQuery(query.id, { text: 'Rapprochement validé' });
        await ask(bot, chatId, '✅ Rapprochement enregistré.');
      } else if (data.startsWith('export:')) {
        const [, table] = data.split(':');
        await bot.answerCallbackQuery(query.id, { text: 'Export en cours…' });
        await handleExportCallback(bot, chatId, table);
      }
    } catch (error) {
      await bot.answerCallbackQuery(query.id, { text: 'Erreur', show_alert: false });
      await ask(bot, chatId, `Erreur : ${error.message}`);
    }
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();
    const session = sessions.get(chatId) || {};

    try {
      // Media-driven flows first
      if (msg.photo || msg.document) {
        if (!session.mode || !['new-invoice-wait-file', 'new-payment-wait-file', 'smart-doc-wait-file'].includes(session.mode)) {
          await ask(bot, chatId, 'J’ai bien reçu un document. Utilise d’abord “🧾 Nouvelle facture”, “💳 Nouveau paiement” ou “📄 Document intelligent”.');
          return;
        }
        const filePath = await downloadTelegramFile(bot, msg);
        setSession(chatId, { tempFiles: [filePath] });
        if (session.mode === 'new-invoice-wait-file') {
          const result = await analyseOCRFacture(filePath, null);
          setSession(chatId, { mode: 'confirm-invoice', pendingInvoice: result, tempFiles: [filePath] });
          await bot.sendMessage(chatId, `${summarizeInvoice(result)}\n\nRéponds avec :\n• ✅ Enregistrer facture\n• ❌ Annuler`, getMainMenu());
          return;
        }
        if (session.mode === 'new-payment-wait-file') {
          const result = await analyseOCRPaiement(filePath, null);
          setSession(chatId, { mode: 'confirm-payment', pendingPayment: result, tempFiles: [filePath] });
          await bot.sendMessage(chatId, `${summarizePayment(result)}\n\nRéponds avec :\n• ✅ Enregistrer paiement\n• ❌ Annuler`, getMainMenu());
          return;
        }
        // smart document
        const invoice = await analyseOCRFacture(filePath, null).catch(() => ({}));
        const payment = await analyseOCRPaiement(filePath, null).catch(() => ({}));
        const paymentScore = (payment.transaction_id ? 35 : 0) + (payment.montant ? 20 : 0);
        const invoiceScore = (invoice.numero_facture ? 35 : 0) + ((invoice.produits || []).length ? 20 : 0) + (invoice.total_ttc ? 15 : 0);
        if (paymentScore > invoiceScore) {
          setSession(chatId, { mode: 'confirm-payment', pendingPayment: payment, tempFiles: [filePath] });
          await bot.sendMessage(chatId, `📄 Document intelligent : j’interprète ce document comme un paiement.\n\n${summarizePayment(payment)}\n\nRéponds avec :\n• ✅ Enregistrer paiement\n• ❌ Annuler`, getMainMenu());
        } else {
          setSession(chatId, { mode: 'confirm-invoice', pendingInvoice: invoice, tempFiles: [filePath] });
          await bot.sendMessage(chatId, `📄 Document intelligent : j’interprète ce document comme une facture.\n\n${summarizeInvoice(invoice)}\n\nRéponds avec :\n• ✅ Enregistrer facture\n• ❌ Annuler`, getMainMenu());
        }
        return;
      }

      if (!text) return;
      if (text.startsWith('/')) return;

      // Confirmation flows
      if (session.mode === 'confirm-invoice') {
        if (text === '✅ Enregistrer facture') return savePendingInvoice(bot, chatId, sessions.get(chatId));
        if (text === '❌ Annuler') { clearSession(chatId); return ask(bot, chatId, 'Opération annulée.'); }
      }
      if (session.mode === 'confirm-payment') {
        if (text === '✅ Enregistrer paiement') return savePendingPayment(bot, chatId, sessions.get(chatId));
        if (text === '❌ Annuler') { clearSession(chatId); return ask(bot, chatId, 'Opération annulée.'); }
      }

      // Guided flows
      if (session.mode === 'awaiting-ai-question') {
        clearSession(chatId);
        return ask(bot, chatId, `Reformulation : tu veux une analyse métier.\n\n${await assistantIA(text, [], supabase)}`);
      }
      if (session.mode === 'decision-awaiting') {
        addHistory('decision', text, { from: 'telegram' });
        clearSession(chatId);
        return ask(bot, chatId, '📝 Décision enregistrée dans l’historique rapide.');
      }
      if (session.mode === 'emballages-step') {
        const data = session.data || {};
        if (session.step === 'structure') {
          setSession(chatId, { step: 'qty', data: { ...data, structure: detectStructure(text) } });
          return ask(bot, chatId, 'Indique maintenant la quantité d’emballages vides renvoyés.');
        }
        if (session.step === 'qty') {
          setSession(chatId, { step: 'reference', data: { ...data, emballages_vides: Number(text.replace(/\D/g, '') || 0) } });
          return ask(bot, chatId, 'Référence facture (ou tape “aucune”).');
        }
        if (session.step === 'reference') {
          setSession(chatId, { step: 'date', data: { ...data, reference_facture: text.toLowerCase() === 'aucune' ? '' : text } });
          return ask(bot, chatId, 'Date du mouvement (YYYY-MM-DD) ou tape “aujourd’hui”.');
        }
        if (session.step === 'date') {
          const payload = { ...data, date_mouvement: text.toLowerCase().includes('aujourd') ? new Date().toISOString().slice(0, 10) : text, note: 'Saisi via Telegram' };
          await apiPost('/api/emballages/manual', payload);
          addHistory('emballages', `Retour emballages ${payload.structure}`, payload);
          clearSession(chatId);
          return ask(bot, chatId, '✅ Retour d’emballages enregistré.');
        }
      }
      if (session.mode === 'ristourne-step') {
        const data = session.data || {};
        if (session.step === 'structure') { setSession(chatId, { step: 'reference', data: { ...data, structure: detectStructure(text) } }); return ask(bot, chatId, 'Référence facture ?'); }
        if (session.step === 'reference') { setSession(chatId, { step: 'amount', data: { ...data, reference_facture: text } }); return ask(bot, chatId, 'Montant reçu ?'); }
        if (session.step === 'amount') { setSession(chatId, { step: 'date', data: { ...data, montant_recu: Number(text.replace(/\D/g, '') || 0) } }); return ask(bot, chatId, 'Date de paiement (YYYY-MM-DD) ou tape “aujourd’hui”.'); }
        if (session.step === 'date') { setSession(chatId, { step: 'mode', data: { ...data, date_paiement: text.toLowerCase().includes('aujourd') ? new Date().toISOString().slice(0, 10) : text } }); return ask(bot, chatId, 'Mode de paiement ?'); }
        if (session.step === 'mode') {
          const payload = { ...data, mode_paiement: text, commentaire: 'Saisi via Telegram', password: PASSWORD };
          await apiPost('/api/ristournes/manual', payload);
          addHistory('ristourne', `Paiement ristourne ${payload.reference_facture}`, payload);
          clearSession(chatId);
          return ask(bot, chatId, '✅ Paiement de ristourne enregistré.');
        }
      }

      // Buttons / menus
      if (text === '📊 Statut') return ask(bot, chatId, await quickStatus(supabase));
      if (text === '⚡ À traiter') return ask(bot, chatId, await buildToDoMessage(supabase));
      if (text === '🧾 Nouvelle facture') { setSession(chatId, { mode: 'new-invoice-wait-file' }); return ask(bot, chatId, 'Envoie maintenant la photo ou le document de la facture.'); }
      if (text === '💳 Nouveau paiement') { setSession(chatId, { mode: 'new-payment-wait-file' }); return ask(bot, chatId, 'Envoie maintenant la capture ou le document du paiement.'); }
      if (text === '📄 Document intelligent') { setSession(chatId, { mode: 'smart-doc-wait-file' }); return ask(bot, chatId, 'Envoie maintenant le document. Je vais déterminer s’il s’agit d’une facture ou d’un paiement.'); }
      if (text === '📦 Retour emballages') { setSession(chatId, { mode: 'emballages-step', step: 'structure', data: {} }); return ask(bot, chatId, 'Pour quelle structure ? Réponds par DZM A ou DZM B.'); }
      if (text === '🎁 Paiement ristourne') { setSession(chatId, { mode: 'ristourne-step', step: 'structure', data: {} }); return ask(bot, chatId, 'Pour quelle structure ? Réponds par DZM A ou DZM B.'); }
      if (text === '🔄 Rapprochements') {
        const rows = await apiGet('/api/rapprochements').catch(() => []);
        const subset = (rows || []).filter((r) => r.statut !== 'rapproché').slice(0, 5);
        if (!subset.length) return ask(bot, chatId, 'Aucun paiement non rapproché trouvé.');
        for (const row of subset) {
          await bot.sendMessage(chatId, `${row.transaction_id} — ${money(row.montant_paiement)} — ${row.numero_facture || 'aucune proposition'} — score ${row.score}%`, {
            reply_markup: { inline_keyboard: row.facture_id ? [[{ text: '✅ Valider le rapprochement', callback_data: `rappr:${row.paiement_id}:${row.facture_id}:${row.montant_paiement}` }]] : [] },
          });
        }
        return bot.sendMessage(chatId, 'Sélectionne les rapprochements à valider.', getMainMenu());
      }
      if (text === '🚨 Alertes') return ask(bot, chatId, await assistantIA('Résume les alertes critiques, anomalies, paiements à rapprocher et ristournes à surveiller.', [], supabase));
      if (text === '🌅 Brief du matin') return ask(bot, chatId, await assistantIA('Prépare un brief du matin clair, pédagogique et orienté action pour DZM A et DZM B.', [], supabase));
      if (text === '🌙 Bilan du soir') return ask(bot, chatId, await assistantIA('Prépare un bilan du soir clair, pédagogique et orienté action pour DZM A et DZM B.', [], supabase));
      if (text === '⚖️ Comparer A/B') return ask(bot, chatId, await assistantIA('Compare DZM A et DZM B sur les achats, paiements, emballages, ristournes et anomalies. Réponse structurée et concise.', [], supabase));
      if (text === '🧭 Copilote') return ask(bot, chatId, await assistantIA('Agis comme un copilote opérationnel DZM. Donne les priorités du moment, les anomalies, les rapprochements à valider et la prochaine meilleure action.', [], supabase));
      if (text === '🤖 Assistant IA') { setSession(chatId, { mode: 'awaiting-ai-question' }); return ask(bot, chatId, 'Pose maintenant ta question en langage naturel.'); }
      if (text === '📝 Décision') { setSession(chatId, { mode: 'decision-awaiting' }); return ask(bot, chatId, 'Décris maintenant la décision à enregistrer (ex: doublon écrasé, facture validée malgré OCR faible, etc.).'); }
      if (text === '📋 Réunion') return ask(bot, chatId, await assistantIA('Prépare un résumé de réunion très lisible sur DZM A / DZM B : achats, paiements, emballages, ristournes, anomalies, actions prioritaires.', [], supabase));
      if (text === '🕘 Historique') {
        if (!historyLog.length) return ask(bot, chatId, 'Historique rapide vide pour le moment.');
        return ask(bot, chatId, ['🕘 Historique rapide', ...historyLog.slice(0, 10).map((h) => `• ${new Date(h.at).toLocaleString('fr-FR')} — ${h.summary}`)].join('\n'));
      }
      if (text === '📤 Exports') {
        return bot.sendMessage(chatId, 'Choisis un export à recevoir dans Telegram.', { reply_markup: { inline_keyboard: [[{ text: '🧾 Factures', callback_data: 'export:factures' }, { text: '💳 Paiements', callback_data: 'export:paiements_mobile' }], [{ text: '📦 Produits', callback_data: 'export:produits_facture' }]] } });
      }
      if (text === '🔊 Brief vocal') { const report = await assistantIA('Prépare un brief du matin court et oral pour DZM A et DZM B.', [], supabase); await sendVoice(bot, chatId, report, 'brief'); return ask(bot, chatId, '🔊 Brief vocal envoyé.'); }
      if (text === '🎙️ Bilan vocal') { const report = await assistantIA('Prépare un bilan du soir court et oral pour DZM A et DZM B.', [], supabase); await sendVoice(bot, chatId, report, 'bilan'); return ask(bot, chatId, '🎙️ Bilan vocal envoyé.'); }
      if (text === 'ℹ️ Aide') return ask(bot, chatId, 'Tu peux consulter, enregistrer des pièces, valider des rapprochements, enregistrer des ristournes, piloter l’activité et demander des synthèses IA.');
    } catch (error) {
      console.error('Telegram error:', error);
      await ask(bot, chatId, `Erreur Telegram : ${error.message}`);
    }
  });
};
