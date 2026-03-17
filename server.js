require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const TelegramBot = require('node-telegram-bot-api');
const { generateExcel } = require('./services/export');
const { analyseOCRFacture, analyseOCRPaiement } = require('./services/ocr');
const { assistantIA } = require('./services/assistant');
const { envoyerAlerteQuotidienne } = require('./services/alerts');
const cron = require('node-cron');
const fs = require('fs');

const app = express();
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { webHook: false })
  : null;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

function getUploadedFile(req) {
  if (req.file) return req.file;
  if (req.files?.image?.[0]) return req.files.image[0];
  if (req.files?.file?.[0]) return req.files.file[0];
  return null;
}

app.post('/webhook', (req, res) => {
  try {
    if (bot) bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

app.get('/health', (_, res) => res.json({
  status: 'ok',
  service: 'DZM Backend v2 - Groq',
  timestamp: new Date().toISOString(),
}));

app.get('/api/config/status', (_, res) => {
  res.json({
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    gmail: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    backendUrl: process.env.BACKEND_PUBLIC_URL || null,
  });
});

app.post('/api/ocr/facture', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRFacture(uploadedFile.path, null);
    if (fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
    res.json({ success: true, data: result });
  } catch (err) {
    if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
    console.error('OCR Facture erreur:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ocr/paiement', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRPaiement(uploadedFile.path, null);
    if (fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
    res.json({ success: true, data: result });
  } catch (err) {
    if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
    console.error('OCR Paiement erreur:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/assistant', async (req, res) => {
  try {
    const question = req.body.question || req.body.message;
    const historique = Array.isArray(req.body.historique) ? req.body.historique : [];
    if (!question) return res.status(400).json({ error: 'Question manquante' });
    const reponse = await assistantIA(question, historique, supabase, null);
    res.json({ success: true, reponse, response: reponse });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [
      { count: totalFactures },
      { count: totalPaiements },
      { data: montantsFactures },
      { data: montantsPaiements },
      { data: casiers },
    ] = await Promise.all([
      supabase.from('factures').select('*', { count: 'exact', head: true }),
      supabase.from('paiements_mobile').select('*', { count: 'exact', head: true }),
      supabase.from('factures').select('total_ttc'),
      supabase.from('paiements_mobile').select('montant').eq('statut', 'payé'),
      supabase.from('factures').select('nombre_casiers'),
    ]);
    const montantFacture = (montantsFactures || []).reduce((s, f) => s + (f.total_ttc || 0), 0);
    const montantRecu = (montantsPaiements || []).reduce((s, p) => s + (p.montant || 0), 0);
    const totalCasiers = (casiers || []).reduce((s, f) => s + (f.nombre_casiers || 0), 0);
    res.json({ totalFactures, totalPaiements, montantFacture, montantRecu, resteAPayer: montantFacture - montantRecu, totalCasiers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const tables = ['factures', 'produits_facture', 'paiements_mobile'];
    if (!tables.includes(table)) return res.status(400).json({ error: 'Table invalide' });
    const { data } = await supabase.from(table).select('*').order('created_at', { ascending: false });
    const buffer = await generateExcel(table, data || []);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=DZM_${table}_${new Date().toISOString().split('T')[0]}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export/email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email manquant' });
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      return res.status(500).json({ error: 'Gmail non configure' });
    }
    const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
      supabase.from('factures').select('*'),
      supabase.from('paiements_mobile').select('*'),
      supabase.from('produits_facture').select('*'),
    ]);
    const bufFactures = await generateExcel('factures', factures || []);
    const bufPaiements = await generateExcel('paiements_mobile', paiements || []);
    const bufProduits = await generateExcel('produits_facture', produits || []);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: `"DZM Codex" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Export DZM Codex - ${new Date().toLocaleDateString('fr-FR')}`,
      html: '<h2>Export DZM Codex</h2><p>3 fichiers Excel en pièces jointes.</p>',
      attachments: [
        { filename: 'DZM_Factures.xlsx', content: bufFactures },
        { filename: 'DZM_Paiements.xlsx', content: bufPaiements },
        { filename: 'DZM_Produits.xlsx', content: bufProduits },
      ],
    });
    res.json({ success: true, message: `Export envoye a ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telegram/rapport', async (req, res) => {
  try {
    if (!bot) return res.status(500).json({ error: 'Telegram non configure' });
    await envoyerAlerteQuotidienne(bot, supabase, null);
    res.json({ success: true, message: 'Rapport envoye' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (bot) {
  require('./services/telegram')(bot, supabase, null);

  cron.schedule('0 8 * * *', async () => {
    await envoyerAlerteQuotidienne(bot, supabase, null);
  }, { timezone: 'Africa/Douala' });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ DZM Backend v2 Groq - http://localhost:${PORT}`);
  console.log(`📊 Supabase  : ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`🤖 Groq      : ${process.env.GROQ_API_KEY ? '✅' : '❌'}`);
  console.log(`📱 Telegram  : ${process.env.TELEGRAM_BOT_TOKEN ? '✅' : '❌'}`);
  console.log(`📧 Gmail     : ${process.env.GMAIL_USER ? '✅' : '❌'}`);
});
