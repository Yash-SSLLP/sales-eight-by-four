import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';

/**
 * CategoryFilter — single compact button + dropdown with one checkbox per
 * category. Replaces the chip rows used previously.
 *
 * Props
 *   categories    — [{ category, total }] or [string], in the order to display
 *   excluded      — Set<string> of currently-excluded category names
 *   onToggle(cat) — flip include/exclude for one category
 *   onClear()     — clear all exclusions (include all)
 *   onSelectOnly(cat) — convenience: keep only this category visible
 *   label         — button label prefix (defaults to "Categories")
 *   compact       — small button variant
 */
const fmt = n => Number(n||0).toLocaleString('en-IN');

const CategoryFilter = ({
  categories = [],
  excluded   = new Set(),
  onToggle,
  onClear,
  onSelectOnly,
  label = 'Categories',
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Normalise input: accept [{category,total}] or [string]
  const items = (categories || []).map(c =>
    typeof c === 'string' ? { category: c, total: 0 } : c
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const totalCount    = items.length;
  const includedCount = items.filter(i => !excluded.has(i.category)).length;
  const isAll         = excluded.size === 0;
  const summary       = isAll
    ? `All ${totalCount}`
    : `${includedCount} of ${totalCount}${excluded.size === 1 ? `  ·  excl. ${[...excluded][0]}` : ''}`;

  return (
    <div ref={ref} style={{position:'relative', display:'inline-block'}}>
      <button
        type="button"
        onClick={()=>setOpen(o=>!o)}
        title="Include or exclude categories from totals"
        style={{
          display:'inline-flex', alignItems:'center', gap:6,
          padding: compact ? '5px 10px' : '6px 12px',
          borderRadius:8,
          background: excluded.size ? 'rgba(251,191,36,.10)' : 'var(--bg2)',
          border:'1px solid '+(excluded.size ? 'rgba(251,191,36,.5)' : 'var(--b2)'),
          color: excluded.size ? '#fbbf24' : 'var(--t2)',
          fontSize: compact ? 11 : 12, fontWeight:600,
          cursor:'pointer', whiteSpace:'nowrap',
        }}>
        <Filter size={compact ? 11 : 12}/>
        <span>{label}: {summary}</span>
        <ChevronDown size={compact ? 11 : 13} style={{transform: open ? 'rotate(180deg)' : 'none', transition:'transform .12s'}}/>
      </button>

      {open && (
        <div
          style={{
            position:'absolute', top:'calc(100% + 6px)', right:0,
            minWidth:280, maxWidth:380, maxHeight:'60vh', overflowY:'auto',
            background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:10,
            boxShadow:'0 12px 32px rgba(0,0,0,0.45)', zIndex:200,
            padding:8,
          }}
        >
          {/* Header — Select all / Clear */}
          <div style={{
            display:'flex', alignItems:'center', gap:8,
            padding:'6px 8px',borderBottom:'1px solid var(--b1)', marginBottom:6,
          }}>
            <span style={{fontSize:10,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.08em'}}>Include categories</span>
            <div style={{flex:1}}/>
            <button
              type="button"
              onClick={()=>{ if(onClear) onClear(); }}
              disabled={isAll}
              style={{
                fontSize:11, padding:'3px 9px', borderRadius:6,
                border:'1px solid var(--b2)', background:'transparent',
                color: isAll ? 'var(--t3)' : 'var(--acc)',
                cursor: isAll ? 'default' : 'pointer',
                opacity: isAll ? 0.55 : 1,
              }}>
              Select all
            </button>
          </div>

          {/* Rows */}
          {items.length === 0 ? (
            <div style={{fontSize:11,color:'var(--t3)',padding:14,textAlign:'center'}}>
              No categories yet for this month.
            </div>
          ) : items.map(({ category, total }) => {
            const off = excluded.has(category);
            return (
              <div key={category} style={{
                display:'flex',alignItems:'center',gap:8,
                padding:'6px 8px',borderRadius:6,
                background: off ? 'transparent' : 'rgba(99,102,241,.06)',
              }}>
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={()=>onToggle && onToggle(category)}
                  style={{cursor:'pointer',flexShrink:0}}
                />
                <span
                  onClick={()=>onToggle && onToggle(category)}
                  style={{
                    flex:1, fontSize:12, fontWeight:600,
                    color: off ? 'var(--t3)' : 'var(--t1)',
                    cursor:'pointer',
                    textDecoration: off ? 'line-through' : 'none',
                  }}>
                  {category}
                </span>
                {total > 0 && (
                  <span style={{fontSize:11,color:'var(--t3)',marginRight:6}}>
                    {fmt(total)}
                  </span>
                )}
                {onSelectOnly && items.length > 1 && (
                  <button
                    type="button"
                    onClick={()=>onSelectOnly(category)}
                    title={`Show only ${category}`}
                    style={{
                      fontSize:10,padding:'2px 7px',borderRadius:5,
                      border:'1px solid var(--b2)',background:'transparent',
                      color:'var(--t3)',cursor:'pointer',
                    }}>only</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CategoryFilter;
