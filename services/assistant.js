const Groq = require('groq-sdk');

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA'; }
function reformulate(question) {
  return `Reformulation : ${question.trim().replace(/\?*$/, '')}.`;
}
function isPackagingProduct(name) {
  const v = String(name || '').toLowerCase();
  return ['emballage', 'casier', 'casiers', 'colis'].some((k) => v.includes(k));
}
function buildNaturalAnswer(question, body) {
  return `${reformulate(question)}\n\n${body}`;
}
function detectStructureFilter(question) {
  const v = String(question || '').toUpperCase();
  if (v.includes('DZM B')) return 'DZM B';
  if (v.includes('DZM A')) return 'DZM A';
  return null;
}

async function assistantIA(question, historique, supabase) {
  const q = String(question || '').toLowerCase();
  const structureFilter = detectStructureFilter(question);
  const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(300),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(300),
    supabase.from('produits_facture').select('*').limit(700),
  ]);

  const facturesBase = (factures || []).filter((f) => !structureFilter || f.structure === structureFilter);
  const paiementsBase = (paiements || []).filter((p) => !structureFilter || p.structure === structureFilter);
  const anomalies = facturesBase.filter((f) => f.statut === 'anomalie');
  const attente = paiementsBase.filter((p) => p.statut === 'en attente');
  const lastFacture = facturesBase[0];
  const totalFacture = facturesBase.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
  const totalPaye = paiementsBase.filter((p) => p.statut === 'payé').reduce((s, p) => s + Number(p.montant || 0), 0);
  const totalEmballages = facturesBase.reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const totalRetours = facturesBase.reduce((s, f) => s + Number(f.casiers_retournes || 0), 0);

  const productMap = new Map();
  for (const row of (produits || []).filter((r) => !isPackagingProduct(r.produit))) {
    const current = productMap.get(row.produit) || { q: 0, ca: 0 };
    current.q += Number(row.quantite || 0);
    current.ca += Number(row.total || 0);
    productMap.set(row.produit, current);
  }
  const top = Array.from(productMap.entries()).sort((a, b) => b[1].ca - a[1].ca).slice(0, 5);

  if ((q.includes('dernier') || q.includes('dernière') || q.includes('dernier paiement') || q.includes('dernier reglement')) && q.includes('paiement')) {
    if (!q.includes('date') && !q.includes('montant')) {
      return buildNaturalAnswer(question, 'Ta demande est ambiguë. Veux-tu parler du paiement le plus récent en date, ou du paiement le plus élevé en montant ?');
    }
    if (q.includes('montant')) {
      const biggest = [...paiementsBase].sort((a, b) => Number(b.montant || 0) - Number(a.montant || 0))[0];
      return buildNaturalAnswer(question, biggest ? `Le paiement le plus élevé est ${biggest.transaction_id} pour ${fmt(biggest.montant)}${biggest.reference_facture ? `, lié à ${biggest.reference_facture}` : ''}.` : 'Je ne trouve aucun paiement dans la base.');
    }
    const latest = paiementsBase[0];
    return buildNaturalAnswer(question, latest ? `Le dernier paiement enregistré en date est ${latest.transaction_id}, du ${latest.date_paiement}, pour ${fmt(latest.montant)}${latest.reference_facture ? `, lié à ${latest.reference_facture}` : ''}.` : 'Je ne trouve aucun paiement dans la base.');
  }

  if (q.includes('anomal')) {
    return buildNaturalAnswer(question, anomalies.length === 0
      ? 'Je ne vois actuellement aucune facture marquée en anomalie.'
      : `Je vois ${anomalies.length} facture(s) en anomalie${structureFilter ? ` pour ${structureFilter}` : ''} : ${anomalies.slice(0, 6).map((f) => `${f.numero_facture} (${f.client})`).join(', ')}.`);
  }
  if (q.includes('paiement') && q.includes('attente')) {
    return buildNaturalAnswer(question, attente.length === 0
      ? 'Je ne vois aucun paiement en attente pour le moment.'
      : `Il y a ${attente.length} paiement(s) en attente${structureFilter ? ` pour ${structureFilter}` : ''}, pour un total de ${fmt(attente.reduce((s, p) => s + Number(p.montant || 0), 0))}.`);
  }
  if (q.includes('derni') && q.includes('facture')) {
    return buildNaturalAnswer(question, lastFacture ? `La dernière facture enregistrée${structureFilter ? ` pour ${structureFilter}` : ''} est ${lastFacture.numero_facture}, datée du ${lastFacture.date_facture}, pour ${fmt(lastFacture.total_ttc)}.` : 'Je ne trouve aucune facture dans la base.');
  }
  if (q.includes('produit') || q.includes('moteur') || q.includes('plus vendu')) {
    return buildNaturalAnswer(question, top.length ? `Les produits les plus moteurs${structureFilter ? ` pour ${structureFilter}` : ''} sont ${top.map(([name, stats]) => `${name} (${stats.q} unités, ${fmt(stats.ca)})`).join(', ')}.` : 'Je ne trouve aucun produit agrégé hors emballages pour le moment.');
  }
  if (q.includes('reste') || q.includes('payer') || q.includes('solde')) {
    return buildNaturalAnswer(question, `Le reste à régler${structureFilter ? ` pour ${structureFilter}` : ''} est actuellement de ${fmt(totalFacture - totalPaye)}. Le total facturé est de ${fmt(totalFacture)} et le total encaissé de ${fmt(totalPaye)}.`);
  }
  if (q.includes('emballage') || q.includes('casier') || q.includes('colis')) {
    const dette = totalEmballages - totalRetours;
    return buildNaturalAnswer(question, `Le solde emballages${structureFilter ? ` pour ${structureFilter}` : ''} est actuellement de ${dette} casier(s). J'ai compté ${totalEmballages} emballages pleins enregistrés et ${totalRetours} emballages vides retournés.`);
  }

  if (!process.env.GROQ_API_KEY) {
    return buildNaturalAnswer(question, `Je n'ai pas de moteur Groq configuré, mais voici l'essentiel${structureFilter ? ` pour ${structureFilter}` : ''} : ${facturesBase.length} factures, ${paiementsBase.length} paiements, un reste à régler de ${fmt(totalFacture - totalPaye)} et un solde emballages de ${totalEmballages - totalRetours} casier(s).`);
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const systemPrompt = `Tu es l'assistant DZM pour les propriétaires de DZM A et DZM B. DT AZIMUTS est leur fournisseur unique à surveiller. Réponds exclusivement en français.\nTu dois TOUJOURS commencer par une reformulation.\nEnsuite, réponds de façon naturelle, concise et pédagogique. N'utilise pas systématiquement les sections "Détails / Analyse / Action". Utilise-les seulement si elles apportent vraiment quelque chose.\nSi la question est ambiguë, demande une précision avant de répondre. Exemple : "dernier paiement" => préciser date ou montant.\nNe traite pas les emballages, casiers ou colis comme des produits classiques.\nFaits disponibles :\n- Structure ciblée: ${structureFilter || 'toutes'}\n- Factures: ${facturesBase.length}\n- Paiements: ${paiementsBase.length}\n- Reste à régler: ${fmt(totalFacture - totalPaye)}\n- Anomalies: ${anomalies.length}\n- Solde emballages: ${totalEmballages - totalRetours}\n- Top produits hors emballages: ${top.map(([n, s]) => `${n} (${s.q} unités, ${fmt(s.ca)})`).join(', ') || 'aucun'}\n- Dernière facture: ${lastFacture ? `${lastFacture.numero_facture} ${lastFacture.client} ${fmt(lastFacture.total_ttc)}` : 'aucune'}\nRéponds depuis le point de vue de DZM A / DZM B, pas du fournisseur.`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(historique || []).slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];
  const response = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: 500 });
  return response.choices[0]?.message?.content || buildNaturalAnswer(question, 'Je n’ai pas pu générer une réponse exploitable.');
}

module.exports = { assistantIA };
