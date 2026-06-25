import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return [3,4,3].map(n => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('')).join('-')
}

function haversineM(lat1,lng1,lat2,lng2){
  const R=6371000,dLat=(lat2-lat1)*Math.PI/180,dLng=(lng2-lng1)*Math.PI/180
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
}
function median(arr){
  if(!arr.length)return 0
  const s=[...arr].sort((a,b)=>a-b),m=Math.floor(s.length/2)
  return s.length%2?s[m]:(s[m-1]+s[m])/2
}

export default async function handler(req, res) {
  const body = req.method === 'POST' ? req.body : req.query
  const { password, action } = body

  if (password !== process.env.TEACHER_PASSWORD)
    return res.status(401).json({ ok: false, reason: 'Sai mật khẩu' })

  // ── Lấy danh sách lớp ──────────────────────────────────────────────────────
  if (action === 'get_classes') {
    const { data } = await supabaseAdmin.from('classes').select('*').order('created_at',{ascending:false})
    return res.json({ ok:true, classes: data||[] })
  }

  // ── Tạo lớp mới ────────────────────────────────────────────────────────────
  if (action === 'create_class') {
    const { name, code, term } = body
    const { data, error } = await supabaseAdmin.from('classes').insert({ name, code, term }).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, class: data })
  }

  // ── Lấy buổi học của lớp ───────────────────────────────────────────────────
  if (action === 'get_lessons') {
    const { class_id } = body
    const { data } = await supabaseAdmin
      .from('lessons').select('*')
      .eq('class_id', class_id)
      .order('lesson_no', {ascending:true})
    return res.json({ ok:true, lessons: data||[] })
  }

  // ── Tạo buổi học mới ───────────────────────────────────────────────────────
  if (action === 'create_lesson') {
    const { class_id, lesson_no, label, date } = body
    const { data, error } = await supabaseAdmin
      .from('lessons').insert({ class_id, lesson_no, label, date: date||new Date().toISOString().slice(0,10) })
      .select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, lesson: data })
  }

  // ── Tạo phiên điểm danh (gắn với buổi) ────────────────────────────────────
  if (action === 'create_session') {
    const { class_id, lesson_id } = body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin
      .from('sessions').insert({ class_id, lesson_id, qr_code, active:true }).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, session: data })
  }

  // ── Đổi mã QR ──────────────────────────────────────────────────────────────
  if (action === 'refresh_qr') {
    const { session_id } = body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin
      .from('sessions').update({ qr_code, created_at: new Date().toISOString() })
      .eq('id', session_id).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, session: data })
  }

  // ── Kết thúc phiên ─────────────────────────────────────────────────────────
  if (action === 'end_session') {
    const { session_id } = body
    await supabaseAdmin.from('sessions')
      .update({ active:false, ended_at: new Date().toISOString() })
      .eq('id', session_id)
    return res.json({ ok:true })
  }

  // ── Kết thúc buổi học (finalize) ───────────────────────────────────────────
  if (action === 'finalize_lesson') {
    const { lesson_id } = body
    await supabaseAdmin.from('lessons').update({ finalized:true }).eq('id', lesson_id)
    return res.json({ ok:true })
  }

  // ── Lấy tất cả điểm danh của 1 buổi (gộp nhiều phiên) ────────────────────
  if (action === 'get_lesson_attendances') {
    const { lesson_id } = body
    // Lấy tất cả sessions của buổi này
    const { data: sessions } = await supabaseAdmin
      .from('sessions').select('id,qr_code,created_at,active')
      .eq('lesson_id', lesson_id)
    if (!sessions?.length) return res.json({ ok:true, attendances:[], sessions:[] })

    const sessionIds = sessions.map(s=>s.id)
    const { data: attendances } = await supabaseAdmin
      .from('attendances').select('*')
      .in('session_id', sessionIds)
      .order('submitted_at',{ascending:true})
    return res.json({ ok:true, attendances: attendances||[], sessions })
  }

  // ── Cập nhật trạng thái sinh viên ─────────────────────────────────────────
  if (action === 'update_status') {
    const { attendance_id, status } = body
    const { error } = await supabaseAdmin
      .from('attendances').update({ status }).eq('id', attendance_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }

  // ── Ghi chú thủ công ───────────────────────────────────────────────────────
  if (action === 'manual_note') {
    const { session_id, lesson_id, name, mssv, note } = body
    const { data: existing } = await supabaseAdmin
      .from('attendances').select('id,flags')
      .eq('session_id', session_id).eq('mssv', mssv).single()
    if (existing) {
      const flags = existing.flags||[]
      if (!flags.includes('manual-note')) flags.push('manual-note')
      await supabaseAdmin.from('attendances')
        .update({ manual_note:note, flags, status:'valid' }).eq('id', existing.id)
    } else {
      await supabaseAdmin.from('attendances').insert({
        session_id, name, mssv, gps_granted:false,
        elapsed_sec:0, flags:['manual-verify'],
        manual_note:note, status:'valid'
      })
    }
    return res.json({ ok:true })
  }

  return res.status(400).json({ ok:false, reason:'Action không hợp lệ' })
}
