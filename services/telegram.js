const { assistantIA } = require("./assistant");

const fmt = n => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";

// Stockage temporaire des résultats OCR en attente de confirmation
const ocrPending = {};

module.exports = function setupTelegram(bot, supabase, genAI) {
  if (!bot) return;


  // /start
  bot.onText(/\/start/, async (msg) => {
    const heure = new Date().getHours();
    const salut = heure < 12 ? "Bonjour" : heure < 18 ? "Bon apres-midi" : "Bonsoir";
    const texte = salut + " ! Je suis l'Assistant IA DZM\n\n" +
      "Menu principal :\n\n" +
      "/vue_generale - Vue proprietaire\n" +
      "/dzm_a - Analyse DZM A\n" +
      "/dzm_b - Analyse DZM B\n" +
      "/duel - DZM A vs DZM B\n" +
      "/factures - Dernieres factures\n" +
      "/paiements - Derniers paiements\n" +
      "/activite - Activite du jour\n" +
      "/vigilance - Points de vigilance\n" +
      "/produits - Produits moteurs\n" +
      "/export - Export Excel par email\n\n" +
      "Envoyez une photo de facture pour OCR automatique !";
    bot.sendMessage(msg.chat.id, texte);
  });

  // /vue_generale
  bot.onText(/\/vue_generale/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse en cours...");
    try {
      const reponse = await assistantIA(
        "Donne-moi une vue generale complete de ETS DZM : facturation globale, paiements, reste a payer, produits moteurs top 3.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Vue Generale Proprietaire\n\n" + reponse);
    } catch (e) {
      console.error("vue_generale error:", e.message);
      bot.sendMessage(chatId, "Erreur lors de l'analyse.");
    }
  });

  // /dzm_a
  bot.onText(/\/dzm_a/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse DZM A en cours...");
    try {
      const reponse = await assistantIA(
        "Analyse detaillee de DZM A : factures, paiements, CA, clients principaux.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Analyse DZM A\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /dzm_b
  bot.onText(/\/dzm_b/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse DZM B en cours...");
    try {
      const reponse = await assistantIA(
        "Analyse detaillee de DZM B : factures, paiements, CA, clients principaux.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Analyse DZM B\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /duel
  bot.onText(/\/duel/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Comparaison en cours...");
    try {
      const reponse = await assistantIA(
        "Compare DZM A vs DZM B. Qui performe mieux ? Donne un verdict final.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Duel DZM A vs DZM B\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /factures
  bot.onText(/\/factures/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const { data } = await supabase
        .from("factures").select("*")
        .order("created_at", { ascending: false }).limit(5);
      if (!data?.length) return bot.sendMessage(chatId, "Aucune facture.");
      let texte = "5 Dernieres Factures\n\n";
      data.forEach(f => {
        texte += f.numero_facture + "\n";
        texte += "Client : " + f.client + "\n";
        texte += "Structure : " + f.structure + "\n";
        texte += "Montant : " + fmt(f.total_ttc) + "\n";
        texte += "Casiers : " + f.nombre_casiers + "\n";
        texte += "Date : " + f.date_facture + "\n";
        texte += "Statut : " + f.statut + "\n\n";
      });
      bot.sendMessage(chatId, texte);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /paiements
  bot.onText(/\/paiements/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const { data } = await supabase
        .from("paiements_mobile").select("*")
        .order("created_at", { ascending: false }).limit(5);
      if (!data?.length) return bot.sendMessage(chatId, "Aucun paiement.");
      let texte = "5 Derniers Paiements\n\n";
      data.forEach(p => {
        texte += p.transaction_id + "\n";
        texte += "Montant : " + fmt(p.montant) + "\n";
        texte += "Structure : " + p.structure + "\n";
        texte += "Facture : " + (p.reference_facture || "Non lie") + "\n";
        texte += "Statut : " + p.statut + "\n\n";
      });
      bot.sendMessage(chatId, texte);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /activite
  bot.onText(/\/activite/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse de l'activite...");
    try {
      const reponse = await assistantIA(
        "Resume l'activite d'aujourd'hui pour ETS DZM.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Activite du Jour\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /vigilance
  bot.onText(/\/vigilance/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Verification en cours...");
    try {
      const reponse = await assistantIA(
        "Analyse les points de vigilance : totaux incoherents, TVA incorrecte, casiers suspects. Donne 2 conseils.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Points de Vigilance\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /produits
  bot.onText(/\/produits/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse des produits...");
    try {
      const reponse = await assistantIA(
        "Top 3 produits moteurs avec casiers vendus, CA et part de vente.",
        [], supabase, null
      );
      bot.sendMessage(chatId, "Produits Moteurs\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /export
  bot.onText(/\/export/, async (msg) => {
    bot.sendMessage(msg.chat.id,
      "Export Excel\n\nEnvoyez votre email :\n\n/email votre@email.com"
    );
  });

  // /email
  bot.onText(/\/email (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1].trim();
    bot.sendMessage(chatId, "Envoi en cours vers " + email + "...");
    try {
      const axios = require("axios");
      await axios.post(
        (process.env.BACKEND_PUBLIC_URL || "https://dzm-backend-api.onrender.com") + "/api/export/email",
        { email }
      );
      bot.sendMessage(chatId, "Export envoye a " + email + " !\n3 fichiers Excel joints.");
    } catch (e) {
      bot.sendMessage(chatId, "Erreur lors de l'envoi. Verifiez la configuration Gmail.");
    }
  });

  // ─── Photo → OCR complet + sauvegarde ───
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const processing = await bot.sendMessage(chatId, "Image recue - OCR Groq en cours...");
    try {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      const fileInfo = await bot.getFile(photoId);
      const fileUrl = "https://api.telegram.org/file/bot" + process.env.TELEGRAM_BOT_TOKEN + "/" + fileInfo.file_path;

      const axios = require("axios");
      const FormData = require("form-data");
      const imageResponse = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const formData = new FormData();
      formData.append("image", Buffer.from(imageResponse.data), {
        filename: "facture.jpg",
        contentType: "image/jpeg"
      });

      const ocrRes = await axios.post(
        (process.env.BACKEND_PUBLIC_URL || "https://dzm-backend-api.onrender.com") + "/api/ocr/facture",
        formData,
        { headers: formData.getHeaders() }
      );
      const d = ocrRes.data.data;

      // Stocker les données OCR complètes
      const msgId = msg.message_id.toString();
      ocrPending[msgId] = d;

      // Afficher résumé
      let texte = "Extraction OCR reussie (" + (d.confiance || "?") + "% confiance)\n\n";
      texte += "Numero : " + (d.numero_facture || "Non detecte") + "\n";
      texte += "Client : " + (d.client || "Non detecte") + "\n";
      texte += "Montant TTC : " + (d.total_ttc ? fmt(d.total_ttc) : "Non detecte") + "\n";
      texte += "Total HT : " + (d.total_ht ? fmt(d.total_ht) : "Non detecte") + "\n";
      texte += "TVA : " + (d.tva ? fmt(d.tva) : "Non detecte") + "\n";
      texte += "Ristourne : " + (d.ristourne ? fmt(d.ristourne) : "Non detecte") + "\n";
      texte += "Casiers : " + (d.nombre_casiers || "Non detecte") + "\n";
      texte += "Casiers retournes : " + (d.casiers_retournes || "Non detecte") + "\n";
      texte += "Date : " + (d.date_facture || "Non detectee") + "\n";
      texte += "Structure : " + (d.structure || "DZM A") + "\n";

      if (d.produits && d.produits.length > 0) {
        texte += "\nProduits (" + d.produits.length + ") :\n";
        d.produits.forEach(p => {
          texte += "- " + p.produit + " x" + p.quantite + " = " + fmt(p.total) + "\n";
        });
      }

      await bot.deleteMessage(chatId, processing.message_id).catch(() => {});
      bot.sendMessage(chatId, texte, {
        reply_markup: {
          inline_keyboard: [[
            { text: "Enregistrer tout", callback_data: "save_" + msgId },
            { text: "Ignorer", callback_data: "ignore" }
          ]]
        }
      });
    } catch (err) {
      await bot.deleteMessage(chatId, processing.message_id).catch(() => {});
      console.error("OCR photo error:", err.message);
      bot.sendMessage(chatId, "Erreur OCR. Reessayez.");
    }
  });

  // Messages texte libres
  bot.on("message", async (msg) => {
    if (msg.text && !msg.text.startsWith("/") && msg.text.length > 3) {
      const chatId = msg.chat.id;
      const processing = await bot.sendMessage(chatId, "Analyse en cours...");
      try {
        const reponse = await assistantIA(msg.text, [], supabase, null);
        await bot.deleteMessage(chatId, processing.message_id).catch(() => {});
        bot.sendMessage(chatId, reponse);
      } catch (e) {
        bot.sendMessage(chatId, "Erreur lors de l'analyse.");
      }
    }
  });

  // ─── Callbacks boutons ───
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;

    if (query.data === "ignore") {
      bot.answerCallbackQuery(query.id, { text: "Ignore." });
      bot.sendMessage(chatId, "Facture ignoree.");
      return;
    }

    if (query.data.startsWith("save_")) {
      const msgId = query.data.replace("save_", "");
      const d = ocrPending[msgId];

      if (!d) {
        bot.answerCallbackQuery(query.id, { text: "Donnees expirées." });
        bot.sendMessage(chatId, "Les donnees ont expire. Renvoyez la photo.");
        return;
      }

      try {
        // 1. Vérifier doublon
        const { data: existing } = await supabase
          .from("factures")
          .select("id")
          .eq("numero_facture", d.numero_facture)
          .limit(1);

        if (existing && existing.length > 0) {
          bot.answerCallbackQuery(query.id, { text: "Doublon detecte !" });
          bot.sendMessage(chatId, "Cette facture existe deja dans la base (" + d.numero_facture + ").");
          delete ocrPending[msgId];
          return;
        }

        // 2. Insérer la facture
        const { data: factureInserted, error: factureError } = await supabase
          .from("factures")
          .insert([{
            numero_facture: d.numero_facture || "OCR-" + Date.now(),
            structure: d.structure || "DZM A",
            client: d.client,
            total_ht: d.total_ht,
            tva: d.tva,
            ristourne: d.ristourne,
            total_ttc: d.total_ttc,
            nombre_casiers: d.nombre_casiers,
            casiers_retournes: d.casiers_retournes,
            date_facture: d.date_facture,
            statut: "en attente"
          }])
          .select();

        if (factureError) throw new Error(factureError.message);

        // 3. Insérer les produits
        if (d.produits && d.produits.length > 0 && factureInserted[0]) {
          const produits = d.produits.map(p => ({
            facture_id: factureInserted[0].id,
            produit: p.produit,
            quantite: p.quantite,
            prix_unitaire: p.prix_unitaire,
            total: p.total
          }));
          await supabase.from("produits_facture").insert(produits);
        }

        // Nettoyer
        delete ocrPending[msgId];

        bot.answerCallbackQuery(query.id, { text: "Enregistre !" });
        bot.sendMessage(chatId,
          "Facture enregistree dans DZM Codex !\n\n" +
          "N : " + (d.numero_facture || "Auto") + "\n" +
          "Client : " + (d.client || "-") + "\n" +
          "Montant : " + (d.total_ttc ? fmt(d.total_ttc) : "-") + "\n" +
          "Produits : " + (d.produits?.length || 0) + " lignes enregistrees"
        );

      } catch (err) {
        console.error("Save error:", err.message);
        bot.answerCallbackQuery(query.id, { text: "Erreur !" });
        bot.sendMessage(chatId, "Erreur enregistrement : " + err.message);
      }
    }
  });

  console.log("Bot Telegram configure et actif");
};
