const ExcelJS = require("exceljs");

async function generateExcel(tableName, data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DZM Codex";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(tableName);

  if (!data || data.length === 0) {
    worksheet.addRow(["Aucune donnée disponible"]);
    return workbook.xlsx.writeBuffer();
  }

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

  worksheet.columns = colonnes[tableName] ||
    Object.keys(data[0]).map(k => ({ header: k, key: k, width: 15 }));

  // Style entête
  worksheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1a3fcc" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  worksheet.getRow(1).height = 25;

  // Données
  data.forEach((row, index) => {
    const excelRow = worksheet.addRow(row);
    if (index % 2 === 1) {
      excelRow.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFF" } };
      });
    }
  });

  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
