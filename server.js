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
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const bot = process.env.TELEGRAM_BOT_TOKEN ? new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { webHook: false }) : null;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

function getUploadedFile(req) {
  if (req.file) return req.file;
  if (req.files?.image?.[0]) return req.files.image[0];
  if (req.files?.file?.[0]) return req.files.file[0];
  return null;
}

function cleanFile(file) {
  if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
}

function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeFacturePayload(body) {
  const produits = Array.isArray(body.produits) ? body.produits : [];
  return {
    numero_facture: String(body.numero_facture || '').trim(),
    structure: body.structure || 'DZM A',
    client: String(body.client || '').trim(),
    total_ht: Number(body.total_ht || 0),
    tva: Number(body.tva || 0),
    ristourne: Number(body.ristourne || 0),
    total_ttc: Number(body.total_ttc || 0),
    nombre_casiers: Number(body.nombre_casiers || 0),
    casiers_retournes: Number(body.casiers_retournes || 0),
    date_facture: normalizeDate(body.date_facture),
    statut: body.statut || 'en attente',
    source: body.source || 'manuel',
    vendeur: body.vendeur || null,
    produits: produits.map((line) => ({
      produit: String(line.produit || '').trim(),
      quantite: Number(line.quantite || 0),
      prix_unitaire: Number(line.prix_unitaire ?? line.prixUnitaire ?? 0),
      total: Number(line.total || 0),
    })).filter((line) => line.produit),
  };
}

async function hydrateFactures(rows) {
  if (!rows?.length) return [];
  const ids = rows.map((row) => row.id);
  const { data: produits, error } = await supabase.from('produits_facture').select('*').in('facture_id', ids);
  if (error) throw error;
  const map = new Map();
  for (const produit of produits || []) {
    if (!map.has(produit.facture_id)) map.set(produit.facture_id, []);
    map.get(produit.facture_id).push(produit);
  }
  return rows.map((row) => ({ ...row, produits: map.get(row.id) || [] }));
}

async function saveFactureWithLines(payload) {
  const normalized = normalizeFacturePayload(payload);
  if (!normalized.numero_facture || !normalized.client) {
    throw new Error('Numero de facture et client requis');
  }

  const { data: existing } = await supabase.from('factures').select('id').eq('numero_facture', normalized.numero_facture).limit(1).maybeSingle();
  if (existing?.id) {
    throw new Error(`La facture ${normalized.numero_facture} existe deja`);
  }

  const { produits, ...facture } = normalized;
  const { data: inserted, error: factureError } = await supabase.from('factures').insert(facture).select('*').single();
  if (factureError) throw factureError;

  if (produits.length) {
    const rows = produits.map((line) => ({ ...line, facture_id: inserted.id }));
    const { error: lineError } = await supabase.from('produits_facture').insert(rows);
    if (lineError) throw lineError;
  }

  const [hydrated] = await hydrateFactures([inserted]);
  return hydrated;
}

async function buildDashboard() {
  const [{ data: factures }, { data: paiements }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }),
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }),
  ]);
  const facturesList = factures || [];
  const paiementsList = paiements || [];
  const hydratedFactures = await hydrateFactures(facturesList.slice(0, 8));

  const montantFacture = facturesList.reduce((s, f) => s + Number(f.total_ttc || 0), 0);
  const montantRecu = paiementsList.filter((p) => p.statut === 'payé').reduce((s, p) => s + Number(p.montant || 0), 0);
  const totalCasiers = facturesList.reduce((s, f) => s + Number(f.nombre_casiers || 0), 0);
  const totalRetours = facturesList.reduce((s, f) => s + Number(f.casiers_retournes || 0), 0);
  const facturesEnAttente = facturesList.filter((f) => f.statut === 'en attente').length;
  const facturesAnomalie = facturesList.filter((f) => f.statut === 'anomalie').length;

  const monthMap = new Map();
  facturesList.forEach((row) => {
    const key = new Date(row.date_facture || row.created_at || Date.now()).toLocaleDateString('fr-FR', { month: 'short' });
    if (!monthMap.has(key)) monthMap.set(key, { name: key, dzmA: 0, dzmB: 0 });
    const bucket = monthMap.get(key);
    if (row.structure === 'DZM B') bucket.dzmB += Number(row.total_ttc || 0);
    else bucket.dzmA += Number(row.total_ttc || 0);
  });

  const pieRaw = {
    'DZM A': facturesList.filter((f) => f.structure === 'DZM A').reduce((s, f) => s + Number(f.total_ttc || 0), 0),
    'DZM B': facturesList.filter((f) => f.structure === 'DZM B').reduce((s, f) => s + Number(f.total_ttc || 0), 0),
  };

  const { data: productRows } = await supabase.from('produits_facture').select('produit, quantite, prix_unitaire, total, facture_id, factures!inner(structure)');
  const productMap = new Map();
  for (const row of productRows || []) {
    if (!productMap.has(row.produit)) {
      productMap.set(row.produit, { produit: row.produit, quantite: 0, totalPu: 0, puCount: 0, caTotal: 0, factures: new Set(), structures: new Set() });
    }
    const entry = productMap.get(row.produit);
    entry.quantite += Number(row.quantite || 0);
    entry.totalPu += Number(row.prix_unitaire || 0);
    entry.puCount += 1;
    entry.caTotal += Number(row.total || 0);
    entry.factures.add(row.facture_id);
    entry.structures.add(row.factures?.structure || 'DZM A');
  }

  const topProducts = Array.from(productMap.values()).map((entry) => ({
    produit: entry.produit,
    quantite: entry.quantite,
    prixUnitaire: entry.puCount ? Math.round(entry.totalPu / entry.puCount) : 0,
    caTotal: entry.caTotal,
    facturesAssociees: entry.factures.size,
    structure: Array.from(entry.structures).join(' / '),
    tendance: 'stable',
  })).sort((a, b) => b.caTotal - a.caTotal);

  const recentActivity = [
    ...hydratedFactures.slice(0, 4).map((f) => ({ time: f.date_facture, text: `Facture ${f.numero_facture} enregistrée pour ${f.client}`, type: 'facture' })),
    ...paiementsList.slice(0, 4).map((p) => ({ time: p.date_paiement, text: `Paiement ${p.transaction_id} de ${Number(p.montant || 0).toLocaleString('fr-FR')} FCFA`, type: 'paiement' })),
  ].slice(0, 8);

  return {
    totalFactures: facturesList.length,
    totalPaiements: paiementsList.length,
    montantFacture,
    montantRecu,
    resteAPayer: montantFacture - montantRecu,
    totalCasiers,
    totalRetours,
    facturesEnAttente,
    facturesAnomalie,
    chartData: Array.from(monthMap.values()),
    pieData: Object.entries(pieRaw).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value })),
    topProducts: topProducts.slice(0, 8),
    recentInvoices: hydratedFactures,
    recentPayments: paiementsList.slice(0, 8),
    recentActivity,
  };
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

app.get('/health', (_, res) => res.json({ status: 'ok', service: 'DZM Backend v3 - Groq + Supabase', timestamp: new Date().toISOString() }));
app.get('/api/config/status', (_, res) => res.json({ supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY), groq: Boolean(process.env.GROQ_API_KEY), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), gmail: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD), backendUrl: process.env.BACKEND_PUBLIC_URL || null }));

app.post('/api/ocr/facture', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRFacture(uploadedFile.path, null);
    cleanFile(uploadedFile);
    res.json({ success: true, data: result });
  } catch (err) {
    cleanFile(uploadedFile);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ocr/paiement', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRPaiement(uploadedFile.path, null);
    cleanFile(uploadedFile);
    res.json({ success: true, data: result });
  } catch (err) {
    cleanFile(uploadedFile);
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

app.get('/api/factures', async (_, res) => {
  try {
    const { data, error } = await supabase.from('factures').select('*').order('date_facture', { ascending: false });
    if (error) throw error;
    res.json(await hydrateFactures(data || []));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/factures', async (req, res) => {
  try {
    const saved = await saveFactureWithLines({ ...req.body, source: req.body.source || 'manuel' });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/factures/from-ocr', async (req, res) => {
  try {
    const saved = await saveFactureWithLines({ ...req.body, source: req.body.source || 'ocr' });
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/factures/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error: lineError } = await supabase.from('produits_facture').delete().eq('facture_id', id);
    if (lineError) throw lineError;
    const { error } = await supabase.from('factures').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/paiements', async (_, res) => {
  try {
    const { data, error } = await supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paiements', async (req, res) => {
  try {
    const payload = {
      transaction_id: String(req.body.transaction_id || '').trim(),
      montant: Number(req.body.montant || 0),
      structure: req.body.structure || 'DZM A',
      reference_facture: req.body.reference_facture || null,
      beneficiaire: req.body.beneficiaire || null,
      date_paiement: normalizeDate(req.body.date_paiement),
      operateur: req.body.operateur || null,
      statut: req.body.statut || 'en attente',
    };
    const { data, error } = await supabase.from('paiements_mobile').insert(payload).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/produits/summary', async (_, res) => {
  try {
    const dashboard = await buildDashboard();
    res.json(dashboard.topProducts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (_, res) => {
  try {
    const dashboard = await buildDashboard();
    res.json({ totalFactures: dashboard.totalFactures, totalPaiements: dashboard.totalPaiements, montantFacture: dashboard.montantFacture, montantRecu: dashboard.montantRecu, resteAPayer: dashboard.resteAPayer, totalCasiers: dashboard.totalCasiers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard', async (_, res) => {
  try {
    res.json(await buildDashboard());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/export/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const tables = ['factures', 'produits_facture', 'paiements_mobile'];
    if (!tables.includes(table)) return res.status(400).json({ error: 'Table invalide' });
    const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: false });
    if (error) throw error;
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
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return res.status(500).json({ error: 'Gmail non configure' });
    const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([
      supabase.from('factures').select('*'),
      supabase.from('paiements_mobile').select('*'),
      supabase.from('produits_facture').select('*'),
    ]);
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    await transporter.sendMail({
      from: `"DZM Codex" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: `Export DZM - ${new Date().toLocaleDateString('fr-FR')}`,
      html: '<h2>Export DZM</h2><p>Les fichiers factures, paiements et produits sont en pièces jointes.</p>',
      attachments: [
        { filename: 'DZM_Factures.xlsx', content: await generateExcel('factures', factures || []) },
        { filename: 'DZM_Paiements.xlsx', content: await generateExcel('paiements_mobile', paiements || []) },
        { filename: 'DZM_Produits.xlsx', content: await generateExcel('produits_facture', produits || []) },
      ],
    });
    res.json({ success: true, message: `Export envoye a ${email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telegram/rapport', async (_, res) => {
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
  console.log(`✅ DZM Backend v3 - http://localhost:${PORT}`);
});
