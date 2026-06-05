import React, { useState } from 'react';
import { X, UserPlus, LogIn, KeyRound, Link as LinkIcon, Trash2, Shield, ShieldCheck } from 'lucide-react';
import { Avatar } from './UI';
import { api } from '../api';
import { notify, confirmDialog } from './Toast';

// Note: `setUsers` updates the client-side users map; `onLoginAs(token, user, impersonatedBy?)`
// is used by the superadmin "Login as" feature to swap the active JWT.
const UserManagement = ({ users, setUsers, currentUser, onClose, onLoginAs, onUsersChanged }) => {
  const [name,    setName]    = useState('');
  const [id,      setId]      = useState('');
  const [pass,    setPass]    = useState('');
  const [role,    setRole]    = useState('salesman');
  const [url,     setUrl]     = useState('');
  const [color,   setColor]   = useState('#818cf8');
  const [busy,    setBusy]    = useState(false);
  const [msg,     setMsg]     = useState(null);

  const colors = ['#818cf8','#34d399','#f472b6','#fb923c','#fbbf24','#22d3ee','#e879f9','#a78bfa','#f87171','#4ade80'];

  const isSuperAdmin = currentUser?.role === 'superadmin';
  const isAdmin      = currentUser?.role === 'admin';

  const flash = (type, text, ms = 3000) => { setMsg({type, text}); setTimeout(()=>setMsg(null), ms); };

  // ── Create user (calls server) ──────────────────────────────────────────
  const create = async () => {
    const idC = id.trim().toLowerCase().replace(/\s+/g, '_');
    if(!name || !idC || !pass){ flash('error','Name, username and password required'); return; }
    if(pass.length < 4){ flash('error','Password min 4 characters'); return; }
    if(users[idC]){ flash('error','Username already exists'); return; }
    if(!isSuperAdmin && (role === 'admin' || role === 'superadmin')){
      flash('error', 'Only superadmin can create admins or superadmins');
      return;
    }
    setBusy(true);
    try {
      const ini = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
      const newUser = await api.createUser({ id: idC, name, pass, role, color, ini });
      // Optimistically update local cache for instant feedback…
      setUsers({ ...users, [idC]: { id: idC, name, pass, role, color, ini, url: url.trim() || null } });
      // …then trigger a server-side refresh so the new user appears with all
      // server-side fields and persists across page reloads + other devices.
      onUsersChanged?.();
      setName(''); setId(''); setPass(''); setUrl(''); setRole('salesman');
      flash('success', 'Created ' + name + ' (' + idC + '). Password: ' + pass);
    } catch(e){
      flash('error', 'Create failed: ' + e.message);
    } finally { setBusy(false); }
  };

  // ── Edit a user (password, URL) ─────────────────────────────────────────
  const reset = async (uid) => {
    const np = prompt('New password for ' + users[uid]?.name + ':');
    if(!np || np.length < 4){ if(np !== null) notify.error('Password must be at least 4 characters'); return; }
    try {
      await api.updateUser(uid, { pass: np });
      setUsers({ ...users, [uid]: { ...users[uid], pass: np } });
      onUsersChanged?.();
      flash('success', 'Password updated for ' + users[uid]?.name);
    } catch(e){ flash('error', 'Reset failed: ' + e.message); }
  };

  const editUrl = async (uid) => {
    const np = prompt('Sheet CSV URL for ' + users[uid]?.name + ' (blank to remove):', users[uid]?.url || '');
    if(np === null) return;
    try {
      await api.updateUser(uid, { url: np.trim() || null });
      setUsers({ ...users, [uid]: { ...users[uid], url: np.trim() || null } });
      onUsersChanged?.();
      flash('success', 'Sheet URL updated');
    } catch(e){ flash('error', 'Update failed: ' + e.message); }
  };

  // ── Assign / change leave approver ──────────────────────────────────────
  const editApprover = async (uid) => {
    const current = users[uid]?.approver || '';
    const list = Object.values(users)
      .filter(u => u.id !== uid && (u.role === 'admin' || u.role === 'superadmin'))
      .map(u => `${u.id} — ${u.name}`);
    const ap = prompt(
      'Leave / visit approver for ' + (users[uid]?.name || uid) + ' — type the user id (blank = any admin can approve):\n\nAvailable:\n' + list.join('\n'),
      current,
    );
    if(ap === null) return;
    const trimmed = ap.trim();
    if(trimmed && !users[trimmed]){ flash('error', 'No user with id "' + trimmed + '"'); return; }
    try {
      await api.updateUser(uid, { approver: trimmed });
      setUsers({ ...users, [uid]: { ...users[uid], approver: trimmed } });
      onUsersChanged?.();
      flash('success', trimmed ? ('Approver set to ' + (users[trimmed]?.name || trimmed)) : 'Approver cleared');
    } catch(e){ flash('error', 'Update failed: ' + e.message); }
  };

  // ── Remove user ─────────────────────────────────────────────────────────
  const remove = async (uid) => {
    if(uid === currentUser?.id){ flash('error', "Can't delete yourself"); return; }
    const okRm = await confirmDialog({ title:'Remove ' + (users[uid]?.name || 'user') + '?', message:'This cannot be undone.', confirmText:'Remove', danger:true });
    if(!okRm) return;
    try {
      await api.deleteUser(uid);
      const u = { ...users }; delete u[uid]; setUsers(u);
      onUsersChanged?.();
      flash('success', 'Removed ' + uid);
    } catch(e){ flash('error', 'Delete failed: ' + e.message); }
  };

  // ── Login as another user (superadmin only) ─────────────────────────────
  const loginAs = async (uid) => {
    if(!isSuperAdmin) return;
    if(uid === currentUser?.id) return;
    const okLA = await confirmDialog({
      title: 'Login as ' + (users[uid]?.name || 'user') + '?',
      message: 'You will see exactly what they see. Use the banner at the top to return to your account at any time.',
      confirmText: 'Login as ' + (users[uid]?.name || 'user'),
    });
    if(!okLA) return;
    try {
      const res = await api.impersonate(uid);
      onLoginAs?.(res.token, res.user, {
        id: currentUser.id,
        name: currentUser.name,
        ini: currentUser.ini,
        color: currentUser.color,
      });
    } catch(e){
      flash('error', 'Login-as failed: ' + e.message);
    }
  };

  // Allowed roles in the create form
  const createRoleOptions = isSuperAdmin
    ? [
        { v:'salesman',   label:'Salesman' },
        { v:'admin',      label:'Admin' },
        { v:'superadmin', label:'Superadmin' },
      ]
    : [
        { v:'salesman', label:'Salesman' },
      ];

  // Group users for clearer display
  const sorted = Object.values(users || {}).sort((a, b) => {
    const order = { superadmin: 0, admin: 1, salesman: 2 };
    const aR = order[a.role] ?? 3, bR = order[b.role] ?? 3;
    if(aR !== bR) return aR - bR;
    return (a.name || '').localeCompare(b.name || '');
  });

  const roleBadge = (r) => {
    if(r === 'superadmin') return { label:'SUPERADMIN', color:'#fbbf24', bg:'rgba(251,191,36,0.12)', icon:ShieldCheck };
    if(r === 'admin')      return { label:'ADMIN',      color:'#a5b4fc', bg:'rgba(99,102,241,0.12)', icon:Shield };
    return                       { label:'SALESMAN',   color:'#86efac', bg:'rgba(34,197,94,0.12)', icon:null };
  };

  // Can the current user manage this row's user?
  const canManage = (target) => {
    if(target.id === currentUser?.id) return true; // can always edit self
    if(isSuperAdmin) return true;
    if(isAdmin && target.role === 'salesman') return true;
    return false;
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:720}}>
        <div className="row" style={{marginBottom:14}}>
          <div style={{fontSize:17, fontWeight:700, display:'flex', alignItems:'center', gap:8}}>
            <UserPlus size={16}/> User Management
          </div>
          <span style={{
            fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4,
            background: roleBadge(currentUser?.role).bg,
            color: roleBadge(currentUser?.role).color,
          }}>
            You: {roleBadge(currentUser?.role).label}
          </span>
          <div className="spacer"/>
          <button onClick={onClose} className="btn"><X size={14}/></button>
        </div>

        {msg && (
          <div style={{
            padding:'8px 12px', borderRadius:6, marginBottom:10, fontSize:12,
            background: msg.type === 'success' ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)',
            border: '1px solid ' + (msg.type === 'success' ? '#15803d' : '#7f1d1d'),
            color:  msg.type === 'success' ? '#86efac' : '#fca5a5',
          }}>{msg.text}</div>
        )}

        {/* ── User list ─────────────────────────────────────────────────── */}
        <div style={{display:'flex', flexDirection:'column', gap:6, maxHeight:340, overflowY:'auto', marginBottom:16}}>
          {sorted.map(u => {
            const isSelf = u.id === currentUser?.id;
            const rb = roleBadge(u.role);
            const RoleIcon = rb.icon;
            return (
              <div key={u.id} style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 12px', background:'var(--bg2)', borderRadius:8,
                border: isSelf ? '1px solid var(--acc)' : '1px solid transparent',
              }}>
                <Avatar user={u} size={32}/>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <div style={{fontSize:13, fontWeight:600}}>{u.name}</div>
                    <span style={{
                      fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3,
                      background: rb.bg, color: rb.color,
                      display:'inline-flex', alignItems:'center', gap:3,
                    }}>
                      {RoleIcon && <RoleIcon size={9}/>} {rb.label}
                    </span>
                    {isSelf && <span style={{fontSize:9, color:'var(--t3)'}}>(you)</span>}
                  </div>
                  <div style={{fontSize:10, color:'var(--t3)', marginTop:2}}>
                    {u.id} · {u.url ? <span style={{color:'#34d399'}}>Sheet ✓</span> : <span style={{color:'var(--t3)'}}>No sheet</span>}
                    {u.role === 'salesman' && (
                      <> · Approver: <span style={{color: u.approver ? '#a5b4fc' : '#fbbf24'}}>
                        {u.approver ? (users[u.approver]?.name || u.approver) : 'any admin'}
                      </span></>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                {isSuperAdmin && !isSelf && (
                  <button onClick={()=>loginAs(u.id)} title={'Log in as ' + u.name}
                    style={{
                      display:'flex', alignItems:'center', gap:4,
                      background:'rgba(251,191,36,0.12)', color:'#fbbf24',
                      border:'1px solid rgba(251,191,36,0.35)',
                      padding:'4px 10px', borderRadius:5, fontSize:11, fontWeight:700, cursor:'pointer',
                    }}>
                    <LogIn size={11}/> Login as
                  </button>
                )}
                {canManage(u) && (
                  <>
                    <button className="btn" style={{fontSize:11, padding:'4px 8px'}} onClick={()=>reset(u.id)} title="Reset password">
                      <KeyRound size={11}/>
                    </button>
                    <button className="btn" style={{fontSize:11, padding:'4px 8px'}} onClick={()=>editUrl(u.id)} title="Edit sheet URL">
                      <LinkIcon size={11}/>
                    </button>
                    {u.role === 'salesman' && (
                      <button className="btn" style={{fontSize:11, padding:'4px 8px'}} onClick={()=>editApprover(u.id)} title="Set leave / visit approver">
                        <Shield size={11}/>
                      </button>
                    )}
                    {!isSelf && (
                      <button className="btnd" style={{fontSize:11, padding:'4px 8px'}} onClick={()=>remove(u.id)} title="Remove user">
                        <Trash2 size={11}/>
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Create new user ───────────────────────────────────────────── */}
        <div style={{paddingTop:14, borderTop:'1px solid var(--b1)'}}>
          <div style={{fontSize:14, fontWeight:600, marginBottom:10, display:'flex', alignItems:'center', gap:6}}>
            <UserPlus size={14}/> Create new user
          </div>
          <div className="g2">
            <div className="field">
              <label>Full Name</label>
              <input className="inp" value={name} onChange={e=>setName(e.target.value)}/>
            </div>
            <div className="field">
              <label>Username</label>
              <input className="inp" value={id} onChange={e=>setId(e.target.value)} placeholder="e.g. rahul"/>
            </div>
            <div className="field">
              <label>Password</label>
              <input className="inp" type="password" value={pass} onChange={e=>setPass(e.target.value)}/>
            </div>
            <div className="field">
              <label>Role</label>
              <select className="inp sel" value={role} onChange={e=>setRole(e.target.value)}>
                {createRoleOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
              </select>
            </div>
            <div className="field full">
              <label>Sheet CSV URL <span style={{color:'var(--t3)', fontSize:10}}>(optional, mainly for salesmen)</span></label>
              <input className="inp" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://docs.google.com/..."/>
            </div>
            <div className="field full">
              <label>Color</label>
              <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:4}}>
                {colors.map(c => (
                  <div key={c} onClick={()=>setColor(c)} style={{
                    width:22, height:22, borderRadius:'50%', cursor:'pointer',
                    background:c,
                    border: color === c ? '2px solid var(--t1)' : '2px solid transparent',
                    transform: color === c ? 'scale(1.2)' : 'scale(1)',
                  }}/>
                ))}
              </div>
            </div>
          </div>
          <button className="btnp" onClick={create} disabled={busy} style={{marginTop:10, display:'flex', alignItems:'center', gap:6}}>
            <UserPlus size={13}/> {busy ? 'Creating…' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserManagement;
