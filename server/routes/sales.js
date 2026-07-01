import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import Sale from '../models/Sale.js';
import Category from '../models/Category.js';
import Dealer from '../models/Dealer.js';
import SalesTarget from '../models/SalesTarget.js';
import { protect, adminOnly, requireFeature } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function normMonth(s) {

  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
  m = t.match(/^([A-Za-z]+)[\s-]+(\d{2,4})$/);
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const mi = months.indexOf(m[1].slice(0,3).toLowerCase());
    if (mi < 0) return null;
    let y = +m[2]; if (y < 100) y += 2000;
    return `${y}-${String(mi+1).padStart(2,'0')}`;
  }
  return null;
}

function cleanSalesman(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  const half = Math.floor(s.length / 2);
  if (s.length > 8 && s[half-1] === ' ' && s.slice(0, half).trim() === s.slice(half).trim()) {
    return s.slice(0, half).trim();
  }
  return s;
}

function escapeRegex(s){ return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

async function buildSubToCatMap() {
  const cats = await Category.find({}).lean();
  const map = new Map();
  for (const c of cats) {
    for (const s of (c.subCategories || [])) {
      map.set(String(s.name).trim().toLowerCase(), c.name);
    }
  }
  return map;
}

router.get('/template', protect, async (req, res) => {
  const cats = await Category.find({}).sort({ name: 1 }).lean();
  const monthLabel = String(req.query.monthLabel || '').trim();
  const prefill    = String(req.query.prefill || '') === '1' || !!monthLabel;
  const filterSm   = String(req.query.salesman || '').trim();

  const subCols = [];
  for (const c of cats) {
    for (const s of (c.subCategories || [])) {
      subCols.push({ category: c.name, sub: s.name });
    }
  }

  const DEALER_HEADERS = [
    'Dealer ID',
    'Dealer Name', 'Salesman', 'City', 'State', 'Zone', 'Status',
    'Target', 'Credit Days', 'Credit Limit',
  ];
  const N_DEALER = DEALER_HEADERS.length;

  const wb = XLSX.utils.book_new();

  const inst = [
    ['Unified Sales Upload Template — Instructions'],
    [''],
    ['ONE Excel — updates everything: dealer info + per-month numbers + category-wise sales.'],
    [''],
    ['Sheet "Sales Data":'],
    ['  Row 1 = Section headers ("Dealer Info" / each Category / "Total")'],
    ['  Row 2 = Field names (Dealer Name, Salesman, City, …, 1 MM, OMBRE, …, Grand Total)'],
    ['  Row 3+ = ONE row per dealer.'],
    [''],
    ['Column A = Dealer ID — HIDDEN. DO NOT EDIT or DELETE these values.'],
    ['  This is how the system finds the existing dealer when you change Name, Salesman or any other field.'],
    ['  Leave blank only when ADDING a brand-new dealer at the bottom.'],
    ['Columns B–J = dealer info (Dealer Name, Salesman, City, State, Zone, Status, Target, Credit Days, Credit Limit).'],
    ['Columns K+  = quantity sold per sub-category (Product Type). Leave blank or 0 if none.'],
    ['Grand Total column auto-calculates from the sub-category cells.'],
    [''],
    ['On upload:'],
    ['  1. If Dealer ID is filled, the dealer is UPDATED in place — including any Name or Salesman change.'],
    ['  2. Dealer master fields (City, State, Zone, Status, Target, Credit) are updated.'],
    ['  3. Per-month numbers (Target, Achieved=Grand Total, Status, Zone, City, State, Credit) are written to monthly data for the picked month.'],
    ['  4. Category-wise sale rows are created from the sub-category cells.'],
    [''],
    ['Re-uploading the same month replaces that month\'s category sales cleanly.'],
    ['New categories/sub-categories added in Admin Panel → Categories show up next time you download this template.'],
  ];
  const instWS = XLSX.utils.aoa_to_sheet(inst);
  instWS['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, instWS, 'Instructions');

  const header1 = [
    'Dealer Info', ...Array(N_DEALER - 1).fill(''),
    ...subCols.map(c => c.category),
    'Total',
  ];
  const header2 = [
    ...DEALER_HEADERS,
    ...subCols.map(c => c.sub),
    'Grand Total',
  ];

  const aoa = [header1, header2];

  let prefillCount = 0;
  if (prefill) {
    const filt = {};
    if (filterSm) filt.salesman = filterSm;
    const dealers = await Dealer.find(filt).sort({ name: 1 }).lean();

    const monthYM = normMonth(monthLabel);
    const saleByDealerSub = new Map();
    if (monthYM) {
      const sales = await Sale.find({ month: monthYM }, { dealerName:1, subCategory:1, qty:1 }).lean();
      for (const s of sales) {
        const key = (String(s.dealerName||'').toLowerCase().trim()) + '||' + (String(s.subCategory||'').toLowerCase().trim());

        saleByDealerSub.set(key, (saleByDealerSub.get(key) || 0) + (s.qty || 0));
      }
    }

    for (const d of dealers) {
      const md = (d.monthlyData && d.monthlyData[monthLabel]) || {};
      const nameKey = String(d.name||'').toLowerCase().trim();

      const subCells = subCols.map(c => {
        const k = nameKey + '||' + String(c.sub).toLowerCase().trim();
        const q = saleByDealerSub.get(k);
        return q ? Number(q) : '';
      });
      aoa.push([
        String(d._id || ''),
        d.name || '',
        d.salesman || '',
        md.city || d.city || '',
        md.state || d.state || '',
        md.zone  || d.zone  || '',
        md.status|| d.status|| 'ACTIVE',
        Number(md.target || d.target || 0),
        Number(md.creditDays  || d.creditDays  || 0),
        Number(md.creditLimit || d.creditLimit || 0),
        ...subCells,
        '',
      ]);
      prefillCount++;
    }
  }

  for (let i = 0; i < 5; i++) {
    aoa.push([...Array(N_DEALER).fill(''), ...subCols.map(() => ''), '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  if (subCols.length > 0) {
    const firstSubCol = N_DEALER;
    const lastSubCol  = N_DEALER + subCols.length - 1;
    const gtCol       = N_DEALER + subCols.length;
    const firstColLetter = XLSX.utils.encode_col(firstSubCol);
    const lastColLetter  = XLSX.utils.encode_col(lastSubCol);
    for (let r = 2; r < aoa.length; r++) {
      const cellRef  = XLSX.utils.encode_cell({ r, c: gtCol });
      const excelRow = r + 1;
      ws[cellRef] = { t: 'n', f: `SUM(${firstColLetter}${excelRow}:${lastColLetter}${excelRow})` };
    }
  }

  ws['!cols'] = [
    { wch: 8, hidden: true },
    { wch: 36 },
    { wch: 22 },
    { wch: 16 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    ...subCols.map(() => ({ wch: 13 })),
    { wch: 13 },
  ];

  const merges = [];

  if (N_DEALER > 1) merges.push({ s:{ r:0, c:0 }, e:{ r:0, c:N_DEALER - 1 } });

  let runStart = N_DEALER;
  for (let i = 1; i < subCols.length; i++) {
    if (subCols[i].category !== subCols[i-1].category) {
      const endCol = i - 1 + N_DEALER;
      if (endCol > runStart) merges.push({ s:{ r:0, c:runStart }, e:{ r:0, c:endCol } });
      runStart = i + N_DEALER;
    }
  }
  if (subCols.length > 0) {
    const endCol = subCols.length - 1 + N_DEALER;
    if (endCol > runStart) merges.push({ s:{ r:0, c:runStart }, e:{ r:0, c:endCol } });
  }
  ws['!merges'] = merges;

  ws['!freeze'] = { xSplit: '2', ySplit: '2' };

  XLSX.utils.book_append_sheet(wb, ws, 'Sales Data');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const tag = monthLabel ? `_${monthLabel.replace(/[^A-Za-z0-9-]/g,'')}` : '';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Sales_Upload_Template${tag}.xlsx"`);
  res.send(buf);
});

router.post('/upload', protect, adminOnly, requireFeature('monthlyEntry'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const month      = normMonth(req.body?.month);
    const monthLabel = String(req.body?.monthLabel || '').trim();
    if (!month) return res.status(400).json({ error: 'month is required (YYYY-MM)' });

    const replace = String(req.body?.replace || 'true') === 'true';
    const batchId = `${month}-${Date.now()}`;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

    let sheetName = wb.SheetNames.find(n => /sales\s*data/i.test(n));
    if (!sheetName) sheetName = wb.SheetNames.find(n => !/instruction/i.test(n)) || wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return res.status(400).json({ error: 'sheet not found' });

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    if (rows.length < 3) return res.status(400).json({ error: 'sheet has no data rows' });

    const r1 = rows[0].map(v => String(v || '').trim());
    const r2 = rows[1].map(v => String(v || '').trim());

    const subToCat = await buildSubToCatMap();
    const hasSubInRow2 = r2.some(v => v && subToCat.has(v.toLowerCase()));
    const hasSubInRow1 = r1.some(v => v && subToCat.has(v.toLowerCase()));

    let headerRowIdx, dataStartIdx, headerCols;
    if (hasSubInRow2) {
      headerRowIdx = 1; dataStartIdx = 2; headerCols = r2;
    } else if (hasSubInRow1) {
      headerRowIdx = 0; dataStartIdx = 1; headerCols = r1;
    } else {
      headerRowIdx = 0; dataStartIdx = 1; headerCols = r1;
    }

    const hasDealerIdCol = headerCols.some(h => /^dealer\s*id$/i.test(String(h || '').trim()));

    const colInfo = headerCols.map((label, idx) => {
      const v = String(label || '').trim();
      const lv = v.toLowerCase();
      let role = 'ignore';
      if (/^dealer\s*id$/i.test(v))                                         role = 'dealerid';
      else if ((!hasDealerIdCol && idx === 0) || /^(company\s*name|dealer\s*name|dealer)$/i.test(v)) role = 'dealer';
      else if (/^(sales\s*person|salesman)$/i.test(v))                     role = 'salesman';
      else if (/^city$/i.test(v))                                           role = 'city';
      else if (/^state$/i.test(v))                                          role = 'state';
      else if (/^zone$/i.test(v))                                           role = 'zone';
      else if (/^status$/i.test(v))                                         role = 'status';
      else if (/^category\s*type$/i.test(v))                                role = 'ignore';
      else if (/^sub\s*category$/i.test(v))                                 role = 'ignore';
      else if (/^target$/i.test(v))                                         role = 'target';
      else if (/^credit\s*days$/i.test(v))                                  role = 'creditDays';
      else if (/^credit\s*limit$/i.test(v))                                 role = 'creditLimit';
      else if (/grand\s*total|^total$|^achieved$/i.test(v))                 role = 'ignore';
      else if (v && subToCat.has(lv))                                       role = 'subcat';
      else if (v)                                                           role = 'misc';
      return { idx, label: v, role };
    });

    const get = (row, role) => {
      const c = colInfo.find(x => x.role === role);
      return c ? row[c.idx] : undefined;
    };

    const dealerColIdx = colInfo.find(c => c.role === 'dealer')?.idx ?? 0;

    const knownDealers = await Dealer.find({}).lean();
    const dealerByNameSm   = new Map();
    const dealerByLower    = new Map();
    const dealerById       = new Map();

    const stripKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const dealerByStrippedSm = new Map();
    const dealerByStripped   = new Map();
    for (const d of knownDealers) {
      const nm = String(d.name || '').trim().toLowerCase();
      const sm = String(d.salesman || '').trim().toLowerCase();
      dealerByNameSm.set(`${nm}|${sm}`, d);
      if (!dealerByLower.has(nm)) dealerByLower.set(nm, d);
      dealerById.set(String(d._id), d);
      const snm = stripKey(d.name);
      const ssm = stripKey(d.salesman);
      if (snm) {
        dealerByStrippedSm.set(`${snm}|${ssm}`, d);
        if (!dealerByStripped.has(snm)) dealerByStripped.set(snm, d);
      }
    }

    if (replace) {
      await Sale.deleteMany({ month });
    }

    const docs = [];
    const unknownSubs       = new Set();
    const unmatchedDealers  = new Set();
    let dealersUpdated      = 0;
    let dealersCreated      = 0;
    let monthlyDataUpdated  = 0;

    for (let i = dataStartIdx; i < rows.length; i++) {
      const row = rows[i];
      const dealerName = String(row[dealerColIdx] || '').trim();
      if (!dealerName) continue;

      if (/^grand\s*total$/i.test(dealerName) || /^total$/i.test(dealerName)) continue;

      const salesman = cleanSalesman(get(row, 'salesman'));

      let rowAchieved = 0;
      const rowSaleRows = [];
      for (const c of colInfo) {
        if (c.role !== 'subcat' && c.role !== 'misc') continue;
        const raw = row[c.idx];
        const qty = Number(raw) || 0;
        if (!qty) continue;

        let cat, sub;
        if (c.role === 'subcat') {
          sub = c.label;
          cat = subToCat.get(sub.toLowerCase());
        } else {
          unknownSubs.add(c.label);
          cat = 'OTHER';
          sub = c.label || 'OTHER';
        }
        rowAchieved += qty;
        rowSaleRows.push({ cat, sub, qty });
      }

      const masterFields = {};
      const hasCell = role => {
        const c = colInfo.find(x => x.role === role);
        if (!c) return false;
        const v = row[c.idx];
        return !(v === undefined || v === null || v === '');
      };
      const numCell = role => {
        const v = get(row, role);
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      if (hasCell('city'))        masterFields.city        = String(get(row,'city')||'').trim();
      if (hasCell('state'))       masterFields.state       = String(get(row,'state')||'').trim();
      if (hasCell('zone'))        masterFields.zone        = String(get(row,'zone')||'').trim();
      if (hasCell('status'))      masterFields.status      = String(get(row,'status')||'').trim() || 'ACTIVE';
      if (hasCell('target')      && numCell('target')      !== null) masterFields.target      = numCell('target');
      if (hasCell('creditDays')  && numCell('creditDays')  !== null) masterFields.creditDays  = numCell('creditDays');
      if (hasCell('creditLimit') && numCell('creditLimit') !== null) masterFields.creditLimit = numCell('creditLimit');

      const rowDealerId = String(get(row, 'dealerid') || '').trim();
      const nmLow = dealerName.toLowerCase();
      const smLow = String(salesman || '').trim().toLowerCase();

      const nmStr = stripKey(dealerName);
      const smStr = stripKey(salesman);
      let dealerDoc =
            (rowDealerId && dealerById.get(rowDealerId))
         || (smLow ? dealerByNameSm.get(`${nmLow}|${smLow}`) : null)
         || (!smLow ? dealerByLower.get(nmLow) : null)
         || (smStr ? dealerByStrippedSm.get(`${nmStr}|${smStr}`) : null)
         || (nmStr ? dealerByStripped.get(nmStr) : null)
         || dealerByLower.get(nmLow);

      if (rowDealerId && dealerDoc) {
        if (dealerName && dealerName !== dealerDoc.name) {
          masterFields.name = dealerName;
        }
        if (salesman && salesman !== dealerDoc.salesman) {
          masterFields.salesman = salesman;
        }
      }

      if (!dealerDoc) {

        if (salesman) {
          try {
            const created = await Dealer.create({
              name: dealerName,
              salesman,
              ...masterFields,
              source: 'cat-upload',
            });
            dealerByNameSm.set(`${nmLow}|${smLow}`, created);
            if (!dealerByLower.has(nmLow)) dealerByLower.set(nmLow, created);
            dealerById.set(String(created._id), created);
            dealerDoc = created;
            dealersCreated++;
          } catch (err) {
            if (err && err.code === 11000) {

              dealerDoc = await Dealer.findOne({ name: dealerName, salesman });
              if (dealerDoc) {
                dealerByNameSm.set(`${nmLow}|${smLow}`, dealerDoc);
                dealerById.set(String(dealerDoc._id), dealerDoc);
              } else {
                unmatchedDealers.add(dealerName);
                console.warn('[sales/upload] 11000 but no doc found for', dealerName, salesman);
              }
            } else {
              throw err;
            }
          }
        } else {
          unmatchedDealers.add(dealerName);
        }
      }

      if (dealerDoc) {

        const updates = {};
        for (const [k, v] of Object.entries(masterFields)) {
          if (dealerDoc[k] !== v) updates[k] = v;
        }

        if (monthLabel) {
          const md = dealerDoc.monthlyData instanceof Map
            ? Object.fromEntries(dealerDoc.monthlyData)
            : (dealerDoc.monthlyData || {});
          const prev = md[monthLabel] || {};
          const entry = {
            achieved:    rowAchieved || prev.achieved || 0,
            target:      ('target' in masterFields ? masterFields.target : (prev.target || 0)),
            status:      masterFields.status ?? prev.status ?? '',
            zone:        masterFields.zone   ?? prev.zone   ?? '',

            category:    prev.category     ?? '',
            categoryType:prev.categoryType ?? '',
            city:        masterFields.city  ?? prev.city  ?? '',
            state:       masterFields.state ?? prev.state ?? '',
            creditDays:  ('creditDays'  in masterFields ? masterFields.creditDays  : (prev.creditDays  || 0)),
            creditLimit: ('creditLimit' in masterFields ? masterFields.creditLimit : (prev.creditLimit || 0)),
          };
          updates[`monthlyData.${monthLabel}`] = entry;
          monthlyDataUpdated++;
        }

        if (Object.keys(updates).length) {
          try {
            await Dealer.updateOne({ _id: dealerDoc._id }, { $set: updates });

            const prevNm = String(dealerDoc.name || '').trim().toLowerCase();
            const prevSm = String(dealerDoc.salesman || '').trim().toLowerCase();
            dealerByNameSm.delete(`${prevNm}|${prevSm}`);
            Object.assign(dealerDoc, updates);
            const newNm = String(dealerDoc.name || '').trim().toLowerCase();
            const newSm = String(dealerDoc.salesman || '').trim().toLowerCase();
            dealerByNameSm.set(`${newNm}|${newSm}`, dealerDoc);
            if (newNm) dealerByLower.set(newNm, dealerDoc);
            dealersUpdated++;
          } catch (err) {
            if (err && err.code === 11000) {

              unmatchedDealers.add(dealerName + ' (rename conflict — another dealer already owns the new name/salesman pair)');
              console.warn('[sales/upload] rename conflict for', dealerDoc.name, '→', updates.name, '/', updates.salesman);
            } else {
              throw err;
            }
          }
        }
      }

      for (const r of rowSaleRows) {
        docs.push({
          dealerName,
          dealerId: dealerDoc?._id,
          salesman,
          month,
          category: r.cat,
          subCategory: r.sub,
          qty: r.qty,
          uploadedBy: req.user?.name || req.user?.email || '',
          uploadBatchId: batchId,
        });
      }
    }

    if (docs.length) await Sale.insertMany(docs);

    res.json({
      ok: true,
      month,
      monthLabel,
      inserted: docs.length,
      dealersCreated,
      dealersUpdated,
      monthlyDataUpdated,
      batchId,
      headerRowDetectedAt: headerRowIdx + 1,
      unmatchedDealers: [...unmatchedDealers].slice(0, 20),
      unmatchedDealersCount: unmatchedDealers.size,
      unknownSubCategories: [...unknownSubs],
    });
  } catch (e) {
    console.error('[sales/upload]', e);
    res.status(500).json({ error: e.message || 'upload failed' });
  }
});

router.get('/months', protect, async (req, res) => {
  const months = await Sale.distinct('month');
  months.sort();
  res.json(months);
});

async function monthFilter(req) {
  const f = {};
  if (req.query.month) f.month = req.query.month;
  if (req.query.from && req.query.to) f.month = { $gte: req.query.from, $lte: req.query.to };
  if (req.query.dealer) f.dealerName = req.query.dealer;

  const role = req.user?.role;
  if (role === 'superadmin') {

    if (req.query.salesman) f.salesman = req.query.salesman;
    return f;
  }

  const User = (await import('../models/User.js')).default;
  const u = await User.findOne({ id: req.user.id }, 'permissions').lean();
  const p = u?.permissions || {};
  const hasStates   = Array.isArray(p.states)   && p.states.length   > 0;
  const hasZones    = Array.isArray(p.zones)    && p.zones.length    > 0;
  const hasSalesmen = Array.isArray(p.salesmen) && p.salesmen.length > 0;

  if (hasStates || hasZones || hasSalesmen) {

    const Dealer = (await import('../models/Dealer.js')).default;
    const dealerFilt = {};
    const escape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ciMatch = v => new RegExp('^\\s*' + escape(v) + '\\s*$', 'i');
    if (hasStates)   dealerFilt.state    = { $in: p.states.map(ciMatch) };
    if (hasZones)    dealerFilt.zone     = { $in: p.zones.map(ciMatch) };
    if (hasSalesmen) dealerFilt.salesman = { $in: p.salesmen };
    const permitted = await Dealer.find(dealerFilt, 'name').lean();
    const names = permitted.map(d => d.name);

    f.dealerName = names.length ? { $in: names } : { $in: ['__no_match__'] };
    if (hasSalesmen) f.salesman = { $in: p.salesmen };
    return f;
  }

  if (role === 'admin') {
    if (req.query.salesman) f.salesman = req.query.salesman;
  } else if (req.user?.id) {
    f.salesman = req.user.id;
  }
  return f;
}

router.get('/by-category', protect, async (req, res) => {
  const filter = await monthFilter(req);
  const rows = await Sale.aggregate([
    { $match: filter },
    { $group: { _id: { category: '$category', subCategory: '$subCategory' }, qty: { $sum: '$qty' } } },
    { $project: { _id: 0, category: '$_id.category', subCategory: '$_id.subCategory', qty: 1 } },
    { $sort: { category: 1, subCategory: 1 } },
  ]);
  const grandTotal = rows.reduce((a, r) => a + (r.qty || 0), 0);
  res.json({ rows, grandTotal });
});

router.get('/by-dealer', protect, async (req, res) => {
  const filter = await monthFilter(req);
  const rows = await Sale.aggregate([
    { $match: filter },
    { $group: {
        _id: { dealer: '$dealerName', category: '$category', subCategory: '$subCategory' },
        qty: { $sum: '$qty' },
    }},
    { $sort: { '_id.dealer': 1, '_id.category': 1, '_id.subCategory': 1 } },
  ]);
  const out = {};
  let grandTotal = 0;
  for (const r of rows) {
    const d = r._id.dealer;
    out[d] = out[d] || { dealer: d, byCategory: {}, total: 0 };
    out[d].byCategory[r._id.category] = out[d].byCategory[r._id.category] || {};
    out[d].byCategory[r._id.category][r._id.subCategory] = r.qty;
    out[d].total += r.qty;
    grandTotal += r.qty;
  }
  res.json({ rows: Object.values(out).sort((a,b) => b.total - a.total), grandTotal });
});

router.get('/by-salesman', protect, async (req, res) => {
  const filter = await monthFilter(req);
  const rows = await Sale.aggregate([
    { $match: filter },
    { $group: {
        _id: { salesman: '$salesman', category: '$category', subCategory: '$subCategory' },
        qty: { $sum: '$qty' },
    }},
    { $sort: { '_id.salesman': 1, '_id.category': 1, '_id.subCategory': 1 } },
  ]);
  const out = {};
  let grandTotal = 0;
  for (const r of rows) {
    const s = r._id.salesman || '(no salesman)';
    out[s] = out[s] || { salesman: s, byCategory: {}, total: 0 };
    out[s].byCategory[r._id.category] = out[s].byCategory[r._id.category] || {};
    out[s].byCategory[r._id.category][r._id.subCategory] = r.qty;
    out[s].total += r.qty;
    grandTotal += r.qty;
  }
  res.json({ rows: Object.values(out).sort((a,b) => b.total - a.total), grandTotal });
});

router.get('/raw', protect, async (req, res) => {
  const filter = await monthFilter(req);
  const limit = Math.min(parseInt(req.query.limit) || 200, 5000);
  const skip = parseInt(req.query.skip) || 0;
  const rows = await Sale.find(filter).sort({ dealerName: 1, category: 1, subCategory: 1 }).skip(skip).limit(limit).lean();
  const total = await Sale.countDocuments(filter);
  res.json({ rows, total });
});

router.get('/dealer/:name', protect, async (req, res) => {
  const dealerName = decodeURIComponent(req.params.name);
  const rows = await Sale.aggregate([
    { $match: { dealerName } },
    { $group: {
        _id: { month:'$month', category:'$category', subCategory:'$subCategory' },
        qty: { $sum: '$qty' },
    }},
    { $sort: { '_id.month': -1, '_id.category': 1, '_id.subCategory': 1 } },
  ]);
  const byMonth = new Map();
  let grandTotal = 0;
  for (const r of rows) {
    const m = r._id.month;
    if (!byMonth.has(m)) byMonth.set(m, { month: m, byCategory: {}, total: 0 });
    const g = byMonth.get(m);
    g.byCategory[r._id.category] = g.byCategory[r._id.category] || {};
    g.byCategory[r._id.category][r._id.subCategory] = r.qty;
    g.total += r.qty;
    grandTotal += r.qty;
  }
  res.json({ dealer: dealerName, months: [...byMonth.values()], grandTotal });
});

router.get('/targets', protect, async (req, res) => {
  const month = normMonth(req.query.month) || String(req.query.month || '');
  const filter = month ? { month } : {};
  const rows = await SalesTarget.find(filter).lean();
  res.json(rows);
});

router.post('/targets', protect, adminOnly, async (req, res) => {
  const { salesmanId, category, target } = req.body || {};
  const month = normMonth(req.body?.month) || String(req.body?.month || '');
  if (!salesmanId || !category || !month) {
    return res.status(400).json({ error: 'salesmanId, category, month required' });
  }
  const updated = await SalesTarget.findOneAndUpdate(
    { salesmanId, category, month },
    { $set: { target: Number(target) || 0, setBy: req.user?.name || req.user?.email || '' } },
    { new: true, upsert: true },
  );
  res.json(updated);
});

router.post('/targets/bulk', protect, adminOnly, async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  let upserted = 0;
  for (const it of items) {
    const month = normMonth(it.month) || String(it.month || '');
    if (!it.salesmanId || !it.category || !month) continue;
    await SalesTarget.findOneAndUpdate(
      { salesmanId: it.salesmanId, category: it.category, month },
      { $set: { target: Number(it.target) || 0, setBy: req.user?.name || req.user?.email || '' } },
      { upsert: true },
    );
    upserted++;
  }
  res.json({ ok: true, upserted });
});

router.delete('/month/:m', protect, adminOnly, async (req, res) => {
  const month = normMonth(req.params.m);
  if (!month) return res.status(400).json({ error: 'bad month' });
  const r = await Sale.deleteMany({ month });
  res.json({ ok: true, deleted: r.deletedCount });
});

export default router;
