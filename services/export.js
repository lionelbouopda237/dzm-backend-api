const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

function moneyStyle(cell) {
  cell.numFmt = '#,##0';
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
}

async function generateExcel(tableName, data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'DZM Financial Cockpit';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(tableName);

  const logoPath = path.join(__dirname, '..', 'assets', 'dzm-logo.png');
  if (fs.existsSync(logoPath)) {
    const imageId = workbook.addImage({ filename: logoPath, extension: 'png' });
    worksheet.mergeCells('A1:C4');
    worksheet.addImage(imageId, 'A1:C4');
  }
  worksheet.mergeCells('D1:H2');
  worksheet.getCell('D1').value = `DZM Financial Cockpit — Export ${tableName}`;
  worksheet.getCell('D1').font = { name: 'Sora', size: 18, bold: true, color: { argb: 'FFF7FAFF' } };
  worksheet.getCell('D1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF091120' } };
  worksheet.getCell('D1').alignment = { vertical: 'middle' };
  worksheet.mergeCells('D3:H4');
  worksheet.getCell('D3').value = `Généré le ${new Date().toLocaleString('fr-FR')} • DZM A / DZM B • Surveillance DT AZIMUTS`;
  worksheet.getCell('D3').font = { size: 10, color: { argb: 'FFB9C5D7' } };
  worksheet.getCell('D3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF091120' } };
  worksheet.getCell('D3').alignment = { vertical: 'middle' };
  worksheet.addRow([]);
  worksheet.addRow([]);

  if (!data || data.length === 0) {
    worksheet.addRow(['Aucune donnée disponible']);
    return workbook.xlsx.writeBuffer();
  }

  const colonnes = {
    factures: [
      { header: 'N° Facture', key: 'numero_facture', width: 16 },
      { header: 'Structure', key: 'structure', width: 12 },
      { header: 'Client', key: 'client', width: 28 },
      { header: 'Total HT (FCFA)', key: 'total_ht', width: 16 },
      { header: 'TVA (FCFA)', key: 'tva', width: 14 },
      { header: 'Ristourne (FCFA)', key: 'ristourne', width: 16 },
      { header: 'Total TTC (FCFA)', key: 'total_ttc', width: 16 },
      { header: 'Emballages reçus', key: 'nombre_casiers', width: 18 },
      { header: 'Emballages renvoyés', key: 'casiers_retournes', width: 19 },
      { header: 'Date', key: 'date_facture', width: 12 },
      { header: 'Statut', key: 'statut', width: 12 },
    ],
    paiements_mobile: [
      { header: 'Transaction ID', key: 'transaction_id', width: 22 },
      { header: 'Structure', key: 'structure', width: 12 },
      { header: 'Montant (FCFA)', key: 'montant', width: 16 },
      { header: 'Facture liée', key: 'reference_facture', width: 18 },
      { header: 'Bénéficiaire', key: 'beneficiaire', width: 26 },
      { header: 'Date', key: 'date_paiement', width: 12 },
      { header: 'Statut', key: 'statut', width: 12 },
    ],
    produits_facture: [
      { header: 'Produit', key: 'produit', width: 28 },
      { header: 'Quantité', key: 'quantite', width: 10 },
      { header: 'Prix unitaire (FCFA)', key: 'prix_unitaire', width: 20 },
      { header: 'Total (FCFA)', key: 'total', width: 14 },
      { header: 'Facture ID', key: 'facture_id', width: 22 },
    ]
  };

  worksheet.columns = colonnes[tableName] || Object.keys(data[0]).map((k) => ({ header: k, key: k, width: 16 }));
  const headerRowIndex = worksheet.lastRow.number + 1;
  worksheet.getRow(headerRowIndex).values = worksheet.columns.map((c) => c.header);
  worksheet.getRow(headerRowIndex).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF143261' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: '335A83C9' } } };
  });
  worksheet.getRow(headerRowIndex).height = 24;

  data.forEach((row, index) => {
    const excelRow = worksheet.addRow(row);
    excelRow.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 === 0 ? 'FF0B1324' : 'FF0F1930' } };
      cell.font = { color: { argb: 'FFF4F7FB' }, size: 10 };
      cell.border = { bottom: { style: 'thin', color: { argb: '1FFFFFFF' } } };
      if ([4,5,6,7,8].includes(col) && tableName === 'factures') moneyStyle(cell);
      if ([3].includes(col) && tableName === 'paiements_mobile') moneyStyle(cell);
      if ([3,4].includes(col) && tableName === 'produits_facture') moneyStyle(cell);
    });
  });

  worksheet.views = [{ state: 'frozen', ySplit: headerRowIndex }];
  return workbook.xlsx.writeBuffer();
}

module.exports = { generateExcel };
