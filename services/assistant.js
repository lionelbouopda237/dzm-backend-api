const Groq = require('groq-sdk');

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA'; }
function reformulate(question) { return `Reformulation : ${String(question || '').trim().replace(/\?*$/, '')}.`; }
function detectStructureFilter(question) {
  const v = String(question || '').toUpperCase();
  if (v.includes('DZM B')) return 'DZM B';
  if (v.includes('DZM A')) return 'DZM A';
  return null;
}
function isPackagingProduct(name) {
  const v = String(name || '').toLowerCase();
  return ['emballage', 'casier', 'casiers', 'colis'].some((k) => v.includes(k));
}
function natural(ref, body) { return `${ref}\n\n${body}`; }
function explainList(items, format) {
  if (!items.length) return 'Aucun élément significatif n’est remonté dans la base pour le moment.';
  return items.map(format).join('\n');
}

async function assistantIA(question, historique, supabase) {
  const q = String(question || '').toLowerCase();
  const structureFilter = detectStructureFilter(question);
  const [{ data: factures }, { data: paiements }, { data: produits }, { data: mouvements }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(800),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(800),
    supabase.from('produits_facture').select('*').limit(1500),
    supabase.from('emballages_mouvements').select('*').order('date_mouvement', { ascending: false }).limit(800),
  ]);

  const facturesBase = (factures || []).filter((f) => !structureFilter || f.structure === structureFilter);
  const paiementsBase = (paiements || []).filter((p) => !structureFilter || p.structure === structureFilter);
  const mouvementsBase = (mouvements || []).filter((m) => !structureFilter || m.structure === structureFilter);
  const anomalies = facturesBase.filter((f) => String(f.statut || '').toLowerCase() === 'anomalie');
  const attente = paiementsBase.filter((p) => String(p.statut || '').toLowerCase() === 'en attente');
  const payes = paiementsBase.filter((p) => ['payé', 'paye'].includes(String(p.statut || '').toLowerCase()));
  const totalFacture = facturesBase.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
  const totalPaye = payes.reduce((s, p) => s + Number(p.montant || 0), 0);
  const emballagesRecus = facturesBase.reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const emballagesRenvoyes = mouvementsBase.reduce((s, m) => s + Number(m.emballages_vides || 0), 0);
  const soldeEmballages = emballagesRecus - emballagesRenvoyes;
  const ref = reformulate(question);

  const productMap = new Map();
  for (const row of (produits || []).filter((r) => !isPackagingProduct(r.produit) && (!structureFilter || r.structure === structureFilter))) {
    const current = productMap.get(row.produit) || { q: 0, ca: 0 };
    current.q += Number(row.quantite || 0);
    current.ca += Number(row.total || 0);
    productMap.set(row.produit, current);
  }
  const top = Array.from(productMap.entries()).sort((a, b) => b[1].ca - a[1].ca).slice(0, 5);

  if (/(dernier|derni[eè]re).*(paiement|r[eè]glement)/i.test(question) && !/(date|montant|r[ée]cent|plus [ée]lev[ée]|important)/i.test(question)) {
    return natural(ref, "Ta demande est ambiguë. Veux-tu parler du paiement le plus récent en date, ou du paiement le plus élevé en montant ? Dis-moi par exemple « dernier paiement en date » ou « plus gros paiement ».");
  }
  if (/(dernier|derni[eè]re).*(facture)/i.test(question) && !/(date|montant|r[ée]cent|plus [ée]lev[ée]|important)/i.test(question)) {
    return natural(ref, "Je peux répondre de deux manières : soit la dernière facture enregistrée en date, soit la facture la plus élevée en montant. Précise simplement le cas que tu veux.");
  }

  if (q.includes('anomal')) {
    return natural(ref, anomalies.length === 0
      ? `Je ne vois actuellement aucune facture marquée en anomalie${structureFilter ? ` pour ${structureFilter}` : ''}. C’est plutôt rassurant, mais je te conseille de garder un œil sur les dernières pièces OCR si leur confiance est faible.`
      : `Je vois ${anomalies.length} facture(s) en anomalie${structureFilter ? ` pour ${structureFilter}` : ''}.\n\n${explainList(anomalies.slice(0, 6), (f) => `• ${f.numero_facture} — ${f.client || 'client non renseigné'} — ${fmt(f.total_ttc)}`)}\n\nEn pratique, le plus utile est de vérifier en priorité les montants, la structure DZM associée, puis les emballages et ristournes éventuels.`);
  }

  if (q.includes('paiement') && q.includes('attente')) {
    const total = attente.reduce((s, p) => s + Number(p.montant || 0), 0);
    return natural(ref, attente.length === 0
      ? `Je ne vois aucun paiement en attente${structureFilter ? ` pour ${structureFilter}` : ''}. Tous les règlements enregistrés paraissent déjà traités ou rapprochés.`
      : `Il y a ${attente.length} paiement(s) en attente${structureFilter ? ` pour ${structureFilter}` : ''}, pour un montant cumulé de ${fmt(total)}.\n\n${explainList(attente.slice(0, 5), (p) => `• ${p.transaction_id} — ${fmt(p.montant)} — ${p.date_paiement}${p.reference_facture ? ` — réf. ${p.reference_facture}` : ''}`)}\n\nJe te conseille de commencer par ceux qui ont une référence facture claire, car ils sont les plus rapides à rapprocher.`);
  }

  if (q.includes('dernier') && q.includes('paiement')) {
    const latest = paiementsBase[0];
    const biggest = [...paiementsBase].sort((a, b) => Number(b.montant || 0) - Number(a.montant || 0))[0];
    if (q.includes('montant') || q.includes('plus élevé') || q.includes('plus eleve') || q.includes('plus gros')) {
      return natural(ref, biggest
        ? `Le paiement le plus élevé${structureFilter ? ` pour ${structureFilter}` : ''} est ${biggest.transaction_id}, pour ${fmt(biggest.montant)}${biggest.reference_facture ? `, lié à ${biggest.reference_facture}` : ''}.\n\nCe paiement mérite d’être vérifié en priorité s’il n’est pas encore rapproché, car il a l’impact financier le plus fort.`
        : 'Je ne trouve aucun paiement exploitable dans la base.');
    }
    return natural(ref, latest
      ? `Le dernier paiement enregistré en date${structureFilter ? ` pour ${structureFilter}` : ''} est ${latest.transaction_id}, saisi le ${latest.date_paiement}, pour ${fmt(latest.montant)}${latest.reference_facture ? `, lié à ${latest.reference_facture}` : ''}.\n\nSi tu veux, je peux aussi te donner le dernier paiement en date avec son statut de rapprochement.`
      : 'Je ne trouve aucun paiement dans la base.');
  }

  if (q.includes('derni') && q.includes('facture')) {
    const lastFacture = facturesBase[0];
    const biggestFacture = [...facturesBase].sort((a, b) => Number(b.total_ttc || 0) - Number(a.total_ttc || 0))[0];
    if (q.includes('montant') || q.includes('plus élevée') || q.includes('plus elevee') || q.includes('plus gros')) {
      return natural(ref, biggestFacture
        ? `La facture la plus élevée${structureFilter ? ` pour ${structureFilter}` : ''} est ${biggestFacture.numero_facture}, pour ${fmt(biggestFacture.total_ttc)}.\n\nElle concerne ${biggestFacture.client || 'un client non renseigné'} et peut mériter un contrôle renforcé si elle est récente ou en anomalie.`
        : 'Je ne trouve aucune facture dans la base.');
    }
    return natural(ref, lastFacture
      ? `La dernière facture enregistrée${structureFilter ? ` pour ${structureFilter}` : ''} est ${lastFacture.numero_facture}, datée du ${lastFacture.date_facture}, pour ${fmt(lastFacture.total_ttc)}.\n\nElle est rattachée à ${lastFacture.structure || 'une structure non renseignée'} et concerne ${lastFacture.client || 'un client non renseigné'}.`
      : 'Je ne trouve aucune facture dans la base.');
  }

  if (q.includes('emballage') || q.includes('casier') || q.includes('colis')) {
    return natural(ref, `Pour ${structureFilter || 'les deux structures'}, j’ai compté ${emballagesRecus} emballages reçus avec boissons et ${emballagesRenvoyes} emballages renvoyés via la saisie manuelle. Le solde actuel est donc de ${soldeEmballages}.\n\nLes colis sont suivis séparément dans les factures. Si tu veux, je peux te détailler le solde emballages structure par structure.`);
  }

  if (q.includes('produit') || q.includes('plus vendu') || q.includes('moteur') || q.includes('top')) {
    return natural(ref, top.length
      ? `Les produits les plus moteurs${structureFilter ? ` pour ${structureFilter}` : ''} sont actuellement :\n\n${explainList(top, ([name, stats]) => `• ${name} — ${stats.q} unité(s) — ${fmt(stats.ca)}`)}\n\nLes emballages et colis sont volontairement exclus de cette analyse pour éviter les biais.`
      : 'Je ne trouve aucun produit agrégé exploitable pour le moment.');
  }

  if (q.includes('reste') || q.includes('payer') || q.includes('solde')) {
    return natural(ref, `Le reste à régler${structureFilter ? ` pour ${structureFilter}` : ''} est actuellement de ${fmt(totalFacture - totalPaye)}.\n\nLe total facturé atteint ${fmt(totalFacture)}, alors que le total déjà encaissé est de ${fmt(totalPaye)}. Autrement dit, la priorité consiste à rapprocher les paiements existants puis à isoler les factures encore ouvertes.`);
  }

  const fallbackSummary = `Voici le contexte utile${structureFilter ? ` pour ${structureFilter}` : ''} : ${facturesBase.length} facture(s), ${paiementsBase.length} paiement(s), ${anomalies.length} anomalie(s), un reste à régler de ${fmt(totalFacture - totalPaye)} et un solde emballages de ${soldeEmballages}.`;

  if (!process.env.GROQ_API_KEY) {
    return natural(ref, fallbackSummary);
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const systemPrompt = `Tu es l'assistant métier DZM pour les propriétaires de DZM A et DZM B. DT AZIMUTS est leur fournisseur unique à surveiller. Réponds exclusivement en français.
Commence toujours par une reformulation.
Ensuite, réponds avec un style naturel, précis, pédagogique et légèrement développé.
N'utilise pas systématiquement les rubriques Détail / Analyse / Action.
Si la question est ambiguë, demande une précision avant de répondre.
Tu dois raisonner depuis le point de vue DZM A / DZM B, jamais du fournisseur.
Les emballages, colis et casiers ne doivent pas être traités comme des produits classiques.
Quand c'est utile, cite des chiffres concrets et termine par une suggestion courte et pratique.
Contexte : structure ciblée = ${structureFilter || 'toutes'}, factures = ${facturesBase.length}, paiements = ${paiementsBase.length}, anomalies = ${anomalies.length}, reste à régler = ${fmt(totalFacture - totalPaye)}, solde emballages = ${soldeEmballages}, top produits = ${top.map(([n, s]) => `${n} (${s.q} unités, ${fmt(s.ca)})`).join(', ') || 'aucun'}.`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(historique || []).slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];
  const response = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: 700 });
  return response.choices[0]?.message?.content || natural(ref, fallbackSummary);
}

module.exports = { assistantIA };
