const { assistantIA } = require("./assistant");
const ExcelJS = require("exceljs");

// ─── Alerte quotidienne Telegram ───
async function envoyerAlerteQuotidienne(bot, supabase, genAI) {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return console.log("⚠️ TELEGRAM_CHAT_ID non configuré");

    const aujourd_hui = new Date().toISOString().split("T")[0];

    const [
      { data: facturesAujourdhui },
      { data: paiementsAujourdhui },
      { count: totalFactures }
    ] = await Promise.all([
      supabase.from("factures").select("*").gte("created_at", aujourd_hui),
      supabase.from("paiements_mobile").select("*").gte("created_at", aujourd_hui),
      supabase.from("factures").select("*", { count: "exact", head: true })
    ]);

    if (!facturesAujourdhui?.length && !paiementsAujourdhui?.length) {
      bot.sendMessage(chatId,
        `⚠️ *Alerte DZM Codex*\n\nAucune activité enregistrée aujourd'hui.\nPensez à saisir vos factures et paiements ! 📋`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const reponse = await assistantIA(
      "Génère un résumé de l'activité d'aujourd'hui pour ETS DZM. Sois concis et positif.",
      [], supabase, genAI
    );

    bot.sendMessage(chatId,
      `📅 *Rapport Quotidien DZM*\n${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}\n\n${reponse}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error("Erreur alerte quotidienne:", err.message);
  }
}

// ─── Génération Excel ───
async function generateExcel(tableName, data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DZM Codex";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(tableName, {
    pageSetup: { orientation: "landscape" }
  });

  // Style entête
  const headerStyle = {
    font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3fcc" } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" }
    }
  };

  if (!data || data.length === 0) {
    worksheet.addRow(["Aucune donnée disponible"]);
    return workbook.xlsx.writeBuffer();
  }

  // Colonnes selon la table
  const colonnes = {
    factures: [
      { header: "N° Facture", key: "numero_facture", width: 15 },
      { header: "Structure", key: "structure", width: 10 },
      { header: "Client", key: "client", width: 25 },
      { header: "Total HT (FCFA)", key: "total_ht", width: 16 },
      { header: "TVA (FCFA)", key: "tva", width: 14 },
      { header: "Ristourne (FCFA)", key: "ristourne", width: 16 },
      { header: "Total TTC (FCFA)", key: "total_ttc", width: 16 },
      { header: "Casiers", key: "nombre_casiers", width: 10 },
      { header: "Casiers retournés", key: "casiers_retournes", width: 18 },
      { header: "Date", key: "date_facture", width: 12 },
      { header: "Statut", key: "statut", width: 12 },
    ],
    paiements_mobile: [
      { header: "Transaction ID", key: "transaction_id", width: 20 },
      { header: "Structure", key: "structure", width: 10 },
      { header: "Montant (FCFA)", key: "montant", width: 16 },
      { header: "Facture liée", key: "reference_facture", width: 15 },
      { header: "Bénéficiaire", key: "beneficiaire", width: 25 },
      { header: "Date", key: "date_paiement", width: 12 },
      { header: "Statut", key: "statut", width: 12 },
    ],
    produits_facture: [
      { header: "Produit", key: "produit", width: 25 },
      { header: "Quantité", key: "quantite", width: 10 },
      { header: "Prix unitaire (FCFA)", key: "prix_unitaire", width: 20 },
      { header: "Total (FCFA)", key: "total", width: 14 },
      { header: "Facture ID", key: "facture_id", width: 20 },
    ]
  };

  worksheet.columns = colonnes[tableName] || Object.keys(data[0]).map(k => ({ header: k, key: k, width: 15 }));

  // Style entête
  worksheet.getRow(1).eachCell(cell => { Object.assign(cell, headerStyle); });
  worksheet.getRow(1).height = 25;

  // Données
  data.forEach((row, index) => {
    const excelRow = worksheet.addRow(row);
    excelRow.eachCell(cell => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFe2e8f0" } },
        left: { style: "thin", color: { argb: "FFe2e8f0" } },
        bottom: { style: "thin", color: { argb: "FFe2e8f0" } },
        right: { style: "thin", color: { argb: "FFe2e8f0" } }
      };
      if (index % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFF" } };
      }
    });

    // Couleur statut
    const statutCell = excelRow.getCell("statut");
    if (statutCell.value === "payé") {
      statutCell.font = { color: { argb: "FF16a34a" }, bold: true };
    } else if (statutCell.value === "anomalie") {
      statutCell.font = { color: { argb: "FFdc2626" }, bold: true };
    } else if (statutCell.value === "en attente") {
      statutCell.font = { color: { argb: "FFd97706" }, bold: true };
    }
  });

  // Ligne totaux pour factures
  if (tableName === "factures") {
    const totalRow = worksheet.addRow({
      numero_facture: "TOTAL",
      total_ht: data.reduce((s, f) => s + (f.total_ht || 0), 0),
      tva: data.reduce((s, f) => s + (f.tva || 0), 0),
      ristourne: data.reduce((s, f) => s + (f.ristourne || 0), 0),
      total_ttc: data.reduce((s, f) => s + (f.total_ttc || 0), 0),
      nombre_casiers: data.reduce((s, f) => s + (f.nombre_casiers || 0), 0),
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFe0e7ff" } };
  }

  return workbook.xlsx.writeBuffer();
}

module.exports = { envoyerAlerteQuotidienne, generateExcel };
