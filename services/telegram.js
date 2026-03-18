const { assistantIA } = require('./assistant');

function money(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA';
}

function getMainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📊 Statut', '🌅 Brief du matin'],
        ['🌙 Bilan du soir', '🚨 Alertes'],
        ['🧾 Factures', '💳 Paiements'],
        ['📦 Emballages', '🔄 Rapprochements'],
        ['🎁 Ristournes', '⚖️ Comparer A/B'],
        ['🤖 Assistant IA', '📤 Exports'],
        ['ℹ️ Aide'],
      ],
      resize_keyboard: true,
      persistent: true,
    },
  };
}

function detectStructure(input) {
  const v = String(input || '').toUpperCase();
  if (v.includes('DZM B')) return 'DZM B';
  return 'DZM A';
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

  const recusA = (factures || [])
    .filter((f) => detectStructure(f.structure) === 'DZM A')
    .reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const recusB = (factures || [])
    .filter((f) => detectStructure(f.structure) === 'DZM B')
    .reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);

  const renvA = (mouvements || [])
    .filter((m) => detectStructure(m.structure) === 'DZM A')
    .reduce((s, m) => s + Number(m.emballages_vides || 0), 0);
  const renvB = (mouvements || [])
    .filter((m) => detectStructure(m.structure) === 'DZM B')
    .reduce((s, m) => s + Number(m.emballages_vides || 0), 0);

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

async function sendFactures(bot, chatId, supabase) {
  const { data } = await supabase
    .from('factures')
    .select('*')
    .order('date_facture', { ascending: false })
    .limit(5);

  if (!data?.length) {
    return bot.sendMessage(chatId, 'Aucune facture.', getMainMenu());
  }

  const lines = ['🧾 Dernières factures'];
  for (const f of data) {
    lines.push(
      `${f.numero_facture} — ${detectStructure(f.structure)} — ${money(f.total_ttc)}`
    );
  }

  return bot.sendMessage(chatId, lines.join('\n'), getMainMenu());
}

async function sendPaiements(bot, chatId, supabase) {
  const { data } = await supabase
    .from('paiements_mobile')
    .select('*')
    .order('date_paiement', { ascending: false })
    .limit(5);

  if (!data?.length) {
    return bot.sendMessage(chatId, 'Aucun paiement.', getMainMenu());
  }

  const lines = ['💳 Derniers paiements'];
  for (const p of data) {
    lines.push(
      `${p.transaction_id} — ${detectStructure(p.structure)} — ${money(p.montant)}`
    );
  }

  return bot.sendMessage(chatId, lines.join('\n'), getMainMenu());
}

async function sendEmballages(bot, chatId, supabase) {
  const [{ data: factures }, { data: mouvements }, { data: lignes }] = await Promise.all([
    supabase.from('factures').select('*'),
    supabase.from('emballages_mouvements').select('*'),
    supabase.from('produits_facture').select('facture_id, produit, quantite'),
  ]);

  const base = new Map();
  ['DZM A', 'DZM B'].forEach((structure) => {
    base.set(structure, {
      structure,
      emballagesRecus: 0,
      emballagesRenvoyes: 0,
      colis: 0,
    });
  });

  const byFacture = new Map();
  for (const row of lignes || []) {
    if (!byFacture.has(row.facture_id)) byFacture.set(row.facture_id, []);
    byFacture.get(row.facture_id).push(row);
  }

  for (const row of factures || []) {
    const target = base.get(detectStructure(row.structure));
    target.emballagesRecus += Number(row.nombre_casiers || 0);
    const rows = byFacture.get(row.id) || [];
    target.colis += rows
      .filter((item) => String(item.produit || '').toLowerCase().includes('colis'))
      .reduce((s, item) => s + Number(item.quantite || 0), 0);
  }

  for (const row of mouvements || []) {
    const target = base.get(detectStructure(row.structure));
    target.emballagesRenvoyes += Number(row.emballages_vides || 0);
  }

  const summary = Array.from(base.values()).map((item) => ({
    ...item,
    solde: item.emballagesRecus - item.emballagesRenvoyes,
  }));

  const lines = ['📦 Gestion emballages vides'];
  for (const row of summary) {
    lines.push(
      `${row.structure} — reçus: ${row.emballagesRecus}, renvoyés: ${row.emballagesRenvoyes}, solde: ${row.solde}, colis: ${row.colis}`
    );
  }

  return bot.sendMessage(chatId, lines.join('\n'), getMainMenu());
}

async function sendCompare(bot, chatId, supabase) {
  const { data: factures } = await supabase.from('factures').select('*');

  const dzmA = (factures || [])
    .filter((f) => detectStructure(f.structure) === 'DZM A')
    .reduce((s, f) => s + Number(f.total_ttc || 0), 0);

  const dzmB = (factures || [])
    .filter((f) => detectStructure(f.structure) === 'DZM B')
    .reduce((s, f) => s + Number(f.total_ttc || 0), 0);

  return bot.sendMessage(
    chatId,
    [
      '⚖️ Comparatif DZM A vs DZM B',
      `DZM A : ${money(dzmA)}`,
      `DZM B : ${money(dzmB)}`,
    ].join('\n'),
    getMainMenu()
  );
}

async function sendRapprochements(bot, chatId, supabase) {
  const [{ data: paiements }, { data: links }] = await Promise.all([
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(10),
    supabase.from('rapprochements_factures_paiements').select('*'),
  ]);

  const linkedIds = new Set((links || []).map((l) => l.paiement_id));
  const pending = (paiements || []).filter((p) => !linkedIds.has(p.id));

  const lines = ['🔄 Rapprochements'];
  if (!pending.length) {
    lines.push('Aucun paiement non rapproché trouvé.');
  } else {
    for (const p of pending.slice(0, 5)) {
      lines.push(`${p.transaction_id} — ${detectStructure(p.structure)} — ${money(p.montant)}`);
    }
  }

  return bot.sendMessage(chatId, lines.join('\n'), getMainMenu());
}

async function sendRistournes(bot, chatId, supabase) {
  const [{ data: factures }, { data: ristournes }] = await Promise.all([
    supabase.from('factures').select('*'),
    supabase.from('ristournes_paiements').select('*'),
  ]);

  const byRef = new Map((ristournes || []).map((r) => [r.reference_facture, r]));
  const rows = (factures || []).filter((f) => Number(f.ristourne || 0) > 0).slice(0, 5);

  const lines = ['🎁 Ristournes'];
  if (!rows.length) {
    lines.push('Aucune ristourne trouvée.');
  } else {
    for (const f of rows) {
      const r = byRef.get(f.numero_facture);
      lines.push(
        `${f.numero_facture} — théorique: ${money(f.ristourne)} — reçu: ${money(r?.montant_recu || 0)}`
      );
    }
  }

  return bot.sendMessage(chatId, lines.join('\n'), getMainMenu());
}

module.exports = function setupTelegram(bot, supabase) {
  if (!bot) return;

  // Commandes de secours
  bot.onText(/\/start/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Bienvenue sur le bot DZM.\nChoisis une fonction dans le menu ci-dessous.',
      getMainMenu()
    );
  });

  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Utilise les boutons pour naviguer rapidement dans les fonctions DZM.',
      getMainMenu()
    );
  });

  bot.onText(/\/status/, async (msg) => {
    await bot.sendMessage(msg.chat.id, await quickStatus(supabase), getMainMenu());
  });

  bot.onText(/\/brief/, async (msg) => {
    const reponse = await assistantIA(
      'Prépare un brief du matin synthétique pour DZM A et DZM B.',
      [],
      supabase
    );
    await bot.sendMessage(msg.chat.id, reponse, getMainMenu());
  });

  bot.onText(/\/bilan/, async (msg) => {
    const reponse = await assistantIA(
      'Prépare un bilan du soir synthétique pour DZM A et DZM B.',
      [],
      supabase
    );
    await bot.sendMessage(msg.chat.id, reponse, getMainMenu());
  });

  bot.onText(/\/alertes/, async (msg) => {
    const reponse = await assistantIA(
      'Résume les alertes, anomalies et paiements en attente.',
      [],
      supabase
    );
    await bot.sendMessage(msg.chat.id, reponse, getMainMenu());
  });

  bot.onText(/\/ia (.+)/, async (msg, match) => {
    const question = match?.[1]?.trim();
    if (!question) {
      return bot.sendMessage(msg.chat.id, 'Pose une question après /ia', getMainMenu());
    }
    const reponse = await assistantIA(question, [], supabase);
    await bot.sendMessage(
      msg.chat.id,
      `Reformulation : tu veux que j’analyse la question suivante.\n\nQuestion : ${question}\n\n${reponse}`,
      getMainMenu()
    );
  });

  // Boutons principaux
  bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text) return;
    if (text.startsWith('/')) return;

    try {
      if (text === '📊 Statut') {
        return bot.sendMessage(msg.chat.id, await quickStatus(supabase), getMainMenu());
      }

      if (text === '🌅 Brief du matin') {
        const reponse = await assistantIA(
          'Prépare un brief du matin synthétique pour DZM A et DZM B.',
          [],
          supabase
        );
        return bot.sendMessage(msg.chat.id, reponse, getMainMenu());
      }

      if (text === '🌙 Bilan du soir') {
        const reponse = await assistantIA(
          'Prépare un bilan du soir synthétique pour DZM A et DZM B.',
          [],
          supabase
        );
        return bot.sendMessage(msg.chat.id, reponse, getMainMenu());
      }

      if (text === '🚨 Alertes') {
        const reponse = await assistantIA(
          'Résume les alertes, anomalies et paiements en attente.',
          [],
          supabase
        );
        return bot.sendMessage(msg.chat.id, reponse, getMainMenu());
      }

      if (text === '🧾 Factures') {
        return sendFactures(bot, msg.chat.id, supabase);
      }

      if (text === '💳 Paiements') {
        return sendPaiements(bot, msg.chat.id, supabase);
      }

      if (text === '📦 Emballages') {
        return sendEmballages(bot, msg.chat.id, supabase);
      }

      if (text === '🔄 Rapprochements') {
        return sendRapprochements(bot, msg.chat.id, supabase);
      }

      if (text === '🎁 Ristournes') {
        return sendRistournes(bot, msg.chat.id, supabase);
      }

      if (text === '⚖️ Comparer A/B') {
        return sendCompare(bot, msg.chat.id, supabase);
      }

      if (text === '🤖 Assistant IA') {
        return bot.sendMessage(
          msg.chat.id,
          '🤖 Envoie maintenant ta question en langage naturel avec la commande :\n/ia Ta question ici',
          getMainMenu()
        );
      }

      if (text === '📤 Exports') {
        return bot.sendMessage(
          msg.chat.id,
          '📤 Les exports premium sont disponibles dans l’application web DZM.',
          getMainMenu()
        );
      }

      if (text === 'ℹ️ Aide') {
        return bot.sendMessage(
          msg.chat.id,
          'Utilise les boutons pour naviguer dans les fonctions principales DZM.',
          getMainMenu()
        );
      }
    } catch (error) {
      console.error('Telegram button handler error:', error);
      await bot.sendMessage(
        msg.chat.id,
        `Erreur Telegram : ${error.message}`,
        getMainMenu()
      );
    }
  });
};
