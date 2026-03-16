// ─── Assistant IA DZM avec Gemini ───
async function assistantIA(question, historique, supabase, genAI) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  // Récupérer les données actuelles de Supabase
  const [
    { data: factures },
    { data: paiements },
    { data: produits }
  ] = await Promise.all([
    supabase.from("factures").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("paiements_mobile").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("produits_facture").select("*").limit(100)
  ]);

  // Calculer les statistiques
  const totalFactureA = (factures || []).filter(f => f.structure === "DZM A").reduce((s, f) => s + (f.total_ttc || 0), 0);
  const totalFactureB = (factures || []).filter(f => f.structure === "DZM B").reduce((s, f) => s + (f.total_ttc || 0), 0);
  const totalPaye = (paiements || []).filter(p => p.statut === "payé").reduce((s, p) => s + (p.montant || 0), 0);
  const totalFacture = (factures || []).reduce((s, f) => s + (f.total_ttc || 0), 0);

  // Produits moteurs
  const produitsStats = {};
  (produits || []).forEach(p => {
    if (!produitsStats[p.produit]) produitsStats[p.produit] = { quantite: 0, ca: 0 };
    produitsStats[p.produit].quantite += p.quantite || 0;
    produitsStats[p.produit].ca += p.total || 0;
  });
  const top3 = Object.entries(produitsStats)
    .sort((a, b) => b[1].ca - a[1].ca)
    .slice(0, 3);

  const heure = new Date().getHours();
  const salutation = heure < 12 ? "Bonjour" : heure < 18 ? "Bon après-midi" : "Bonsoir";

  const contexte = `
Tu es l'Assistant IA DZM, un expert financier pour ETS DZM (distribution de boissons au Cameroun).
Tu analyses les données en temps réel et réponds en français avec un ton professionnel et chaleureux.
Utilise parfois des emojis. Varie tes formulations. Ne répète jamais la même intro.

DONNÉES ACTUELLES (${new Date().toLocaleDateString("fr-FR")}) :
- Total factures : ${factures?.length || 0}
- Factures DZM A : ${(factures || []).filter(f => f.structure === "DZM A").length} (${totalFactureA.toLocaleString("fr-FR")} FCFA)
- Factures DZM B : ${(factures || []).filter(f => f.structure === "DZM B").length} (${totalFactureB.toLocaleString("fr-FR")} FCFA)
- Montant total facturé : ${totalFacture.toLocaleString("fr-FR")} FCFA
- Montant reçu : ${totalPaye.toLocaleString("fr-FR")} FCFA
- Reste à payer : ${(totalFacture - totalPaye).toLocaleString("fr-FR")} FCFA
- Paiements en attente : ${(paiements || []).filter(p => p.statut === "en attente").length}
- Top produits : ${top3.map(([nom, s]) => `${nom} (${s.quantite} casiers, ${s.ca.toLocaleString("fr-FR")} FCFA)`).join(", ")}

DERNIÈRES FACTURES :
${(factures || []).slice(0, 5).map(f => `- ${f.numero_facture} | ${f.client} | ${f.structure} | ${(f.total_ttc || 0).toLocaleString("fr-FR")} FCFA | ${f.statut}`).join("\n")}

HISTORIQUE CONVERSATION :
${historique.slice(-6).map(h => `${h.role === "user" ? "Utilisateur" : "Assistant"}: ${h.content}`).join("\n")}
`;

  const result = await model.generateContent(`${contexte}\n\nQuestion de l'utilisateur : ${question}`);
  return result.response.text();
}

module.exports = { assistantIA };
