const fs = require("fs");
const Groq = require("groq-sdk");

async function analyseOCRFacture(imagePath, genAI) {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Tu es expert en factures camerounaises. Extrais TOUTES les informations.
Réponds UNIQUEMENT avec un JSON valide sans texte avant ou après.
{
  "numero_facture": "numéro",
  "client": "nom client",
  "date_facture": "YYYY-MM-DD",
  "structure": "DZM A",
  "produits": [{"produit": "nom", "quantite": 0, "prix_unitaire": 0, "total": 0}],
  "total_ht": 0,
  "tva": 0,
  "ristourne": 0,
  "total_ttc": 0,
  "nombre_casiers": 0,
  "casiers_retournes": 0,
  "emb_plein": 0,
  "emb_vide": 0,
  "colis": 0,
  "confiance": 95
}`
          },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64," + base64Image }
          }
        ]
      }],
      temperature: 0.1,
      max_tokens: 2000
    });

    let text = response.choices[0]?.message?.content || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log("OCR Groq reussi - confiance:", parsed.confiance + "%");
      return parsed;
    }
    throw new Error("JSON non trouve");
  } catch (err) {
    console.error("Groq OCR facture echoue:", err.message);
    return await fallbackTesseract(imagePath, "facture");
  }
}

async function analyseOCRPaiement(imagePath, genAI) {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString("base64");

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Extrais les infos de ce SMS Mobile Money camerounais.
JSON uniquement: {"transaction_id":"","montant":0,"beneficiaire":"","date_paiement":"YYYY-MM-DD","operateur":"Orange Money","statut":"payé","confiance":95}`
          },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64," + base64Image }
          }
        ]
      }],
      temperature: 0.1,
      max_tokens: 300
    });

    let text = response.choices[0]?.message?.content || "";
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    throw new Error("JSON non trouve");
  } catch (err) {
    console.error("Groq OCR paiement echoue:", err.message);
    return await fallbackTesseract(imagePath, "paiement");
  }
}

async function fallbackTesseract(imagePath, type) {
  try {
    const Tesseract = require("tesseract.js");
    const { data: { text } } = await Tesseract.recognize(imagePath, "fra+eng");
    if (type === "paiement") {
      const montantMatch = text.match(/(\d[\d\s]{2,})\s*(?:fcfa|cfa)/i);
      const txnMatch = text.match(/(?:id|transaction)[^\d]*(\d{6,})/i);
      return { transaction_id: txnMatch?.[1] || null, montant: montantMatch ? parseInt(montantMatch[1].replace(/\s/g,"")) : null, beneficiaire: null, date_paiement: new Date().toISOString().split("T")[0], operateur: text.toLowerCase().includes("orange") ? "Orange Money" : text.toLowerCase().includes("wave") ? "Wave" : text.toLowerCase().includes("mtn") ? "MTN MoMo" : null, statut: "en attente", confiance: 35, source: "tesseract" };
    }
    const numeroMatch = text.match(/(?:facture|n°)[^\d]*(\d{4,})/i);
    const montantMatch = text.match(/(?:net|total)[^\d]*(\d[\d\s]{3,})/i);
    const clientMatch = text.match(/(?:client)[^\n]*:?\s*([^\n]{3,40})/i);
    const casiersMatch = text.match(/(?:casiers?)[^\d]*(\d+)/i);
    return { numero_facture: numeroMatch?.[1] || null, client: clientMatch?.[1]?.trim() || null, date_facture: new Date().toISOString().split("T")[0], structure: "DZM A", produits: [], total_ht: null, tva: null, ristourne: null, total_ttc: montantMatch ? parseInt(montantMatch[1].replace(/\s/g,"")) : null, nombre_casiers: casiersMatch ? parseInt(casiersMatch[1]) : null, casiers_retournes: 0, emb_plein: casiersMatch ? parseInt(casiersMatch[1]) : 0, emb_vide: 0, colis: casiersMatch ? parseInt(casiersMatch[1]) : 0, confiance: 35, source: "tesseract" };
  } catch(e) {
    return { erreur: "OCR indisponible", confiance: 0, message: "Saisie manuelle requise" };
  }
}

module.exports = { analyseOCRFacture, analyseOCRPaiement };
