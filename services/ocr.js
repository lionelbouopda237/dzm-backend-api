const fs = require("fs");
const axios = require("axios");

// ─── OCR Facture avec Gemini Vision ───
async function analyseOCRFacture(imagePath, genAI) {
  try {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Tu es un expert en lecture de factures camerounaises.
Analyse cette image de facture et extrais TOUTES les informations visibles.
Sois très attentif aux détails même si l'image est de mauvaise qualité.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, sans backticks.

Champs à extraire :
- numero_facture : le numéro de facture (cherche "Facture N°", "N°", "FA-", "INV-", ou tout numéro visible)
- client : nom du client ou du dépôt
- date_facture : date au format YYYY-MM-DD (cherche toute date visible)
- structure : "DZM A" ou "DZM B" (si non visible, mets "DZM A")
- produits : liste des produits avec nom, quantite, prix_unitaire, total
- total_ht : montant hors taxes
- tva : montant de la TVA
- ristourne : montant de la ristourne ou remise
- total_ttc : montant total à payer (NET A PAYER)
- nombre_casiers : nombre de casiers (cherche "casiers", "caisses")
- casiers_retournes : casiers retournés
- confiance : ton niveau de confiance entre 0 et 100

Exemple de réponse attendue :
{"numero_facture":"246112","client":"Depot Pierre et Marthe","date_facture":"2023-08-03","structure":"DZM A","produits":[{"produit":"VALSYS 33 CL","quantite":16,"prix_unitaire":1600,"total":25600}],"total_ht":138200,"tva":27618,"ristourne":7500,"total_ttc":157318,"nombre_casiers":11,"casiers_retournes":4,"confiance":85}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: "image/jpeg"
        }
      }
    ]);

    let text = result.response.text().trim();
    // Nettoyer la réponse
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    // Trouver le JSON dans la réponse
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("OCR Gemini reussi - confiance:", parsed.confiance + "%");
      return parsed;
    }

    throw new Error("JSON non trouve dans la reponse Gemini");

  } catch (err) {
    console.error("Gemini OCR facture echoue:", err.message);
    return await fallbackTesseract(imagePath, "facture");
  }
}

// ─── OCR Paiement Mobile Money ───
async function analyseOCRPaiement(imagePath, genAI) {
  try {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Tu es un expert en lecture de captures SMS Mobile Money camerounais.
Analyse cette image et extrais les informations de paiement.
Opérateurs au Cameroun : Orange Money, MTN MoMo, Wave, Moov Money, Express Union.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après, sans backticks.

Champs à extraire :
- transaction_id : identifiant unique de la transaction
- montant : montant en FCFA (nombre entier)
- beneficiaire : nom du bénéficiaire
- date_paiement : date au format YYYY-MM-DD
- operateur : Orange Money, MTN MoMo, Wave, Moov Money, ou Express Union
- statut : "payé"
- confiance : niveau de confiance entre 0 et 100

Exemple SMS Orange Money :
"Transfert de 50000 FCFA effectue. ID: 12345678. Beneficiaire: DT AZIMUT"

Exemple de réponse :
{"transaction_id":"12345678","montant":50000,"beneficiaire":"DT AZIMUT","date_paiement":"2026-03-16","operateur":"Orange Money","statut":"payé","confiance":90}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Image,
          mimeType: "image/jpeg"
        }
      }
    ]);

    let text = result.response.text().trim();
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("OCR Paiement reussi - confiance:", parsed.confiance + "%");
      return parsed;
    }

    throw new Error("JSON non trouve");

  } catch (err) {
    console.error("Gemini OCR paiement echoue:", err.message);
    return await fallbackTesseract(imagePath, "paiement");
  }
}

// ─── Fallback Tesseract ───
async function fallbackTesseract(imagePath, type) {
  try {
    const Tesseract = require("tesseract.js");
    const { data: { text } } = await Tesseract.recognize(imagePath, "fra+eng");

    console.log("Tesseract texte extrait:", text.slice(0, 200));

    if (type === "paiement") {
      const montantMatch = text.match(/(\d[\d\s]{2,})\s*(?:fcfa|xaf|cfa|f\b)/i);
      const txnMatch = text.match(/(?:id|transaction|ref)[^\d]*(\d{6,})/i);

      return {
        transaction_id: txnMatch ? txnMatch[1] : null,
        montant: montantMatch ? parseInt(montantMatch[1].replace(/\s/g, "")) : null,
        beneficiaire: null,
        date_paiement: new Date().toISOString().split("T")[0],
        operateur: text.toLowerCase().includes("orange") ? "Orange Money" :
                   text.toLowerCase().includes("wave") ? "Wave" :
                   text.toLowerCase().includes("mtn") ? "MTN MoMo" :
                   text.toLowerCase().includes("moov") ? "Moov Money" : null,
        statut: "en attente",
        confiance: 35,
        source: "tesseract"
      };
    }

    // Extraction basique pour facture
    const numeroMatch = text.match(/(?:facture|n°|no|num)[^\d]*(\d{4,})/i);
    const montantMatch = text.match(/(?:net|total|ttc)[^\d]*(\d[\d\s]{3,})\s*(?:fcfa|f\b)?/i);
    const clientMatch = text.match(/(?:client|depot|depôt)\s*:?\s*([^\n]{3,40})/i);
    const casiersMatch = text.match(/(?:casiers?|caisses?)\s*:?\s*(\d+)/i);

    return {
      numero_facture: numeroMatch ? numeroMatch[1] : null,
      client: clientMatch ? clientMatch[1].trim() : null,
      date_facture: new Date().toISOString().split("T")[0],
      structure: "DZM A",
      produits: [],
      total_ht: null,
      tva: null,
      ristourne: null,
      total_ttc: montantMatch ? parseInt(montantMatch[1].replace(/\s/g, "")) : null,
      nombre_casiers: casiersMatch ? parseInt(casiersMatch[1]) : null,
      casiers_retournes: null,
      confiance: 35,
      source: "tesseract",
      texte_brut: text.slice(0, 300)
    };
  } catch (e) {
    return {
      erreur: "OCR indisponible",
      confiance: 0,
      message: "Veuillez saisir les donnees manuellement"
    };
  }
}

module.exports = { analyseOCRFacture, analyseOCRPaiement };
