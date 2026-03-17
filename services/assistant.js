const Groq = require('groq-sdk');

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA'; }
function reformulate(question) {
  return `Reformulation : ${question.trim().replace(/\?*$/, '')}.`;
}

async function assistantIA(question, historique, supabase) {
  const q = String(question || '').toLowerCase();
  const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(200),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(200),
    supabase.from('produits_facture').select('*').limit(400),
  ]);

  const facturesList = factures || [];
  const paiementsList = paiements || [];
  const produitsList = produits || [];
  const anomalies = facturesList.filter((f) => f.statut === 'anomalie');
  const attente = paiementsList.filter((p) => p.statut === 'en attente');
  const latest = facturesList[0];
  const totalFacture = facturesList.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
  const totalPaye = paiementsList.filter((p) => p.statut === 'payé').reduce((s, p) => s + Number(p.montant || 0), 0);

  const productMap = new Map();
  for (const row of produitsList) {
    const current = productMap.get(row.produit) || { q: 0, ca: 0 };
    current.q += Number(row.quantite || 0);
    current.ca += Number(row.total || 0);
    productMap.set(row.produit, current);
  }
  const top = Array.from(productMap.entries()).sort((a, b) => b[1].ca - a[1].ca).slice(0, 5);

  let answer = '';
  if (q.includes('anomal')) {
    answer = anomalies.length === 0 ? 'Réponse : aucune facture en anomalie actuellement.' : `Réponse : ${anomalies.length} facture(s) en anomalie.\n\nDétails :\n${anomalies.map((f) => `- ${f.numero_facture} • ${f.client} • ${fmt(f.total_ttc)}`).join('\n')}`;
    return `${reformulate(question)}\n\n${answer}`;
  }
  if (q.includes('paiement') && q.includes('attente')) {
    answer = attente.length === 0 ? 'Réponse : aucun paiement en attente.' : `Réponse : ${attente.length} paiement(s) en attente pour ${fmt(attente.reduce((s, p) => s + Number(p.montant || 0), 0))}.\n\nDétails :\n${attente.slice(0, 8).map((p) => `- ${p.transaction_id} • ${fmt(p.montant)} • ${p.reference_facture || 'Non rapproché'}`).join('\n')}`;
    return `${reformulate(question)}\n\n${answer}`;
  }
  if (q.includes('derni') && q.includes('facture')) {
    answer = latest ? `Réponse : la dernière facture est ${latest.numero_facture}.\n\nDétails :\n- Client : ${latest.client}\n- Structure : ${latest.structure}\n- Montant TTC : ${fmt(latest.total_ttc)}\n- Statut : ${latest.statut}\n- Date : ${latest.date_facture}` : 'Réponse : aucune facture trouvée.';
    return `${reformulate(question)}\n\n${answer}`;
  }
  if (q.includes('produit') || q.includes('moteur')) {
    answer = top.length ? `Réponse : voici les produits les plus moteurs actuellement.\n\nDétails :\n${top.map(([name, stats], i) => `${i + 1}. ${name} — ${stats.q} unités — ${fmt(stats.ca)}`).join('\n')}` : 'Réponse : aucun produit agrégé pour le moment.';
    return `${reformulate(question)}\n\n${answer}`;
  }
  if (q.includes('reste') || q.includes('payer')) {
    answer = `Réponse : le reste à payer actuel est ${fmt(totalFacture - totalPaye)}.\n\nDétails :\n- Total facturé : ${fmt(totalFacture)}\n- Total encaissé : ${fmt(totalPaye)}`;
    return `${reformulate(question)}\n\n${answer}`;
  }

  if (!process.env.GROQ_API_KEY) {
    return `${reformulate(question)}\n\nRéponse : je n'ai pas de moteur Groq configuré, mais voici un résumé utile.\n\n- Factures : ${facturesList.length}\n- Paiements : ${paiementsList.length}\n- Reste à payer : ${fmt(totalFacture - totalPaye)}\n- Factures en anomalie : ${anomalies.length}`;
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const systemPrompt = `Tu es l'assistant DZM. Réponds exclusivement en français. Tu dois TOUJOURS reformuler d'abord, puis répondre de façon structurée et pédagogique. Utilise les données suivantes comme vérité principale :
- Factures: ${facturesList.length}
- Paiements: ${paiementsList.length}
- Reste à payer: ${fmt(totalFacture - totalPaye)}
- Anomalies: ${anomalies.length}
- Top produits: ${top.map(([n, s]) => `${n} (${s.q} unités, ${fmt(s.ca)})`).join(', ') || 'aucun'}
- Dernière facture: ${latest ? `${latest.numero_facture} ${latest.client} ${fmt(latest.total_ttc)}` : 'aucune'}
Format obligatoire:
Reformulation : ...
Réponse : ...
Détails : ...
Analyse : ...
Action suggérée : ...`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(historique || []).slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];
  const response = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: 650 });
  return response.choices[0]?.message?.content || `${reformulate(question)}\n\nRéponse : je n’ai pas pu générer une réponse.`;
}

module.exports = { assistantIA };
