const { assistantIA } = require("./assistant");
const ExcelJS = require("exceljs");

async function envoyerAlerteQuotidienne(bot, supabase, genAI) {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return console.log("TELEGRAM_CHAT_ID non configure");

    const aujourd_hui = new Date().toISOString().split("T")[0];
    const [{ data: facturesAujourdhui }, { data: paiementsAujourdhui }] = await Promise.all([
      supabase.from("factures").select("*").gte("created_at", aujourd_hui),
      supabase.from("paiements_mobile").select("*").gte("created_at", aujourd_hui)
    ]);

    if (!facturesAujourdhui?.length && !paiementsAujourdhui?.length) {
      bot.sendMessage(chatId, "Alerte DZM\n\nAucune activite enregistree aujourd'hui.\nPensez a saisir vos factures et paiements !");
      return;
    }

    const reponse = await assistantIA(
      "Resume l'activite d'aujourd'hui pour ETS DZM. Sois concis et positif.",
      [], supabase, null
    );

    const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    bot.sendMessage(chatId, `Rapport Quotidien DZM\n${date}\n\n${reponse}`);

  } catch (err) {
    console.error("Erreur alerte quotidienne:", err.message);
  }
}

async function generateExcel(tableName, data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DZM Codex";
  const worksheet = workbook.addWorksheet(tableName);

  if (!data || data.length === 0) {
    worksheet.addRow(["Aucune donnee disponible"]);
    return workbook.xlsx.writeBuffer();
  }

  const colonnes = {
    factures: [
      { header: "N Facture", key: "numero_facture", width: 15 },
      { header: "Structure", key: "structure", width: 10 },
      { header: "Client", key: "client", width: 25 },
      { header: "Total HT", key: "total_ht", width: 15 },
      { header: "TVA", key: "tva", width: 12 },
      { header: "Ristourne", key: "ristourne", width: 12 },
      { header: "Total TTC", key: "total_ttc", width: 15 },
      { header: "Casiers", key: "nombre_casiers", width: 10 },
      { header: "Retournes", key: "casiers_retournes", width: 12 },
      { header: "Date", key: "date_facture", width: 12 },
      { header: "Statut", key: "statut", width: 12 },
    ],
    paiements_mobile: [
      { header: "Transaction ID", key: "transaction_id", width: 20 },
      { header: "Structure", key: "structure", width: 10 },
      { header: "Montant", key: "montant", width: 15 },
      { header: "Facture", key: "reference_facture", width: 15 },
      { header: "Beneficiaire", key: "beneficiaire", width: 25 },
      { header: "Date", key: "date_paiement", width: 12 },
      { header: "Statut", key: "statut", width: 12 },
    ],
    produits_facture: [
      { header: "Produit", key: "produit", width: 25 },
      { header: "Quantite", key: "quantite", width: 10 },
      { header: "Prix unitaire", key: "prix_unitaire", width: 15 },
      { header: "Total", key: "total", width: 12 },
      { header: "Facture ID", key: "facture_id", width: 20 },
    ]
  };

  worksheet.columns = colonnes[tableName] || Object.keys(data[0]).map(k => ({ header: k, key: k, width: 15 }));

  worksheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3fcc" } };
    cell.alignment = { horizontal: "center" };
  });

  data.forEach(row => worksheet.addRow(row));

  return workbook.xlsx.writeBuffer();
}

module.exports = { envoyerAlerteQuotidienne, generateExcel };
