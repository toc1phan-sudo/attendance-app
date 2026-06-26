import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

function fmtTime(sec){return sec<60?`${sec}g`:`${Math.floor(sec/60)}p${sec%60}g`}
function initials(name){return name.trim().split(' ').slice(-2).map(w=>w[0]).join('').toUpperCase()}
function fmtDate(d){return new Date(d).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}
function lastName(fullName){
  // Tên người VN: từ cuối cùng là tên, VD "Nguyễn Văn An" → "An"
  if(!fullName)return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length-1]
}
function sortAttendances(list, sortBy){
  const copy = [...list]
  const STATUS_ORDER = {valid:0,pending:1,absent:2,suspicious:3,excused:4}
  const FLAG_ORDER = f => {
    if(f.includes('no-gps')||f.includes('gps-outlier')) return 0
    if(f.includes('device-reuse')||f.includes('device-shared')||f.includes('device-rapid')) return 1
    if(f.includes('late')||f.includes('expired-qr')) return 2
    return 3
  }
  if(sortBy==='status') return copy.sort((a,b)=>{
    const fa=FLAG_ORDER(a.flags||[]), fb=FLAG_ORDER(b.flags||[])
    if(fa!==fb)return fa-fb
    return (STATUS_ORDER[a.status||'pending']||0)-(STATUS_ORDER[b.status||'pending']||0)
  })
  if(sortBy==='name') return copy.sort((a,b)=>lastName(a.name).localeCompare(lastName(b.name),'vi'))
  if(sortBy==='mssv') return copy.sort((a,b)=>(a.mssv||'').localeCompare(b.mssv||''))
  return copy // default: thời gian điểm danh (mới nhất lên đầu)
}
function fmtDateTime(d){return new Date(d).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}

const FLAG_META = {
  'no-gps':        {label:'Không GPS',          color:'#b91c1c',bg:'#fee2e2'},
  'gps-outlier':   {label:'Vị trí lệch >200m',  color:'#b91c1c',bg:'#fee2e2'},
  'late':          {label:'Điểm danh trễ',       color:'#92400e',bg:'#fef9c3'},
  'expired-qr':    {label:'Mã QR hết hạn',       color:'#92400e',bg:'#fef9c3'},
  'device-reuse':  {label:'Thiết bị dùng chung', color:'#9d174d',bg:'#fce7f3'},
  'device-shared': {label:'Thiết bị dùng chung', color:'#9d174d',bg:'#fce7f3'},
  'device-rapid':  {label:'Điểm danh liên tiếp', color:'#9d174d',bg:'#fce7f3'},
  'manual-note':   {label:'Ghi chú thủ công',    color:'#0369a1',bg:'#e0f2fe'},
  'manual-verify': {label:'Xác nhận trực tiếp',  color:'#166534',bg:'#dcfce7'},
}

const STATUS_META = {
  'valid':      {label:'✅ Hợp lệ',   color:'#166534',bg:'#dcfce7'},
  'pending':    {label:'⚠️ Chú ý',    color:'#92400e',bg:'#fef9c3'},
  'absent':     {label:'❌ Vắng',     color:'#b91c1c',bg:'#fee2e2'},
  'suspicious': {label:'🔍 Xem xét', color:'#9d174d',bg:'#fce7f3'},
  'excused':    {label:'📝 Có phép',  color:'#0369a1',bg:'#e0f2fe'},
}

function SharedWithNote({flags}){
  // Tên người dùng chung được encode trong flags: "shared-with:TênSV"
  const sharedFlag = (flags||[]).find(f=>f.startsWith('shared-with:'))
  if(!sharedFlag) return null
  const sharedName = sharedFlag.replace('shared-with:','')
  return(
    <div style={{fontSize:11,color:'#9d174d',marginTop:3,display:'flex',alignItems:'center',gap:4}}>
      📱 Dùng chung với <strong>{lastName(sharedName)}</strong>
    </div>
  )
}

function Badges({flags}){
  if(!flags?.length)return null
  return <>{flags.map(f=>{const m=FLAG_META[f];if(!m)return null;return<span key={f} style={{fontSize:10,padding:'2px 7px',borderRadius:99,background:m.bg,color:m.color,fontWeight:600,marginRight:3,whiteSpace:'nowrap'}}>{m.label}</span>})}</>
}

function StatusBadge({status}){
  const m=STATUS_META[status||'pending']
  return<span style={{fontSize:11,padding:'3px 9px',borderRadius:99,background:m.bg,color:m.color,fontWeight:700}}>{m.label}</span>
}

function QRDisplay({code,size=200}){
  const[src,setSrc]=useState('')
  useEffect(()=>{
    if(!code)return
    const url=`${window.location.origin}/attend?session=${encodeURIComponent(code)}`
    setSrc(`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&bgcolor=ffffff&color=111111&qzone=1`)
  },[code,size])
  if(!src)return<div style={{width:size,height:size,background:'#f3f4f6',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',color:'#aaa',fontSize:12}}>Đang tạo QR…</div>
  return<img src={src} width={size} height={size} alt={`QR ${code}`} style={{display:'block',borderRadius:8}}/>
}

// ── Manual Note Modal ────────────────────────────────────────────────────────
function ManualModal({password,sessionId,onClose,onSaved}){
  const[mode,setMode]=useState('broken')
  const[svName,setSvName]=useState('')
  const[svMssv,setSvMssv]=useState('')
  const[note,setNote]=useState('ĐT hư, xác nhận có mặt trực tiếp')
  const[saving,setSaving]=useState(false)
  const MODES=[
    {id:'broken', label:'📱 Điện thoại hư',     note:'ĐT hư, xác nhận có mặt trực tiếp'},
    {id:'noapp',  label:'🌐 Không vào được app', note:'Lỗi app/mạng, xác nhận có mặt'},
    {id:'custom', label:'✏️ Ghi chú khác',        note:''},
  ]
  const save=async()=>{
    if(!svName||!svMssv)return
    setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action:'manual_note',session_id:sessionId,name:svName,mssv:svMssv,note})})
    setSaving(false);onSaved();onClose()
  }
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:360,boxShadow:'0 8px 32px rgba(0,0,0,0.15)'}}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>Xác nhận thủ công</div>
        <div style={{fontSize:12,color:'#888',marginBottom:14}}>Dành cho SV không điểm danh được qua app</div>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
          {MODES.map(m=>(
            <button key={m.id} onClick={()=>{setMode(m.id);if(m.note)setNote(m.note)}}
              style={{padding:'8px 12px',borderRadius:8,border:mode===m.id?'2px solid #0ea5e9':'1px solid #ddd',background:mode===m.id?'#f0f9ff':'#fafafa',textAlign:'left',fontSize:13,fontWeight:mode===m.id?600:400,color:mode===m.id?'#0369a1':'#374151'}}>
              {m.label}
            </button>
          ))}
        </div>
        <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Họ và tên</label><input value={svName} onChange={e=>setSvName(e.target.value)} placeholder="Nguyễn Văn A"/></div>
        <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>MSSV</label><input value={svMssv} onChange={e=>setSvMssv(e.target.value)} placeholder="21001234"/></div>
        {mode==='custom'&&<div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Ghi chú</label><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Nội dung..."/></div>}
        <div style={{display:'flex',gap:8,marginTop:14}}>
          <button onClick={onClose} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
          <button onClick={save} disabled={!svName||!svMssv||saving} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:(!svName||!svMssv)?'#ccc':'#111',color:'#fff',fontSize:13,fontWeight:700}}>
            {saving?'Đang lưu…':'✅ Xác nhận & lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Export Excel ─────────────────────────────────────────────────────────────
function exportExcel(lesson, attendances, className) {
  // Tổng hợp: mỗi SV chỉ xuất hiện 1 lần (lấy status cuối cùng)
  const map = {}
  attendances.forEach(a => {
    if (!map[a.mssv] || new Date(a.submitted_at) > new Date(map[a.mssv].submitted_at)) {
      map[a.mssv] = a
    }
  })
  const rows = Object.values(map).sort((a,b)=>a.name.localeCompare(b.name))
  const statusLabel = s => ({ valid:'Hợp lệ', pending:'Chú ý', absent:'Vắng', suspicious:'Xem xét', excused:'Có phép' }[s]||s)
  const flagLabel = f => (FLAG_META[f]?.label||f)

  let csv = '\uFEFF' // BOM for Excel UTF-8
  csv += `Lớp:,${className}\n`
  csv += `Buổi:,${lesson.lesson_no} - ${lesson.label||''}\n`
  csv += `Ngày:,${fmtDate(lesson.date)}\n\n`
  csv += 'STT,Họ và tên,MSSV,Trạng thái,Thời gian điểm danh,Ghi chú,Cờ phát hiện\n'
  rows.forEach((a,i) => {
    const flags = (a.flags||[]).map(flagLabel).join(' | ')
    csv += `${i+1},"${a.name}","${a.mssv}","${statusLabel(a.status)}","${fmtDateTime(a.submitted_at)}","${a.manual_note||''}","${flags}"\n`
  })

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `diemdanh_${className}_buoi${lesson.lesson_no}_${lesson.date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Status Editor Modal ───────────────────────────────────────────────────────
function StatusModal({attendance, password, onClose, onSaved}){
  const[status,setStatus]=useState(attendance.status||'pending')
  const[saving,setSaving]=useState(false)
  const save=async()=>{
    setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action:'update_status',attendance_id:attendance.id,status})})
    setSaving(false);onSaved(attendance.id,status);onClose()
  }
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:340}}>
        <div style={{fontSize:15,fontWeight:700,marginBottom:2}}>{attendance.name}</div>
        <div style={{fontSize:12,color:'#888',marginBottom:16}}>{attendance.mssv}</div>
        <div style={{fontSize:12,fontWeight:600,color:'#555',marginBottom:10}}>Chọn trạng thái:</div>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
          {Object.entries(STATUS_META).map(([k,m])=>(
            <button key={k} onClick={()=>setStatus(k)}
              style={{padding:'10px 14px',borderRadius:10,border:status===k?`2px solid ${m.color}`:'1px solid #eee',background:status===k?m.bg:'#fafafa',textAlign:'left',fontSize:13,fontWeight:status===k?700:400,color:status===k?m.color:'#374151'}}>
              {m.label}
              {k==='valid'&&<span style={{fontSize:11,color:'#888',fontWeight:400}}> — Xác nhận có mặt, hợp lệ</span>}
              {k==='absent'&&<span style={{fontSize:11,color:'#888',fontWeight:400}}> — Đánh dấu vắng mặt</span>}
              {k==='suspicious'&&<span style={{fontSize:11,color:'#888',fontWeight:400}}> — Nghi ngờ gian lận</span>}
              {k==='excused'&&<span style={{fontSize:11,color:'#888',fontWeight:400}}> — Vắng có phép</span>}
              {k==='pending'&&<span style={{fontSize:11,color:'#888',fontWeight:400}}> — Chưa xử lý</span>}
            </button>
          ))}
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
          <button onClick={save} disabled={saving} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontSize:13,fontWeight:700}}>
            {saving?'Đang lưu…':'💾 Lưu trạng thái'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Lesson History View ───────────────────────────────────────────────────────
function LessonHistory({lesson, cls, password, onBack}){
  const[attendances,setAttendances]=useState([])
  const[sessions,setSessions]=useState([])
  const[loading,setLoading]=useState(true)
  const[editTarget,setEditTarget]=useState(null)
  const[sortBy,setSortBy]=useState('time')
  const realtimeRef=useRef(null)

  const load=useCallback(async()=>{
    setLoading(true)
    const res=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action:'get_lesson_attendances',lesson_id:lesson.id})})
    const data=await res.json()
    if(data.ok){setAttendances(data.attendances);setSessions(data.sessions)}
    setLoading(false)
  },[lesson.id,password])

  useEffect(()=>{
    load()
    // Realtime
    const ch=supabase.channel('lesson-'+lesson.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'attendances'},()=>load())
      .subscribe()
    realtimeRef.current=ch
    return()=>supabase.removeChannel(ch)
  },[load])

  // Tổng hợp: mỗi SV 1 hàng (lấy lần mới nhất)
  const map={}
  attendances.forEach(a=>{
    if(!map[a.mssv]||new Date(a.submitted_at)>new Date(map[a.mssv].submitted_at))map[a.mssv]=a
  })
  const merged=sortAttendances(Object.values(map), sortBy)
  const counts={valid:0,pending:0,absent:0,suspicious:0,excused:0}
  merged.forEach(a=>{ if(counts[a.status]!==undefined)counts[a.status]++ })

  const updateLocal=(id,status)=>{
    setAttendances(prev=>prev.map(a=>a.id===id?{...a,status}:a))
  }

  return(
    <div>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',fontSize:13,color:'#0369a1',padding:'0 0 12px',cursor:'pointer'}}>
        ← Quay lại
      </button>
      <div style={{background:'#fff',borderRadius:16,padding:'1rem',marginBottom:12,boxShadow:'0 1px 6px rgba(0,0,0,0.06)'}}>
        <div style={{fontSize:16,fontWeight:700}}>{cls.code} — Buổi {lesson.lesson_no}</div>
        <div style={{fontSize:13,color:'#666',marginTop:2}}>{lesson.label||''} • {fmtDate(lesson.date)}</div>
        <div style={{fontSize:11,color:'#aaa',marginTop:2}}>{sessions.length} lần điểm danh • {attendances.length} lượt ghi nhận</div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
        {[
          {k:'valid',  n:counts.valid,   lbl:'Hợp lệ',  c:'#166534',bg:'#dcfce7'},
          {k:'pending',n:counts.pending, lbl:'Chú ý',   c:'#92400e',bg:'#fef9c3'},
          {k:'absent', n:counts.absent,  lbl:'Vắng',    c:'#b91c1c',bg:'#fee2e2'},
        ].map(({k,n,lbl,c,bg})=>(
          <div key={k} style={{background:bg,borderRadius:10,padding:'10px 4px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:700,color:c}}>{n}</div>
            <div style={{fontSize:11,color:c}}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Export */}
      <button onClick={()=>exportExcel(lesson,attendances,cls.code+' '+cls.name)}
        style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',fontWeight:600,fontSize:13,marginBottom:12}}>
        📥 Xuất danh sách CSV (mở bằng Excel)
      </button>

      {/* List */}
      <div style={{background:'#fff',borderRadius:16,padding:'1rem',boxShadow:'0 1px 6px rgba(0,0,0,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:6}}>
          <div style={{fontSize:12,color:'#888',fontWeight:600}}>DANH SÁCH ({merged.length} sinh viên)</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)}
            style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#fafafa'}}>
            <option value="time">Sắp xếp: Thời gian</option>
            <option value="status">Sắp xếp: Trạng thái / Cờ</option>
            <option value="name">Sắp xếp: Tên (A→Z)</option>
            <option value="mssv">Sắp xếp: MSSV</option>
          </select>
        </div>
        {loading&&<div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>Đang tải…</div>}
        {!loading&&!merged.length&&<div style={{textAlign:'center',padding:'2rem',color:'#ccc',fontSize:13}}>Chưa có sinh viên điểm danh</div>}
        {merged.map((a,i)=>(
          <div key={a.id} onClick={()=>setEditTarget(a)}
            style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:'1px solid #f5f5f5',cursor:'pointer'}}>
            <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:STATUS_META[a.status||'pending'].bg,color:STATUS_META[a.status||'pending'].color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>
              {initials(a.name)}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600}}>{a.name}</div>
              <div style={{fontSize:11,color:'#888',marginBottom:3}}>{a.mssv} • {fmtDateTime(a.submitted_at)}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:2}}><Badges flags={a.flags}/></div>
              <SharedWithNote flags={a.flags}/>
              {a.manual_note&&<div style={{fontSize:11,color:'#0369a1',marginTop:2}}>📝 {a.manual_note}</div>}
            </div>
            <StatusBadge status={a.status}/>
          </div>
        ))}
      </div>

      {editTarget&&(
        <StatusModal attendance={editTarget} password={password}
          onClose={()=>setEditTarget(null)}
          onSaved={(id,status)=>{updateLocal(id,status);setEditTarget(null)}}/>
      )}
    </div>
  )
}

// ── Main Teacher Page ─────────────────────────────────────────────────────────
export default function TeacherPage(){
  const[authed,setAuthed]=useState(false)
  const[password,setPassword]=useState('')
  const[pwError,setPwError]=useState('')
  const[tab,setTab]=useState('session') // session | classes
  const[classes,setClasses]=useState([])
  const[selectedClass,setSelectedClass]=useState('')
  const[selectedLesson,setSelectedLesson]=useState(null)
  const[lessons,setLessons]=useState([])
  const[historyLesson,setHistoryLesson]=useState(null) // lesson đang xem lịch sử
  const[session,setSession]=useState(null)
  const[attendances,setAttendances]=useState([])
  const[timerVal,setTimerVal]=useState(60)
  const[showManual,setShowManual]=useState(false)
  const[showNewClass,setShowNewClass]=useState(false)
  const[showNewLesson,setShowNewLesson]=useState(false)
  const[newClass,setNewClass]=useState({name:'',code:'',term:''})
  const[newLesson,setNewLesson]=useState({lesson_no:'',label:'',date:new Date().toISOString().slice(0,10)})
  const[detail,setDetail]=useState(null)
  const[liveSort,setLiveSort]=useState('time')
  const timerRef=useRef(null)
  const realtimeRef=useRef(null)

  const api=useCallback(async(action,extra={})=>{
    const res=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action,...extra})})
    return res.json()
  },[password])

  const loadClasses=useCallback(async()=>{
    const data=await api('get_classes')
    if(data.ok)setClasses(data.classes)
  },[api])

  const loadLessons=useCallback(async(classId)=>{
    const data=await api('get_lessons',{class_id:classId})
    if(data.ok)setLessons(data.lessons)
  },[api])

  const login=async()=>{
    const res=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action:'get_classes'})})
    const data=await res.json()
    if(data.ok){setAuthed(true);setClasses(data.classes)}
    else setPwError('Sai mật khẩu, thử lại')
  }

  const subscribeRealtime=useCallback((sessionId)=>{
    if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)
    const ch=supabase.channel('att-'+sessionId)
      .on('postgres_changes',{event:'*',schema:'public',table:'attendances',filter:`session_id=eq.${sessionId}`},
        payload=>{
          if(payload.eventType==='INSERT')setAttendances(prev=>[payload.new,...prev])
          if(payload.eventType==='UPDATE')setAttendances(prev=>prev.map(a=>a.id===payload.new.id?payload.new:a))
        }).subscribe()
    realtimeRef.current=ch
  },[])

  const startSession=async()=>{
    if(!selectedClass||!selectedLesson)return
    const data=await api('create_session',{class_id:selectedClass,lesson_id:selectedLesson.id})
    if(!data.ok)return
    setSession(data.session);setAttendances([])
    startTimer(data.session);subscribeRealtime(data.session.id)
  }

  const refreshQR=async()=>{
    if(!session)return
    const data=await api('refresh_qr',{session_id:session.id})
    if(data.ok){setSession(data.session);setTimerVal(60)}
  }

  const endSession=async()=>{
    clearInterval(timerRef.current)
    if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)
    if(session)await api('end_session',{session_id:session.id})
    setSession(null);setAttendances([]);setSelectedLesson(null)
  }

  const startTimer=(sess)=>{
    clearInterval(timerRef.current)
    timerRef.current=setInterval(async()=>{
      const start=new Date(sess.created_at).getTime()
      const elapsed=Math.round((Date.now()-start)/1000)
      const remaining=60-(elapsed%60)
      setTimerVal(remaining)
      // Auto refresh QR khi hết hạn
      if(remaining===60&&elapsed>0){
        const data=await api('refresh_qr',{session_id:sess.id})
        if(data.ok){
          setSession(prev=>({...prev,...data.session}))
        }
      }
    },1000)
  }

  useEffect(()=>()=>{
    clearInterval(timerRef.current)
    if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)
  },[])

  const present=attendances.length
  const warned=attendances.filter(a=>a.flags?.length>0).length
  const cls=classes.find(c=>c.id===selectedClass)

  if(!authed)return(
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
        <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:'100%',maxWidth:360,boxShadow:'0 4px 24px rgba(0,0,0,0.1)'}}>
          <div style={{fontSize:32,textAlign:'center',marginBottom:8}}>🏫</div>
          <div style={{fontSize:20,fontWeight:700,textAlign:'center',marginBottom:4}}>Giáo viên</div>
          <div style={{fontSize:13,color:'#888',textAlign:'center',marginBottom:24}}>Nhập mật khẩu để vào trang quản lý</div>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&login()} placeholder="Mật khẩu giáo viên" style={{marginBottom:8}}/>
          {pwError&&<div style={{fontSize:12,color:'#b91c1c',marginBottom:8}}>{pwError}</div>}
          <button onClick={login} style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:15}}>Đăng nhập →</button>
        </div>
      </div>
    </>
  )

  return(
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div style={{background:'#111',padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:20}}>🏫</span>
        <div style={{flex:1}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:15}}>Trang Giáo viên</div>
          <div style={{color:'#777',fontSize:11,fontFamily:'monospace'}}>yourapp.com/teacher</div>
        </div>
        <button onClick={()=>{setTab(tab==='session'?'classes':'session');if(tab==='classes')loadClasses()}}
          style={{fontSize:12,padding:'6px 12px',borderRadius:8,border:'1px solid #333',background:'#222',color:'#ccc'}}>
          {tab==='session'?'📚 Quản lý lớp':'📋 Điểm danh'}
        </button>
      </div>

      <div style={{maxWidth:500,margin:'0 auto',padding:'1rem'}}>

        {/* ── TAB SESSION ── */}
        {tab==='session'&&(
          <>
            {!session?(
              <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Chọn lớp và buổi học</div>
                <select value={selectedClass} onChange={e=>{setSelectedClass(e.target.value);setSelectedLesson(null);if(e.target.value)loadLessons(e.target.value)}} style={{marginBottom:10}}>
                  <option value="">-- Chọn lớp --</option>
                  {classes.map(c=><option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                </select>

                {selectedClass&&(
                  <>
                    <select value={selectedLesson?.id||''} onChange={e=>{const l=lessons.find(x=>x.id===e.target.value);setSelectedLesson(l||null)}} style={{marginBottom:10}}>
                      <option value="">-- Chọn buổi học --</option>
                      {lessons.map(l=><option key={l.id} value={l.id}>Buổi {l.lesson_no}{l.label?` — ${l.label}`:''} ({fmtDate(l.date)})</option>)}
                    </select>
                    <button onClick={()=>setShowNewLesson(true)}
                      style={{width:'100%',padding:'8px',borderRadius:8,border:'1px dashed #ddd',background:'#fafafa',color:'#666',fontSize:13,marginBottom:10}}>
                      + Tạo buổi học mới
                    </button>
                  </>
                )}

                <button onClick={startSession} disabled={!selectedClass||!selectedLesson}
                  style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:(selectedClass&&selectedLesson)?'#111':'#ccc',color:'#fff',fontWeight:700,fontSize:15}}>
                  📋 Bắt đầu điểm danh
                </button>
                {!classes.length&&<div style={{marginTop:12,padding:'10px',background:'#fef9c3',borderRadius:8,fontSize:12,color:'#92400e'}}>⚠️ Chưa có lớp. Nhấn "Quản lý lớp" để tạo.</div>}
              </div>
            ):(
              <>
                {/* QR Card */}
                <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',marginBottom:12,textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#aaa',marginBottom:2}}>{cls?.code} — Buổi {selectedLesson?.lesson_no}</div>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:'monospace',letterSpacing:2,color:'#111',marginBottom:10}}>{session.qr_code}</div>
                  <div style={{display:'inline-block',padding:10,background:'#fff',border:'1px solid #eee',borderRadius:12,boxShadow:'0 2px 12px rgba(0,0,0,0.08)',marginBottom:10}}>
                    <QRDisplay code={session.qr_code} size={200}/>
                  </div>
                  <div style={{fontSize:12,color:'#888',marginBottom:4}}>Sinh viên mở: <strong style={{color:'#0369a1'}}>yourapp.com/attend</strong></div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginTop:8}}>
                    <span style={{fontSize:13,color:'#888'}}>Mã mới sau:</span>
                    <span style={{width:36,height:36,borderRadius:'50%',background:timerVal<=15?'#fef9c3':'#e0f2fe',color:timerVal<=15?'#92400e':'#0369a1',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,transition:'all 0.3s'}}>{timerVal}</span>
                    <button onClick={refreshQR} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>🔄 Đổi ngay</button>
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

                <div style={{display:'flex',gap:8,marginBottom:12}}>
                  <button onClick={()=>setShowManual(true)} style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',fontWeight:600,fontSize:13}}>✋ Thủ công</button>
                  <button onClick={endSession} style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',fontWeight:600,fontSize:13}}>⏹ Kết thúc</button>
                </div>

                <div style={{background:'#fff',borderRadius:16,padding:'1rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,flexWrap:'wrap',gap:6}}>
                    <div style={{fontSize:12,color:'#888',fontWeight:600}}>DANH SÁCH ({present})</div>
                    <select value={liveSort} onChange={e=>setLiveSort(e.target.value)}
                      style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#fafafa'}}>
                      <option value="time">Thời gian</option>
                      <option value="status">Trạng thái</option>
                      <option value="name">Tên</option>
                      <option value="mssv">MSSV</option>
                    </select>
                  </div>
                  {!present&&<div style={{textAlign:'center',padding:'2rem',color:'#ccc',fontSize:13}}>Chưa có sinh viên điểm danh</div>}
                  {sortAttendances(attendances, liveSort).map((sv,i)=>(
                    <div key={sv.id||i} onClick={()=>setDetail(sv)}
                      style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 0',borderBottom:'1px solid #f5f5f5',cursor:'pointer'}}>
                      <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:sv.flags?.length?'#fce7f3':'#dcfce7',color:sv.flags?.length?'#9d174d':'#166534',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>
                        {initials(sv.name)}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{sv.name}</div>
                        <div style={{fontSize:11,color:'#888',marginBottom:3}}>{sv.mssv} • {fmtTime(sv.elapsed_sec||0)}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:2}}><Badges flags={sv.flags}/></div>
                        <SharedWithNote flags={sv.flags}/>
                        {sv.manual_note&&<div style={{fontSize:11,color:'#0369a1',marginTop:2}}>📝 {sv.manual_note}</div>}
                      </div>
                      <StatusBadge status={sv.status}/>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── TAB CLASSES ── */}
        {tab==='classes'&&(
          <>
            {historyLesson?(
              <LessonHistory lesson={historyLesson} cls={classes.find(c=>c.id===historyLesson.class_id)||{}} password={password} onBack={()=>setHistoryLesson(null)}/>
            ):(
              <>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div style={{fontSize:15,fontWeight:700}}>Danh sách lớp</div>
                  <button onClick={()=>setShowNewClass(true)} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:600,fontSize:13}}>+ Thêm lớp</button>
                </div>
                {!classes.length&&<div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center',color:'#aaa',fontSize:13}}>Chưa có lớp nào.</div>}
                {classes.map(c=>(
                  <div key={c.id} style={{background:'#fff',borderRadius:12,padding:'1rem',marginBottom:8,boxShadow:'0 1px 6px rgba(0,0,0,0.05)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                      <div style={{width:40,height:40,borderRadius:10,background:'#e0f2fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>📚</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:14,fontWeight:600}}>{c.code}</div>
                        <div style={{fontSize:12,color:'#666'}}>{c.name} • {c.term}</div>
                      </div>
                      <button onClick={async()=>{await loadLessons(c.id);setSelectedClass(c.id)}}
                        style={{fontSize:12,padding:'5px 10px',borderRadius:6,border:'1px solid #ddd',background:'#f8f9fa',cursor:'pointer'}}>
                        Xem buổi
                      </button>
                    </div>
                    {selectedClass===c.id&&(
                      <div style={{borderTop:'1px solid #f0f0f0',paddingTop:10}}>
                        {!lessons.length&&<div style={{fontSize:12,color:'#aaa',padding:'4px 0'}}>Chưa có buổi học nào</div>}
                        {lessons.map(l=>(
                          <div key={l.id} onClick={()=>setHistoryLesson(l)}
                            style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid #f9f9f9',cursor:'pointer'}}>
                            <div style={{width:28,height:28,borderRadius:8,background:'#f0f9ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#0369a1'}}>
                              {l.lesson_no}
                            </div>
                            <div style={{flex:1}}>
                              <div style={{fontSize:13,fontWeight:500}}>Buổi {l.lesson_no}{l.label?` — ${l.label}`:''}</div>
                              <div style={{fontSize:11,color:'#aaa'}}>{fmtDate(l.date)}</div>
                            </div>
                            <span style={{fontSize:11,color:'#0369a1'}}>Xem →</span>
                          </div>
                        ))}
                        <button onClick={()=>setShowNewLesson(true)}
                          style={{width:'100%',padding:'7px',borderRadius:8,border:'1px dashed #ddd',background:'#fafafa',color:'#666',fontSize:12,marginTop:8}}>
                          + Thêm buổi học
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {showNewClass&&(
                  <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',marginTop:8,boxShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:14}}>Tạo lớp mới</div>
                    <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Mã lớp</label><input value={newClass.code} onChange={e=>setNewClass({...newClass,code:e.target.value})} placeholder="VD: CNTT03"/></div>
                    <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Tên môn học</label><input value={newClass.name} onChange={e=>setNewClass({...newClass,name:e.target.value})} placeholder="VD: Lập trình Web"/></div>
                    <div style={{marginBottom:14}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Học kỳ</label><input value={newClass.term} onChange={e=>setNewClass({...newClass,term:e.target.value})} placeholder="VD: HK1 2024-2025"/></div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>setShowNewClass(false)} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
                      <button onClick={async()=>{const d=await api('create_class',{...newClass});if(d.ok){await loadClasses();setShowNewClass(false);setNewClass({name:'',code:'',term:''})}}}
                        style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:13}}>✅ Tạo lớp</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* New Lesson Modal */}
      {showNewLesson&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:360}}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:14}}>Tạo buổi học mới</div>
            <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Số buổi</label><input type="number" value={newLesson.lesson_no} onChange={e=>setNewLesson({...newLesson,lesson_no:e.target.value})} placeholder="1"/></div>
            <div style={{marginBottom:10}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Tên buổi (tuỳ chọn)</label><input value={newLesson.label} onChange={e=>setNewLesson({...newLesson,label:e.target.value})} placeholder="VD: Chương 1 - Giới thiệu"/></div>
            <div style={{marginBottom:14}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4}}>Ngày</label><input type="date" value={newLesson.date} onChange={e=>setNewLesson({...newLesson,date:e.target.value})}/></div>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setShowNewLesson(false)} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>Hủy</button>
              <button onClick={async()=>{
                const classId=selectedClass||classes[0]?.id
                if(!classId||!newLesson.lesson_no)return
                const d=await api('create_lesson',{class_id:classId,lesson_no:parseInt(newLesson.lesson_no),label:newLesson.label,date:newLesson.date})
                if(d.ok){await loadLessons(classId);setShowNewLesson(false);setSelectedLesson(d.lesson);setNewLesson({lesson_no:'',label:'',date:new Date().toISOString().slice(0,10)})}
              }} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:13}}>✅ Tạo buổi</button>
            </div>
          </div>
        </div>
      )}

      {showManual&&session&&<ManualModal password={password} sessionId={session.id} onClose={()=>setShowManual(false)} onSaved={()=>{}}/>}

      {detail&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'flex-end'}} onClick={()=>setDetail(null)}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:20,width:'100%',maxWidth:500,margin:'0 auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{detail.name}</div>
            <div style={{fontSize:12,color:'#888',marginBottom:12}}>{detail.mssv} • {fmtTime(detail.elapsed_sec||0)}</div>
            <div style={{fontSize:12,fontWeight:600,color:'#555',marginBottom:8}}>🔍 Tín hiệu:</div>
            {!detail.flags?.length&&<div style={{fontSize:13,color:'#166534',marginBottom:8}}>✅ Không có cờ bất thường</div>}
            {detail.flags?.map(f=>{const m=FLAG_META[f];if(!m)return null;return<div key={f} style={{padding:'7px 10px',borderRadius:8,background:m.bg,color:m.color,fontSize:12,fontWeight:600,marginBottom:5}}>{m.label}</div>})}
            {detail.lat&&<div style={{fontSize:11,color:'#aaa',marginTop:8,fontFamily:'monospace'}}>📍 {detail.lat.toFixed(5)}, {detail.lng.toFixed(5)} (±{Math.round(detail.gps_accuracy||0)}m)</div>}
            {detail.manual_note&&<div style={{fontSize:12,color:'#0369a1',marginTop:6}}>📝 {detail.manual_note}</div>}
            <button onClick={()=>setDetail(null)} style={{marginTop:14,width:'100%',padding:'10px',borderRadius:10,border:'1px solid #ddd',background:'#f8f9fa',fontSize:14}}>Đóng</button>
          </div>
        </div>
      )}
    </>
  )
}
