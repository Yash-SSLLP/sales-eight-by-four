import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useGlobalCategoryFilter } from './useGlobalCategoryFilter';

/**
 * useFilteredDealers — given the raw dealers array + the active month label
 * (e.g. "Jun-26"), return a dealers array whose `.months[currentMonthIdx]` is
 * adjusted by subtracting any categories the user has globally excluded.
 *
 * Drives EVERY page that reads `dealer.months[currentMonthIdx]` (Overview's
 * status lists, All Dealers totals, Monthly Trend, Compare, MapView,
 * Reports, etc.). When the filter is empty, returns the raw array unchanged
 * (cheap pass-through, no extra renders).
 *
 * The hook fetches `/api/sales/by-dealer?month=YYYY-MM` once when the month
 * changes and caches the per-dealer category breakdown.
 */

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function moToYM(lbl) {
  if (!lbl) return '';
  const m = /^([A-Za-z]{3,})-(\d{2,4})$/.exec(String(lbl).trim());
  if (!m) return '';
  const mi = MONTHS.indexOf(m[1].slice(0,3).toLowerCase());
  if (mi < 0) return '';
  let y = +m[2]; if (y < 100) y += 2000;
  return `${y}-${String(mi+1).padStart(2,'0')}`;
}

export function useFilteredDealers(dealers, currentMonthIdx, monthLabel) {
  const { excluded } = useGlobalCategoryFilter();

  // Fetch the dealer × category breakdown for the active month
  const [dealerCatMap, setDealerCatMap] = useState(new Map());
  useEffect(() => {
    if (!monthLabel) { setDealerCatMap(new Map()); return; }
    const ym = moToYM(monthLabel);
    if (!ym) { setDealerCatMap(new Map()); return; }
    let cancelled = false;
    api.salesByDealer({ month: ym })
      .then(r => {
        if (cancelled) return;
        const map = new Map();
        for (const row of (r.rows || [])) {
          const perCat = {};
          for (const [cat, subMap] of Object.entries(row.byCategory || {})) {
            perCat[cat] = Object.values(subMap).reduce((s,v) => s + (v||0), 0);
          }
          map.set(String(row.dealer || '').toLowerCase().trim(), perCat);
        }
        setDealerCatMap(map);
      })
      .catch(() => { if (!cancelled) setDealerCatMap(new Map()); });
    return () => { cancelled = true; };
  }, [monthLabel]);

  // No filter → pass through (cheap, stable reference)
  return useMemo(() => {
    if (!excluded || excluded.size === 0) return dealers;
    if (!Array.isArray(dealers)) return dealers;
    if (currentMonthIdx == null || currentMonthIdx < 0) return dealers;
    return dealers.map(d => {
      const perCat = dealerCatMap.get(String(d.name||'').toLowerCase().trim());
      if (!perCat) return d;
      let exclSum = 0;
      for (const c of excluded) exclSum += (perCat[c] || 0);
      if (!exclSum) return d;
      const base = Number(d.months?.[currentMonthIdx]) || 0;
      const adj = Math.max(0, base - exclSum);
      const nextMonths = Array.isArray(d.months) ? d.months.slice() : [];
      nextMonths[currentMonthIdx] = adj;
      return { ...d, months: nextMonths };
    });
  }, [dealers, excluded, dealerCatMap, currentMonthIdx]);
}
