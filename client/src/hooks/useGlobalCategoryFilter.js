import { useEffect, useState, useCallback } from 'react';

/**
 * useGlobalCategoryFilter — single source of truth for "which categories are
 * excluded from totals" across the whole app.
 *
 * Backed by localStorage (`stp_global_cat_excluded`) so the choice survives
 * reloads. A custom DOM event keeps every consumer in sync within the page —
 * toggling LINER off in the Admin Panel header instantly hides LINER in the
 * Overview KPI, the Sales by Category page, the Dealer Modal's Categories
 * tab, and the per-category Drill chart.
 *
 * Returns:
 *   excluded  : Set<string>    — categories currently OFF
 *   toggle(c) : flip include/exclude for one category
 *   set(set)  : replace the entire excluded set
 *   clear()   : turn everything ON (no exclusions)
 *   isOff(c)  : convenience boolean check
 */

const STORAGE_KEY = 'stp_global_cat_excluded';
const EVENT_NAME  = 'stp:global-cat-filter';

function read() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch { return new Set(); }
}

function write(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch {}
  try { window.dispatchEvent(new CustomEvent(EVENT_NAME)); } catch {}
}

export function useGlobalCategoryFilter() {
  const [excluded, setExcluded] = useState(() => read());

  useEffect(() => {
    const onChange = () => setExcluded(read());
    window.addEventListener(EVENT_NAME, onChange);
    // also react to changes from other tabs / windows
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) onChange();
    });
    return () => {
      window.removeEventListener(EVENT_NAME, onChange);
      // (no specific remove for the inline storage handler — listed for symmetry)
    };
  }, []);

  const toggle = useCallback((cat) => {
    const next = new Set(read());
    next.has(cat) ? next.delete(cat) : next.add(cat);
    write(next);
    setExcluded(next);
  }, []);

  const set = useCallback((nextSet) => {
    const s = nextSet instanceof Set ? nextSet : new Set(nextSet || []);
    write(s);
    setExcluded(s);
  }, []);

  const clear = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    try { window.dispatchEvent(new CustomEvent(EVENT_NAME)); } catch {}
    setExcluded(new Set());
  }, []);

  const isOff = useCallback((cat) => excluded.has(cat), [excluded]);

  return { excluded, toggle, set, clear, isOff };
}
