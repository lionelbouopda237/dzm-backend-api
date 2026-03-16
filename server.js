require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const nodemailer = require("nodemailer");
const TelegramBot = require("node-telegram-bot-api");
const { generateExcel } = require("./services/export");
const { analyseOCRFacture, analyseOCRPaiement } = require("./services/ocr");
const { assistantIA } = require("./services/assistant");
const { envoyerAlerteQuotidienne } = require("./services/alerts");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

// ─── Initialisation ───
const app = express();
const upload = multer({ dest: "/tmp/uploads/", limits: { fileSize: 10 * 1024 * 1024 } });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { webHook: true });

// ─── Middleware ───
app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json({ limit: "10mb" }));
// Webhook Telegram
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Envoyer rapport manuel
app.post("/api/telegram/rapport", async (req, res) => {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    await envoyerAlerteQuotidienne(bot, supabase, genAI);
    res.json({ success: true, message: "Rapport envoyé" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health check ───
app.get("/health", (_, res) => res.json({
  status: "ok",
  service: "DZM Backend",
  timestamp: new Date().toISOString()
}));

// ─── OCR Facture ───
app.post("/api/ocr/facture", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune image reçue" });
    const result = await analyseOCRFacture(req.file.path, genAI);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("OCR Facture erreur:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── OCR Paiement Mobile Money ───
app.post("/api/ocr/paiement", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucune image reçue" });
    const result = await analyseOCRPaiement(req.file.path, genAI);
    fs.unlinkSync(req.file.path);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("OCR Paiement erreur:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Assistant IA ───
app.post("/api/assistant", async (req, res) => {
  try {
    const { question, historique } = req.body;
    if (!question) return res.status(400).json({ error: "Question manquante" });
    const reponse = await assistantIA(question, historique || [], supabase, genAI);
    res.json({ success: true, reponse });
  } catch (err) {
    console.error("Assistant IA erreur:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Stats dashboard ───
app.get("/api/stats", async (req, res) => {
  try {
    const [
      { count: totalFactures },
      { count: totalPaiements },
      { data: montantsFactures },
      { data: montantsPaiements },
      { data: casiers }
    ] = await Promise.all([
      supabase.from("factures").select("*", { count: "exact", head: true }),
      supabase.from("paiements_mobile").select("*", { count: "exact", head: true }),
      supabase.from("factures").select("total_ttc"),
      supabase.from("paiements_mobile").select("montant").eq("statut", "payé"),
      supabase.from("factures").select("nombre_casiers")
    ]);

    const montantFacture = (montantsFactures || []).reduce((s, f) => s + (f.total_ttc || 0), 0);
    const montantRecu = (montantsPaiements || []).reduce((s, p) => s + (p.montant || 0), 0);
    const totalCasiers = (casiers || []).reduce((s, f) => s + (f.nombre_casiers || 0), 0);

    res.json({
      totalFactures,
      totalPaiements,
      montantFacture,
      montantRecu,
      resteAPayer: montantFacture - montantRecu,
      totalCasiers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export Excel ───
app.get("/api/export/:table", async (req, res) => {
  try {
    const { table } = req.params;
    const tables = ["factures", "produits_facture", "paiements_mobile"];
    if (!tables.includes(table)) return res.status(400).json({ error: "Table invalide" });

    const { data } = await supabase.from(table).select("*").order("created_at", { ascending: false });
    const buffer = await generateExcel(table, data || []);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=DZM_${table}_${new Date().toISOString().split("T")[0]}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Export complet par email ───
app.post("/api/export/email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email manquant" });

    const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
      supabase.from("factures").select("*"),
      supabase.from("paiements_mobile").select("*"),
      supabase.from("produits_facture").select("*")
    ]);

    const bufFactures  = await generateExcel("factures", factures || []);
    const bufPaiements = await generateExcel("paiements_mobile", paiements || []);
    const bufProduits  = await generateExcel("produits_facture", produits || []);

    const transporter = nodemailer.createTransporter({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
      }
    });

    await transporter.sendMail({
      from: `"DZM Codex" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `📊 Export DZM Codex — ${new Date().toLocaleDateString("fr-FR")}`,
      html: `
        <h2>📊 Export DZM Codex</h2>
        <p>Bonjour,</p>
        <p>Veuillez trouver en pièces jointes l'export complet de la base de données DZM.</p>
        <ul>
          <li>✅ Factures (${factures?.length || 0} entrées)</li>
          <li>✅ Paiements Mobile Money (${paiements?.length || 0} entrées)</li>
          <li>✅ Produits facturés (${produits?.length || 0} entrées)</li>
        </ul>
        <p>Cordialement,<br><strong>Assistant IA DZM</strong></p>
      `,
      attachments: [
        { filename: "DZM_Factures.xlsx",  content: bufFactures },
        { filename: "DZM_Paiements.xlsx", content: bufPaiements },
        { filename: "DZM_Produits.xlsx",  content: bufProduits }
      ]
    });

    res.json({ success: true, message: `Export envoyé à ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bot Telegram ───
require("./services/telegram")(bot, supabase, genAI);

// ─── Alerte quotidienne (tous les jours à 8h) ───
cron.schedule("0 8 * * *", async () => {
  console.log("⏰ Envoi alerte quotidienne...");
  await envoyerAlerteQuotidienne(bot, supabase, genAI);
}, { timezone: "Africa/Douala" });

// ─── Démarrage ───
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n✅ DZM Backend démarré sur http://localhost:${PORT}`);
  console.log(`📊 Supabase : ${process.env.SUPABASE_URL ? "✅ Configuré" : "❌ Manquant"}`);
  console.log(`🤖 Gemini   : ${process.env.GEMINI_API_KEY ? "✅ Configuré" : "❌ Manquant"}`);
  console.log(`📱 Telegram : ${process.env.TELEGRAM_BOT_TOKEN ? "✅ Configuré" : "❌ Manquant"}`);
  console.log(`📧 Gmail    : ${process.env.GMAIL_USER ? "✅ Configuré" : "❌ Manquant"}\n`);
});
