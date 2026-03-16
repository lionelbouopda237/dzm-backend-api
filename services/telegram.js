const { assistantIA } = require("./assistant");

const fmt = n => new Intl.NumberFormat("fr-FR").format(n) + " FCFA";

module.exports = function setupTelegram(bot, supabase, genAI) {

  // ─── /start ───
  bot.onText(/\/start/, async (msg) => {
    const heure = new Date().getHours();
    const salut = heure < 12 ? "🌅 Bonjour" : heure < 18 ? "☀️ Bon après-midi" : "🌙 Bonsoir";
    const texte = `${salut} ! Je suis *l'Assistant IA DZM* 🤖\n\n` +
      `Je gère les finances de *ETS DZM* en temps réel.\n\n` +
      `*Menu principal :*\n` +
      `📊 /vue\_generale — Vue propriétaire\n` +
      `🏢 /dzm\_a — Analyse DZM A\n` +
      `🏢 /dzm\_b — Analyse DZM B\n` +
      `⚔️ /duel — DZM A vs DZM B\n` +
      `📄 /factures — Dernières factures\n` +
      `💳 /paiements — Derniers paiements\n` +
      `📅 /activite — Activité du jour\n` +
      `⚠️ /vigilance — Points de vigilance\n` +
      `📦 /produits — Produits moteurs\n` +
      `📤 /export — Export Excel par email\n` +
      `🎤 Envoyez un *message vocal* pour une question\n` +
      `📸 Envoyez une *photo* de facture pour l'OCR`;
    bot.sendMessage(msg.chat.id, texte, { parse_mode: "Markdown" });
  });

  // ─── Vue générale ───
  bot.onText(/\/vue_generale/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Analyse en cours...");
    try {
      const reponse = await assistantIA(
        "Donne-moi une vue générale complète de ETS DZM : facturation globale, paiements, reste à payer, produits moteurs top 3. Sois précis et utilise les vraies données.",
        [], supabase, genAI
      );
      bot.sendMessage(chatId, `📊 *Vue Générale Propriétaire*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur lors de l'analyse.");
    }
  });

  // ─── DZM A ───
  bot.onText(/\/dzm_a/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Analyse DZM A...");
    try {
      const reponse = await assistantIA("Analyse détaillée de DZM A uniquement : factures, paiements, CA, clients principaux.", [], supabase, genAI);
      bot.sendMessage(chatId, `🏢 *Analyse DZM A*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── DZM B ───
  bot.onText(/\/dzm_b/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Analyse DZM B...");
    try {
      const reponse = await assistantIA("Analyse détaillée de DZM B uniquement : factures, paiements, CA, clients principaux.", [], supabase, genAI);
      bot.sendMessage(chatId, `🏢 *Analyse DZM B*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Duel ───
  bot.onText(/\/duel/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Comparaison en cours...");
    try {
      const reponse = await assistantIA("Compare DZM A vs DZM B de façon détaillée. Qui performe mieux ? Sur quels critères ? Donne un verdict final.", [], supabase, genAI);
      bot.sendMessage(chatId, `⚔️ *Duel DZM A vs DZM B*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Dernières factures ───
  bot.onText(/\/factures/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const { data } = await supabase.from("factures").select("*").order("created_at", { ascending: false }).limit(5);
      if (!data?.length) return bot.sendMessage(chatId, "📭 Aucune facture.");
      let texte = `📄 *5 Dernières Factures*\n\n`;
      data.forEach(f => {
        const emoji = f.statut === "payé" ? "✅" : f.statut === "anomalie" ? "⚠️" : "⏳";
        texte += `${emoji} *${f.numero_facture}*\n`;
        texte += `   👤 ${f.client}\n`;
        texte += `   🏢 ${f.structure} | 💰 ${fmt(f.total_ttc)}\n`;
        texte += `   📦 ${f.nombre_casiers} casiers | 📅 ${f.date_facture}\n\n`;
      });
      bot.sendMessage(chatId, texte, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Derniers paiements ───
  bot.onText(/\/paiements/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const { data } = await supabase.from("paiements_mobile").select("*").order("created_at", { ascending: false }).limit(5);
      if (!data?.length) return bot.sendMessage(chatId, "📭 Aucun paiement.");
      let texte = `💳 *5 Derniers Paiements*\n\n`;
      data.forEach(p => {
        const emoji = p.statut === "payé" ? "✅" : "⏳";
        texte += `${emoji} *${p.transaction_id}*\n`;
        texte += `   💰 ${fmt(p.montant)} | 📱 ${p.operateur || "—"}\n`;
        texte += `   🔗 ${p.reference_facture || "Non lié"} | ${p.structure}\n\n`;
      });
      bot.sendMessage(chatId, texte, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Activité du jour ───
  bot.onText(/\/activite/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Analyse de l'activité...");
    try {
      const reponse = await assistantIA("Qu'est-ce qui s'est passé aujourd'hui dans ETS DZM ? Factures créées, paiements enregistrés, modifications. Sois précis.", [], supabase, genAI);
      bot.sendMessage(chatId, `📅 *Activité du Jour*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Points de vigilance ───
  bot.onText(/\/vigilance/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Vérification en cours...");
    try {
      const reponse = await assistantIA("Analyse les points de vigilance : totaux incohérents, TVA incorrecte, casiers suspects, produits inconnus. Donne aussi 2 conseils de gestion.", [], supabase, genAI);
      bot.sendMessage(chatId, `⚠️ *Points de Vigilance*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Produits moteurs ───
  bot.onText(/\/produits/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "⏳ Analyse des produits...");
    try {
      const reponse = await assistantIA("Quels sont les top 3 produits moteurs ? Donne casiers vendus, CA et part de vente pour chacun.", [], supabase, genAI);
      bot.sendMessage(chatId, `📦 *Produits Moteurs*\n\n${reponse}`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur.");
    }
  });

  // ─── Export par email ───
  bot.onText(/\/export/, async (msg) => {
    bot.sendMessage(msg.chat.id,
      "📤 *Export Excel*\n\nEnvoyez votre email pour recevoir l'export complet :\n\nFormat : /email votre@email.com",
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/\/email (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match[1].trim();
    bot.sendMessage(chatId, `📧 Envoi en cours vers ${email}...`);
    try {
      const axios = require("axios");
      await axios.post(`${process.env.BACKEND_URL}/api/export/email`, { email });
      bot.sendMessage(chatId, `✅ Export envoyé avec succès à *${email}* !\n\nVous recevrez 3 fichiers Excel.`, { parse_mode: "Markdown" });
    } catch (_) {
      bot.sendMessage(chatId, "❌ Erreur lors de l'envoi. Vérifiez la configuration Gmail.");
    }
  });

  // ─── Photo → OCR automatique ───
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const processing = await bot.sendMessage(chatId, "📸 Image reçue — Analyse OCR Gemini en cours...");
    try {
      const photoId = msg.photo[msg.photo.length - 1].file_id;
      const fileInfo = await bot.getFile(photoId);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

      const axios = require("axios");
      const FormData = require("form-data");
      const imageResponse = await axios.get(fileUrl, { responseType: "arraybuffer" });
      const formData = new FormData();
      formData.append("image", Buffer.from(imageResponse.data), { filename: "facture.jpg", contentType: "image/jpeg" });

      const ocrRes = await axios.post(`${process.env.BACKEND_URL}/api/ocr/facture`, formData, { headers: formData.getHeaders() });
      const d = ocrRes.data.data;

      const texte = `✅ *Extraction OCR réussie* (${d.confiance || "?"}% confiance)\n\n` +
        `📄 *N° Facture :* ${d.numero_facture || "Non détecté"}\n` +
        `👤 *Client :* ${d.client || "Non détecté"}\n` +
        `💰 *Total TTC :* ${d.total_ttc ? fmt(d.total_ttc) : "Non détecté"}\n` +
        `📦 *Casiers :* ${d.nombre_casiers || "Non détecté"}\n` +
        `📅 *Date :* ${d.date_facture || "Non détectée"}\n` +
        `🏢 *Structure :* ${d.structure || "Non détectée"}`;

      await bot.deleteMessage(chatId, processing.message_id);
      bot.sendMessage(chatId, texte, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Enregistrer", callback_data: `save_${JSON.stringify({ numero_facture: d.numero_facture, client: d.client, total_ttc: d.total_ttc, structure: d.structure })}` },
            { text: "❌ Ignorer", callback_data: "ignore" }
          ]]
        }
      });
    } catch (err) {
      await bot.deleteMessage(chatId, processing.message_id);
      bot.sendMessage(chatId, "❌ Erreur OCR. Vérifiez que le backend est actif.");
    }
  });

  // ─── Message vocal → Question IA ───
  bot.on("voice", async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🎤 Message vocal reçu — Transcription en cours...");
    bot.sendMessage(chatId, "ℹ️ La transcription vocale sera disponible après configuration de Whisper/Groq sur le serveur.");
  });

  // ─── Message texte libre → Assistant IA ───
  bot.on("message", async (msg) => {
    if (msg.text && !msg.text.startsWith("/") && msg.text.length > 3) {
      const chatId = msg.chat.id;
      const processing = await bot.sendMessage(chatId, "🤖 Analyse en cours...");
      try {
        const reponse = await assistantIA(msg.text, [], supabase, genAI);
        await bot.deleteMessage(chatId, processing.message_id);
        bot.sendMessage(chatId, reponse, { parse_mode: "Markdown" });
      } catch (_) {
        bot.sendMessage(chatId, "❌ Erreur lors de l'analyse.");
      }
    }
  });

  // ─── Callback boutons inline ───
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (query.data === "ignore") {
      bot.answerCallbackQuery(query.id, { text: "Ignoré." });
      return;
    }
    if (query.data.startsWith("save_")) {
      try {
        const data = JSON.parse(query.data.replace("save_", ""));
        await supabase.from("factures").insert([{ ...data, statut: "en attente", source: "telegram" }]);
        bot.answerCallbackQuery(query.id, { text: "✅ Enregistré !" });
        bot.sendMessage(chatId, "✅ Facture enregistrée dans DZM Codex !");
      } catch (_) {
        bot.sendMessage(chatId, "❌ Erreur lors de l'enregistrement.");
      }
    }
  });

  console.log("🤖 Bot Telegram configuré et actif");
};
