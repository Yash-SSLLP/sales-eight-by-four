import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage:multer.memoryStorage(), limits:{ fileSize:10*1024*1024 } });

// Inline schemas
const sampleSchema = new mongoose.Schema({
  name:{ type:String, required:true }, zone:{ type:String, required:true },
  category:{ type:String, default:'' }, active:{ type:Boolean, default:true },
},{ timestamps:true });

const givenSchema = new mongoose.Schema({
  dealerName:{ type:String, required:true }, dealerId:{ type:String, default:'' },
  sampleId:  { type:String, required:true }, sampleName:{ type:String, required:true },
  zone:      { type:String, default:'' },    salesman:  { type:String, default:'' },
  givenBy:   { type:String, default:'' },    givenDate: { type:String, default:'' },
  notes:     { type:String, default:'' },
},{ timestamps:true });

const Sample      = mongoose.models.Sample      || mongoose.model('Sample', sampleSchema);
const SampleGiven = mongoose.models.SampleGiven || mongoose.model('SampleGiven', givenSchema);

// ── Party-sample master ──────────────────────────────────────────────────────
// A flat dump of "which party already holds which samples", uploaded from the
// "Party Name | Screen Name | Total" Excel. partyCode (SSLxxxxx) is the party
// identity; sampleName is the "Screen Name"; qty is the "Total".
const partySampleSchema = new mongoose.Schema({
  partyCode:  { type:String, default:'', index:true },
  partyName:  { type:String, default:'' },   // cleaned name, code stripped
  sampleName: { type:String, required:true },
  qty:        { type:Number, default:1 },
},{ timestamps:true });
partySampleSchema.index({ partyCode:1, sampleName:1 });
const PartySample = mongoose.models.PartySample || mongoose.model('PartySample', partySampleSchema);

const today = () => new Date().toISOString().slice(0,10);

// Normalize a party/dealer name for matching (case + whitespace insensitive).
const normName = (s) => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
// Build a case-insensitive, whitespace-flexible exact-match regex for a name,
// so "A P TRADERS-SSL15183" matches regardless of casing or double spaces.
const exactNameRx = (s) => new RegExp(
  '^' + String(s||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+') + '$',
  'i'
);
// Split "A.V. INTERIOR SOLUTIONS-SSL16566" → { name:'A.V. INTERIOR SOLUTIONS', code:'SSL16566' }.
const splitParty = (raw) => {
  const s = String(raw||'').trim();
  const m = s.match(/(SSL\d+)\s*$/i);
  const code = m ? m[1].toUpperCase() : '';
  const name = (m ? s.slice(0, m.index) : s).replace(/[-–—\s]+$/,'').trim();
  return { name, code };
};

// GET /api/samples — get all samples (optionally filter by zone)
router.get('/', protect, async (req, res) => {
  try {
    const filter = req.query.zone ? { zone:req.query.zone, active:true } : { active:true };
    const samples = await Sample.find(filter).sort({ zone:1, name:1 });
    res.json(samples);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// Staff = admin OR superadmin (both see all sample records)
const isStaff = (req) => req.user?.role === 'admin' || req.user?.role === 'superadmin';

// GET /api/samples/given — get all given records
router.get('/given', protect, async (req, res) => {
  try {
    const filter = {};
    if(!isStaff(req)) filter.salesman = req.user.id;
    if(req.query.dealerName) filter.dealerName = new RegExp(req.query.dealerName, 'i');
    if(req.query.zone) filter.zone = req.query.zone;
    const given = await SampleGiven.find(filter).sort({ createdAt:-1 });
    res.json(given);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/samples/given — mark sample as given
router.post('/given', protect, async (req, res) => {
  try {
    const { dealerName, dealerId, sampleId, sampleName, zone, salesman, givenDate, notes } = req.body;
    if(!dealerName || !sampleId) return res.status(400).json({ error:'dealerName and sampleId required' });
    // Check if already given
    const existing = await SampleGiven.findOne({ dealerName:new RegExp(`^${dealerName}$`,'i'), sampleId });
    if(existing) return res.status(400).json({ error:'Sample already marked as given to this dealer' });
    const record = await SampleGiven.create({
      dealerName, dealerId:dealerId||'', sampleId, sampleName, zone:zone||'',
      salesman:salesman||req.user.id, givenBy:req.user.id,
      givenDate:givenDate||today(), notes:notes||'',
    });
    res.json(record);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// DELETE /api/samples/given/:id — unmark sample
router.delete('/given/:id', protect, async (req, res) => {
  try {
    const rec = await SampleGiven.findById(req.params.id);
    if(!rec) return res.status(404).json({ error:'Not found' });
    if(!isStaff(req) && rec.givenBy !== req.user.id)
      return res.status(403).json({ error:'Not allowed' });
    await SampleGiven.findByIdAndDelete(req.params.id);
    res.json({ ok:true });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/samples/upload — upload sample master (admin only)
router.post('/upload', protect, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({ error:'file required' });
    const wb   = XLSX.read(req.file.buffer, { type:'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:'' });
    if(!rows.length) return res.status(400).json({ error:'No data' });
    const results = { added:0, updated:0, errors:[] };
    for(const row of rows) {
      const keys = Object.keys(row);
      const find = (...t) => { for(const x of t){ const k=keys.find(k=>k.toLowerCase().replace(/[\s_-]/g,'').includes(x.toLowerCase().replace(/[\s_-]/g,''))); if(k&&String(row[k]).trim()) return String(row[k]).trim(); } return ''; };
      const name     = find('sample','name','product');
      const zone     = find('zone','territory','area');
      const category = find('category','type','cat');
      if(!name || !zone) continue;
      try {
        const ex = await Sample.findOne({ name:new RegExp(`^${name}$`,'i'), zone:new RegExp(`^${zone}$`,'i') });
        if(ex) { await Sample.findByIdAndUpdate(ex._id, { category }); results.updated++; }
        else { await Sample.create({ name, zone, category }); results.added++; }
      } catch(e) { results.errors.push(`${name}: ${e.message}`); }
    }
    res.json(results);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/samples — add single sample (admin only)
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { name, zone, category } = req.body;
    if(!name || !zone) return res.status(400).json({ error:'name and zone required' });
    // Check duplicate
    const ex = await Sample.findOne({ name:new RegExp(`^${name}$`,'i'), zone:new RegExp(`^${zone}$`,'i') });
    if(ex) return res.status(400).json({ error:'Sample already exists for this zone' });
    const s = await Sample.create({ name:name.trim(), zone:zone.trim(), category:category||'' });
    res.json(s);
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// ── Party-sample master endpoints ────────────────────────────────────────────

// GET /api/samples/party — samples a given party holds.
// Resolve the party by dealerId (preferred) → its code/name, then look up
// holdings by code first, falling back to a normalized-name match so it still
// works for dealers whose code hasn't been back-filled yet.
router.get('/party', protect, async (req, res) => {
  try {
    let code = String(req.query.code || '').trim().toUpperCase();
    let name = String(req.query.name || '').trim();

    if(req.query.dealerId){
      const Dealer = (await import('../models/Dealer.js')).default;
      const d = await Dealer.findById(req.query.dealerId).lean();
      if(d){ if(!code) code = String(d.code||'').toUpperCase(); if(!name) name = d.name || ''; }
    }

    // Match on the FULL dealer/party name (stored verbatim); the SSLxxxxx code
    // is only a secondary key for dealers that were stamped on upload.
    let rows = [];
    if(name) rows = await PartySample.find({ partyName: exactNameRx(name) }).lean();
    if(!rows.length && code) rows = await PartySample.find({ partyCode: code }).lean();
    rows.sort((a,b)=> String(a.sampleName).localeCompare(String(b.sampleName)));
    res.json({
      code: code || (rows[0]?.partyCode || ''),
      party: rows[0]?.partyName || name || '',
      count: rows.length,
      totalQty: rows.reduce((s,r)=> s + (Number(r.qty)||0), 0),
      samples: rows.map(r=>({ id:String(r._id), sampleName:r.sampleName, qty:Number(r.qty)||0 })),
    });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// POST /api/samples/party-upload — replace the party-sample master (admin only).
// Excel columns: Party Name | Screen Name | Total. Full-snapshot semantics:
// the whole PartySample collection is rebuilt from the file. Also back-fills
// each matched dealer's `code` so future look-ups match strictly by code.
router.post('/party-upload', protect, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if(!req.file) return res.status(400).json({ error:'file required' });
    const wb   = XLSX.read(req.file.buffer, { type:'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval:'' });
    if(!rows.length) return res.status(400).json({ error:'No data' });

    const docs = [];
    const partyMap = new Map();  // normalized full name → { raw, code } (verbatim, for matching)
    let skipped = 0;
    for(const row of rows){
      const keys = Object.keys(row);
      const find = (...t) => { for(const x of t){ const k=keys.find(k=>k.toLowerCase().replace(/[\s_-]/g,'').includes(x.toLowerCase().replace(/[\s_-]/g,''))); if(k&&String(row[k]).trim()) return String(row[k]).trim(); } return ''; };
      const partyRaw  = find('partyname','party','dealer','name');
      const sampleName= find('screenname','screen','sample','product','item');
      const qtyRaw    = find('total','qty','quantity','count');
      if(!partyRaw || !sampleName){ skipped++; continue; }
      const raw = String(partyRaw).trim();          // party name stored & matched verbatim
      const { code } = splitParty(partyRaw);        // code kept only as a secondary key
      const qty = Math.round(parseFloat(String(qtyRaw).replace(/[^\d.-]/g,'')) || 0) || 1;
      docs.push({ partyCode:code, partyName:raw, sampleName, qty });
      partyMap.set(normName(raw), { raw, code });
    }
    if(!docs.length) return res.status(400).json({ error:'No valid rows (need Party Name + Screen Name)' });

    // Full refresh — this file is the complete master snapshot.
    await PartySample.deleteMany({});
    await PartySample.insertMany(docs, { ordered:false });

    // Back-fill dealer codes by matching the FULL party name → dealer(s).
    // The Excel party name is stored verbatim in the app, so we match as-is.
    const Dealer = (await import('../models/Dealer.js')).default;
    let dealersMatched = 0, partiesMatched = 0;
    const unmatched = [];
    for(const { raw, code } of partyMap.values()){
      const r = await Dealer.updateMany({ name: exactNameRx(raw) }, code ? { $set:{ code } } : {});
      if(r.matchedCount > 0){ partiesMatched++; dealersMatched += r.matchedCount; }
      else if(unmatched.length < 50) unmatched.push(raw);
    }

    console.log(`[PARTY-SAMPLES] rows=${rows.length} inserted=${docs.length} skipped=${skipped} parties=${partyMap.size} partiesMatched=${partiesMatched} dealersMatched=${dealersMatched}`);
    res.json({
      rows: rows.length,
      inserted: docs.length,
      skipped,
      parties: partyMap.size,
      partiesMatched,
      dealersMatched,
      unmatchedCount: partyMap.size - partiesMatched,
      unmatchedSample: unmatched.slice(0, 20),
    });
  } catch(e){ console.error('[PARTY-SAMPLES]', e.message); res.status(500).json({ error:e.message }); }
});

// DELETE /api/samples/:id — delete sample master (admin only)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  await Sample.findByIdAndDelete(req.params.id);
  res.json({ ok:true });
});

export default router;