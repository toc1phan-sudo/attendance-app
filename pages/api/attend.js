import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Haversine distance in meters
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
function median(arr) {
  if (!arr.length) return 0
  const s = [...arr].sort((a,b)=>a-b), m = Math.floor(s.length/2)
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { qr_code, name, mssv, gps_granted, lat, lng, gps_accuracy, fingerprint } = req.body
  if (!qr_code || !name || !mssv) return res.status(400).json({ ok: false, reason: 'Thiếu thông tin' })

  // 1. Tìm phiên theo mã QR
  const { data: session, error: sessErr } = await supabaseAdmin
    .from('sessions')
    .select('id, created_at, active')
    .eq('qr_code', qr_code)
    .single()

  if (sessErr || !session) return res.status(400).json({ ok: false, reason: 'Mã QR không hợp lệ' })
  if (!session.active) return res.status(400).json({ ok: false, reason: 'Phiên điểm danh đã kết thúc' })

  const elapsed_sec = Math.round((Date.now() - new Date(session.created_at).getTime()) / 1000)
  const flags = []

  // 2. Không GPS
  if (!gps_granted) flags.push('no-gps')

  // 3. GPS outlier — so sánh với trung vị cả lớp, cần ≥5 SV có GPS
  if (gps_granted && lat && lng) {
    const { data: existing } = await supabaseAdmin
      .from('attendances')
      .select('lat, lng')
      .eq('session_id', session.id)
      .eq('gps_granted', true)
      .not('lat', 'is', null)

    if (existing && existing.length >= 5) {
      const medLat = median(existing.map(r => r.lat))
      const medLng = median(existing.map(r => r.lng))
      const dist = haversineM(lat, lng, medLat, medLng)
      if (dist > 200) flags.push('gps-outlier')
    }
  }

  // 4. Trễ
  if (elapsed_sec > 60) flags.push('late')

  // 5. Device fingerprint trùng trong phiên
  if (fingerprint) {
    const { data: sameDevice } = await supabaseAdmin
      .from('attendances')
      .select('mssv, name')
      .eq('session_id', session.id)
      .eq('fingerprint', fingerprint)
      .neq('mssv', mssv)
      .limit(1)

    if (sameDevice && sameDevice.length > 0) {
      flags.push('device-reuse')
      // Đánh dấu sinh viên trước đó
      const { data: prevRow } = await supabaseAdmin
        .from('attendances')
        .select('id, flags')
        .eq('session_id', session.id)
        .eq('fingerprint', fingerprint)
        .limit(1)
      if (prevRow && prevRow.length > 0) {
        const prevFlags = prevRow[0].flags || []
        if (!prevFlags.includes('device-shared')) {
          await supabaseAdmin
            .from('attendances')
            .update({ flags: [...prevFlags, 'device-shared'] })
            .eq('id', prevRow[0].id)
        }
      }
    }

    // 6. Nộp nhanh < 90s cùng thiết bị
    const ninetySecsAgo = new Date(Date.now() - 90000).toISOString()
    const { data: rapidSub } = await supabaseAdmin
      .from('attendances')
      .select('mssv')
      .eq('fingerprint', fingerprint)
      .neq('mssv', mssv)
      .gte('submitted_at', ninetySecsAgo)
      .limit(1)

    if (rapidSub && rapidSub.length > 0 && !flags.includes('device-reuse')) {
      flags.push('device-rapid')
    }
  }

  // 7. Lưu vào DB
  const { error: insertErr } = await supabaseAdmin
    .from('attendances')
    .insert({
      session_id: session.id,
      name, mssv, gps_granted,
      lat: lat || null,
      lng: lng || null,
      gps_accuracy: gps_accuracy || null,
      fingerprint: fingerprint || null,
      elapsed_sec,
      flags,
    })

  if (insertErr) return res.status(500).json({ ok: false, reason: 'Lỗi server, thử lại' })

  return res.status(200).json({ ok: true, flags })
}
