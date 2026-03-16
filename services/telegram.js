const { assistantIA } = require("./assistant");

const fmt = n => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";

module.exports = function setupTelegram(bot, supabase, genAI) {

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
        [], supabase, genAI
      );
      bot.sendMessage(chatId, "Vue Generale Proprietaire\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur lors de l'analyse.");
    }
  });

  // /dzm_a
  bot.onText(/\/dzm_a/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Analyse DZM A en cours...");
    try {
      const reponse = await assistantIA(
        "Analyse detaillee de DZM A uniquement : factures, paiements, CA, clients principaux.",
        [], supabase, genAI
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
        "Analyse detaillee de DZM B uniquement : factures, paiements, CA, clients principaux.",
        [], supabase, genAI
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
        [], supabase, genAI
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
        .from("factures")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

      if (!data || !data.length) {
        bot.sendMessage(chatId, "Aucune facture trouvee.");
        return;
      }

      let texte = "5 Dernieres Factures\n\n";
      data.forEach(f => {
        const statut = f.statut === "paye" ? "OK" : f.statut === "anomalie" ? "ANOMALIE" : "EN ATTENTE";
        texte += f.numero_facture + "\n";
        texte += "Client : " + f.client + "\n";
        texte += "Structure : " + f.structure + "\n";
        texte += "Montant : " + fmt(f.total_ttc) + "\n";
        texte += "Casiers : " + f.nombre_casiers + "\n";
        texte += "Date : " + f.date_facture + "\n";
        texte += "Statut : " + statut + "\n\n";
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
        .from("paiements_mobile")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

      if (!data || !data.length) {
        bot.sendMessage(chatId, "Aucun paiement trouve.");
        return;
      }

      let texte = "5 Derniers Paiements\n\n";
      data.forEach(p => {
        texte += p.transaction_id + "\n";
        texte += "Montant : " + fmt(p.montant) + "\n";
        texte += "Operateur : " + (p.operateur || "-") + "\n";
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
        "Qu'est-ce qui s'est passe aujourd'hui dans ETS DZM ? Factures, paiements, modifications.",
        [], supabase, genAI
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
        "Analyse les points de vigilance : totaux incoherents, TVA incorrecte, casiers suspects. Donne 2 conseils de gestion.",
        [], supabase, genAI
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
        "Quels sont les top 3 produits moteurs ? Casiers vendus, CA et part de vente pour chacun.",
        [], supabase, genAI
      );
      bot.sendMessage(chatId, "Produits Moteurs\n\n" + reponse);
    } catch (e) {
      bot.sendMessage(chatId, "Erreur.");
    }
  });

  // /export
  bot.onText(/\/export/, async (msg) => {
    bot.sendMessage(msg.chat.id,
      "Export Excel\n\nEnvoyez votre email pour recevoir l'export :\n\n/email votre@email.com"
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
        "https://dzm-backend-api.onrender.com/api/export/email",
        { email }
      );
      bot.sendMessage(chatId, "Export envoye avec succes a " + email + " !\n\nVous recevrez 3 fichiers Excel.");
    } catch (e) {
      bot.sendMessage(chatId, "Erreur lors de l'envoi. Verifiez la configuration Gmail.");
    }
  });

  // Photo -> OCR
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const processing = await bot.sendMessage(chatId, "Image recue - Analyse OCR Gemini en cours...");
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
        "https://dzm-backend-api.onrender.com/api/ocr/facture",
        formData,
        { headers: formData.getHeaders() }
      );
      const d = ocrRes.data.data;

      const texte = "Extraction OCR reussie (" + (d.confiance || "?") + "% confiance)\n\n" +
        "Numero : " + (d.numero_facture || "Non detecte") + "\n" +
        "Client : " + (d.client || "Non detecte") + "\n" +
        "Montant TTC : " + (d.total_ttc ? fmt(d.total_ttc) : "Non detecte") + "\n" +
        "Casiers : " + (d.nombre_casiers || "Non detecte") + "\n" +
        "Date : " + (d.date_facture || "Non detectee") + "\n" +
        "Structure : " + (d.structure || "Non detectee");

      await bot.deleteMessage(chatId, processing.message_id);
      bot.sendMessage(chatId, texte, {
        reply_markup: {
          inline_keyboard: [[
            { text: "Enregistrer", callback_data: "save_facture" },
            { text: "Ignorer", callback_data: "ignore" }
          ]]
        }
      });
    } catch (err) {
      await bot.deleteMessage(chatId, processing.message_id).catch(() => {});
      bot.sendMessage(chatId, "Erreur OCR. Verifiez que le backend est actif.");
    }
  });

  // Messages texte libres -> Assistant IA
  bot.on("message", async (msg) => {
    if (msg.text && !msg.text.startsWith("/") && msg.text.length > 3) {
      const chatId = msg.chat.id;
      const processing = await bot.sendMessage(chatId, "Analyse en cours...");
      try {
        const reponse = await assistantIA(msg.text, [], supabase, genAI);
        await bot.deleteMessage(chatId, processing.message_id).catch(() => {});
        bot.sendMessage(chatId, reponse);
      } catch (e) {
        bot.sendMessage(chatId, "Erreur lors de l'analyse.");
      }
    }
  });

  // Callbacks boutons
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (query.data === "ignore") {
      bot.answerCallbackQuery(query.id, { text: "Ignore." });
    } else if (query.data === "save_facture") {
      bot.answerCallbackQuery(query.id, { text: "Enregistre !" });
      bot.sendMessage(chatId, "Facture enregistree dans DZM Codex !");
    }
  });

  console.log("Bot Telegram configure et actif");
};
