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
  // Kiểm tra mật khẩu giáo viên
  const { password, action } = req.body || req.query
  if (password !== process.env.TEACHER_PASSWORD) {
    return res.status(401).json({ ok: false, reason: 'Sai mật khẩu' })
  }

  // --- Tạo phiên mới ---
  if (action === 'create_session') {
    const { class_id } = req.body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin
      .from('sessions')
      .insert({ class_id, qr_code, active: true })
      .select()
      .single()
    if (error) return res.status(500).json({ ok: false, reason: error.message })
    return res.json({ ok: true, session: data })
  }

  // --- Đổi mã QR (refresh) ---
  if (action === 'refresh_qr') {
    const { session_id } = req.body
    const qr_code = genCode()
    const { data, error } = await supabaseAdmin
      .from('sessions')
      .update({ qr_code, created_at: new Date().toISOString() })
      .eq('id', session_id)
      .select()
      .single()
    if (error) return res.status(500).json({ ok: false, reason: error.message })
    return res.json({ ok: true, session: data })
  }

  // --- Kết thúc phiên ---
  if (action === 'end_session') {
    const { session_id } = req.body
    await supabaseAdmin
      .from('sessions')
      .update({ active: false, ended_at: new Date().toISOString() })
      .eq('id', session_id)
    return res.json({ ok: true })
  }

  // --- Ghi chú thủ công ---
  if (action === 'manual_note') {
    const { session_id, name, mssv, note } = req.body
    // Kiểm tra SV đã điểm danh chưa
    const { data: existing } = await supabaseAdmin
      .from('attendances')
      .select('id, flags')
      .eq('session_id', session_id)
      .eq('mssv', mssv)
      .single()

    if (existing) {
      // Cập nhật ghi chú
      const flags = existing.flags || []
      if (!flags.includes('manual-note')) flags.push('manual-note')
      await supabaseAdmin.from('attendances').update({ manual_note: note, flags }).eq('id', existing.id)
    } else {
      // Thêm mới (SV không điểm danh được qua app)
      await supabaseAdmin.from('attendances').insert({
        session_id, name, mssv,
        gps_granted: false,
        elapsed_sec: 0,
        flags: ['manual-verify'],
        manual_note: note,
      })
    }
    return res.json({ ok: true })
  }

  // --- Tạo lớp mới ---
  if (action === 'create_class') {
    const { name, code, term } = req.body
    const { data, error } = await supabaseAdmin
      .from('classes')
      .insert({ name, code, term })
      .select()
      .single()
    if (error) return res.status(500).json({ ok: false, reason: error.message })
    return res.json({ ok: true, class: data })
  }

  // --- Lấy danh sách lớp ---
  if (action === 'get_classes') {
    const { data } = await supabaseAdmin.from('classes').select('*').order('created_at', { ascending: false })
    return res.json({ ok: true, classes: data || [] })
  }

  return res.status(400).json({ ok: false, reason: 'Action không hợp lệ' })
}
