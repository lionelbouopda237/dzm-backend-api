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
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const upload = multer({ dest: '/tmp/uploads/', limits: { fileSize: 12 * 1024 * 1024 } });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const bot = TELEGRAM_TOKEN ? new TelegramBot(TELEGRAM_TOKEN, { polling: { autoStart: true, interval: 1000, params: { timeout: 10 } } }) : null;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

function getUploadedFile(req) {
  if (req.file) return req.file;
  if (req.files?.image?.[0]) return req.files.image[0];
  if (req.files?.file?.[0]) return req.files.file[0];
  return null;
}
function cleanFile(file) { if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); }
function normalizeDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}
function detectStructure(input) {
  const v = String(input || '').toUpperCase();
  if (v.includes('DZM B')) return 'DZM B';
  return 'DZM A';
}

function isPackagingProduct(name) {
  const v = String(name || '').toLowerCase();
  return ['emballage', 'casier', 'casiers', 'colis'].some((k) => v.includes(k));
}
async function buildEmballagesSummary() {
  const [{ data: factures }, { data: mouvements }, { data: lignes }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }),
    supabase.from('emballages_mouvements').select('*').order('date_mouvement', { ascending: false }),
    supabase.from('produits_facture').select('facture_id, produit, quantite'),
  ]);
  const byFacture = new Map();
  for (const row of lignes || []) {
    const key = row.facture_id;
    if (!byFacture.has(key)) byFacture.set(key, []);
    byFacture.get(key).push(row);
  }
  const base = new Map();
  for (const structure of ['DZM A', 'DZM B']) {
    base.set(structure, { structure, emballagesRecus: 0, emballagesRenvoyes: 0, solde: 0, colis: 0 });
  }
  for (const row of (factures || [])) {
    const target = base.get(detectStructure(row.structure));
    target.emballagesRecus += Number(row.nombre_casiers || 0);
    const rows = byFacture.get(row.id) || [];
    target.colis += rows.filter((item) => String(item.produit || '').toLowerCase().includes('colis')).reduce((s, item) => s + Number(item.quantite || 0), 0);
  }
  for (const row of (mouvements || [])) {
    const target = base.get(detectStructure(row.structure));
    target.emballagesRenvoyes += Number(row.emballages_vides || 0);
  }
  const summary = Array.from(base.values()).map((item) => ({ ...item, solde: item.emballagesRecus - item.emballagesRenvoyes }));
  const synthese = summary.reduce((acc, row) => {
    acc.emballagesRecus += row.emballagesRecus;
    acc.emballagesRenvoyes += row.emballagesRenvoyes;
    acc.solde += row.solde;
    acc.colis += row.colis;
    return acc;
  }, { emballagesRecus: 0, emballagesRenvoyes: 0, solde: 0, colis: 0 });
  return { summary, mouvements: mouvements || [], synthese };
}
function buildInvoiceWarnings(payload) {
  const warnings = [];
  const sumLines = (payload.produits || []).reduce((s, l) => s + Number(l.total || 0), 0);
  if (payload.total_ht && Math.abs(Number(payload.total_ht) - sumLines) > 5) warnings.push('Le total HT ne correspond pas exactement à la somme des lignes.');
  if (payload.total_ttc && payload.total_ht && payload.tva && Math.abs(Number(payload.total_ttc) - (Number(payload.total_ht) + Number(payload.tva) - Number(payload.ristourne || 0))) > 5) warnings.push('Le total TTC paraît incohérent avec HT, TVA et ristourne.');
  if (!payload.client) warnings.push('Le client/structure commanditaire est vide.');
  return warnings;
}
function buildPaymentWarnings(payload) {
  const warnings = [];
  if (!payload.transaction_id) warnings.push('Transaction ID manquant.');
  if (!payload.reference_facture) warnings.push('Paiement non rapproché à une facture.');
  if (!payload.montant || Number(payload.montant) <= 0) warnings.push('Montant paiement invalide.');
  return warnings;
}
async function uploadToCloudinary(filePath, folder) {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return null;
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  if (process.env.CLOUDINARY_UPLOAD_PRESET) form.append('upload_preset', process.env.CLOUDINARY_UPLOAD_PRESET);
  form.append('folder', folder);
  const timestamp = Math.round(Date.now() / 1000);
  const crypto = require('crypto');
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_UPLOAD_PRESET ? `&upload_preset=${process.env.CLOUDINARY_UPLOAD_PRESET}` : ''}${process.env.CLOUDINARY_TRANSFORMATION ? `&transformation=${process.env.CLOUDINARY_TRANSFORMATION}` : ''}${process.env.CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash('sha1').update(paramsToSign).digest('hex');
  form.append('api_key', process.env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('signature', signature);
  if (process.env.CLOUDINARY_TRANSFORMATION) form.append('transformation', process.env.CLOUDINARY_TRANSFORMATION);
  const url = `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`;
  const response = await axios.post(url, form, { headers: form.getHeaders(), maxBodyLength: Infinity });
  return { url: response.data.secure_url, public_id: response.data.public_id };
}

function normalizeFacturePayload(body) {
  const produits = Array.isArray(body.produits) ? body.produits : [];
  return {
    numero_facture: String(body.numero_facture || '').trim(),
    structure: detectStructure(body.structure),
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
    image_url: body.image_url || null,
    image_public_id: body.image_public_id || null,
    produits: produits.map((line) => ({
      produit: String(line.produit || '').trim(),
      quantite: Number(line.quantite || 0),
      prix_unitaire: Number(line.prix_unitaire ?? line.prixUnitaire ?? 0),
      total: Number(line.total || 0),
    })).filter((line) => line.produit),
  };
}
function normalizePaiementPayload(body) {
  return {
    transaction_id: String(body.transaction_id || '').trim(),
    montant: Number(body.montant || 0),
    structure: detectStructure(body.structure),
    reference_facture: body.reference_facture || null,
    beneficiaire: body.beneficiaire || null,
    date_paiement: normalizeDate(body.date_paiement),
    operateur: body.operateur || null,
    statut: body.statut || 'en attente',
    image_url: body.image_url || null,
    image_public_id: body.image_public_id || null,
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
  if (!normalized.numero_facture || !normalized.client) throw new Error('Numero de facture et client requis');
  const overwrite = Boolean(payload.overwrite);
  const { data: existing } = await supabase.from('factures').select('id').eq('numero_facture', normalized.numero_facture).limit(1).maybeSingle();
  if (existing?.id && !overwrite) throw new Error(`DOUBLON_FACTURE:${normalized.numero_facture}`);
  const { produits, ...facture } = normalized;
  let inserted;
  if (existing?.id && overwrite) {
    const { data, error } = await supabase.from('factures').update(facture).eq('id', existing.id).select('*').single();
    if (error) throw error;
    inserted = data;
    await supabase.from('produits_facture').delete().eq('facture_id', existing.id);
  } else {
    const { data, error } = await supabase.from('factures').insert(facture).select('*').single();
    if (error) throw error;
    inserted = data;
  }
  if (produits.length) {
    const rows = produits.map((line) => ({ ...line, facture_id: inserted.id }));
    const { error: lineError } = await supabase.from('produits_facture').insert(rows);
    if (lineError) throw lineError;
  }
  const [hydrated] = await hydrateFactures([inserted]);
  return { ...hydrated, warnings: buildInvoiceWarnings(normalized) };
}
async function savePaiement(payload) {
  const normalized = normalizePaiementPayload(payload);
  if (!normalized.transaction_id) throw new Error('Transaction ID requis');
  const overwrite = Boolean(payload.overwrite);
  const { data: existing } = await supabase.from('paiements_mobile').select('id').eq('transaction_id', normalized.transaction_id).limit(1).maybeSingle();
  if (existing?.id && !overwrite) throw new Error(`DOUBLON_PAIEMENT:${normalized.transaction_id}`);
  let data;
  if (existing?.id && overwrite) {
    ({ data } = await supabase.from('paiements_mobile').update(normalized).eq('id', existing.id).select('*').single());
  } else {
    ({ data } = await supabase.from('paiements_mobile').insert(normalized).select('*').single());
  }
  return { ...data, warnings: buildPaymentWarnings(normalized) };
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
    if (row.structure === 'DZM B') bucket.dzmB += Number(row.total_ttc || 0); else bucket.dzmA += Number(row.total_ttc || 0);
  });
  const pieRaw = { 'DZM A': facturesList.filter((f) => f.structure === 'DZM A').reduce((s, f) => s + Number(f.total_ttc || 0), 0), 'DZM B': facturesList.filter((f) => f.structure === 'DZM B').reduce((s, f) => s + Number(f.total_ttc || 0), 0) };
  const { data: productRows } = await supabase.from('produits_facture').select('produit, quantite, prix_unitaire, total, facture_id, factures!inner(structure)');
  const productMap = new Map();
  for (const row of (productRows || []).filter((row) => !isPackagingProduct(row.produit))) {
    if (!productMap.has(row.produit)) productMap.set(row.produit, { produit: row.produit, quantite: 0, totalPu: 0, puCount: 0, caTotal: 0, factures: new Set(), structures: new Set() });
    const entry = productMap.get(row.produit);
    entry.quantite += Number(row.quantite || 0); entry.totalPu += Number(row.prix_unitaire || 0); entry.puCount += 1; entry.caTotal += Number(row.total || 0); entry.factures.add(row.facture_id); entry.structures.add(row.factures?.structure || 'DZM A');
  }
  const topProducts = Array.from(productMap.values()).map((entry) => ({ produit: entry.produit, quantite: entry.quantite, prixUnitaire: entry.puCount ? Math.round(entry.totalPu / entry.puCount) : 0, caTotal: entry.caTotal, facturesAssociees: entry.factures.size, structure: Array.from(entry.structures).join(' / '), tendance: 'stable' })).sort((a, b) => b.caTotal - a.caTotal);
  const recentActivity = [...hydratedFactures.slice(0, 4).map((f) => ({ time: f.date_facture, text: `Facture ${f.numero_facture} enregistrée pour ${f.client}`, type: 'facture' })), ...paiementsList.slice(0, 4).map((p) => ({ time: p.date_paiement, text: `Paiement ${p.transaction_id} de ${Number(p.montant || 0).toLocaleString('fr-FR')} FCFA`, type: 'paiement' }))].slice(0, 8);
  return { totalFactures: facturesList.length, totalPaiements: paiementsList.length, montantFacture, montantRecu, resteAPayer: montantFacture - montantRecu, totalCasiers, totalRetours, facturesEnAttente, facturesAnomalie, chartData: Array.from(monthMap.values()), pieData: Object.entries(pieRaw).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value })), topProducts: topProducts.slice(0, 8), recentInvoices: hydratedFactures, recentPayments: paiementsList.slice(0, 8), recentActivity };
}

async function buildRapprochements() {
  const [{ data: paiements }, { data: factures }, { data: links }] = await Promise.all([
    supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }),
    supabase.from('factures').select('*').order('date_facture', { ascending: false }),
    supabase.from('rapprochements_factures_paiements').select('*').order('created_at', { ascending: false })
  ]);
  const facturesById = new Map((factures || []).map(f => [f.id, f]));
  const existingByPayment = new Map((links || []).map(l => [l.paiement_id, l]));
  return (paiements || []).map((p) => {
    const linked = existingByPayment.get(p.id);
    const linkedFacture = linked?.facture_id ? facturesById.get(linked.facture_id) : null;
    if (linkedFacture) {
      return { paiement_id: p.id, transaction_id: p.transaction_id, structure: detectStructure(p.structure), montant_paiement: Number(p.montant || 0), date_paiement: p.date_paiement, facture_id: linkedFacture.id, numero_facture: linkedFacture.numero_facture, montant_facture: Number(linkedFacture.total_ttc || 0), score: Number(linked.score || 100), statut: 'rapproché', suggestion: 'Rapprochement validé' };
    }
    const candidates = (factures || []).filter((f) => detectStructure(f.structure) === detectStructure(p.structure));
    const scored = candidates.map((f) => {
      let score = 25;
      const amountGap = Math.abs(Number(f.total_ttc || 0) - Number(p.montant || 0));
      if (amountGap === 0) score += 45;
      else if (amountGap <= 500) score += 30;
      else if (amountGap <= 5000) score += 15;
      const d1 = new Date(f.date_facture); const d2 = new Date(p.date_paiement);
      const dayGap = Math.abs((d2 - d1) / (1000*60*60*24));
      if (dayGap <= 2) score += 20; else if (dayGap <= 7) score += 10;
      if ((p.reference_facture || '').includes(f.numero_facture)) score += 20;
      return { f, score: Math.min(99, Math.round(score)) };
    }).sort((a,b)=>b.score-a.score);
    const best = scored[0];
    return { paiement_id: p.id, transaction_id: p.transaction_id, structure: detectStructure(p.structure), montant_paiement: Number(p.montant || 0), date_paiement: p.date_paiement, facture_id: best?.score >= 45 ? best.f.id : null, numero_facture: best?.score >= 45 ? best.f.numero_facture : null, montant_facture: best?.score >= 45 ? Number(best.f.total_ttc || 0) : null, score: best?.score || 0, statut: best?.score >= 45 ? 'à valider' : 'non rapproché', suggestion: best?.score >= 45 ? 'Correspondance probable détectée' : 'Aucun rapprochement fiable' };
  });
}

async function buildRistournes() {
  const [{ data: factures }, { data: ristournes }] = await Promise.all([
    supabase.from('factures').select('*').order('date_facture', { ascending: false }),
    supabase.from('ristournes_paiements').select('*').order('date_paiement', { ascending: false })
  ]);
  const byRef = new Map((ristournes || []).map(r => [r.reference_facture || '', r]));
  return (factures || []).filter(f => Number(f.ristourne || 0) > 0).map((f) => {
    const row = byRef.get(f.numero_facture) || null;
    return {
      id: row?.id || `facture-${f.id}`,
      structure: detectStructure(f.structure),
      reference_facture: f.numero_facture,
      montant_theorique: Number(f.ristourne || 0),
      montant_recu: Number(row?.montant_recu || 0),
      date_paiement: row?.date_paiement || null,
      mode_paiement: row?.mode_paiement || null,
      commentaire: row?.commentaire || null,
      statut: row ? (Number(row.montant_recu || 0) >= Number(f.ristourne || 0) ? 'payée' : 'partielle') : 'à recevoir'
    };
  });
}

app.get('/', (_, res) => res.json({ service: 'DZM Backend API', status: 'ok', health: '/health' }));
app.get('/health', (_, res) => res.json({ status: 'ok', service: 'DZM Backend Final - Groq + Supabase + Cloudinary', timestamp: new Date().toISOString() }));
app.get('/api/config/status', (_, res) => res.json({ supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY), groq: Boolean(process.env.GROQ_API_KEY), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID), gmail: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD), cloudinary: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET), backendUrl: process.env.BACKEND_PUBLIC_URL || null }));
app.post('/api/files/upload', upload.single('image'), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const type = req.body.type === 'paiement' ? 'paiements' : 'factures';
    const cloud = await uploadToCloudinary(uploadedFile.path, `dzm/${type}`);
    cleanFile(uploadedFile);
    if (!cloud) return res.status(500).json({ error: 'Cloudinary non configuré' });
    res.json(cloud);
  } catch (err) {
    cleanFile(uploadedFile);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/ocr/facture', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRFacture(uploadedFile.path, null);
    cleanFile(uploadedFile);
    res.json({ success: true, data: { ...result, warnings: buildInvoiceWarnings(normalizeFacturePayload(result)) } });
  } catch (err) { cleanFile(uploadedFile); res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/ocr/paiement', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
  const uploadedFile = getUploadedFile(req);
  try {
    if (!uploadedFile) return res.status(400).json({ error: 'Aucune image recue' });
    const result = await analyseOCRPaiement(uploadedFile.path, null);
    cleanFile(uploadedFile);
    res.json({ success: true, data: { ...result, warnings: buildPaymentWarnings(normalizePaiementPayload(result)) } });
  } catch (err) { cleanFile(uploadedFile); res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/assistant', async (req, res) => {
  try {
    const question = req.body.question || req.body.message;
    const historique = Array.isArray(req.body.historique) ? req.body.historique : [];
    if (!question) return res.status(400).json({ error: 'Question manquante' });
    const reponse = await assistantIA(question, historique, supabase, null);
    res.json({ success: true, reponse, response: reponse });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/factures', async (_, res) => { try { const { data, error } = await supabase.from('factures').select('*').order('date_facture', { ascending: false }); if (error) throw error; res.json(await hydrateFactures(data || [])); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/factures', async (req, res) => { try { res.json(await saveFactureWithLines({ ...req.body, source: req.body.source || 'manuel' })); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/factures/from-ocr', async (req, res) => { try { res.json(await saveFactureWithLines({ ...req.body, source: req.body.source || 'ocr' })); } catch (err) { res.status(500).json({ error: err.message }); } });
app.delete('/api/factures/:id', async (req, res) => { try { const { id } = req.params; await supabase.from('produits_facture').delete().eq('facture_id', id); const { error } = await supabase.from('factures').delete().eq('id', id); if (error) throw error; res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/paiements', async (_, res) => { try { const { data, error } = await supabase.from('paiements_mobile').select('*').order('date_paiement', { ascending: false }); if (error) throw error; res.json(data || []); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/paiements', async (req, res) => { try { res.json(await savePaiement(req.body)); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/paiements/from-ocr', async (req, res) => { try { res.json(await savePaiement({ ...req.body, source: 'ocr' })); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/produits/summary', async (_, res) => { try { const dashboard = await buildDashboard(); res.json(dashboard.topProducts); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/emballages', async (_, res) => { try { res.json(await buildEmballagesSummary()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/emballages/manual', async (req, res) => { try { const payload = { structure: detectStructure(req.body.structure), reference_facture: req.body.reference_facture || null, emballages_pleins: 0, emballages_vides: Number(req.body.emballages_vides || 0), colis: 0, date_mouvement: normalizeDate(req.body.date_mouvement), source: req.body.source || 'manuel', note: req.body.note || null }; const { data, error } = await supabase.from('emballages_mouvements').insert(payload).select('*').single(); if (error) throw error; res.json(data); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/stats', async (_, res) => { try { const dashboard = await buildDashboard(); res.json({ totalFactures: dashboard.totalFactures, totalPaiements: dashboard.totalPaiements, montantFacture: dashboard.montantFacture, montantRecu: dashboard.montantRecu, resteAPayer: dashboard.resteAPayer, totalCasiers: dashboard.totalCasiers }); } catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/dashboard', async (_, res) => { try { res.json(await buildDashboard()); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get('/api/rapprochements', async (_, res) => { try { res.json(await buildRapprochements()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/rapprochements', async (req, res) => { try {
  const payload = { paiement_id: req.body.paiement_id, facture_id: req.body.facture_id, montant_impute: Number(req.body.montant_impute || 0), score: Number(req.body.score || 100), source: req.body.source || 'manuel' };
  const { data: existing } = await supabase.from('rapprochements_factures_paiements').select('id').eq('paiement_id', payload.paiement_id).maybeSingle();
  let data;
  if (existing?.id) {
    const resp = await supabase.from('rapprochements_factures_paiements').update(payload).eq('id', existing.id).select('*').single(); if (resp.error) throw resp.error; data = resp.data;
  } else {
    const resp = await supabase.from('rapprochements_factures_paiements').insert(payload).select('*').single(); if (resp.error) throw resp.error; data = resp.data;
  }
  res.json(data);
} catch (err) { res.status(500).json({ error: err.message }); } });
app.get('/api/ristournes', async (_, res) => { try { res.json(await buildRistournes()); } catch (err) { res.status(500).json({ error: err.message }); } });
app.post('/api/ristournes/manual', async (req, res) => { try {
  const password = req.body.password || '';
  if (password !== 'DZM2026') return res.status(403).json({ error: 'Mot de passe invalide' });
  const payload = { structure: detectStructure(req.body.structure), reference_facture: req.body.reference_facture || null, montant_theorique: Number(req.body.montant_theorique || 0), montant_recu: Number(req.body.montant_recu || 0), date_paiement: normalizeDate(req.body.date_paiement), mode_paiement: req.body.mode_paiement || null, commentaire: req.body.commentaire || null };
  const { data: existing } = await supabase.from('ristournes_paiements').select('id').eq('reference_facture', payload.reference_facture).maybeSingle();
  let data;
  if (existing?.id) {
    const resp = await supabase.from('ristournes_paiements').update(payload).eq('id', existing.id).select('*').single(); if (resp.error) throw resp.error; data = resp.data;
  } else {
    const resp = await supabase.from('ristournes_paiements').insert(payload).select('*').single(); if (resp.error) throw resp.error; data = resp.data;
  }
  res.json(data);
} catch (err) { res.status(500).json({ error: err.message }); } });

app.get('/api/export/:table', async (req, res) => {
  try { const { table } = req.params; const tables = ['factures', 'produits_facture', 'paiements_mobile']; if (!tables.includes(table)) return res.status(400).json({ error: 'Table invalide' }); const { data, error } = await supabase.from(table).select('*'); if (error) throw error; const buffer = await generateExcel(table, data || []); res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename=DZM_${table}_${new Date().toISOString().split('T')[0]}.xlsx`); res.send(buffer); } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/export/email', async (req, res) => {
  try {
    const { email } = req.body; if (!email) return res.status(400).json({ error: 'Email manquant' });
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return res.status(500).json({ error: 'Gmail non configure' });
    const [{ data: factures }, { data: paiements }, { data: produits }] = await Promise.all([supabase.from('factures').select('*'), supabase.from('paiements_mobile').select('*'), supabase.from('produits_facture').select('*')]);
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    await transporter.sendMail({ from: `"DZM Financial Cockpit" <${process.env.GMAIL_USER}>`, to: email, subject: `Export DZM - ${new Date().toLocaleDateString('fr-FR')}`, html: '<h2>Export DZM</h2><p>Les fichiers factures, paiements et produits sont en pièces jointes.</p>', attachments: [{ filename: 'DZM_Factures.xlsx', content: await generateExcel('factures', factures || []) }, { filename: 'DZM_Paiements.xlsx', content: await generateExcel('paiements_mobile', paiements || []) }, { filename: 'DZM_Produits.xlsx', content: await generateExcel('produits_facture', produits || []) }] });
    res.json({ success: true, message: `Export envoye a ${email}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/telegram/rapport', async (_, res) => { try { if (!bot) return res.status(500).json({ error: 'Telegram non configure' }); await envoyerAlerteQuotidienne(bot, supabase, null); res.json({ success: true, message: 'Rapport envoye' }); } catch (err) { res.status(500).json({ error: err.message }); } });
if (bot) {
  bot.deleteWebHook().catch(() => {});
  bot.on('polling_error', (error) => console.error('Telegram polling error:', error?.message || error));
  require('./services/telegram')(bot, supabase, null);
  cron.schedule('0 8 * * *', async () => { await envoyerAlerteQuotidienne(bot, supabase, null); }, { timezone: 'Africa/Douala' });
}
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ DZM Backend Final - http://localhost:${PORT}`));
