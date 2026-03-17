const Groq = require('groq-sdk');

function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Number(n || 0)) + ' FCFA'; }

async function assistantIA(question, historique, supabase) {
  const q = String(question || '').toLowerCase();
  const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }).limit(100),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }).limit(100),
    supabase.from('produits_facture').select('*').limit(200),
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
  const top = Array.from(productMap.entries()).sort((a, b) => b[1].ca - a[1].ca).slice(0, 3);

  if (q.includes('anomal')) {
    return anomalies.length === 0 ? 'Aucune facture en anomalie actuellement.' : `Nombre de factures en anomalie : ${anomalies.length}\n\n${anomalies.map((f) => `- ${f.numero_facture} • ${f.client} • ${fmt(f.total_ttc)}`).join('\n')}`;
  }
  if (q.includes('paiement') && q.includes('attente')) {
    return attente.length === 0 ? 'Aucun paiement en attente.' : `Paiements en attente : ${attente.length}\n\n${attente.slice(0, 8).map((p) => `- ${p.transaction_id} • ${fmt(p.montant)} • ${p.reference_facture || 'Non rapproché'}`).join('\n')}`;
  }
  if (q.includes('derni') && q.includes('facture')) {
    return latest ? `Dernière facture : ${latest.numero_facture}\nClient : ${latest.client}\nStructure : ${latest.structure}\nMontant TTC : ${fmt(latest.total_ttc)}\nStatut : ${latest.statut}\nDate : ${latest.date_facture}` : 'Aucune facture trouvée.';
  }
  if (q.includes('produit') || q.includes('moteur')) {
    return top.length ? `Top produits moteurs :\n\n${top.map(([name, stats], i) => `${i + 1}. ${name} — ${stats.q} unités — ${fmt(stats.ca)}`).join('\n')}` : 'Aucun produit agrégé pour le moment.';
  }
  if (q.includes('reste') || q.includes('payer')) {
    return `Total facturé : ${fmt(totalFacture)}\nTotal encaissé : ${fmt(totalPaye)}\nReste à payer : ${fmt(totalFacture - totalPaye)}`;
  }

  if (!process.env.GROQ_API_KEY) {
    return `Résumé DZM\n- Factures : ${facturesList.length}\n- Paiements : ${paiementsList.length}\n- Reste à payer : ${fmt(totalFacture - totalPaye)}\n- Factures en anomalie : ${anomalies.length}`;
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const systemPrompt = `Tu es l'assistant DZM. Réponds en français, très concrètement, à partir des données suivantes :\n- Factures: ${facturesList.length}\n- Paiements: ${paiementsList.length}\n- Reste à payer: ${fmt(totalFacture - totalPaye)}\n- Anomalies: ${anomalies.length}\n- Top produits: ${top.map(([n, s]) => `${n} (${s.q} unités, ${fmt(s.ca)})`).join(', ') || 'aucun'}\n- Dernière facture: ${latest ? `${latest.numero_facture} ${latest.client} ${fmt(latest.total_ttc)}` : 'aucune'}`;
  const messages = [
    { role: 'system', content: systemPrompt },
    ...(historique || []).slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: question },
  ];
  const response = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.2, max_tokens: 500 });
  return response.choices[0]?.message?.content || 'Je n’ai pas pu générer une réponse.';
}

module.exports = { assistantIA };
