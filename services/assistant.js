const Groq = require('groq-sdk');

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA'; }
function reformulate(question) { return `Reformulation : ${question.trim().replace(/\?*$/, '')}.`; }
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
function natural(reformulation, body) {
  return `${reformulation}\n\n${body}`;
}

async function assistantIA(question, historique, supabase) {
  const q = String(question || '').toLowerCase();
  const structureFilter = detectStructureFilter(question);
  const [{ data: factures }, { data: paiements }, { data: produits }, { data: mouvements }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(500),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(500),
    supabase.from('produits_facture').select('*').limit(1000),
    supabase.from('emballages_mouvements').select('*').order('date_mouvement', { ascending: false }).limit(500),
  ]);

  const facturesBase = (factures || []).filter((f) => !structureFilter || f.structure === structureFilter);
  const paiementsBase = (paiements || []).filter((p) => !structureFilter || p.structure === structureFilter);
  const mouvementsBase = (mouvements || []).filter((m) => !structureFilter || m.structure === structureFilter);
  const anomalies = facturesBase.filter((f) => f.statut === 'anomalie');
  const attente = paiementsBase.filter((p) => p.statut === 'en attente');
  const paid = paiementsBase.filter((p) => p.statut === 'payé');
  const totalFacture = facturesBase.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
  const totalPaye = paid.reduce((s, p) => s + Number(p.montant || 0), 0);
  const emballagesRecus = facturesBase.reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const emballagesRenvoyes = mouvementsBase.reduce((s, m) => s + Number(m.emballages_vides || 0), 0);
  const soldeEmballages = emballagesRecus - emballagesRenvoyes;

  const productMap = new Map();
  for (const row of (produits || []).filter((r) => !isPackagingProduct(r.produit))) {
    const current = productMap.get(row.produit) || { q: 0, ca: 0 };
    current.q += Number(row.quantite || 0);
    current.ca += Number(row.total || 0);
    productMap.set(row.produit, current);
  }
  const top = Array.from(productMap.entries()).sort((a, b) => b[1].ca - a[1].ca).slice(0, 5);
  const ref = reformulate(question);

  if (/(dernier|derni[eè]re).*(paiement|r[eè]glement)/i.test(question) && !/(date|montant|r[ée]cent|plus [ée]lev[ée])/i.test(question)) {
    return natural(ref, 'Ta demande peut être comprise de deux façons. Veux-tu parler du paiement le plus récent en date, ou du paiement le plus élevé en montant ?');
  }
  if (q.includes('anomal')) {
    return natural(ref, anomalies.length === 0
      ? `Je ne vois actuellement aucune facture marquée en anomalie${structureFilter ? ` pour ${structureFilter}` : ''}. Les derniers contrôles paraissent cohérents.`
      : `Je vois ${anomalies.length} facture(s) en anomalie${structureFilter ? ` pour ${structureFilter}` : ''}. Les références principales sont ${anomalies.slice(0, 6).map((f) => `${f.numero_facture} (${f.client})`).join(', ')}. Je te conseille de vérifier d'abord les montants et les emballages associés.`);
  }
  if (q.includes('paiement') && q.includes('attente')) {
    const total = attente.reduce((s, p) => s + Number(p.montant || 0), 0);
    return natural(ref, attente.length === 0
      ? `Je ne vois aucun paiement en attente${structureFilter ? ` pour ${structureFilter}` : ''}. Tous les règlements présents semblent déjà traités ou rapprochés.`
      : `Il y a ${attente.length} paiement(s) en attente${structureFilter ? ` pour ${structureFilter}` : ''}, pour un montant cumulé de ${fmt(total)}. Le plus important à traiter en priorité est ${attente[0]?.transaction_id || 'non identifié'}.`);
  }
  if (q.includes('dernier') && q.includes('paiement')) {
    const latest = paiementsBase[0];
    const biggest = [...paiementsBase].sort((a, b) => Number(b.montant || 0) - Number(a.montant || 0))[0];
    if (q.includes('montant') || q.includes('plus élevé')) return natural(ref, biggest ? `Le paiement le plus élevé${structureFilter ? ` pour ${structureFilter}` : ''} est ${biggest.transaction_id}, pour ${fmt(biggest.montant)}${biggest.reference_facture ? `, relié à ${biggest.reference_facture}` : ''}.` : 'Je ne trouve aucun paiement exploitable dans la base.');
    return natural(ref, latest ? `Le dernier paiement enregistré en date${structureFilter ? ` pour ${structureFilter}` : ''} est ${latest.transaction_id}, saisi le ${latest.date_paiement}, pour ${fmt(latest.montant)}${latest.reference_facture ? `, lié à ${latest.reference_facture}` : ''}.` : 'Je ne trouve aucun paiement dans la base.');
  }
  if (q.includes('derni') && q.includes('facture')) {
    const lastFacture = facturesBase[0];
    return natural(ref, lastFacture ? `La dernière facture enregistrée${structureFilter ? ` pour ${structureFilter}` : ''} est ${lastFacture.numero_facture}, datée du ${lastFacture.date_facture}, pour ${fmt(lastFacture.total_ttc)}. Elle concerne ${lastFacture.client || 'un client non renseigné'}.` : 'Je ne trouve aucune facture dans la base.');
  }
  if (q.includes('emballage') || q.includes('casier') || q.includes('colis')) {
    return natural(ref, `Pour ${structureFilter || 'les deux structures'}, j'ai compté ${emballagesRecus} emballages reçus avec boissons et ${emballagesRenvoyes} emballages renvoyés en saisie manuelle. Le solde actuel est donc de ${soldeEmballages}. Les colis sont suivis séparément dans les factures et ne doivent pas être mélangés aux produits classiques.`);
  }
  if (q.includes('produit') || q.includes('plus vendu') || q.includes('moteur')) {
    return natural(ref, top.length ? `Les produits les plus moteurs${structureFilter ? ` pour ${structureFilter}` : ''} sont ${top.map(([name, stats]) => `${name} (${stats.q} unités, ${fmt(stats.ca)})`).join(', ')}. Les emballages et colis sont exclus de cette analyse.` : 'Je ne trouve aucun produit agrégé exploitable pour le moment.');
  }
  if (q.includes('reste') || q.includes('payer') || q.includes('solde')) {
    return natural(ref, `Le reste à régler${structureFilter ? ` pour ${structureFilter}` : ''} est actuellement de ${fmt(totalFacture - totalPaye)}. Le total facturé atteint ${fmt(totalFacture)} alors que le total réellement encaissé est de ${fmt(totalPaye)}.`);
  }

  if (!process.env.GROQ_API_KEY) {
    return natural(ref, `Je n'ai pas de moteur Groq configuré, mais voici la synthèse principale${structureFilter ? ` pour ${structureFilter}` : ''} : ${facturesBase.length} facture(s), ${paiementsBase.length} paiement(s), un reste à régler de ${fmt(totalFacture - totalPaye)} et un solde emballages de ${soldeEmballages}.`);
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const systemPrompt = `Tu es l'assistant métier DZM pour les propriétaires de DZM A et DZM B. DT AZIMUTS est leur fournisseur unique à surveiller. Réponds exclusivement en français.\nCommence TOUJOURS par une reformulation.\nEnsuite, réponds avec un style naturel, précis, pédagogique et légèrement développé. N'utilise pas systématiquement les rubriques Détail / Analyse / Action.\nSi la question est ambiguë, demande une précision avant de répondre.\nTu dois raisonner depuis le point de vue DZM A / DZM B, jamais du fournisseur.\nLes emballages, colis et casiers ne doivent pas être traités comme des produits classiques.\nContexte utile : structure ciblée = ${structureFilter || 'toutes'}, factures = ${facturesBase.length}, paiements = ${paiementsBase.length}, anomalies = ${anomalies.length}, reste à régler = ${fmt(totalFacture - totalPaye)}, solde emballages = ${soldeEmballages}, top produits = ${top.map(([n, s]) => `${n} (${s.q} unités, ${fmt(s.ca)})`).join(', ') || 'aucun'}.`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(historique || []).slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];
  const response = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.22, max_tokens: 650 });
  return response.choices[0]?.message?.content || natural(ref, 'Je n’ai pas pu générer une réponse exploitable.');
}

module.exports = { assistantIA };
