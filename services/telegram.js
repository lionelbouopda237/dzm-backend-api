const { assistantIA } = require('./assistant');

function money(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA';
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
  const recusA = (factures || []).filter((f) => f.structure === 'DZM A').reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const recusB = (factures || []).filter((f) => f.structure === 'DZM B').reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const renvA = (mouvements || []).filter((m) => m.structure === 'DZM A').reduce((s, m) => s + Number(m.emballages_vides || 0), 0);
  const renvB = (mouvements || []).filter((m) => m.structure === 'DZM B').reduce((s, m) => s + Number(m.emballages_vides || 0), 0);
  return `📊 Statut DZM
• Factures récentes : ${(factures || []).length}
• Paiements récents : ${(paiements || []).length}
• Paiements en attente : ${attente.length} (${money(totalAttente)})
• Anomalies facture : ${anomalies}
• Solde emballages DZM A : ${recusA - renvA}
• Solde emballages DZM B : ${recusB - renvB}`;
}

module.exports = function setupTelegram(bot, supabase) {
  if (!bot) return;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Assistant DZM prêt.\nCommandes : /help, /status, /brief, /bilan, /alertes, /emballages, /compare, /factures, /paiements, /ia <question>');
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, [
      'Commandes disponibles :',
      '/status — vue rapide',
      '/brief — brief du matin',
      '/bilan — bilan du soir',
      '/alertes — anomalies et paiements à traiter',
      '/emballages — état des emballages',
      '/compare — compare DZM A et DZM B',
      '/factures — dernières factures',
      '/paiements — derniers paiements',
      '/ia <question> — poser une question métier',
      '/email <adresse> — envoyer les exports',
    ].join('\n'));
  });

  bot.onText(/\/status/, async (msg) => {
    bot.sendMessage(msg.chat.id, await quickStatus(supabase));
  });

  bot.onText(/\/brief/, async (msg) => {
    const reponse = await assistantIA('Prépare un brief du matin synthétique pour DZM A et DZM B.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/bilan/, async (msg) => {
    const reponse = await assistantIA('Prépare un bilan du soir synthétique pour DZM A et DZM B.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/alertes/, async (msg) => {
    const reponse = await assistantIA('Résume les alertes, anomalies et paiements en attente.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/emballages/, async (msg) => {
    const reponse = await assistantIA('Donne le solde emballages de DZM A et DZM B avec une synthèse.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/compare/, async (msg) => {
    const reponse = await assistantIA('Compare DZM A et DZM B sur les achats, paiements et emballages.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/factures/, async (msg) => {
    const { data } = await supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(5);
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Aucune facture.');
    bot.sendMessage(msg.chat.id, data.map((f) => `${f.numero_facture} • ${f.structure} • ${money(f.total_ttc)} • ${f.statut}`).join('\n'));
  });

  bot.onText(/\/paiements/, async (msg) => {
    const { data } = await supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(5);
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Aucun paiement.');
    bot.sendMessage(msg.chat.id, data.map((p) => `${p.transaction_id} • ${p.structure} • ${money(p.montant)} • ${p.statut}`).join('\n'));
  });

  bot.onText(/\/ia (.+)/, async (msg, match) => {
    const question = match[1].trim();
    const reponse = await assistantIA(question, [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/email (.+)/, async (msg, match) => {
    const email = match[1].trim();
    const axios = require('axios');
    const base = process.env.BACKEND_PUBLIC_URL || 'https://dzm-backend-api.onrender.com';
    try {
      await axios.post(`${base}/api/export/email`, { email });
      bot.sendMessage(msg.chat.id, `Export envoyé à ${email}`);
    } catch (e) {
      bot.sendMessage(msg.chat.id, `Erreur lors de l’envoi de l’export : ${e.response?.data?.error || e.message}`);
    }
  });
};
