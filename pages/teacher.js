import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(sec) { return sec < 60 ? `${sec}g` : `${Math.floor(sec/60)}p${sec%60}g` }
function initials(name) { return name.trim().split(' ').slice(-2).map(w=>w[0]).join('').toUpperCase() }

const FLAG_META = {
  'no-gps':       { label: 'Không GPS',           color: '#b91c1c', bg: '#fee2e2' },
  'gps-outlier':  { label: 'Vị trí lệch >200m',   color: '#b91c1c', bg: '#fee2e2' },
  'late':         { label: 'Điểm danh trễ',        color: '#92400e', bg: '#fef9c3' },
  'device-reuse': { label: 'Thiết bị dùng chung',  color: '#9d174d', bg: '#fce7f3' },
  'device-shared':{ label: 'Thiết bị dùng chung',  color: '#9d174d', bg: '#fce7f3' },
  'device-rapid': { label: 'Điểm danh liên tiếp',  color: '#9d174d', bg: '#fce7f3' },
  'manual-note':  { label: 'Ghi chú thủ công',     color: '#0369a1', bg: '#e0f2fe' },
  'manual-verify':{ label: 'Xác nhận trực tiếp',   color: '#166534', bg: '#dcfce7' },
}

function Badges({ flags }) {
  if (!flags?.length) return <span style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:'#dcfce7',color:'#166534',fontWeight:600}}>✅ Hợp lệ</span>
  return <>{flags.map(f => {
    const m = FLAG_META[f]; if (!m) return null
    return <span key={f} style={{fontSize:11,padding:'2px 8px',borderRadius:99,background:m.bg,color:m.color,fontWeight:600,marginRight:3,whiteSpace:'nowrap'}}>{m.label}</span>
  })}</>
}

// ── QR thật — encode URL attend?session=CODE ─────────────────────────────────
function QRDisplay({ code, size=200 }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!code) return
    const url = `${window.location.origin}/attend?session=${encodeURIComponent(code)}`
    setSrc(`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=111111&qzone=1`)
  }, [code, size])
  if (!src) return <div style={{width:size,height:size,background:'#f3f4f6',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',color:'#aaa',fontSize:12}}>Đang tạo QR…</div>
  return <img src={src} width={size} height={size} alt={`QR ${code}`} style={{display:'block',borderRadius:8}}/>
}

// ── Manual Note Modal ────────────────────────────────────────────────────────
function ManualModal({ password, sessionId, onClose, onSaved }) {
  const [mode, setMode]   = useState('broken')
  const [svName, setSvName] = useState('')
  const [svMssv, setSvMssv] = useState('')
  const [note, setNote]   = useState('ĐT hư, xác nhận có mặt trực tiếp')
  const [saving, setSaving] = useState(false)

  const MODES = [
    { id:'broken',  label:'📱 Điện thoại hư',     note:'ĐT hư, xác nhận có mặt trực tiếp' },
    { id:'noapp',   label:'🌐 Không vào được app', note:'Lỗi app/mạng, xác nhận có mặt'   },
    { id:'custom',  label:'✏️ Ghi chú khác',        note:'' },
  ]

  const save = async () => {
    if (!svName || !svMssv) return
    setSaving(true)
    await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, action: 'manual_note', session_id: sessionId, name: svName, mssv: svMssv, note }),
    })
    setSaving(false)
    onSaved()
    onClose()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:360,boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Xác nhận thủ công</div>
        <div style={{fontSize:12,color:'#888',marginBottom:16}}>Dành cho sinh viên không điểm danh được qua app</div>

        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
          {MODES.map(m=>(
            <button key={m.id} onClick={()=>{ setMode(m.id); if(m.note) setNote(m.note) }}
              style={{padding:'9px 12px',borderRadius:8,border:mode===m.id?'2px solid #0ea5e9':'1px solid #ddd',background:mode===m.id?'#f0f9ff':'#fafafa',textAlign:'left',fontSize:13,fontWeight:mode===m.id?600:400,color:mode===m.id?'#0369a1':'#374151'}}>
              {m.label}
            </button>
          ))}
        </div>

        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Họ và tên</label>
          <input value={svName} onChange={e=>setSvName(e.target.value)} placeholder="Nguyễn Văn A"/>
        </div>
        <div style={{marginBottom:10}}>
          <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Mã số sinh viên</label>
          <input value={svMssv} onChange={e=>setSvMssv(e.target.value)} placeholder="21001234"/>
        </div>
        {mode==='custom' && (
          <div style={{marginBottom:10}}>
            <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Nội dung ghi chú</label>
            <input value={note} onChange={e=>setNote(e.target.value)} placeholder="VD: Báo bệnh, có giấy phép..."/>
          </div>
        )}

        <div style={{display:'flex',gap:8,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
          <button onClick={save} disabled={!svName||!svMssv||saving}
            style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:(!svName||!svMssv)?'#ccc':'#111',color:'#fff',fontSize:13,fontWeight:700}}>
            {saving ? 'Đang lưu…' : '✅ Xác nhận & lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Teacher Page ─────────────────────────────────────────────────────────
export default function TeacherPage() {
  const [authed, setAuthed]         = useState(false)
  const [password, setPassword]     = useState('')
  const [pwError, setPwError]       = useState('')
  const [tab, setTab]               = useState('session') // session | classes
  const [classes, setClasses]       = useState([])
  const [selectedClass, setSelectedClass] = useState('')
  const [session, setSession]       = useState(null)   // { id, qr_code, created_at }
  const [attendances, setAttendances] = useState([])
  const [timerVal, setTimerVal]     = useState(60)
  const [showManual, setShowManual] = useState(false)
  const [showNewClass, setShowNewClass] = useState(false)
  const [newClass, setNewClass]     = useState({ name:'', code:'', term:'' })
  const [detail, setDetail]         = useState(null)   // student detail panel
  const timerRef  = useRef(null)
  const realtimeRef = useRef(null)

  const api = useCallback(async (action, extra={}) => {
    const res = await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, action, ...extra }),
    })
    return res.json()
  }, [password])

  // Load classes
  const loadClasses = useCallback(async () => {
    const data = await api('get_classes')
    if (data.ok) setClasses(data.classes)
  }, [api])

  // Login
  const login = async () => {
    const res = await fetch('/api/teacher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, action: 'get_classes' }),
    })
    const data = await res.json()
    if (data.ok) { setAuthed(true); setClasses(data.classes) }
    else setPwError('Sai mật khẩu, thử lại')
  }

  // Realtime subscription
  const subscribeRealtime = useCallback((sessionId) => {
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current)
    const channel = supabase
      .channel('attendances-' + sessionId)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'attendances',
        filter: `session_id=eq.${sessionId}`,
      }, payload => {
        if (payload.eventType === 'INSERT') {
          setAttendances(prev => [payload.new, ...prev])
        }
        if (payload.eventType === 'UPDATE') {
          setAttendances(prev => prev.map(a => a.id === payload.new.id ? payload.new : a))
        }
      })
      .subscribe()
    realtimeRef.current = channel
  }, [])

  // Start session
  const startSession = async () => {
    if (!selectedClass) return
    const data = await api('create_session', { class_id: selectedClass })
    if (!data.ok) return
    setSession(data.session)
    setAttendances([])
    startTimer(data.session)
    subscribeRealtime(data.session.id)
  }

  // Refresh QR
  const refreshQR = async () => {
    if (!session) return
    const data = await api('refresh_qr', { session_id: session.id })
    if (data.ok) { setSession(data.session); setTimerVal(60) }
  }

  // End session
  const endSession = async () => {
    clearInterval(timerRef.current)
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current)
    if (session) await api('end_session', { session_id: session.id })
    setSession(null); setAttendances([]); setSelectedClass('')
  }

  // Timer
  const startTimer = (sess) => {
    clearInterval(timerRef.current)
    const start = new Date(sess.created_at).getTime()
    timerRef.current = setInterval(() => {
      const elapsed = Math.round((Date.now() - start) / 1000)
      const remaining = 60 - (elapsed % 60)
      setTimerVal(remaining)
    }, 500)
  }

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (realtimeRef.current) supabase.removeChannel(realtimeRef.current)
  }, [])

  const present = attendances.length
  const warned  = attendances.filter(a => a.flags?.length > 0).length
  const cls     = classes.find(c => c.id === selectedClass)

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!authed) return (
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
        <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:'100%',maxWidth:360,boxShadow:'0 4px 24px rgba(0,0,0,0.1)'}}>
          <div style={{fontSize:32,textAlign:'center',marginBottom:8}}>🏫</div>
          <div style={{fontSize:20,fontWeight:700,textAlign:'center',marginBottom:4}}>Giáo viên</div>
          <div style={{fontSize:13,color:'#888',textAlign:'center',marginBottom:24}}>Nhập mật khẩu để vào trang quản lý</div>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&login()}
            placeholder="Mật khẩu giáo viên" style={{marginBottom:8}}/>
          {pwError && <div style={{fontSize:12,color:'#b91c1c',marginBottom:8}}>{pwError}</div>}
          <button onClick={login} style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:15}}>
            Đăng nhập →
          </button>
        </div>
      </div>
    </>
  )

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>

      {/* Header */}
      <div style={{background:'#111',padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:20}}>🏫</span>
        <div style={{flex:1}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:15}}>Trang Giáo viên</div>
          <div style={{color:'#777',fontSize:11,fontFamily:'monospace'}}>yourapp.com/teacher</div>
        </div>
        <button onClick={()=>{ setTab(tab==='session'?'classes':'session'); if(tab==='classes') loadClasses() }}
          style={{fontSize:12,padding:'6px 12px',borderRadius:8,border:'1px solid #333',background:'#222',color:'#ccc'}}>
          {tab==='session' ? '📚 Quản lý lớp' : '📋 Điểm danh'}
        </button>
      </div>

      <div style={{maxWidth:500,margin:'0 auto',padding:'1rem'}}>

        {/* ── TAB: SESSION ── */}
        {tab==='session' && (
          <>
            {!session ? (
              <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Chọn lớp để bắt đầu điểm danh</div>
                <select value={selectedClass} onChange={e=>setSelectedClass(e.target.value)} style={{marginBottom:12}}>
                  <option value="">-- Chọn lớp --</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                </select>
                <button onClick={startSession} disabled={!selectedClass}
                  style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:selectedClass?'#111':'#ccc',color:'#fff',fontWeight:700,fontSize:15}}>
                  📋 Bắt đầu điểm danh
                </button>
                {!classes.length && (
                  <div style={{marginTop:12,padding:'10px',background:'#fef9c3',borderRadius:8,fontSize:12,color:'#92400e'}}>
                    ⚠️ Chưa có lớp nào. Nhấn "Quản lý lớp" ở trên để tạo lớp mới.
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* QR Card */}
                <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',marginBottom:12,textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#aaa',marginBottom:4}}>{cls?.code} – {cls?.name}</div>
                  <div style={{fontSize:12,color:'#888',fontFamily:'monospace',marginBottom:6}}>MÃ PHIÊN</div>
                  <div style={{fontSize:22,fontWeight:800,fontFamily:'monospace',letterSpacing:3,color:'#111',marginBottom:12}}>{session.qr_code}</div>
                  <div style={{display:'inline-block',padding:10,background:'#fff',border:'1px solid #eee',borderRadius:12,boxShadow:'0 2px 12px rgba(0,0,0,0.08)',marginBottom:12}}>
                    <QRDisplay code={session.qr_code} size={200}/>
                  </div>
                  <div style={{fontSize:12,color:'#888',marginBottom:4}}>
                    Sinh viên mở: <strong style={{color:'#0369a1'}}>yourapp.com/attend</strong>
                  </div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginTop:10}}>
                    <span style={{fontSize:13,color:'#888'}}>Hết hạn sau:</span>
                    <span style={{width:36,height:36,borderRadius:'50%',background:timerVal<=15?'#fef9c3':'#e0f2fe',color:timerVal<=15?'#92400e':'#0369a1',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700}}>{timerVal}</span>
                    <button onClick={refreshQR} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>🔄 Đổi mã</button>
                  </div>
                </div>

                {/* Stats */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                  <div style={{background:'#dcfce7',borderRadius:12,padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:28,fontWeight:700,color:'#166534'}}>{present}</div>
                    <div style={{fontSize:12,color:'#166534'}}>Đã điểm danh</div>
                  </div>
                  <div style={{background:'#fce7f3',borderRadius:12,padding:'12px',textAlign:'center'}}>
                    <div style={{fontSize:28,fontWeight:700,color:'#9d174d'}}>{warned}</div>
                    <div style={{fontSize:12,color:'#9d174d'}}>Cần xem lại</div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{display:'flex',gap:8,marginBottom:12}}>
                  <button onClick={()=>setShowManual(true)}
                    style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',fontWeight:600,fontSize:13}}>
                    ✋ Thủ công
                  </button>
                  <button onClick={endSession}
                    style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',fontWeight:600,fontSize:13}}>
                    ⏹ Kết thúc
                  </button>
                </div>

                {/* Student list */}
                <div style={{background:'#fff',borderRadius:16,padding:'1rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                  <div style={{fontSize:12,color:'#888',fontWeight:600,marginBottom:10}}>DANH SÁCH ({present} sinh viên)</div>
                  {!present && <div style={{textAlign:'center',padding:'2rem',color:'#ccc',fontSize:13}}>Chưa có sinh viên điểm danh</div>}
                  {attendances.map((sv,i) => (
                    <div key={sv.id||i} onClick={()=>setDetail(sv)}
                      style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 0',borderBottom:'1px solid #f5f5f5',cursor:'pointer'}}>
                      <div style={{width:34,height:34,borderRadius:'50%',flexShrink:0,
                        background:sv.flags?.length?'#fce7f3':'#dcfce7',
                        color:sv.flags?.length?'#9d174d':'#166534',
                        display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>
                        {initials(sv.name)}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{sv.name}</div>
                        <div style={{fontSize:11,color:'#888',marginBottom:4}}>{sv.mssv}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:3}}><Badges flags={sv.flags}/></div>
                        {sv.manual_note && <div style={{fontSize:11,color:'#0369a1',marginTop:3}}>📝 {sv.manual_note}</div>}
                      </div>
                      <div style={{fontSize:11,color:'#ccc',flexShrink:0,paddingTop:2}}>{fmtTime(sv.elapsed_sec||0)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── TAB: CLASSES ── */}
        {tab==='classes' && (
          <>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontSize:15,fontWeight:700}}>Danh sách lớp</div>
              <button onClick={()=>setShowNewClass(true)}
                style={{padding:'8px 14px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:600,fontSize:13}}>
                + Thêm lớp
              </button>
            </div>

            {!classes.length && (
              <div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center',color:'#aaa',fontSize:13}}>
                Chưa có lớp nào. Nhấn "+ Thêm lớp" để tạo.
              </div>
            )}

            {classes.map(c=>(
              <div key={c.id} style={{background:'#fff',borderRadius:12,padding:'1rem',marginBottom:8,boxShadow:'0 1px 6px rgba(0,0,0,0.05)',display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:40,height:40,borderRadius:10,background:'#e0f2fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>📚</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600}}>{c.code}</div>
                  <div style={{fontSize:12,color:'#666'}}>{c.name}</div>
                  <div style={{fontSize:11,color:'#aaa'}}>{c.term}</div>
                </div>
              </div>
            ))}

            {/* New class form */}
            {showNewClass && (
              <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',marginTop:8,boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
                <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>Tạo lớp mới</div>
                <div style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Mã lớp</label>
                  <input value={newClass.code} onChange={e=>setNewClass({...newClass,code:e.target.value})} placeholder="VD: CNTT03"/>
                </div>
                <div style={{marginBottom:10}}>
                  <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Tên môn học</label>
                  <input value={newClass.name} onChange={e=>setNewClass({...newClass,name:e.target.value})} placeholder="VD: Lập trình Web"/>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Học kỳ</label>
                  <input value={newClass.term} onChange={e=>setNewClass({...newClass,term:e.target.value})} placeholder="VD: HK1 2024-2025"/>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setShowNewClass(false)} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
                  <button onClick={async()=>{
                    const data = await api('create_class',{name:newClass.name,code:newClass.code,term:newClass.term})
                    if(data.ok){await loadClasses();setShowNewClass(false);setNewClass({name:'',code:'',term:''})}
                  }} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:13}}>
                    ✅ Tạo lớp
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Manual note modal */}
      {showManual && session && (
        <ManualModal password={password} sessionId={session.id}
          onClose={()=>setShowManual(false)}
          onSaved={()=>{}}
        />
      )}

      {/* Detail panel */}
      {detail && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'flex-end'}} onClick={()=>setDetail(null)}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:20,width:'100%',maxWidth:500,margin:'0 auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{detail.name}</div>
            <div style={{fontSize:12,color:'#888',marginBottom:12}}>{detail.mssv} • Điểm danh lúc {fmtTime(detail.elapsed_sec||0)}</div>
            <div style={{fontSize:12,fontWeight:600,color:'#555',marginBottom:8}}>🔍 Tín hiệu phát hiện:</div>
            {!detail.flags?.length && <div style={{fontSize:13,color:'#166534',marginBottom:8}}>✅ Tất cả tín hiệu hợp lệ</div>}
            {detail.flags?.map(f=>{ const m=FLAG_META[f]; if(!m)return null; return(
              <div key={f} style={{padding:'8px 12px',borderRadius:8,background:m.bg,color:m.color,fontSize:12,fontWeight:600,marginBottom:6}}>{m.label}</div>
            )})}
            {detail.lat && <div style={{fontSize:11,color:'#aaa',marginTop:8,fontFamily:'monospace'}}>📍 {detail.lat.toFixed(5)}, {detail.lng.toFixed(5)} (±{Math.round(detail.gps_accuracy||0)}m)</div>}
            {detail.manual_note && <div style={{fontSize:12,color:'#0369a1',marginTop:6}}>📝 {detail.manual_note}</div>}
            <button onClick={()=>setDetail(null)} style={{marginTop:14,width:'100%',padding:'10px',borderRadius:10,border:'1px solid #ddd',background:'#f8f9fa',fontSize:14}}>Đóng</button>
          </div>
        </div>
      )}
    </>
  )
}
