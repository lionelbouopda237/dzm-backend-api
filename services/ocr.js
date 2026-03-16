const fs = require("fs");

// ─── OCR Facture avec Gemini Vision ───
async function analyseOCRFacture(imagePath, genAI) {
  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString("base64");
  const mimeType = imagePath.endsWith(".pdf") ? "application/pdf" : "image/jpeg";

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `Tu es un expert en lecture de factures camerounaises de boissons.
Analyse cette image de facture et extrais EXACTEMENT ces informations en JSON.
Réponds UNIQUEMENT avec le JSON, sans aucun texte avant ou après.

{
  "numero_facture": "numéro de la facture (ex: FA-2026-001)",
  "client": "nom du client",
  "date_facture": "date au format YYYY-MM-DD",
  "structure": "DZM A ou DZM B",
  "produits": [
    {
      "produit": "nom du produit (ex: Casier Beaufort 65cl)",
      "quantite": nombre entier,
      "prix_unitaire": nombre,
      "total": nombre
    }
  ],
  "total_ht": nombre,
  "tva": nombre,
  "ristourne": nombre,
  "total_ttc": nombre,
  "nombre_casiers": nombre entier,
  "casiers_retournes": nombre entier,
  "confiance": pourcentage entre 0 et 100
}

Si une valeur n'est pas visible, mets null.
Les montants sont en FCFA.`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType } }
    ]);

    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("Gemini OCR facture échoué, tentative Tesseract...");
    return await fallbackTesseract(imagePath, "facture");
  }
}

// ─── OCR Paiement Mobile Money ───
async function analyseOCRPaiement(imagePath, genAI) {
  const imageData = fs.readFileSync(imagePath);
  const base64Image = imageData.toString("base64");

  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `Tu es un expert en lecture de captures SMS Mobile Money camerounais.
Analyse cette image et extrais les informations de paiement en JSON.
Réponds UNIQUEMENT avec le JSON, sans texte avant ou après.

Opérateurs connus : Orange Money, Wave, MTN MoMo, Moov Money

{
  "transaction_id": "identifiant de la transaction",
  "montant": nombre en FCFA,
  "beneficiaire": "nom du bénéficiaire",
  "date_paiement": "date au format YYYY-MM-DD",
  "operateur": "Orange Money ou Wave ou MTN MoMo ou Moov Money",
  "statut": "payé",
  "confiance": pourcentage entre 0 et 100
}

Exemple de SMS à analyser :
"Transfert de 500000 FCFA effectué avec succès. Transaction Id: 15765062067. DT AZIMUT MASTER"

Si une valeur n'est pas visible, mets null.`;

  try {
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
    ]);

    const text = result.response.text().trim();
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("Gemini OCR paiement échoué, tentative fallback...");
    return await fallbackTesseract(imagePath, "paiement");
  }
}

// ─── Fallback Tesseract si Gemini échoue ───
async function fallbackTesseract(imagePath, type) {
  try {
    const Tesseract = require("tesseract.js");
    const { data: { text } } = await Tesseract.recognize(imagePath, "fra");

    if (type === "paiement") {
      const montantMatch = text.match(/(\d[\d\s]{2,})\s*(?:fcfa|xaf|cfa|f)/i);
      const txnMatch = text.match(/(?:transaction|id|ref)[^\d]*(\d{8,})/i);

      return {
        transaction_id: txnMatch ? txnMatch[1] : null,
        montant: montantMatch ? parseInt(montantMatch[1].replace(/\s/g, "")) : null,
        beneficiaire: null,
        date_paiement: new Date().toISOString().split("T")[0],
        operateur: text.toLowerCase().includes("orange") ? "Orange Money" :
                   text.toLowerCase().includes("wave") ? "Wave" :
                   text.toLowerCase().includes("mtn") ? "MTN MoMo" : null,
        statut: "en attente",
        confiance: 40,
        source: "tesseract"
      };
    }

    return {
      numero_facture: null,
      client: null,
      date_facture: new Date().toISOString().split("T")[0],
      structure: "DZM A",
      produits: [],
      total_ht: null,
      tva: null,
      ristourne: null,
      total_ttc: null,
      nombre_casiers: null,
      casiers_retournes: null,
      confiance: 30,
      source: "tesseract",
      texte_brut: text.slice(0, 500)
    };
  } catch (_) {
    return {
      erreur: "OCR non disponible",
      confiance: 0,
      message: "Veuillez saisir les données manuellement"
    };
  }
}

module.exports = { analyseOCRFacture, analyseOCRPaiement };
