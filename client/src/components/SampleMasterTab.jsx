import React, { useState, useRef } from 'react';
import { api } from '../api';
import { Upload, RefreshCw, Package } from 'lucide-react';

// Admin: upload the party-sample master — a "Party Name | Screen Name | Total"
// Excel dump of which party already holds which samples. Each upload REPLACES
// the whole master (full snapshot) and back-fills dealer party codes by name.
export default function SampleMasterTab() {
  const [uploading, setUploading] = useState(false);
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState('');
  const fileRef = useRef();

  const handleUpload = async (file) => {
    if(!file) return;
    setUploading(true); setErr(''); setResult(null);
    try {
      const res = await api.uploadPartySamples(file);
      setResult(res);
    } catch(e) { setErr(e.message); }
    setUploading(false);
  };

  return (
    <div>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>Sample Master</div>
        <div style={{fontSize:12,color:'var(--t3)',marginBottom:12}}>
          Upload the party-samples Excel. Opening any party then shows the samples it holds.
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}}
            onChange={e=>{if(e.target.files[0])handleUpload(e.target.files[0]);e.target.value='';}}/>
          <button onClick={()=>fileRef.current?.click()} disabled={uploading} className="btnp"
            style={{display:'flex',alignItems:'center',gap:6}}>
            {uploading
              ? <RefreshCw size={13} style={{animation:'spin .7s linear infinite'}}/>
              : <Upload size={13}/>}
            {uploading?'Uploading...':'Upload Master Excel'}
          </button>
          {err && <span style={{fontSize:11,color:'#f87171'}}>Error: {err}</span>}
        </div>
      </div>

      {/* Expected format */}
      <div style={{background:'var(--bg2)',borderRadius:8,padding:12,marginBottom:14,fontSize:11,color:'var(--t3)'}}>
        <strong style={{color:'var(--t2)'}}>Excel format (first sheet):</strong>
        <div style={{fontFamily:'monospace',marginTop:6,background:'var(--bg1)',padding:8,borderRadius:6,overflowX:'auto',whiteSpace:'nowrap'}}>
          Party Name&nbsp;&nbsp;|&nbsp;&nbsp;Screen Name&nbsp;&nbsp;|&nbsp;&nbsp;Total<br/>
          A.V. INTERIOR SOLUTIONS-SSL16566&nbsp;&nbsp;|&nbsp;&nbsp;COLOUR WORLD SAMPLE SET&nbsp;&nbsp;|&nbsp;&nbsp;1<br/>
          A P TRADERS-SSL15183&nbsp;&nbsp;|&nbsp;&nbsp;FOLDER OVERLAY ENGRAVED&nbsp;&nbsp;|&nbsp;&nbsp;1
        </div>
        <div style={{marginTop:8,lineHeight:1.5}}>
          The <strong>SSLxxxxx</strong> code in the party name is the party ID — it’s stamped onto the
          matching dealer so samples line up. Each upload <strong>replaces</strong> the entire master.
        </div>
      </div>

      {/* Upload result */}
      {result && (
        <>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
            {[
              {l:'Rows',            v:result.rows,           c:'var(--acc)'},
              {l:'Samples loaded',  v:result.inserted,       c:'var(--acc)'},
              {l:'Parties',         v:result.parties,        c:'#fbbf24'},
              {l:'Parties matched', v:result.partiesMatched, c:'#34d399'},
              {l:'Dealers stamped', v:result.dealersMatched, c:'#34d399'},
              {l:'Unmatched',       v:result.unmatchedCount, c:result.unmatchedCount>0?'#f87171':'var(--t3)'},
            ].map(k=>(
              <div key={k.l} style={{background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.2)',
                borderRadius:8,padding:'8px 14px',textAlign:'center',minWidth:90}}>
                <div style={{fontSize:10,color:'var(--t3)',marginBottom:2}}>{k.l}</div>
                <div style={{fontSize:18,fontWeight:700,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>

          {result.unmatchedSample?.length > 0 && (
            <div className="card" style={{padding:12,marginBottom:14,border:'1px solid rgba(248,113,113,0.25)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'#f87171',marginBottom:6}}>
                Parties with no matching dealer ({result.unmatchedCount})
              </div>
              <div style={{fontSize:11,color:'var(--t3)',marginBottom:8}}>
                Their samples are stored but won’t show until a dealer with the same name exists.
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:200,overflowY:'auto'}}>
                {result.unmatchedSample.map((p,i)=>(
                  <div key={i} style={{fontSize:11,color:'var(--t2)',fontFamily:'monospace'}}>{p}</div>
                ))}
                {result.unmatchedCount > result.unmatchedSample.length && (
                  <div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>
                    …and {result.unmatchedCount - result.unmatchedSample.length} more
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!result && !uploading && (
        <div style={{textAlign:'center',padding:40,color:'var(--t3)'}}>
          <Package size={32} style={{marginBottom:10,opacity:.3}}/>
          <div style={{fontSize:13}}>Upload the party-samples Excel to load the master.</div>
        </div>
      )}
    </div>
  );
}
