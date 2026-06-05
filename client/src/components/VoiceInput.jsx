// Voice-to-text wrapper. Renders any <input> or <textarea> as a child with
// a microphone button overlaid in the top-right corner. Click the mic →
// browser starts SpeechRecognition → recognised text gets APPENDED to the
// current value (preserving anything the user already typed).
//
// Works in:
//   * Chrome / Edge (desktop + Android)
//   * Safari iOS (uses webkitSpeechRecognition)
//   * Capacitor APK WebView (since it's Chrome-based)
//
// Graceful degradation: if the browser has no SpeechRecognition API, the
// mic button is hidden and the wrapper falls back to a plain textarea/input.

import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;
const IS_NATIVE = !!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform && window.Capacitor.isNativePlatform());
// On native (APK) we use the Capacitor plugin which goes through the device's
// built-in speech engine (Google Speech / vendor). On web we use the standard
// SpeechRecognition API.
const SUPPORTED = !!SR || IS_NATIVE;

// Persist the chosen language in localStorage so the user only picks it once.
const LANG_KEY = 'stp_voice_lang';
const LANGUAGES = [
  { code:'en-IN', label:'English (India)' },
  { code:'en-US', label:'English (US)' },
  { code:'hi-IN', label:'हिन्दी (Hindi)' },
  { code:'mr-IN', label:'मराठी (Marathi)' },
  { code:'ta-IN', label:'தமிழ் (Tamil)' },
  { code:'te-IN', label:'తెలుగు (Telugu)' },
  { code:'gu-IN', label:'ગુજરાતી (Gujarati)' },
  { code:'kn-IN', label:'ಕನ್ನಡ (Kannada)' },
  { code:'ml-IN', label:'മലയാളം (Malayalam)' },
  { code:'pa-IN', label:'ਪੰਜਾਬੀ (Punjabi)' },
  { code:'bn-IN', label:'বাংলা (Bengali)' },
];

function useVoice({ lang, onResult }){
  const recRef = useRef(null);              // web SpeechRecognition instance
  const nativeListenerRef = useRef(null);   // capacitor plugin listener handle
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  // Always-fresh callback ref so the recognition handler uses the latest one
  const onResultRef = useRef(onResult);
  useEffect(()=>{ onResultRef.current = onResult; }, [onResult]);

  // ── Native (Capacitor APK) path ──────────────────────────────────────
  const startNative = async () => {
    try {
      const mod = await import('@capacitor-community/speech-recognition');
      const SR_PLUGIN = mod.SpeechRecognition;
      // Permission flow — popup once, then granted
      try { await SR_PLUGIN.requestPermissions(); } catch{}
      const { available } = await SR_PLUGIN.available();
      if(!available){
        setError('Speech recognition not available on this device');
        return false;
      }
      // Cleanup any previous listener
      try { await SR_PLUGIN.removeAllListeners(); } catch{}
      // Both partial and final results route here; the plugin gives the LAST
      // match for partial chunks, and the user-friendly "best" for the final.
      // We append only when the segment finalises by tracking a known marker.
      let lastFinal = '';
      const handle = await SR_PLUGIN.addListener('partialResults', (data) => {
        const matches = data?.matches || [];
        if(matches.length){
          // Replace last partial with the new best guess (no double-append)
          const text = matches[0] || '';
          // We can't easily distinguish partial vs final on Android — instead
          // wait for the listener to stop and finalize then. We DO commit if
          // text grew significantly between callbacks.
          if(text && text !== lastFinal){
            lastFinal = text;
          }
        }
      });
      nativeListenerRef.current = { handle, getFinal:()=>lastFinal };
      await SR_PLUGIN.start({
        language: lang || 'en-IN',
        maxResults: 1,
        prompt: '',
        partialResults: true,
        popup: false,
      });
      setRecording(true);
      setError('');
      return true;
    } catch(e){
      setError(e?.message || 'mic error');
      setRecording(false);
      return false;
    }
  };
  const stopNative = async () => {
    try {
      const mod = await import('@capacitor-community/speech-recognition');
      const SR_PLUGIN = mod.SpeechRecognition;
      await SR_PLUGIN.stop();
      // Commit whatever we captured
      const text = nativeListenerRef.current?.getFinal?.() || '';
      if(text && onResultRef.current) onResultRef.current(text);
      try { await SR_PLUGIN.removeAllListeners(); } catch{}
    } catch(e){
      // ignored — best-effort stop
    } finally {
      nativeListenerRef.current = null;
      setRecording(false);
    }
  };

  // ── Web (browser) path ───────────────────────────────────────────────
  const startWeb = () => {
    if(!SR){ setError('Speech recognition not supported in this browser'); return false; }
    if(recRef.current){ try{ recRef.current.stop(); }catch{} }
    const rec = new SR();
    rec.lang = lang || 'en-IN';
    rec.continuous     = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      let txt = '';
      for(let i = ev.resultIndex; i < ev.results.length; i++){
        if(ev.results[i].isFinal) txt += ev.results[i][0].transcript + ' ';
      }
      if(txt && onResultRef.current) onResultRef.current(txt.trim());
    };
    rec.onerror = (e) => { setError(e.error || 'mic error'); setRecording(false); };
    rec.onend = () => setRecording(false);
    try {
      rec.start();
      recRef.current = rec;
      setRecording(true);
      setError('');
      return true;
    } catch(e){ setError(e.message); return false; }
  };
  const stopWeb = () => {
    if(recRef.current){ try{ recRef.current.stop(); }catch{} }
    setRecording(false);
  };

  const start = () => IS_NATIVE ? startNative() : startWeb();
  const stop  = () => IS_NATIVE ? stopNative()  : stopWeb();

  // Stop on unmount
  useEffect(()=>()=>{
    try{ recRef.current?.stop(); }catch{}
    if(IS_NATIVE){ stopNative().catch(()=>{}); }
  }, []);
  return { recording, error, start, stop };
}

// Animated 4-bar waveform shown while recording. Each bar bounces at its own
// pace so it actually looks "alive" instead of just a static red blob.
function WaveBars(){
  const bars = [0, 0.15, 0.3, 0.45];
  return (
    <span style={{display:'inline-flex', alignItems:'center', gap:2, height:14}}>
      {bars.map((delay, i) => (
        <span key={i} style={{
          width:2.5, height:'100%', background:'#fff',
          borderRadius:1,
          animation: 'stpVoiceBar 0.9s ease-in-out infinite',
          animationDelay: delay + 's',
          transformOrigin:'center',
        }}/>
      ))}
    </span>
  );
}

// Inline keyframes — self-contained so we don't depend on Styles.jsx
function Keyframes(){
  return (
    <style>{`
      @keyframes stpVoiceBar {
        0%,100% { transform: scaleY(0.35); }
        50%     { transform: scaleY(1);    }
      }
      @keyframes stpVoicePulse {
        0%   { box-shadow: 0 0 0 0   rgba(220,38,38,0.55); }
        70%  { box-shadow: 0 0 0 10px rgba(220,38,38,0);    }
        100% { box-shadow: 0 0 0 0   rgba(220,38,38,0);    }
      }
    `}</style>
  );
}

// Shared rendering: textarea or input + mic button overlay
function VoiceField({ as='textarea', value, onChange, placeholder='', className='inp', rows=3, style, ...rest }){
  const [lang, setLang] = useState(()=>{
    try { return localStorage.getItem(LANG_KEY) || 'en-IN'; } catch { return 'en-IN'; }
  });
  const [showLang, setShowLang] = useState(false);

  const appendTranscript = (t) => {
    if(!t) return;
    const sep = !value || /[\s\n]$/.test(value) ? '' : ' ';
    const next = (value || '') + sep + t;
    onChange?.(next);
  };
  const { recording, error, start, stop } = useVoice({ lang, onResult: appendTranscript });

  const onMicClick = () => {
    if(recording) stop();
    else start();
  };
  const pickLang = (code) => {
    setLang(code);
    try { localStorage.setItem(LANG_KEY, code); } catch{}
    setShowLang(false);
  };

  // Default heights — generous so users have room to type / dictate without
  // the box feeling cramped. Caller can still pass `style.minHeight`.
  const DEFAULT_MIN_H = as === 'input' ? 44 : 110;
  const sharedStyle = {
    paddingRight: 14,
    paddingBottom: as === 'input' ? undefined : 56, // room for the mic pill at bottom-right
    minHeight: DEFAULT_MIN_H,
    fontSize: 13,
    lineHeight: 1.5,
    ...style,
  };
  const Tag = as === 'input' ? 'input' : 'textarea';
  const inputProps = as === 'input'
    ? { value: value||'', onChange:(e)=>onChange?.(e.target.value), placeholder, className, style: sharedStyle, ...rest }
    : { value: value||'', onChange:(e)=>onChange?.(e.target.value), placeholder, className, rows, style:{ resize:'vertical', fontFamily:'inherit', ...sharedStyle }, ...rest };

  return (
    <div style={{position:'relative'}}>
      <Keyframes/>
      <Tag {...inputProps}/>

      {/* Voice controls in the bottom-right corner of the field */}
      {SUPPORTED && (
        <div style={{
          position:'absolute',
          bottom: as === 'input' ? '50%' : 10,
          right: 10,
          transform: as === 'input' ? 'translateY(50%)' : 'none',
          display:'flex', alignItems:'center', gap:6,
        }}>
          {/* Language chip — click to switch */}
          <div style={{position:'relative'}}>
            <button type="button"
              onClick={()=>setShowLang(s=>!s)}
              title="Voice input language"
              style={{
                fontSize:9, padding:'4px 7px', borderRadius:5,
                background:'var(--bg1)', border:'1px solid var(--b2)',
                color:'var(--t2)', cursor:'pointer', fontWeight:700, letterSpacing:'.04em',
              }}>{lang.toUpperCase()}</button>
            {showLang && (
              <div style={{
                position:'absolute', bottom:'calc(100% + 4px)', right:0, zIndex:50,
                background:'var(--bg2)', border:'1px solid var(--b2)', borderRadius:6,
                minWidth:170, maxHeight:240, overflowY:'auto',
                boxShadow:'0 6px 20px rgba(0,0,0,0.45)', padding:4,
              }}>
                {LANGUAGES.map(L => (
                  <div key={L.code} onClick={()=>pickLang(L.code)}
                    style={{
                      padding:'6px 9px', fontSize:11, cursor:'pointer', borderRadius:4,
                      background: L.code===lang ? 'var(--bg1)' : 'transparent',
                      color: L.code===lang ? 'var(--acc)' : 'var(--t2)',
                      fontWeight: L.code===lang ? 700 : 400,
                    }}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg1)'}
                    onMouseLeave={e=>{ if(L.code!==lang) e.currentTarget.style.background='transparent'; }}>
                    {L.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Icon-only mic button. While recording shows the animated bars;
              while idle shows just the mic icon. No label text. */}
          <button type="button"
            onClick={onMicClick}
            title={recording ? 'Tap to stop recording' : 'Tap and speak'}
            aria-label={recording ? 'Stop recording' : 'Start voice input'}
            style={{
              width: 36, height: 36,
              display:'inline-flex', alignItems:'center', justifyContent:'center',
              borderRadius: '50%',
              padding: 0,
              cursor:'pointer',
              transition:'all .15s',
              background: recording ? '#dc2626' : 'var(--acc)',
              color:'#fff',
              border: '1px solid ' + (recording ? '#b91c1c' : 'transparent'),
              boxShadow: recording ? '0 0 0 0 rgba(220,38,38,0.55)' : '0 2px 8px rgba(0,0,0,0.25)',
              animation: recording ? 'stpVoicePulse 1.4s ease-out infinite' : 'none',
            }}>
            {recording ? <WaveBars/> : <Mic size={16}/>}
          </button>
        </div>
      )}

      {error && (
        <div style={{fontSize:10, color:'#fbbf24', marginTop:3}}>{error}</div>
      )}
    </div>
  );
}

export function VoiceTextarea(props){ return <VoiceField as="textarea" {...props}/>; }
export function VoiceInput(props){    return <VoiceField as="input"    {...props}/>; }
export const VOICE_SUPPORTED = SUPPORTED;
