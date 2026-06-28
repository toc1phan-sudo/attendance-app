import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return [3,4,3].map(n => Array.from({length:n}, () => chars[Math.floor(Math.random()*chars.length)]).join('')).join('-')
}

export default async function handler(req, res) {
  const body = req.method === 'POST' ? req.body : req.query
  const { password, action } = body
  if (password !== process.env.TEACHER_PASSWORD)
    return res.status(401).json({ ok: false, reason: 'Sai mật khẩu' })

  try {

  // ── CLASSES ────────────────────────────────────────────────────────────────
  if (action === 'get_classes') {
    const { data } = await supabaseAdmin.from('classes').select('*').order('created_at',{ascending:false})
    return res.json({ ok:true, classes: data||[] })
  }
  if (action === 'create_class') {
    const { name, code, term, total_students } = body
    const { data, error } = await supabaseAdmin.from('classes')
      .insert({ name, code, term, total_students: parseInt(total_students)||0 }).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, class: data })
  }
  if (action === 'update_class') {
    const { class_id, name, code, term, total_students } = body
    const { error } = await supabaseAdmin.from('classes')
      .update({ name, code, term, total_students: parseInt(total_students)||0 }).eq('id', class_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }
  if (action === 'delete_class') {
    const { class_id } = body
    const { error } = await supabaseAdmin.from('classes').delete().eq('id', class_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }

  // ── SUBJECTS ───────────────────────────────────────────────────────────────
  if (action === 'get_subjects') {
    const { class_id } = body
    const { data } = await supabaseAdmin.from('subjects').select('*')
      .eq('class_id', class_id).order('created_at',{ascending:true})
    return res.json({ ok:true, subjects: data||[] })
  }
  if (action === 'create_subject') {
    const { class_id, name, code } = body
    const { data, error } = await supabaseAdmin.from('subjects')
      .insert({ class_id, name, code }).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, subject: data })
  }
  if (action === 'update_subject') {
    const { subject_id, name, code } = body
    const { error } = await supabaseAdmin.from('subjects')
      .update({ name, code }).eq('id', subject_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }
  if (action === 'delete_subject') {
    const { subject_id } = body
    const { error } = await supabaseAdmin.from('subjects').delete().eq('id', subject_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }

  // ── STUDENTS ───────────────────────────────────────────────────────────────
  if (action === 'get_students') {
    const { class_id } = body
    const { data } = await supabaseAdmin.from('students').select('*')
      .eq('class_id', class_id).order('mssv',{ascending:true})
    return res.json({ ok:true, students: data||[] })
  }
  if (action === 'add_student') {
    const { class_id, name, mssv } = body
    const { data, error } = await supabaseAdmin.from('students')
      .insert({ class_id, name, mssv }).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, student: data })
  }
  if (action === 'import_students') {
    // bulk import: students = [{name, mssv}]
    const { class_id, students } = body
    const rows = students.map(s => ({ class_id, name: s.name.trim(), mssv: s.mssv.trim() }))
    const { error } = await supabaseAdmin.from('students')
      .upsert(rows, { onConflict: 'class_id,mssv' })
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }
  if (action === 'delete_student') {
    const { student_id } = body
    const { error } = await supabaseAdmin.from('students').delete().eq('id', student_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }

  // ── LESSONS ────────────────────────────────────────────────────────────────
  if (action === 'get_lessons') {
    const { subject_id } = body
    const { data } = await supabaseAdmin.from('lessons').select('*')
      .eq('subject_id', subject_id).order('lesson_no',{ascending:true})
    return res.json({ ok:true, lessons: data||[] })
  }
  if (action === 'create_lesson') {
    const { class_id, subject_id, lesson_no, label, date } = body
    const { data, error } = await supabaseAdmin.from('lessons')
      .insert({ class_id, subject_id, lesson_no: parseInt(lesson_no), label, date: date||new Date().toISOString().slice(0,10) })
      .select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, lesson: data })
  }
  if (action === 'update_lesson') {
    const { lesson_id, lesson_no, label, date } = body
    const { error } = await supabaseAdmin.from('lessons')
      .update({ lesson_no: parseInt(lesson_no), label, date }).eq('id', lesson_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }
  if (action === 'delete_lesson') {
    const { lesson_id } = body
    const { error } = await supabaseAdmin.from('lessons').delete().eq('id', lesson_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }

  // ── SESSIONS ───────────────────────────────────────────────────────────────
  if (action === 'create_session') {
    const { class_id, lesson_id, duration_sec } = body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin.from('sessions')
      .insert({ class_id, lesson_id, qr_code, active:true, duration_sec: parseInt(duration_sec)||60 })
      .select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, session: data })
  }
  if (action === 'refresh_qr') {
    const { session_id } = body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin.from('sessions')
      .update({ qr_code, created_at: new Date().toISOString() })
      .eq('id', session_id).select().single()
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true, session: data })
  }
  if (action === 'end_session') {
    const { session_id } = body
    await supabaseAdmin.from('sessions')
      .update({ active:false, ended_at: new Date().toISOString() }).eq('id', session_id)
    return res.json({ ok:true })
  }

  // ── ATTENDANCES ────────────────────────────────────────────────────────────
  if (action === 'get_lesson_attendances') {
    const { lesson_id } = body
    const { data: sessions } = await supabaseAdmin.from('sessions').select('id,qr_code,created_at,active,duration_sec')
      .eq('lesson_id', lesson_id)
    if (!sessions?.length) return res.json({ ok:true, attendances:[], sessions:[] })
    const { data: attendances } = await supabaseAdmin.from('attendances').select('*')
      .in('session_id', sessions.map(s=>s.id)).order('submitted_at',{ascending:true})
    return res.json({ ok:true, attendances: attendances||[], sessions })
  }
  if (action === 'update_status') {
    const { attendance_id, status } = body
    const { error } = await supabaseAdmin.from('attendances').update({ status }).eq('id', attendance_id)
    if (error) return res.status(500).json({ ok:false, reason: error.message })
    return res.json({ ok:true })
  }
  if (action === 'manual_note') {
    const { session_id, name, mssv, note } = body
    const { data: existing } = await supabaseAdmin.from('attendances').select('id,flags')
      .eq('session_id', session_id).eq('mssv', mssv).single()
    if (existing) {
      const flags = existing.flags||[]
      if (!flags.includes('manual-note')) flags.push('manual-note')
      await supabaseAdmin.from('attendances').update({ manual_note:note, flags, status:'valid' }).eq('id', existing.id)
    } else {
      await supabaseAdmin.from('attendances').insert({
        session_id, name, mssv, gps_granted:false,
        elapsed_sec:0, flags:['manual-verify'], manual_note:note, status:'valid'
      })
    }
    return res.json({ ok:true })
  }

  return res.status(400).json({ ok:false, reason:'Action không hợp lệ' })

  } catch(e) {
    return res.status(500).json({ ok:false, reason:'Exception: ' + e.message })
  }
}
