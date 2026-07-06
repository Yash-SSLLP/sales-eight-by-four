import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { RefreshCw, Package, Search } from 'lucide-react';

// Shows the samples a party (dealer) already holds, loaded from the
// "Party Name | Screen Name | Total" sample-master upload. Read-only:
// the data is the uploaded master snapshot, not an editable checklist.
export default function SamplesTab({ dealer }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [q,       setQ]       = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [dealer?.id]);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if(dealer?.id)   params.set('dealerId', dealer.id);
      if(dealer?.code) params.set('code', dealer.code);
      if(dealer?.name) params.set('name', dealer.name);
      const res = await api.getPartySamples(params.toString());
      setData(res || null);
    } catch(e) { console.warn('Party samples load failed:', e.message); setData(null); }
    setLoading(false);
  };

  if(loading) return (
    <div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>
      <RefreshCw size={20} style={{animation:'spin .8s linear infinite',marginBottom:8}}/>
      <div style={{fontSize:12}}>Loading samples...</div>
    </div>
  );

  const samples = data?.samples || [];

  if(samples.length === 0) return (
    <div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>
      <Package size={32} style={{marginBottom:10,opacity:.3}}/>
      <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>No samples recorded for this party</div>
      <div style={{fontSize:11,maxWidth:260,margin:'0 auto'}}>
        {dealer?.code
          ? `Party code ${dealer.code} has no rows in the sample master.`
          : 'This party isn’t linked to a code yet. Admin Panel → 📦 Sample Master → upload the master Excel to match it.'}
      </div>
    </div>
  );

  const filtered = q.trim()
    ? samples.filter(s => s.sampleName.toLowerCase().includes(q.toLowerCase()))
    : samples;

  return (
    <div>
      {/* Stats row */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
        {[
          {l:'Samples',   v:data.count,    c:'var(--acc)'},
          {l:'Total Qty', v:data.totalQty, c:'#34d399'},
          {l:'Code',      v:data.code||'—',c:'#fbbf24', small:true},
        ].map(k=>(
          <div key={k.l} className="stat-card">
            <div style={{fontSize:9,color:'var(--t3)',textTransform:'uppercase',marginBottom:4}}>{k.l}</div>
            <div style={{fontSize:k.small?14:22,fontWeight:700,color:k.c,wordBreak:'break-all'}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{position:'relative',marginBottom:12}}>
        <Search size={13} style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'var(--t3)'}}/>
        <input
          className="inp"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search samples..."
          style={{width:'100%',paddingLeft:30}}
        />
      </div>

      {/* Sample list */}
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {filtered.map((s, i) => (
          <div key={s.id} style={{
            display:'flex', alignItems:'center', gap:10,
            padding:'10px 12px', borderRadius:8,
            background:'var(--bg2)',
            border:'1px solid var(--b2)',
          }}>
            <span style={{fontSize:11,color:'var(--t3)',minWidth:22,textAlign:'right'}}>{i+1}</span>
            <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:500,color:'var(--t1)'}}>{s.sampleName}</div>
            <span style={{
              fontSize:11, fontWeight:600, padding:'2px 10px', borderRadius:20, flexShrink:0,
              background:'rgba(52,211,153,0.12)', color:'#34d399',
            }}>×{s.qty}</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{textAlign:'center',padding:20,fontSize:12,color:'var(--t3)'}}>
            No samples match “{q}”.
          </div>
        )}
      </div>
    </div>
  );
}
