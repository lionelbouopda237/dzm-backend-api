const Groq = require("groq-sdk");

async function assistantIA(question, historique, supabase, genAI) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
    supabase.from("factures").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("paiements_mobile").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("produits_facture").select("*").limit(100)
  ]);

  const totalFactureA = (factures||[]).filter(f=>f.structure==="DZM A").reduce((s,f)=>s+(f.total_ttc||0),0);
  const totalFactureB = (factures||[]).filter(f=>f.structure==="DZM B").reduce((s,f)=>s+(f.total_ttc||0),0);
  const totalPaye = (paiements||[]).filter(p=>p.statut==="payé").reduce((s,p)=>s+(p.montant||0),0);
  const totalFacture = (factures||[]).reduce((s,f)=>s+(f.total_ttc||0),0);

  const produitsStats = {};
  (produits||[]).forEach(p => {
    if (!produitsStats[p.produit]) produitsStats[p.produit] = { quantite: 0, ca: 0 };
    produitsStats[p.produit].quantite += p.quantite || 0;
    produitsStats[p.produit].ca += p.total || 0;
  });
  const top3 = Object.entries(produitsStats).sort((a,b)=>b[1].ca-a[1].ca).slice(0,3);

  const systemPrompt = `Tu es l'Assistant IA DZM, expert financier pour ETS DZM (distribution de boissons au Cameroun).
Réponds en français, ton professionnel et chaleureux, utilise des emojis occasionnellement.

DONNÉES TEMPS RÉEL (${new Date().toLocaleDateString("fr-FR")}) :
- Factures total : ${factures?.length||0} | DZM A: ${(factures||[]).filter(f=>f.structure==="DZM A").length} (${totalFactureA.toLocaleString("fr-FR")} FCFA) | DZM B: ${(factures||[]).filter(f=>f.structure==="DZM B").length} (${totalFactureB.toLocaleString("fr-FR")} FCFA)
- Total facturé : ${totalFacture.toLocaleString("fr-FR")} FCFA | Reçu : ${totalPaye.toLocaleString("fr-FR")} FCFA | Reste : ${(totalFacture-totalPaye).toLocaleString("fr-FR")} FCFA
- Paiements en attente : ${(paiements||[]).filter(p=>p.statut==="en attente").length}
- Top produits : ${top3.map(([n,s])=>n+" ("+s.quantite+" casiers)").join(", ")}
- Dernières factures : ${(factures||[]).slice(0,3).map(f=>f.numero_facture+"|"+f.client+"|"+f.structure+"|"+(f.total_ttc||0).toLocaleString("fr-FR")+" FCFA").join(" / ")}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...historique.slice(-6).map(h => ({ role: h.role==="user"?"user":"assistant", content: h.content })),
    { role: "user", content: question }
  ];

  const response = await groq.chat.completions.create({
    model: "mixtral-8x7b-32768",
    messages,
    temperature: 0.7,
    max_tokens: 800
  });

  return response.choices[0]?.message?.content || "Je n'ai pas pu générer une réponse.";
}

module.exports = { assistantIA };
