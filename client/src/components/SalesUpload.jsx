import React, { useEffect, useRef, useState } from 'react';
import { Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle, X, Calendar, Layers } from 'lucide-react';
import { api } from '../api';
import { notify } from './Toast';

/**
 * SalesUpload — admin uploads the wide-format Excel:
 *   ┌───────────────┬──────────────┬─────────┬───────┬─────┬────────┐
 *   │ Company Name  │ Sales Person │  1 MM   │ OMBRE │ ... │ Grand  │
 *   ├───────────────┼──────────────┼─────────┼───────┼─────┼────────┤
 *   │ A & M INTERIO │ Ratish Das   │         │  16   │  3  │   19   │
 *   └───────────────┴──────────────┴─────────┴───────┴─────┴────────┘
 *
 * Steps:
 *   1. Pick a month.
 *   2. Click "Download Template" — server generates an Excel with current
 *      categories/sub-categories as column headers.
 *   3. Fill it in Excel and upload.
 *   4. Server explodes the wide row into per-(dealer × sub-cat) line items.
 */

// Build a "YYYY-MM" string list spanning last 18 months → next 6
function buildMonthOptions() {
  const out = [];
  const now  = new Date();
  for (let i = -18; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lbl = d.toLocaleString('default', { month:'short', year:'numeric' });
    out.push({ ym, label: lbl });
  }
  return out;
}

const SalesUpload = ({ currentUser, onUploaded }) => {
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  const months = buildMonthOptions();
  const currentYM = (() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}`; })();

  const [month, setMonth]     = useState(currentYM);
  const [file, setFile]       = useState(null);
  const [busy, setBusy]       = useState(false);
  const [busyT, setBusyT]     = useState(false);
  const [result, setResult]   = useState(null);
  const [err, setErr]         = useState('');
  const [drag, setDrag]       = useState(false);
  const [existingMonths, setExistingMonths] = useState([]);
  const [replace, setReplace] = useState(true);
  const fileRef = useRef(null);

  useEffect(() => { api.salesMonths().then(setExistingMonths).catch(()=>{}); }, []);

  const monthHasData = existingMonths.includes(month);

  const downloadTpl = async () => {
    setBusyT(true);
    try { await api.salesDownloadTemplate(); }
    catch(e) { notify.error(e.message); }
    setBusyT(false);
  };

  const onPick = (f) => {
    if (!f) return;
    if (!/\.(xlsx|xls)$/i.test(f.name)) { notify.error('Please pick an Excel (.xlsx) file'); return; }
    setFile(f); setResult(null); setErr('');
  };

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false);
    onPick(e.dataTransfer?.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file)  { notify.error('Pick an Excel file first'); return; }
    if (!month) { notify.error('Pick a month'); return; }
    setBusy(true); setErr(''); setResult(null);
    try {
      const res = await api.salesUpload(file, month, replace);
      setResult(res);
      notify.success(`Uploaded ${res.inserted} sales rows for ${month}`);
      const ms = await api.salesMonths().catch(()=>[]);
      setExistingMonths(ms);
      if (onUploaded) onUploaded();
    } catch(e) { setErr(e.message); notify.error(e.message); }
    setBusy(false);
  };

  const reset = () => { setFile(null); setResult(null); setErr(''); if(fileRef.current) fileRef.current.value=''; };

  if (!isAdmin) {
    return (
      <div className="card" style={{padding:20}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <AlertCircle size={18} color="#f59e0b"/>
          <div style={{fontSize:14,fontWeight:600}}>Only admins can upload sales data.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade" style={{display:'grid',gap:14}}>
      {/* Top — title + month picker */}
      <div className="row">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <FileSpreadsheet size={18} color="var(--acc)"/>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>Upload Category-wise Sales</div>
            <div style={{fontSize:12,color:'var(--t3)'}}>One row per dealer. Columns = product types.</div>
          </div>
        </div>
        <div className="spacer"/>
      </div>

      {/* Step 1 — Template */}
      <div className="card" style={{padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
          <div style={{
            width:26,height:26,borderRadius:13,background:'var(--acc)',color:'white',
            display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
          }}>1</div>
          <div style={{fontSize:14,fontWeight:700}}>Download the Excel template</div>
        </div>
        <div style={{fontSize:12,color:'var(--t3)',marginBottom:10,paddingLeft:34}}>
          The template auto-generates columns from your current Category Types &amp; Product Types.
          Manage them under <b>Admin Panel → Categories</b>.
        </div>
        <div style={{paddingLeft:34}}>
          <button className="btnp" onClick={downloadTpl} disabled={busyT}
            style={{display:'inline-flex',alignItems:'center',gap:6}}>
            <Download size={14}/> {busyT ? 'Building…' : 'Download Sales Template'}
          </button>
        </div>
      </div>

      {/* Step 2 — Month + replace toggle */}
      <div className="card" style={{padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{
            width:26,height:26,borderRadius:13,background:'var(--acc)',color:'white',
            display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
          }}>2</div>
          <div style={{fontSize:14,fontWeight:700}}>Pick the month this data is for</div>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:14,alignItems:'center',paddingLeft:34}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <Calendar size={14} color="var(--t3)"/>
            <select value={month} onChange={e=>setMonth(e.target.value)} className="inp" style={{minWidth:160}}>
              {months.map(m => (
                <option key={m.ym} value={m.ym}>
                  {m.label}{existingMonths.includes(m.ym) ? '  •  has data' : ''}
                </option>
              ))}
            </select>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'var(--t2)'}}>
            <input type="checkbox" checked={replace} onChange={e=>setReplace(e.target.checked)} />
            Replace existing data for this month
          </label>
          {monthHasData && replace && (
            <span style={{fontSize:11,color:'#f59e0b'}}>⚠ existing rows for {month} will be wiped before insert</span>
          )}
        </div>
      </div>

      {/* Step 3 — Upload */}
      <div className="card" style={{padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
          <div style={{
            width:26,height:26,borderRadius:13,background:'var(--acc)',color:'white',
            display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,
          }}>3</div>
          <div style={{fontSize:14,fontWeight:700}}>Upload the filled Excel</div>
        </div>
        <div
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={onDrop}
          onClick={()=>fileRef.current?.click()}
          style={{
            marginLeft:34,
            border:`2px dashed ${drag?'var(--acc)':'var(--b2)'}`,
            borderRadius:10, padding:24, textAlign:'center', cursor:'pointer',
            background: drag ? 'rgba(99,102,241,.06)' : 'transparent',
          }}
        >
          <Upload size={28} color={drag?'var(--acc)':'var(--t3)'} style={{marginBottom:6}}/>
          <div style={{fontSize:13,fontWeight:600}}>{file ? file.name : 'Click or drag .xlsx here'}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:4}}>
            {file ? `${(file.size/1024).toFixed(1)} KB` : 'Use the template above for best results'}
          </div>
          <input
            ref={fileRef} type="file" accept=".xlsx,.xls" hidden
            onChange={e=>onPick(e.target.files?.[0])}
          />
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
          {file && (
            <button className="btn" onClick={reset}><X size={13}/> Clear</button>
          )}
          <button className="btnp" onClick={handleUpload} disabled={busy || !file}>
            <Upload size={13}/> {busy ? 'Uploading…' : `Upload for ${month}`}
          </button>
        </div>
      </div>

      {/* Result */}
      {err && (
        <div className="card" style={{padding:14,borderColor:'#ef4444',background:'rgba(239,68,68,.06)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <AlertCircle size={16} color="#ef4444"/>
            <div style={{fontSize:13,fontWeight:600,color:'#ef4444'}}>{err}</div>
          </div>
        </div>
      )}
      {result && (
        <div className="card" style={{padding:14,borderColor:'#34d399',background:'rgba(52,211,153,.05)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
            <CheckCircle size={16} color="#34d399"/>
            <div style={{fontSize:13,fontWeight:700}}>Upload successful</div>
          </div>
          <div style={{fontSize:12,color:'var(--t2)',display:'grid',gap:4}}>
            <div>Month: <b>{result.month}</b></div>
            <div>Inserted: <b>{result.inserted}</b> line items</div>
            {result.unknownSubCategories?.length > 0 && (
              <div style={{color:'#f59e0b'}}>
                ⚠ Unknown sub-categories skipped: {result.unknownSubCategories.join(', ')}
                <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>
                  Add them in Admin → Categories, then re-upload.
                </div>
              </div>
            )}
            {result.unmatchedDealersCount > 0 && (
              <div style={{color:'#f59e0b'}}>
                ⚠ {result.unmatchedDealersCount} dealer name(s) didn't match the dealer master list
                {result.unmatchedDealers?.length ? `: ${result.unmatchedDealers.slice(0,5).join(', ')}${result.unmatchedDealersCount>5?'…':''}` : ''}.
                <div style={{fontSize:10,color:'var(--t3)',marginTop:2}}>
                  Data was still saved, but Dealer drill-down may show those by name only.
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesUpload;
