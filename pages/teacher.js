import { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(sec){return sec<60?`${sec}g`:`${Math.floor(sec/60)}p${sec%60}g`}
function fmtDate(d){return d?new Date(d).toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}):''}
function fmtDateTime(d){return d?new Date(d).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}
function lastName(n){if(!n)return '';const p=n.trim().split(/\s+/);return p[p.length-1]}
function initials(n){return n.trim().split(' ').slice(-2).map(w=>w[0]).join('').toUpperCase()}
function sortList(list,sortBy){
  const copy=[...list]
  const SO={valid:0,pending:1,absent:2,suspicious:3,excused:4}
  const FO=f=>{if(f.includes('no-gps')||f.includes('gps-outlier'))return 0;if(f.some(x=>x.startsWith('shared-with:')||x==='device-reuse'||x==='device-shared'||x==='device-rapid'))return 1;if(f.includes('late')||f.includes('expired-qr'))return 2;return 3}
  if(sortBy==='status')return copy.sort((a,b)=>{const fa=FO(a.flags||[]),fb=FO(b.flags||[]);if(fa!==fb)return fa-fb;return(SO[a.status||'pending']||0)-(SO[b.status||'pending']||0)})
  if(sortBy==='name')return copy.sort((a,b)=>lastName(a.name).localeCompare(lastName(b.name),'vi'))
  if(sortBy==='mssv')return copy.sort((a,b)=>(a.mssv||'').localeCompare(b.mssv||''))
  return copy
}

const FLAG_META={
  'no-gps':{label:'Không GPS',color:'#b91c1c',bg:'#fee2e2'},
  'gps-outlier':{label:'Vị trí lệch >200m',color:'#b91c1c',bg:'#fee2e2'},
  'late':{label:'Điểm danh trễ',color:'#92400e',bg:'#fef9c3'},
  'expired-qr':{label:'Mã QR hết hạn',color:'#92400e',bg:'#fef9c3'},
  'device-reuse':{label:'Thiết bị dùng chung',color:'#9d174d',bg:'#fce7f3'},
  'device-shared':{label:'Thiết bị dùng chung',color:'#9d174d',bg:'#fce7f3'},
  'device-rapid':{label:'Điểm danh liên tiếp',color:'#9d174d',bg:'#fce7f3'},
  'manual-note':{label:'Ghi chú thủ công',color:'#0369a1',bg:'#e0f2fe'},
  'manual-verify':{label:'Xác nhận trực tiếp',color:'#166534',bg:'#dcfce7'},
}
const STATUS_META={
  'valid':{label:'✅ Hợp lệ',color:'#166534',bg:'#dcfce7'},
  'pending':{label:'⚠️ Chú ý',color:'#92400e',bg:'#fef9c3'},
  'absent':{label:'❌ Vắng',color:'#b91c1c',bg:'#fee2e2'},
  'suspicious':{label:'🔍 Xem xét',color:'#9d174d',bg:'#fce7f3'},
  'excused':{label:'📝 Có phép',color:'#0369a1',bg:'#e0f2fe'},
}

function Badges({flags}){
  const visible=(flags||[]).filter(f=>FLAG_META[f])
  if(!visible.length)return null
  return<>{visible.map(f=>{const m=FLAG_META[f];return<span key={f} style={{fontSize:10,padding:'2px 7px',borderRadius:99,background:m.bg,color:m.color,fontWeight:600,marginRight:3,whiteSpace:'nowrap'}}>{m.label}</span>})}</>
}
function StatusBadge({status}){
  const m=STATUS_META[status||'pending']
  return<span style={{fontSize:11,padding:'3px 9px',borderRadius:99,background:m.bg,color:m.color,fontWeight:700,whiteSpace:'nowrap'}}>{m.label}</span>
}
function SharedWith({flags}){
  const f=(flags||[]).find(x=>x.startsWith('shared-with:'))
  if(!f)return null
  return<div style={{fontSize:11,color:'#9d174d',marginTop:2}}>📱 Dùng chung với <b>{lastName(f.replace('shared-with:',''))}</b></div>
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

// ── Export CSV ────────────────────────────────────────────────────────────────
function exportCSV(lesson, attendances, students, subjectName, className){
  const map={}
  attendances.forEach(a=>{if(!map[a.mssv]||new Date(a.submitted_at)>new Date(map[a.mssv].submitted_at))map[a.mssv]=a})
  const attended=map
  const statusLabel=s=>({valid:'Hợp lệ',pending:'Chú ý',absent:'Vắng',suspicious:'Xem xét',excused:'Có phép'}[s]||s)
  const flagLabel=f=>{const sf=(f||[]).find(x=>x.startsWith('shared-with:'));return[...(f||[]).filter(x=>FLAG_META[x]).map(x=>FLAG_META[x].label),sf?`Dùng chung với ${lastName(sf.replace('shared-with:',''))}`:null].filter(Boolean).join(' | ')}

  // Hợp nhất: SV trong danh sách + SV điểm danh không có trong danh sách
  const allMssv=new Set([...students.map(s=>s.mssv),...Object.keys(attended)])
  const rows=[]
  allMssv.forEach(mssv=>{
    const sv=students.find(s=>s.mssv===mssv)
    const att=attended[mssv]
    rows.push({
      name: att?.name||sv?.name||'',
      mssv,
      status: att?statusLabel(att.status||'pending'):'Vắng',
      time: att?fmtDateTime(att.submitted_at):'',
      note: att?.manual_note||'',
      flags: att?flagLabel(att.flags):'',
    })
  })
  rows.sort((a,b)=>lastName(a.name).localeCompare(lastName(b.name),'vi'))

  let csv='\uFEFF'
  csv+=`Lớp:,${className}\nMôn:,${subjectName}\nBuổi:,${lesson.lesson_no}${lesson.label?' - '+lesson.label:''}\nNgày:,${fmtDate(lesson.date)}\n\n`
  csv+='STT,Họ và tên,MSSV,Trạng thái,Thời gian điểm danh,Ghi chú,Cờ phát hiện\n'
  rows.forEach((r,i)=>{csv+=`${i+1},"${r.name}","${r.mssv}","${r.status}","${r.time}","${r.note}","${r.flags}"\n`})

  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'})
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download=`diemdanh_${className}_${subjectName}_buoi${lesson.lesson_no}_${lesson.date}.csv`;a.click();URL.revokeObjectURL(url)
}

// ── Modals ────────────────────────────────────────────────────────────────────
function Modal({title,onClose,children}){
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={onClose}>
      <div style={{background:'#fff',borderRadius:16,padding:20,width:'100%',maxWidth:380,boxShadow:'0 8px 32px rgba(0,0,0,0.15)',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:16,fontWeight:700,marginBottom:16}}>{title}</div>
        {children}
      </div>
    </div>
  )
}
function Field({label,children}){return<div style={{marginBottom:12}}><label style={{fontSize:12,color:'#555',display:'block',marginBottom:4,fontWeight:500}}>{label}</label>{children}</div>}
function BtnRow({children}){return<div style={{display:'flex',gap:8,marginTop:16}}>{children}</div>}
function BtnPrimary({onClick,disabled,children}){return<button onClick={onClick} disabled={disabled} style={{flex:2,padding:'10px',borderRadius:8,border:'none',background:disabled?'#ccc':'#111',color:'#fff',fontWeight:700,fontSize:13,cursor:disabled?'default':'pointer'}}>{children}</button>}
function BtnSecondary({onClick,children}){return<button onClick={onClick} style={{flex:1,padding:'10px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13,cursor:'pointer'}}>{children}</button>}

function StatusModal({attendance,password,onClose,onSaved}){
  const[status,setStatus]=useState(attendance.status||'pending')
  const[saving,setSaving]=useState(false)
  const save=async()=>{
    setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password,action:'update_status',attendance_id:attendance.id,status})})
    setSaving(false);onSaved(attendance.id,status);onClose()
  }
  return(
    <Modal title={`${attendance.name} — ${attendance.mssv}`} onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:4}}>
        {Object.entries(STATUS_META).map(([k,m])=>(
          <button key={k} onClick={()=>setStatus(k)}
            style={{padding:'10px 14px',borderRadius:10,border:status===k?`2px solid ${m.color}`:'1px solid #eee',background:status===k?m.bg:'#fafafa',textAlign:'left',fontSize:13,fontWeight:status===k?700:400,color:status===k?m.color:'#374151'}}>
            {m.label}
          </button>
        ))}
      </div>
      <BtnRow><BtnSecondary onClick={onClose}>Hủy</BtnSecondary><BtnPrimary onClick={save} disabled={saving}>{saving?'Đang lưu…':'💾 Lưu'}</BtnPrimary></BtnRow>
    </Modal>
  )
}

function ManualModal({password,sessionId,onClose}){
  const[mode,setMode]=useState('broken')
  const[name,setName]=useState('')
  const[mssv,setMssv]=useState('')
  const[note,setNote]=useState('ĐT hư, xác nhận có mặt trực tiếp')
  const[saving,setSaving]=useState(false)
  const MODES=[{id:'broken',label:'📱 Điện thoại hư',note:'ĐT hư, xác nhận có mặt trực tiếp'},{id:'noapp',label:'🌐 Không vào được app',note:'Lỗi app/mạng, xác nhận có mặt'},{id:'custom',label:'✏️ Ghi chú khác',note:''}]
  const save=async()=>{
    if(!name||!mssv)return;setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'manual_note',session_id:sessionId,name,mssv,note})})
    setSaving(false);onClose()
  }
  return(
    <Modal title="Xác nhận thủ công" onClose={onClose}>
      <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
        {MODES.map(m=><button key={m.id} onClick={()=>{setMode(m.id);if(m.note)setNote(m.note)}} style={{padding:'8px 12px',borderRadius:8,border:mode===m.id?'2px solid #0ea5e9':'1px solid #ddd',background:mode===m.id?'#f0f9ff':'#fafafa',textAlign:'left',fontSize:13,fontWeight:mode===m.id?600:400,color:mode===m.id?'#0369a1':'#374151'}}>{m.label}</button>)}
      </div>
      <Field label="Họ và tên"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nguyễn Văn A"/></Field>
      <Field label="MSSV"><input value={mssv} onChange={e=>setMssv(e.target.value)} placeholder="21001234"/></Field>
      {mode==='custom'&&<Field label="Ghi chú"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Nội dung..."/></Field>}
      <BtnRow><BtnSecondary onClick={onClose}>Hủy</BtnSecondary><BtnPrimary onClick={save} disabled={!name||!mssv||saving}>{saving?'Đang lưu…':'✅ Xác nhận & lưu'}</BtnPrimary></BtnRow>
    </Modal>
  )
}

// ── Lesson History ────────────────────────────────────────────────────────────
function LessonHistory({lesson,subject,cls,password,onBack,onUpdate}){
  const[atts,setAtts]=useState([])
  const[sessions,setSessions]=useState([])
  const[students,setStudents]=useState([])
  const[loading,setLoading]=useState(true)
  const[sortBy,setSortBy]=useState('time')
  const[editTarget,setEditTarget]=useState(null)
  const[editLesson,setEditLesson]=useState(false)
  const[lessonForm,setLessonForm]=useState({lesson_no:lesson.lesson_no,label:lesson.label||'',date:lesson.date})
  const realtimeRef=useRef(null)

  const load=useCallback(async()=>{
    setLoading(true)
    const[r1,r2]=await Promise.all([
      fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'get_lesson_attendances',lesson_id:lesson.id})}).then(r=>r.json()),
      fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'get_students',class_id:cls.id})}).then(r=>r.json()),
    ])
    if(r1.ok){setAtts(r1.attendances);setSessions(r1.sessions)}
    if(r2.ok)setStudents(r2.students)
    setLoading(false)
  },[lesson.id,cls.id,password])

  useEffect(()=>{
    load()
    const ch=supabase.channel('lesson-'+lesson.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'attendances'},()=>load()).subscribe()
    realtimeRef.current=ch
    return()=>supabase.removeChannel(ch)
  },[load])

  // Merge: latest att per mssv
  const map={}
  atts.forEach(a=>{if(!map[a.mssv]||new Date(a.submitted_at)>new Date(map[a.mssv].submitted_at))map[a.mssv]=a})

  // Thêm SV vắng hoàn toàn từ danh sách lớp
  const allRows=[]
  const attendedMssv=new Set(Object.keys(map))
  students.forEach(s=>{
    if(attendedMssv.has(s.mssv))allRows.push(map[s.mssv])
    else allRows.push({id:'absent-'+s.mssv,name:s.name,mssv:s.mssv,flags:[],status:'absent',submitted_at:null,elapsed_sec:0,manual_note:null,_notInDB:true})
  })
  // SV điểm danh nhưng không trong danh sách lớp
  Object.values(map).forEach(a=>{if(!students.find(s=>s.mssv===a.mssv))allRows.push(a)})

  const sorted=sortList(allRows,sortBy)
  const counts={valid:0,pending:0,absent:0,suspicious:0,excused:0}
  allRows.forEach(a=>{if(counts[a.status||'pending']!==undefined)counts[a.status||'pending']++})

  const saveLesson=async()=>{
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'update_lesson',lesson_id:lesson.id,...lessonForm})})
    setEditLesson(false);onUpdate()
  }

  return(
    <div>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',fontSize:13,color:'#0369a1',padding:'0 0 12px',cursor:'pointer'}}>← Quay lại</button>
      <div style={{background:'#fff',borderRadius:16,padding:'1rem',marginBottom:12,boxShadow:'0 1px 6px rgba(0,0,0,0.06)'}}>
        {editLesson?(
          <>
            <Field label="Số buổi"><input type="number" value={lessonForm.lesson_no} onChange={e=>setLessonForm({...lessonForm,lesson_no:e.target.value})}/></Field>
            <Field label="Tên buổi"><input value={lessonForm.label} onChange={e=>setLessonForm({...lessonForm,label:e.target.value})} placeholder="VD: Chương 1"/></Field>
            <Field label="Ngày"><input type="date" value={lessonForm.date} onChange={e=>setLessonForm({...lessonForm,date:e.target.value})}/></Field>
            <BtnRow><BtnSecondary onClick={()=>setEditLesson(false)}>Hủy</BtnSecondary><BtnPrimary onClick={saveLesson}>💾 Lưu</BtnPrimary></BtnRow>
          </>
        ):(
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:16,fontWeight:700}}>{cls.code} • {subject.name}</div>
              <div style={{fontSize:13,color:'#666',marginTop:2}}>Buổi {lesson.lesson_no}{lesson.label?' — '+lesson.label:''}</div>
              <div style={{fontSize:12,color:'#aaa',marginTop:1}}>{fmtDate(lesson.date)} • {sessions.length} lần điểm danh</div>
            </div>
            <button onClick={()=>setEditLesson(true)} style={{fontSize:12,padding:'5px 10px',borderRadius:6,border:'1px solid #ddd',background:'#f8f9fa',cursor:'pointer'}}>✏️ Sửa</button>
          </div>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
        {[{k:'valid',n:counts.valid,lbl:'Hợp lệ',c:'#166534',bg:'#dcfce7'},{k:'pending',n:counts.pending,lbl:'Chú ý',c:'#92400e',bg:'#fef9c3'},{k:'absent',n:counts.absent,lbl:'Vắng',c:'#b91c1c',bg:'#fee2e2'}].map(({k,n,lbl,c,bg})=>(
          <div key={k} style={{background:bg,borderRadius:10,padding:'10px 4px',textAlign:'center'}}>
            <div style={{fontSize:22,fontWeight:700,color:c}}>{n}</div>
            <div style={{fontSize:11,color:c}}>{lbl}</div>
          </div>
        ))}
      </div>

      <button onClick={()=>exportCSV(lesson,atts,students,subject.name,cls.code+' '+cls.name)}
        style={{width:'100%',padding:'10px',borderRadius:10,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',fontWeight:600,fontSize:13,marginBottom:12}}>
        📥 Xuất danh sách CSV (mở bằng Excel)
      </button>

      <div style={{background:'#fff',borderRadius:16,padding:'1rem',boxShadow:'0 1px 6px rgba(0,0,0,0.06)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:6,flexWrap:'wrap'}}>
          <div style={{fontSize:12,color:'#888',fontWeight:600}}>DANH SÁCH ({allRows.length} SV) • Nhấn để đổi trạng thái</div>
          <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#fafafa'}}>
            <option value="time">Thời gian</option>
            <option value="status">Trạng thái / Cờ</option>
            <option value="name">Tên (A→Z)</option>
            <option value="mssv">MSSV</option>
          </select>
        </div>
        {loading&&<div style={{textAlign:'center',padding:'2rem',color:'#aaa'}}>Đang tải…</div>}
        {sorted.map((a,i)=>(
          <div key={a.id||i} onClick={()=>!a._notInDB&&setEditTarget(a)}
            style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 0',borderBottom:'1px solid #f5f5f5',cursor:a._notInDB?'default':'pointer',opacity:a._notInDB?0.6:1}}>
            <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:STATUS_META[a.status||'pending'].bg,color:STATUS_META[a.status||'pending'].color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>
              {initials(a.name)}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600}}>{a.name}</div>
              <div style={{fontSize:11,color:'#888',marginBottom:2}}>{a.mssv}{a.submitted_at?' • '+fmtDateTime(a.submitted_at):' • Chưa điểm danh'}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:2}}><Badges flags={a.flags}/></div>
              <SharedWith flags={a.flags}/>
              {a.manual_note&&<div style={{fontSize:11,color:'#0369a1',marginTop:2}}>📝 {a.manual_note}</div>}
            </div>
            <StatusBadge status={a.status||'absent'}/>
          </div>
        ))}
      </div>
      {editTarget&&<StatusModal attendance={editTarget} password={password} onClose={()=>setEditTarget(null)} onSaved={(id,st)=>{setAtts(prev=>prev.map(a=>a.id===id?{...a,status:st}:a));setEditTarget(null)}}/>}
    </div>
  )
}

// ── Student Manager ───────────────────────────────────────────────────────────
function StudentManager({cls,password,onClose}){
  const[students,setStudents]=useState([])
  const[name,setName]=useState('')
  const[mssv,setMssv]=useState('')
  const[bulk,setBulk]=useState('')
  const[tab,setTab]=useState('list') // list | add | import
  const[saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    const r=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'get_students',class_id:cls.id})}).then(r=>r.json())
    if(r.ok)setStudents(r.students)
  },[cls.id,password])

  useEffect(()=>{load()},[load])

  const addOne=async()=>{
    if(!name||!mssv)return;setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'add_student',class_id:cls.id,name:name.trim(),mssv:mssv.trim()})})
    setName('');setMssv('');setSaving(false);load()
  }

  const importBulk=async()=>{
    const lines=bulk.trim().split('\n').filter(l=>l.trim())
    const rows=lines.map(l=>{
      // Support: "Họ tên,MSSV" or "MSSV,Họ tên" or tab-separated
      const parts=l.split(/[,\t]/).map(p=>p.trim()).filter(Boolean)
      if(parts.length<2)return null
      // Nếu phần đầu là số → MSSV trước, tên sau
      if(/^\d+$/.test(parts[0]))return{mssv:parts[0],name:parts.slice(1).join(' ')}
      return{name:parts[0],mssv:parts[parts.length-1]}
    }).filter(Boolean)
    if(!rows.length)return
    setSaving(true)
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'import_students',class_id:cls.id,students:rows})})
    setBulk('');setSaving(false);load();setTab('list')
  }

  const del=async(id)=>{
    if(!confirm('Xóa sinh viên này?'))return
    await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'delete_student',student_id:id})})
    load()
  }

  return(
    <Modal title={`Danh sách SV — ${cls.code}`} onClose={onClose}>
      <div style={{display:'flex',gap:4,marginBottom:14}}>
        {[{k:'list',l:`Danh sách (${students.length})`},{k:'add',l:'+ Thêm 1 SV'},{k:'import',l:'📋 Dán Excel'}].map(({k,l})=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:'7px 4px',borderRadius:8,border:tab===k?'2px solid #111':'1px solid #ddd',background:tab===k?'#111':'#fafafa',color:tab===k?'#fff':'#555',fontSize:11,fontWeight:tab===k?700:400,cursor:'pointer'}}>{l}</button>
        ))}
      </div>

      {tab==='list'&&(
        <div style={{maxHeight:360,overflowY:'auto'}}>
          {!students.length&&<div style={{textAlign:'center',padding:'2rem',color:'#aaa',fontSize:13}}>Chưa có SV nào. Dùng tab "Thêm" hoặc "Dán Excel".</div>}
          {students.map(s=>(
            <div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid #f5f5f5'}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:600}}>{s.name}</div>
                <div style={{fontSize:11,color:'#888'}}>{s.mssv}</div>
              </div>
              <button onClick={()=>del(s.id)} style={{fontSize:11,padding:'3px 8px',borderRadius:6,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',cursor:'pointer'}}>Xóa</button>
            </div>
          ))}
        </div>
      )}

      {tab==='add'&&(
        <>
          <Field label="Họ và tên"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nguyễn Văn A"/></Field>
          <Field label="MSSV"><input value={mssv} onChange={e=>setMssv(e.target.value)} placeholder="21001234"/></Field>
          <BtnRow><BtnSecondary onClick={()=>setTab('list')}>Hủy</BtnSecondary><BtnPrimary onClick={addOne} disabled={!name||!mssv||saving}>{saving?'Đang lưu…':'➕ Thêm'}</BtnPrimary></BtnRow>
        </>
      )}

      {tab==='import'&&(
        <>
          <div style={{fontSize:12,color:'#666',marginBottom:8,lineHeight:1.6}}>
            Dán từ Excel — mỗi dòng 1 SV theo định dạng:<br/>
            <code style={{background:'#f3f4f6',padding:'2px 6px',borderRadius:4,fontSize:11}}>Họ tên, MSSV</code> hoặc <code style={{background:'#f3f4f6',padding:'2px 6px',borderRadius:4,fontSize:11}}>MSSV, Họ tên</code>
          </div>
          <textarea value={bulk} onChange={e=>setBulk(e.target.value)} rows={8}
            placeholder={"Nguyễn Văn An, 21001234\nTrần Thị Bảo, 21001235\n21001236, Lê Minh Châu"}
            style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid #ddd',fontSize:12,fontFamily:'monospace',resize:'vertical'}}/>
          <div style={{fontSize:11,color:'#aaa',marginTop:4}}>{bulk.trim().split('\n').filter(l=>l.trim()).length} dòng</div>
          <BtnRow><BtnSecondary onClick={()=>setTab('list')}>Hủy</BtnSecondary><BtnPrimary onClick={importBulk} disabled={!bulk.trim()||saving}>{saving?'Đang nhập…':'📥 Nhập danh sách'}</BtnPrimary></BtnRow>
        </>
      )}
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TeacherPage(){
  const[authed,setAuthed]=useState(false)
  const[password,setPassword]=useState('')
  const[pwError,setPwError]=useState('')
  const[tab,setTab]=useState('session')
  const[classes,setClasses]=useState([])
  // Session flow state
  const[selClass,setSelClass]=useState('')
  const[selSubject,setSelSubject]=useState(null)
  const[selLesson,setSelLesson]=useState(null)
  const[subjects,setSubjects]=useState([])
  const[lessons,setLessons]=useState([])
  const[duration,setDuration]=useState(60)
  const[session,setSession]=useState(null)
  const[atts,setAtts]=useState([])
  const[timerVal,setTimerVal]=useState(60)
  const[liveSort,setLiveSort]=useState('time')
  const[showManual,setShowManual]=useState(false)
  const[detail,setDetail]=useState(null)
  // Classes tab state
  const[expandedClass,setExpandedClass]=useState(null)
  const[expandedSubject,setExpandedSubject]=useState(null)
  const[classSubjects,setClassSubjects]=useState({})
  const[subjectLessons,setSubjectLessons]=useState({})
  const[historyCtx,setHistoryCtx]=useState(null) // {lesson,subject,cls}
  const[studentMgrCls,setStudentMgrCls]=useState(null)
  // Edit/create modals
  const[editClass,setEditClass]=useState(null)
  const[editSubject,setEditSubject]=useState(null)
  const[editLesson,setEditLesson]=useState(null)
  const[newClassForm,setNewClassForm]=useState({name:'',code:'',term:'',total_students:''})
  const[newSubjectForm,setNewSubjectForm]=useState({name:'',code:''})
  const[newLessonForm,setNewLessonForm]=useState({lesson_no:'',label:'',date:new Date().toISOString().slice(0,10)})
  const[showNewClass,setShowNewClass]=useState(false)
  const[showNewSubject,setShowNewSubject]=useState(null) // class_id
  const[showNewLesson,setShowNewLesson]=useState(null) // {class_id,subject_id}
  const timerRef=useRef(null)
  const realtimeRef=useRef(null)

  const api=useCallback(async(action,extra={})=>{
    const r=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action,...extra})})
    return r.json()
  },[password])

  const loadClasses=useCallback(async()=>{const d=await api('get_classes');if(d.ok)setClasses(d.classes)},[api])
  const loadSubjects=useCallback(async(cid)=>{const d=await api('get_subjects',{class_id:cid});if(d.ok)setClassSubjects(p=>({...p,[cid]:d.subjects}));return d.subjects||[]},[api])
  const loadLessons=useCallback(async(sid)=>{const d=await api('get_lessons',{subject_id:sid});if(d.ok)setSubjectLessons(p=>({...p,[sid]:d.lessons}));return d.lessons||[]},[api])

  const login=async()=>{
    const r=await fetch('/api/teacher',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password,action:'get_classes'})}).then(r=>r.json())
    if(r.ok){setAuthed(true);setClasses(r.classes)}else setPwError('Sai mật khẩu, thử lại')
  }

  const startSession=async()=>{
    if(!selClass||!selLesson)return
    const d=await api('create_session',{class_id:selClass,lesson_id:selLesson.id,duration_sec:duration})
    if(!d.ok)return
    setSession(d.session);setAtts([])
    startTimer(d.session,duration)
    if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)
    const ch=supabase.channel('att-'+d.session.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'attendances',filter:`session_id=eq.${d.session.id}`},
        p=>{if(p.eventType==='INSERT')setAtts(prev=>[p.new,...prev]);if(p.eventType==='UPDATE')setAtts(prev=>prev.map(a=>a.id===p.new.id?p.new:a))}).subscribe()
    realtimeRef.current=ch
  }

  const startTimer=(sess,dur)=>{
    clearInterval(timerRef.current)
    const d=dur||sess.duration_sec||60
    timerRef.current=setInterval(async()=>{
      const elapsed=Math.round((Date.now()-new Date(sess.created_at).getTime())/1000)
      const remaining=d-(elapsed%d)
      setTimerVal(remaining)
      if(remaining===d&&elapsed>0){
        const r=await api('refresh_qr',{session_id:sess.id})
        if(r.ok)setSession(prev=>({...prev,...r.session}))
      }
    },1000)
  }

  const endSession=async()=>{
    clearInterval(timerRef.current)
    if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)
    if(session)await api('end_session',{session_id:session.id})
    setSession(null);setAtts([]);setSelLesson(null);setSelSubject(null)
  }

  useEffect(()=>()=>{clearInterval(timerRef.current);if(realtimeRef.current)supabase.removeChannel(realtimeRef.current)},[])

  const present=atts.length, warned=atts.filter(a=>a.flags?.length>0).length
  const cls=classes.find(c=>c.id===selClass)

  if(!authed)return(
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:16,background:'#f1f5f9'}}>
        <div style={{background:'#fff',borderRadius:16,padding:'2rem',width:'100%',maxWidth:360,boxShadow:'0 4px 24px rgba(0,0,0,0.1)'}}>
          <div style={{textAlign:'center',marginBottom:16}}>
            <img src="/logo.png" alt="Logo" style={{width:72,height:72,objectFit:'contain',marginBottom:8}} onError={e=>e.target.style.display='none'}/>
            <div style={{fontSize:13,fontWeight:600,color:'#555'}}>Trường Cao đẳng Y tế Bình Dương</div>
          </div>
          <div style={{fontSize:20,fontWeight:700,textAlign:'center',marginBottom:4}}>🏫 Giáo viên</div>
          <div style={{fontSize:13,color:'#888',textAlign:'center',marginBottom:20}}>Nhập mật khẩu để vào trang quản lý</div>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&login()} placeholder="Mật khẩu giáo viên" style={{marginBottom:8}}/>
          {pwError&&<div style={{fontSize:12,color:'#b91c1c',marginBottom:8}}>{pwError}</div>}
          <button onClick={login} style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:'#111',color:'#fff',fontWeight:700,fontSize:15}}>Đăng nhập →</button>
        </div>
      </div>
    </>
  )

  return(
    <>
      <Head><title>Giáo viên – Điểm danh</title><meta name="viewport" content="width=device-width, initial-scale=1"/></Head>
      <div style={{background:'#111',padding:'10px 16px',display:'flex',alignItems:'center',gap:10}}>
        <img src="/logo.png" alt="Logo" style={{width:36,height:36,objectFit:'contain',borderRadius:4}} onError={e=>e.target.style.display='none'}/>
        <div style={{flex:1}}>
          <div style={{color:'#fff',fontWeight:700,fontSize:14}}>Hệ thống Điểm danh</div>
          <div style={{color:'#777',fontSize:10}}>Cao đẳng Y tế Bình Dương</div>
        </div>
        <button onClick={()=>{setTab(tab==='session'?'classes':'session');if(tab==='classes')loadClasses()}}
          style={{fontSize:12,padding:'6px 12px',borderRadius:8,border:'1px solid #333',background:'#222',color:'#ccc'}}>
          {tab==='session'?'📚 Quản lý':'📋 Điểm danh'}
        </button>
      </div>

      <div style={{maxWidth:500,margin:'0 auto',padding:'1rem'}}>

        {/* ── SESSION TAB ── */}
        {tab==='session'&&(
          <>
            {!session?(
              <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Chọn lớp → Môn → Buổi</div>

                <Field label="Lớp">
                  <select value={selClass} onChange={async e=>{setSelClass(e.target.value);setSelSubject(null);setSelLesson(null);setSubjects([]);setLessons([]);if(e.target.value){const s=await loadSubjects(e.target.value);setSubjects(s||[])}}}>
                    <option value="">-- Chọn lớp --</option>
                    {classes.map(c=><option key={c.id} value={c.id}>{c.code} – {c.name}</option>)}
                  </select>
                </Field>

                {selClass&&<Field label="Môn học">
                  <select value={selSubject?.id||''} onChange={async e=>{const s=subjects.find(x=>x.id===e.target.value);setSelSubject(s||null);setSelLesson(null);if(s){const l=await loadLessons(s.id);setLessons(l||[])}}}>
                    <option value="">-- Chọn môn --</option>
                    {subjects.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>}

                {selSubject&&<Field label="Buổi học">
                  <select value={selLesson?.id||''} onChange={e=>{const l=lessons.find(x=>x.id===e.target.value);setSelLesson(l||null)}}>
                    <option value="">-- Chọn buổi --</option>
                    {lessons.map(l=><option key={l.id} value={l.id}>Buổi {l.lesson_no}{l.label?' — '+l.label:''} ({fmtDate(l.date)})</option>)}
                  </select>
                </Field>}

                {selSubject&&(
                  <Field label={`Thời gian mỗi mã QR (giây)`}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <input type="number" value={duration} onChange={e=>setDuration(Math.max(10,parseInt(e.target.value)||60))} min={10} style={{width:100}}/>
                      <span style={{fontSize:12,color:'#888'}}>giây (mặc định 60)</span>
                    </div>
                  </Field>
                )}

                <button onClick={startSession} disabled={!selClass||!selLesson}
                  style={{width:'100%',padding:'11px',borderRadius:10,border:'none',background:(selClass&&selLesson)?'#111':'#ccc',color:'#fff',fontWeight:700,fontSize:15,marginTop:4}}>
                  📋 Bắt đầu điểm danh
                </button>
                {!classes.length&&<div style={{marginTop:12,padding:'10px',background:'#fef9c3',borderRadius:8,fontSize:12,color:'#92400e'}}>⚠️ Chưa có lớp. Nhấn "Quản lý" để tạo.</div>}
              </div>
            ):(
              <>
                <div style={{background:'#fff',borderRadius:16,padding:'1.25rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',marginBottom:12,textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#aaa',marginBottom:2}}>{cls?.code} • {selSubject?.name} • Buổi {selLesson?.lesson_no}</div>
                  <div style={{fontSize:15,fontWeight:700,fontFamily:'monospace',letterSpacing:2,color:'#111',marginBottom:10}}>{session.qr_code}</div>
                  <div style={{display:'inline-block',padding:10,background:'#fff',border:'1px solid #eee',borderRadius:12,boxShadow:'0 2px 12px rgba(0,0,0,0.08)',marginBottom:10}}>
                    <QRDisplay code={session.qr_code} size={200}/>
                  </div>
                  <div style={{fontSize:12,color:'#888',marginBottom:4}}>Sinh viên mở: <strong style={{color:'#0369a1'}}>yourapp.com/attend</strong></div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10,marginTop:8}}>
                    <span style={{fontSize:13,color:'#888'}}>Mã mới sau:</span>
                    <span style={{width:36,height:36,borderRadius:'50%',background:timerVal<=15?'#fef9c3':'#e0f2fe',color:timerVal<=15?'#92400e':'#0369a1',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,transition:'all 0.3s'}}>{timerVal}</span>
                    <button onClick={async()=>{const r=await api('refresh_qr',{session_id:session.id});if(r.ok){setSession(p=>({...p,...r.session}));setTimerVal(duration)}}} style={{padding:'6px 14px',borderRadius:8,border:'1px solid #ddd',background:'#f8f9fa',fontSize:13}}>🔄 Đổi ngay</button>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                  <div style={{background:'#dcfce7',borderRadius:12,padding:'12px',textAlign:'center'}}><div style={{fontSize:28,fontWeight:700,color:'#166534'}}>{present}</div><div style={{fontSize:12,color:'#166534'}}>Đã điểm danh</div></div>
                  <div style={{background:'#fce7f3',borderRadius:12,padding:'12px',textAlign:'center'}}><div style={{fontSize:28,fontWeight:700,color:'#9d174d'}}>{warned}</div><div style={{fontSize:12,color:'#9d174d'}}>Cần xem lại</div></div>
                </div>
                <div style={{display:'flex',gap:8,marginBottom:12}}>
                  <button onClick={()=>setShowManual(true)} style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',fontWeight:600,fontSize:13}}>✋ Thủ công</button>
                  <button onClick={endSession} style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',fontWeight:600,fontSize:13}}>⏹ Kết thúc</button>
                </div>
                <div style={{background:'#fff',borderRadius:16,padding:'1rem',boxShadow:'0 2px 12px rgba(0,0,0,0.06)'}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,gap:6,flexWrap:'wrap'}}>
                    <div style={{fontSize:12,color:'#888',fontWeight:600}}>DANH SÁCH ({present})</div>
                    <select value={liveSort} onChange={e=>setLiveSort(e.target.value)} style={{fontSize:12,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#fafafa'}}>
                      <option value="time">Thời gian</option>
                      <option value="status">Trạng thái</option>
                      <option value="name">Tên</option>
                      <option value="mssv">MSSV</option>
                    </select>
                  </div>
                  {!present&&<div style={{textAlign:'center',padding:'2rem',color:'#ccc',fontSize:13}}>Chưa có sinh viên điểm danh</div>}
                  {sortList(atts,liveSort).map((sv,i)=>(
                    <div key={sv.id||i} onClick={()=>setDetail(sv)} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 0',borderBottom:'1px solid #f5f5f5',cursor:'pointer'}}>
                      <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:sv.flags?.length?'#fce7f3':'#dcfce7',color:sv.flags?.length?'#9d174d':'#166534',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{initials(sv.name)}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600}}>{sv.name}</div>
                        <div style={{fontSize:11,color:'#888',marginBottom:2}}>{sv.mssv} • {fmtTime(sv.elapsed_sec||0)}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:2}}><Badges flags={sv.flags}/></div>
                        <SharedWith flags={sv.flags}/>
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

        {/* ── CLASSES TAB ── */}
        {tab==='classes'&&(
          historyCtx?(
            <LessonHistory {...historyCtx} password={password}
              onBack={()=>setHistoryCtx(null)}
              onUpdate={()=>{loadLessons(historyCtx.subject.id)}}/>
          ):(
            <>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <div style={{fontSize:15,fontWeight:700}}>Quản lý lớp học</div>
                <button onClick={()=>{setShowNewClass(true);setNewClassForm({name:'',code:'',term:'',total_students:''})}} style={{padding:'8px 14px',borderRadius:8,border:'none',background:'#111',color:'#fff',fontWeight:600,fontSize:13}}>+ Thêm lớp</button>
              </div>

              {!classes.length&&<div style={{background:'#fff',borderRadius:16,padding:'2rem',textAlign:'center',color:'#aaa',fontSize:13}}>Chưa có lớp nào.</div>}

              {classes.map(c=>(
                <div key={c.id} style={{background:'#fff',borderRadius:12,padding:'1rem',marginBottom:10,boxShadow:'0 1px 6px rgba(0,0,0,0.05)'}}>
                  {/* Class header */}
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                    <div style={{width:40,height:40,borderRadius:10,background:'#e0f2fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>📚</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700}}>{c.code}</div>
                      <div style={{fontSize:12,color:'#666'}}>{c.name} • {c.term}{c.total_students?` • ${c.total_students} SV`:''}</div>
                    </div>
                    <div style={{display:'flex',gap:4}}>
                      <button onClick={()=>setStudentMgrCls(c)} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #bae6fd',background:'#f0f9ff',color:'#0369a1',cursor:'pointer'}}>👥 DS SV</button>
                      <button onClick={()=>{setEditClass(c)}} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#f8f9fa',cursor:'pointer'}}>✏️</button>
                      <button onClick={async()=>{if(!confirm('Xóa lớp này? Toàn bộ dữ liệu sẽ bị xóa!'))return;await api('delete_class',{class_id:c.id});loadClasses()}} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',cursor:'pointer'}}>🗑️</button>
                      <button onClick={async()=>{if(expandedClass===c.id){setExpandedClass(null)}else{setExpandedClass(c.id);await loadSubjects(c.id)}}} style={{fontSize:11,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',background:'#f8f9fa',cursor:'pointer'}}>{expandedClass===c.id?'▲':'▼'}</button>
                    </div>
                  </div>

                  {/* Subjects */}
                  {expandedClass===c.id&&(
                    <div style={{borderTop:'1px solid #f0f0f0',paddingTop:10,marginTop:4}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                        <div style={{fontSize:12,color:'#888',fontWeight:600}}>MÔN HỌC</div>
                        <button onClick={()=>{setShowNewSubject(c.id);setNewSubjectForm({name:'',code:''})}} style={{fontSize:11,padding:'3px 8px',borderRadius:6,border:'1px solid #ddd',background:'#fafafa',cursor:'pointer'}}>+ Thêm môn</button>
                      </div>
                      {!(classSubjects[c.id]||[]).length&&<div style={{fontSize:12,color:'#aaa',marginBottom:8}}>Chưa có môn nào</div>}
                      {(classSubjects[c.id]||[]).map(sub=>(
                        <div key={sub.id} style={{marginBottom:8}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 8px',background:'#f8f9fa',borderRadius:8}}>
                            <span style={{fontSize:13,fontWeight:600,flex:1}}>📖 {sub.name}{sub.code?` (${sub.code})`:''}</span>
                            <button onClick={()=>setEditSubject(sub)} style={{fontSize:11,padding:'3px 7px',borderRadius:6,border:'1px solid #ddd',background:'#fff',cursor:'pointer'}}>✏️</button>
                            <button onClick={async()=>{if(!confirm('Xóa môn này?'))return;await api('delete_subject',{subject_id:sub.id});loadSubjects(c.id)}} style={{fontSize:11,padding:'3px 7px',borderRadius:6,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',cursor:'pointer'}}>🗑️</button>
                            <button onClick={async()=>{if(expandedSubject===sub.id){setExpandedSubject(null)}else{setExpandedSubject(sub.id);await loadLessons(sub.id)}}} style={{fontSize:11,padding:'3px 7px',borderRadius:6,border:'1px solid #ddd',background:'#fff',cursor:'pointer'}}>{expandedSubject===sub.id?'▲':'▼'}</button>
                          </div>
                          {/* Lessons */}
                          {expandedSubject===sub.id&&(
                            <div style={{paddingLeft:12,paddingTop:6}}>
                              {(subjectLessons[sub.id]||[]).map(l=>(
                                <div key={l.id} style={{display:'flex',alignItems:'center',gap:6,padding:'6px 0',borderBottom:'1px solid #f5f5f5'}}>
                                  <div style={{width:24,height:24,borderRadius:6,background:'#e0f2fe',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#0369a1',flexShrink:0}}>{l.lesson_no}</div>
                                  <div style={{flex:1,cursor:'pointer'}} onClick={()=>setHistoryCtx({lesson:l,subject:sub,cls:c})}>
                                    <div style={{fontSize:12,fontWeight:500,color:'#0369a1'}}>Buổi {l.lesson_no}{l.label?' — '+l.label:''}</div>
                                    <div style={{fontSize:11,color:'#aaa'}}>{fmtDate(l.date)}</div>
                                  </div>
                                  <button onClick={()=>{setEditLesson(l)}} style={{fontSize:11,padding:'3px 7px',borderRadius:6,border:'1px solid #ddd',background:'#f8f9fa',cursor:'pointer'}}>✏️</button>
                                  <button onClick={async()=>{if(!confirm('Xóa buổi này?'))return;await api('delete_lesson',{lesson_id:l.id});loadLessons(sub.id)}} style={{fontSize:11,padding:'3px 7px',borderRadius:6,border:'1px solid #fca5a5',background:'#fee2e2',color:'#b91c1c',cursor:'pointer'}}>🗑️</button>
                                </div>
                              ))}
                              <button onClick={()=>{setShowNewLesson({class_id:c.id,subject_id:sub.id});setNewLessonForm({lesson_no:(subjectLessons[sub.id]||[]).length+1,label:'',date:new Date().toISOString().slice(0,10)})}}
                                style={{width:'100%',padding:'6px',borderRadius:8,border:'1px dashed #ddd',background:'#fafafa',color:'#666',fontSize:12,marginTop:6,cursor:'pointer'}}>
                                + Thêm buổi học
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )
        )}
      </div>

      {/* ── Modals ── */}
      {showNewClass&&(
        <Modal title="Tạo lớp mới" onClose={()=>setShowNewClass(false)}>
          <Field label="Mã lớp *"><input value={newClassForm.code} onChange={e=>setNewClassForm({...newClassForm,code:e.target.value})} placeholder="VD: YT01"/></Field>
          <Field label="Tên lớp *"><input value={newClassForm.name} onChange={e=>setNewClassForm({...newClassForm,name:e.target.value})} placeholder="VD: Điều dưỡng K10"/></Field>
          <Field label="Học kỳ"><input value={newClassForm.term} onChange={e=>setNewClassForm({...newClassForm,term:e.target.value})} placeholder="VD: HK1 2024-2025"/></Field>
          <Field label="Sĩ số"><input type="number" value={newClassForm.total_students} onChange={e=>setNewClassForm({...newClassForm,total_students:e.target.value})} placeholder="VD: 35"/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setShowNewClass(false)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{const d=await api('create_class',newClassForm);if(d.ok){await loadClasses();setShowNewClass(false)}}}>✅ Tạo lớp</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {editClass&&(
        <Modal title="Sửa lớp" onClose={()=>setEditClass(null)}>
          <Field label="Mã lớp"><input defaultValue={editClass.code} id="ec-code" placeholder="YT01"/></Field>
          <Field label="Tên lớp"><input defaultValue={editClass.name} id="ec-name" placeholder="Điều dưỡng K10"/></Field>
          <Field label="Học kỳ"><input defaultValue={editClass.term} id="ec-term"/></Field>
          <Field label="Sĩ số"><input type="number" defaultValue={editClass.total_students} id="ec-total"/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setEditClass(null)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{
              await api('update_class',{class_id:editClass.id,code:document.getElementById('ec-code').value,name:document.getElementById('ec-name').value,term:document.getElementById('ec-term').value,total_students:document.getElementById('ec-total').value})
              await loadClasses();setEditClass(null)
            }}>💾 Lưu</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {showNewSubject&&(
        <Modal title="Thêm môn học" onClose={()=>setShowNewSubject(null)}>
          <Field label="Tên môn *"><input value={newSubjectForm.name} onChange={e=>setNewSubjectForm({...newSubjectForm,name:e.target.value})} placeholder="VD: Giải phẫu học"/></Field>
          <Field label="Mã môn (tuỳ chọn)"><input value={newSubjectForm.code} onChange={e=>setNewSubjectForm({...newSubjectForm,code:e.target.value})} placeholder="VD: GPH01"/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setShowNewSubject(null)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{const d=await api('create_subject',{class_id:showNewSubject,...newSubjectForm});if(d.ok){await loadSubjects(showNewSubject);setShowNewSubject(null)}}}>✅ Tạo môn</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {editSubject&&(
        <Modal title="Sửa môn học" onClose={()=>setEditSubject(null)}>
          <Field label="Tên môn"><input defaultValue={editSubject.name} id="es-name"/></Field>
          <Field label="Mã môn"><input defaultValue={editSubject.code} id="es-code"/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setEditSubject(null)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{await api('update_subject',{subject_id:editSubject.id,name:document.getElementById('es-name').value,code:document.getElementById('es-code').value});await loadSubjects(editSubject.class_id);setEditSubject(null)}}>💾 Lưu</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {showNewLesson&&(
        <Modal title="Thêm buổi học" onClose={()=>setShowNewLesson(null)}>
          <Field label="Số buổi *"><input type="number" value={newLessonForm.lesson_no} onChange={e=>setNewLessonForm({...newLessonForm,lesson_no:e.target.value})} placeholder="1"/></Field>
          <Field label="Tên buổi (tuỳ chọn)"><input value={newLessonForm.label} onChange={e=>setNewLessonForm({...newLessonForm,label:e.target.value})} placeholder="VD: Chương 1 - Giới thiệu"/></Field>
          <Field label="Ngày"><input type="date" value={newLessonForm.date} onChange={e=>setNewLessonForm({...newLessonForm,date:e.target.value})}/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setShowNewLesson(null)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{const d=await api('create_lesson',{...showNewLesson,...newLessonForm});if(d.ok){await loadLessons(showNewLesson.subject_id);setSelLesson(d.lesson);setShowNewLesson(null)}}}>✅ Tạo buổi</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {editLesson&&(
        <Modal title="Sửa buổi học" onClose={()=>setEditLesson(null)}>
          <Field label="Số buổi"><input type="number" defaultValue={editLesson.lesson_no} id="el-no"/></Field>
          <Field label="Tên buổi"><input defaultValue={editLesson.label} id="el-label" placeholder="Chương 1..."/></Field>
          <Field label="Ngày"><input type="date" defaultValue={editLesson.date} id="el-date"/></Field>
          <BtnRow>
            <BtnSecondary onClick={()=>setEditLesson(null)}>Hủy</BtnSecondary>
            <BtnPrimary onClick={async()=>{await api('update_lesson',{lesson_id:editLesson.id,lesson_no:document.getElementById('el-no').value,label:document.getElementById('el-label').value,date:document.getElementById('el-date').value});await loadLessons(editLesson.subject_id);setEditLesson(null)}}>💾 Lưu</BtnPrimary>
          </BtnRow>
        </Modal>
      )}

      {showManual&&session&&<ManualModal password={password} sessionId={session.id} onClose={()=>setShowManual(false)}/>}
      {studentMgrCls&&<StudentManager cls={studentMgrCls} password={password} onClose={()=>setStudentMgrCls(null)}/>}

      {detail&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:100,display:'flex',alignItems:'flex-end'}} onClick={()=>setDetail(null)}>
          <div style={{background:'#fff',borderRadius:'16px 16px 0 0',padding:20,width:'100%',maxWidth:500,margin:'0 auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:16,fontWeight:700,marginBottom:2}}>{detail.name}</div>
            <div style={{fontSize:12,color:'#888',marginBottom:12}}>{detail.mssv} • {fmtTime(detail.elapsed_sec||0)}</div>
            {!detail.flags?.length&&<div style={{fontSize:13,color:'#166534',marginBottom:8}}>✅ Không có cờ bất thường</div>}
            {detail.flags?.filter(f=>FLAG_META[f]).map(f=>{const m=FLAG_META[f];return<div key={f} style={{padding:'7px 10px',borderRadius:8,background:m.bg,color:m.color,fontSize:12,fontWeight:600,marginBottom:5}}>{m.label}</div>})}
            <SharedWith flags={detail.flags}/>
            {detail.lat&&<div style={{fontSize:11,color:'#aaa',marginTop:8,fontFamily:'monospace'}}>📍 {detail.lat.toFixed(5)}, {detail.lng.toFixed(5)} (±{Math.round(detail.gps_accuracy||0)}m)</div>}
            {detail.manual_note&&<div style={{fontSize:12,color:'#0369a1',marginTop:6}}>📝 {detail.manual_note}</div>}
            <button onClick={()=>setDetail(null)} style={{marginTop:14,width:'100%',padding:'10px',borderRadius:10,border:'1px solid #ddd',background:'#f8f9fa',fontSize:14}}>Đóng</button>
          </div>
        </div>
      )}
    </>
  )
}
