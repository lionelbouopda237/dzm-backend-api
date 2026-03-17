const { assistantIA } = require('./assistant');

module.exports = function setupTelegram(bot, supabase) {
  if (!bot) return;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Assistant DZM prêt. Commandes : /vue_generale, /factures, /paiements, /produits, /vigilance');
  });

  bot.onText(/\/vue_generale/, async (msg) => {
    const reponse = await assistantIA('Donne une vue générale de l’activité DZM.', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/factures/, async (msg) => {
    const { data } = await supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(5);
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Aucune facture.');
    bot.sendMessage(msg.chat.id, data.map((f) => `${f.numero_facture} • ${f.client} • ${new Intl.NumberFormat('fr-FR').format(f.total_ttc || 0)} FCFA • ${f.statut}`).join('\n'));
  });

  bot.onText(/\/paiements/, async (msg) => {
    const { data } = await supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(5);
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Aucun paiement.');
    bot.sendMessage(msg.chat.id, data.map((p) => `${p.transaction_id} • ${new Intl.NumberFormat('fr-FR').format(p.montant || 0)} FCFA • ${p.statut}`).join('\n'));
  });

  bot.onText(/\/produits/, async (msg) => {
    const reponse = await assistantIA('Quels sont les produits moteurs ?', [], supabase);
    bot.sendMessage(msg.chat.id, reponse);
  });

  bot.onText(/\/vigilance/, async (msg) => {
    const reponse = await assistantIA('Combien de factures sont en anomalie ?', [], supabase);
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
      bot.sendMessage(msg.chat.id, 'Erreur lors de l’envoi de l’export.');
    }
  });
};
