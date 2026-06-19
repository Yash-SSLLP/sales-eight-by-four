import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, BarChart3, Users, User, Download, TrendingUp, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';
import { notify, confirmDialog } from './Toast';
import CategoryFilter from './CategoryFilter';

/**
 * SalesByCategory — three views over uploaded category-wise sales:
 *   • Overall        → category totals (with sub-cat breakdown) + Grand Total
 *   • By Dealer      → pivot table: rows=dealer, cols=category, totals
 *   • By Salesman    → pivot table: rows=salesman, cols=category, totals
 *
 * All three respect the same Month filter at the top.
 */

const fmt = n => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

const SalesByCategory = ({ currentUser, dealers, onOpenDealer } = {}) => {
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  // Build a name → dealerId index so clicking a dealer row in the pivot opens
  // their modal at the Categories tab.
  const dealerIdByName = useMemo(() => {
    const m = new Map();
    for (const d of (dealers || [])) {
      if (d?.name && d?.id) m.set(String(d.name).toLowerCase().trim(), d.id);
    }
    return m;
  }, [dealers]);
  const openDealerByName = (name) => {
    if (!onOpenDealer) return;
    const id = dealerIdByName.get(String(name).toLowerCase().trim());
    if (id) onOpenDealer(id);
  };
  const [tab, setTab]               = useState('overall');
  const [months, setMonths]         = useState([]);
  const [month, setMonth]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [byCat, setByCat]           = useState({ rows:[], grandTotal:0 });
  const [byDealer, setByDealer]     = useState({ rows:[], grandTotal:0 });
  const [bySalesman, setBySalesman] = useState({ rows:[], grandTotal:0 });

  const [search, setSearch] = useState('');

  // Categories the user has toggled OFF (excluded from totals/pivots).
  // Persisted so user's choice (e.g. "always exclude LINER") survives reloads.
  const [excluded, setExcluded] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('stp_salescat_excluded')||'[]')); }
    catch { return new Set(); }
  });
  const toggleExcluded = (cat) => {
    setExcluded(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      try { localStorage.setItem('stp_salescat_excluded', JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const clearExcluded = () => {
    setExcluded(new Set());
    try { localStorage.removeItem('stp_salescat_excluded'); } catch {}
  };

  // Load distinct months once
  useEffect(() => {
    api.salesMonths().then(ms => {
      setMonths(ms);
      if (ms.length) setMonth(ms[ms.length-1]);     // latest by default
    }).catch(()=>{});
  }, []);

  // Reload all three aggregates whenever month changes
  const load = async () => {
    if (!month) return;
    setLoading(true);
    try {
      const [a, b, c] = await Promise.all([
        api.salesByCategory({ month }),
        api.salesByDealer({ month }),
        api.salesBySalesman({ month }),
      ]);
      setByCat(a); setByDealer(b); setBySalesman(c);
    } catch(e) { notify.error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, [month]);

  // "2026-06" → "Jun-26" (the MO-label format dealer.monthlyData keys use)
  const ymToMoLabel = (ym) => {
    if (!ym) return '';
    const m = /^(\d{4})-(\d{1,2})$/.exec(ym);
    if (!m) return ym;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[+m[2]-1]}-${String(+m[1]).slice(2)}`;
  };

  // Admin: full clean-slate reset for a month.
  // (a) Category sale rows, (b) dealer.monthlyData[label], (c) dedupe dealers.
  const handleDeleteMonth = async () => {
    if (!month) return;
    const label = ymToMoLabel(month);
    const ok = await confirmDialog({
      title: `Reset ALL data for ${month}?`,
      message: [
        `This wipes everything for ${month} so you can re-upload cleanly:`,
        '',
        `• Every category-wise sale row for ${month}`,
        `• Every dealer's Target / Achieved / Status / Zone / City for ${label}`,
        `• Duplicate dealer rows created during the bad upload`,
        '',
        'Dealer master records and OTHER months are NOT touched.',
      ].join('\n'),
      confirmText: `Yes, reset ${month}`,
      cancelText: 'Cancel',
      danger: true,
    });
    if (!ok) return;
    try {
      const r1 = await api.salesDeleteMonth(month).catch(e => ({ deleted:0, _err:e.message }));
      const r2 = await api.deleteMonth(label).catch(e => ({ dealersTouched:0, _err:e.message }));
      const r0 = await api.deleteDealersBySource('cat-upload', false).catch(e => ({ deleted:0, migrated:0, _err:e.message }));
      const r3 = await api.dedupeDealers(false).catch(e => ({ duplicatesRemoved:0, _err:e.message }));
      const r4 = await api.cleanupSuffixDupes(false).catch(e => ({ deleted:0, migrated:0, _err:e.message }));
      notify.success(
        `Reset ${month}: ${r0.deleted||0} bad-upload dealers · ${r1.deleted||0} sale rows · ${r2.dealersTouched||0} dealer-months · ${(r3.duplicatesRemoved ?? r3.removed) || 0} exact dupes · ${r4.deleted || 0} suffix dupes.`
      );
      const ms = await api.salesMonths().catch(()=>[]);
      setMonths(ms);
      if (!ms.includes(month)) {
        setMonth(ms.length ? ms[ms.length-1] : '');
      } else {
        load();
      }
    } catch(e) { notify.error(e.message); }
  };

  // Build distinct category list (FULL — used by the include/exclude chips).
  const allCategories = useMemo(() => {
    const set = new Set();
    byCat.rows.forEach(r => set.add(r.category));
    byDealer.rows.forEach(r => Object.keys(r.byCategory||{}).forEach(c => set.add(c)));
    bySalesman.rows.forEach(r => Object.keys(r.byCategory||{}).forEach(c => set.add(c)));
    return [...set].sort();
  }, [byCat, byDealer, bySalesman]);

  // Category list AFTER applying the user's exclusions (used as pivot columns).
  const categories = useMemo(
    () => allCategories.filter(c => !excluded.has(c)),
    [allCategories, excluded],
  );

  // Filtered totals — recomputed each render so toggling LINER off instantly
  // re-bases Grand Total, the pivot tables and the KPI cards.
  const filteredByCatRows = useMemo(
    () => byCat.rows.filter(r => !excluded.has(r.category)),
    [byCat, excluded],
  );
  const filteredGrandTotal = useMemo(
    () => filteredByCatRows.reduce((s,r) => s + (r.qty||0), 0),
    [filteredByCatRows],
  );
  // Same trick for the dealer / salesman pivots — recompute each row's total
  // from its visible categories so the "Total" column matches the visible cells.
  const dealerRowsAdj = useMemo(() => byDealer.rows.map(r => {
    const visible = Object.fromEntries(
      Object.entries(r.byCategory||{}).filter(([c]) => !excluded.has(c))
    );
    const total = Object.values(visible).reduce(
      (s, subs) => s + Object.values(subs).reduce((a,v)=>a+v, 0), 0,
    );
    return { ...r, byCategory: visible, total };
  }).sort((a,b) => b.total - a.total), [byDealer, excluded]);

  const salesmanRowsAdj = useMemo(() => bySalesman.rows.map(r => {
    const visible = Object.fromEntries(
      Object.entries(r.byCategory||{}).filter(([c]) => !excluded.has(c))
    );
    const total = Object.values(visible).reduce(
      (s, subs) => s + Object.values(subs).reduce((a,v)=>a+v, 0), 0,
    );
    return { ...r, byCategory: visible, total };
  }).sort((a,b) => b.total - a.total), [bySalesman, excluded]);

  // Group the (excluded-aware) rows by category for the Overall tab.
  const overallByCategory = useMemo(() => {
    const m = new Map();
    for (const r of filteredByCatRows) {
      if (!m.has(r.category)) m.set(r.category, { category:r.category, total:0, subs:[] });
      const g = m.get(r.category);
      g.total += r.qty;
      g.subs.push({ subCategory:r.subCategory, qty:r.qty });
    }
    return [...m.values()].sort((a,b) => b.total - a.total);
  }, [filteredByCatRows]);

  const filteredDealerRows   = dealerRowsAdj.filter(r   => !search || r.dealer.toLowerCase().includes(search.toLowerCase()));
  const filteredSalesmanRows = salesmanRowsAdj.filter(r => !search || r.salesman.toLowerCase().includes(search.toLowerCase()));

  // CSV export helpers
  const downloadCSV = (filename, headers, rows) => {
    const esc = v => `"${String(v ?? '').replace(/"/g,'""')}"`;
    const csv = '﻿' + [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  };

  const exportOverall = () => {
    downloadCSV(
      `Sales-by-Category_${month}.csv`,
      ['Category','Sub-Category','Quantity'],
      filteredByCatRows.map(r => [r.category, r.subCategory, r.qty]),
    );
  };
  const exportByDealer = () => {
    downloadCSV(
      `Sales-by-Dealer-Category_${month}.csv`,
      ['Dealer', ...categories, 'Total'],
      dealerRowsAdj.map(r => [
        r.dealer,
        ...categories.map(c => Object.values(r.byCategory?.[c]||{}).reduce((s,v)=>s+v,0)),
        r.total,
      ]),
    );
  };
  const exportBySalesman = () => {
    downloadCSV(
      `Sales-by-Salesman-Category_${month}.csv`,
      ['Salesman', ...categories, 'Total'],
      salesmanRowsAdj.map(r => [
        r.salesman,
        ...categories.map(c => Object.values(r.byCategory?.[c]||{}).reduce((s,v)=>s+v,0)),
        r.total,
      ]),
    );
  };

  return (
    <div className="fade" style={{display:'grid',gap:14}}>

      {/* ── Header bar ─────────────────────────────────────────── */}
      <div className="row">
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <BarChart3 size={18} color="var(--acc)"/>
          <div>
            <div style={{fontSize:18,fontWeight:700}}>Category-wise Sales</div>
            <div style={{fontSize:12,color:'var(--t3)'}}>Overall · Dealer-wise · Salesman-wise</div>
          </div>
        </div>
        <div className="spacer"/>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <Calendar size={14} color="var(--t3)"/>
          <select value={month} onChange={e=>setMonth(e.target.value)} className="inp" style={{minWidth:140}}>
            {months.length === 0 && <option value="">(no data yet)</option>}
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={loading?'spin':''}/>
        </button>
        {allCategories.length > 0 && (
          <CategoryFilter
            categories={allCategories.map(c => {
              const total = filteredByCatRows
                .concat(byCat.rows.filter(r => excluded.has(r.category)))
                .filter(r => r.category === c)
                .reduce((s,r) => s + (r.qty||0), 0);
              return { category: c, total };
            })}
            excluded={excluded}
            onToggle={toggleExcluded}
            onClear={clearExcluded}
            onSelectOnly={(cat)=>{
              const newExcl = new Set(allCategories.filter(c=>c!==cat));
              try { localStorage.setItem('stp_salescat_excluded', JSON.stringify([...newExcl])); } catch {}
              setExcluded(newExcl);
            }}
            label="Categories"
          />
        )}
        {isAdmin && month && byCat.grandTotal > 0 && (
          <button
            className="btn"
            onClick={handleDeleteMonth}
            title={`Delete all category sales for ${month} from DB`}
            style={{
              color:'#fca5a5',
              border:'1px solid rgba(248,113,113,0.4)',
              background:'rgba(248,113,113,0.08)',
              display:'inline-flex', alignItems:'center', gap:5,
            }}>
            <Trash2 size={12}/> Delete {month}
          </button>
        )}
      </div>

      {/* ── Total Sale KPI bar ─────────────────────────────────── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        <div className="card" style={{padding:14}}>
          <div style={{fontSize:11,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>
            Grand Total — {month||'—'} {excluded.size>0 && <span style={{color:'#fbbf24'}}>(excl. {excluded.size})</span>}
          </div>
          <div style={{fontSize:26,fontWeight:800,marginTop:4,color:'#34d399'}}>{fmt(filteredGrandTotal)}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>
            {excluded.size > 0
              ? <>total units (excluding <b>{[...excluded].join(', ')}</b>)</>
              : 'total units sold across all categories'}
          </div>
        </div>
        <div className="card" style={{padding:14}}>
          <div style={{fontSize:11,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>Categories</div>
          <div style={{fontSize:26,fontWeight:800,marginTop:4}}>{overallByCategory.length}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>categories included in totals</div>
        </div>
        <div className="card" style={{padding:14}}>
          <div style={{fontSize:11,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>Dealers Selling</div>
          <div style={{fontSize:26,fontWeight:800,marginTop:4}}>{dealerRowsAdj.filter(r=>r.total>0).length}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>distinct dealers in this month</div>
        </div>
        <div className="card" style={{padding:14}}>
          <div style={{fontSize:11,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>Salesmen Selling</div>
          <div style={{fontSize:26,fontWeight:800,marginTop:4}}>{salesmanRowsAdj.filter(r=>r.total>0).length}</div>
          <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>distinct salesmen with sales</div>
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────── */}
      <div className="tabs">
        <button className={`tab ${tab==='overall'?'active':''}`}  onClick={()=>setTab('overall')}>Overall</button>
        <button className={`tab ${tab==='dealer'?'active':''}`}   onClick={()=>setTab('dealer')}>Dealer-wise</button>
        <button className={`tab ${tab==='salesman'?'active':''}`} onClick={()=>setTab('salesman')}>Salesman-wise</button>
      </div>

      {/* ── OVERALL ────────────────────────────────────────────── */}
      {tab === 'overall' && (
        <>
          <div className="row" style={{marginBottom:4}}>
            <div className="spacer"/>
            <button className="btn" onClick={exportOverall} disabled={!byCat.rows.length}>
              <Download size={13}/> Export CSV
            </button>
          </div>
          {overallByCategory.length === 0 ? (
            <div className="card" style={{padding:30,textAlign:'center',color:'var(--t3)'}}>
              No sales data uploaded for {month}.
            </div>
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
              {overallByCategory.map(g => {
                const pct = filteredGrandTotal ? (g.total / filteredGrandTotal * 100) : 0;
                return (
                  <div key={g.category} className="card" style={{padding:14}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <div style={{fontSize:13,fontWeight:700,flex:1}}>{g.category}</div>
                      <div style={{fontSize:18,fontWeight:800,color:'#34d399'}}>{fmt(g.total)}</div>
                    </div>
                    <div style={{height:6,background:'var(--bg1)',borderRadius:3,overflow:'hidden',marginBottom:8}}>
                      <div style={{width:`${pct.toFixed(1)}%`,height:'100%',background:'linear-gradient(90deg,#6366f1,#34d399)'}}/>
                    </div>
                    <div style={{fontSize:11,color:'var(--t3)',marginBottom:6}}>
                      {pct.toFixed(1)}% of total
                    </div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {g.subs.sort((a,b)=>b.qty-a.qty).map(s => (
                        <span key={s.subCategory} style={{
                          fontSize:11,padding:'2px 8px',borderRadius:6,
                          background:'var(--bg1)',border:'1px solid var(--b1)',
                        }}>
                          {s.subCategory}: <b>{fmt(s.qty)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── DEALER-WISE PIVOT ─────────────────────────────────── */}
      {tab === 'dealer' && (
        <>
          <div className="row" style={{marginBottom:4}}>
            <input
              className="inp" placeholder="Search dealer…"
              value={search} onChange={e=>setSearch(e.target.value)}
              style={{maxWidth:260}}
            />
            <div className="spacer"/>
            <button className="btn" onClick={exportByDealer} disabled={!byDealer.rows.length}>
              <Download size={13}/> Export CSV
            </button>
          </div>
          <div className="card scroll" style={{padding:0,overflow:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th style={{position:'sticky',left:0,background:'var(--bg2)',zIndex:2}}>Dealer</th>
                  {categories.map(c => <th key={c} style={{textAlign:'right'}}>{c}</th>)}
                  <th style={{textAlign:'right',background:'rgba(52,211,153,.08)'}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredDealerRows.map(r => {
                  const clickable = !!onOpenDealer && dealerIdByName.has(String(r.dealer).toLowerCase().trim());
                  return (
                  <tr key={r.dealer} onClick={()=>clickable && openDealerByName(r.dealer)}
                      style={clickable ? { cursor:'pointer' } : undefined}
                      title={clickable ? 'Click to see this dealer\'s full category breakdown' : ''}>
                    <td style={{position:'sticky',left:0,background:'var(--bg2)',fontWeight:600,color:clickable?'var(--acc)':undefined,textDecoration:clickable?'underline dotted':'none'}}>{r.dealer}</td>
                    {categories.map(c => {
                      const v = Object.values(r.byCategory?.[c]||{}).reduce((s,v)=>s+v,0);
                      return <td key={c} style={{textAlign:'right',color:v?'var(--t2)':'var(--t3)'}}>{v? fmt(v) : '—'}</td>;
                    })}
                    <td style={{textAlign:'right',fontWeight:700,color:'#34d399'}}>{fmt(r.total)}</td>
                  </tr>
                  );
                })}
                {filteredDealerRows.length === 0 && (
                  <tr><td colSpan={categories.length + 2} style={{textAlign:'center',padding:18,color:'var(--t3)'}}>No data</td></tr>
                )}
              </tbody>
              {filteredDealerRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{position:'sticky',left:0,background:'var(--bg1)',fontWeight:800}}>Grand Total</td>
                    {categories.map(c => {
                      const sum = filteredDealerRows.reduce((s,r) => s + Object.values(r.byCategory?.[c]||{}).reduce((a,v)=>a+v,0), 0);
                      return <td key={c} style={{textAlign:'right',fontWeight:700,background:'var(--bg1)'}}>{sum?fmt(sum):'—'}</td>;
                    })}
                    <td style={{textAlign:'right',fontWeight:800,background:'rgba(52,211,153,.12)',color:'#34d399'}}>
                      {fmt(filteredDealerRows.reduce((s,r)=>s+r.total,0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {/* ── SALESMAN-WISE PIVOT ───────────────────────────────── */}
      {tab === 'salesman' && (
        <>
          <div className="row" style={{marginBottom:4}}>
            <input
              className="inp" placeholder="Search salesman…"
              value={search} onChange={e=>setSearch(e.target.value)}
              style={{maxWidth:260}}
            />
            <div className="spacer"/>
            <button className="btn" onClick={exportBySalesman} disabled={!bySalesman.rows.length}>
              <Download size={13}/> Export CSV
            </button>
          </div>
          <div className="card scroll" style={{padding:0,overflow:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th style={{position:'sticky',left:0,background:'var(--bg2)',zIndex:2}}>Salesman</th>
                  {categories.map(c => <th key={c} style={{textAlign:'right'}}>{c}</th>)}
                  <th style={{textAlign:'right',background:'rgba(52,211,153,.08)'}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredSalesmanRows.map(r => (
                  <tr key={r.salesman}>
                    <td style={{position:'sticky',left:0,background:'var(--bg2)',fontWeight:600}}>{r.salesman}</td>
                    {categories.map(c => {
                      const v = Object.values(r.byCategory?.[c]||{}).reduce((s,v)=>s+v,0);
                      return <td key={c} style={{textAlign:'right',color:v?'var(--t2)':'var(--t3)'}}>{v? fmt(v) : '—'}</td>;
                    })}
                    <td style={{textAlign:'right',fontWeight:700,color:'#34d399'}}>{fmt(r.total)}</td>
                  </tr>
                ))}
                {filteredSalesmanRows.length === 0 && (
                  <tr><td colSpan={categories.length + 2} style={{textAlign:'center',padding:18,color:'var(--t3)'}}>No data</td></tr>
                )}
              </tbody>
              {filteredSalesmanRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{position:'sticky',left:0,background:'var(--bg1)',fontWeight:800}}>Grand Total</td>
                    {categories.map(c => {
                      const sum = filteredSalesmanRows.reduce((s,r) => s + Object.values(r.byCategory?.[c]||{}).reduce((a,v)=>a+v,0), 0);
                      return <td key={c} style={{textAlign:'right',fontWeight:700,background:'var(--bg1)'}}>{sum?fmt(sum):'—'}</td>;
                    })}
                    <td style={{textAlign:'right',fontWeight:800,background:'rgba(52,211,153,.12)',color:'#34d399'}}>
                      {fmt(filteredSalesmanRows.reduce((s,r)=>s+r.total,0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default SalesByCategory;
