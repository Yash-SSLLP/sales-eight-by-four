import express from 'express';
import Category from '../models/Category.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

/* ---------- list / read (everyone logged-in) ---------- */
router.get('/', protect, async (req, res) => {
  const list = await Category.find({}).sort({ name: 1 }).lean();
  res.json(list);
});

/* ---------- create top-level Category (admin) ---------- */
router.post('/', protect, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const exists = await Category.findOne({ name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (exists) return res.status(409).json({ error: 'Category already exists' });
  const cat = await Category.create({
    name,
    createdBy: req.user?.name || req.user?.email || '',
    subCategories: Array.isArray(req.body?.subCategories)
      ? req.body.subCategories.filter(Boolean).map(n => ({ name: String(n).trim() }))
      : [],
  });
  res.json(cat);
});

/* ---------- rename Category ---------- */
router.put('/:id', protect, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const cat = await Category.findByIdAndUpdate(req.params.id, { name }, { new: true });
  if (!cat) return res.status(404).json({ error: 'not found' });
  res.json(cat);
});

/* ---------- delete Category ---------- */
router.delete('/:id', protect, adminOnly, async (req, res) => {
  await Category.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

/* ---------- add sub-category to a Category ---------- */
router.post('/:id/sub', protect, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const cat = await Category.findById(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not found' });
  if ((cat.subCategories || []).some(s => s.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Sub-category already exists' });
  cat.subCategories.push({ name });
  await cat.save();
  res.json(cat);
});

/* ---------- rename sub-category ---------- */
router.put('/:id/sub/:subId', protect, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  const cat = await Category.findById(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not found' });
  const sub = cat.subCategories.id(req.params.subId);
  if (!sub) return res.status(404).json({ error: 'sub not found' });
  sub.name = name;
  await cat.save();
  res.json(cat);
});

/* ---------- delete sub-category ---------- */
router.delete('/:id/sub/:subId', protect, adminOnly, async (req, res) => {
  const cat = await Category.findById(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not found' });
  const sub = cat.subCategories.id(req.params.subId);
  if (sub) sub.deleteOne();
  await cat.save();
  res.json(cat);
});

/* ---------- seed default taxonomy (admin) ---------- */
/* Idempotent. Seeds with the user's actual category list (from Sample.xlsx). */
router.post('/seed-defaults', protect, adminOnly, async (req, res) => {
  const result = await seedDefaultCategories();
  res.json(result);
});

/* ---------- helpers ---------- */
function escapeRegex(s){ return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

/**
 * Default seed used both by the boot script and the admin endpoint above.
 *
 * `subs`   — the product types that must exist under the category.
 * `remove` — deprecated product-type names to prune (renamed/retired types).
 *            Kept explicit so the seed can be idempotent and self-healing
 *            without wiping product types an admin has added by hand.
 */
export const DEFAULT_TAXONOMY = [
  { name: 'DECORATIVE - SPECIAL', subs: ['DECORATIVE - SPECIAL'] },
  { name: 'EDGE BANDING',         subs: ['EDGE'],                            remove: ['EDGE BANDING'] },
  { name: 'FOLDERS',              subs: ['FOLDER'] },
  { name: 'LAMINATE',             subs: ['1 MM', 'OMBRE'],                   remove: ['0.92 LAM'] },
  { name: 'LINER',                subs: ['LINER'],                           remove: ['FABRIC .8 LINER'] },
  { name: 'LOUVRES',              subs: ['CANE', 'CHARCOL'],                 remove: ['BAMBOO', 'CHARCOAL'] },
  { name: 'OTHER',                subs: ['NON LAMINATES'],                   remove: ['OTHER'] },
  { name: 'POLYMER SHEET',        subs: ['GAG', 'MCS', 'PVC', 'TESLINE', 'TLM'], remove: ['ACRYLIC', 'POLYMER SHEET', 'THERMOLAM'] },
  { name: 'ROLLS',                subs: ['TWILE', 'THREAD'],                 remove: ['VOWEL VINYL ROLL', 'WEAVED CANE'] },
];

export async function seedDefaultCategories() {
  let inserted = 0, updated = 0;
  for (const t of DEFAULT_TAXONOMY) {
    const removeSet = new Set((t.remove || []).map(n => n.toLowerCase()));
    let cat = await Category.findOne({ name: new RegExp(`^${escapeRegex(t.name)}$`, 'i') });
    if (!cat) {
      cat = await Category.create({
        name: t.name,
        subCategories: t.subs.map(n => ({ name: n })),
        createdBy: 'system-seed',
      });
      inserted++;
    } else {
      let dirty = false;
      // Prune deprecated / renamed product types.
      if (removeSet.size) {
        const before = cat.subCategories.length;
        cat.subCategories = cat.subCategories.filter(
          s => !removeSet.has(s.name.toLowerCase())
        );
        if (cat.subCategories.length !== before) dirty = true;
      }
      // Add any missing product types from the default list.
      const have = new Set((cat.subCategories || []).map(s => s.name.toLowerCase()));
      for (const s of t.subs) {
        if (!have.has(s.toLowerCase())) {
          cat.subCategories.push({ name: s });
          dirty = true;
        }
      }
      if (dirty) { await cat.save(); updated++; }
    }
  }
  return { ok: true, inserted, updated };
}

export default router;
