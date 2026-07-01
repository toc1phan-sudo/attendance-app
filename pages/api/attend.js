import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

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
  if (req.method !== 'POST') return res.status(405).end()
  try {
  const { qr_code, name, mssv, gps_granted, lat, lng, gps_accuracy, fingerprint } = req.body
  if (!name || !mssv) return res.status(400).json({ ok:false, reason:'Thiếu thông tin' })
  if (!qr_code) return res.status(400).json({ ok:false, reason:'Thiếu mã phiên' })

  const now = Date.now()
  const flags = []
  let expired_qr = false
  let session = null

  // Tìm phiên active với mã QR này
  const { data: activeSession } = await supabaseAdmin
    .from('sessions').select('id,created_at,active,qr_code,duration_sec')
    .eq('qr_code', qr_code).eq('active', true).single()

  if (activeSession) {
    session = activeSession
  } else {
    // Tìm phiên đã hết hạn (mã QR cũ)
    const { data: expiredSession } = await supabaseAdmin
      .from('sessions').select('id,created_at,active,qr_code')
      .eq('qr_code', qr_code).single()

    if (!expiredSession) return res.status(400).json({ ok:false, reason:'Mã QR không hợp lệ. Hãy nhập mã mới từ màn hình chiếu.' })

    // Kiểm tra xem có phiên active nào cùng lesson không
    const { data: sameLesson } = await supabaseAdmin
      .from('sessions').select('id,created_at,lesson_id')
      .eq('lesson_id', expiredSession.lesson_id || '').eq('active', true).single()

    if (!sameLesson) return res.status(400).json({ ok:false, reason:'Phiên điểm danh đã kết thúc.' })

    // Cho điểm danh vào phiên active, nhưng flag expired_qr
    session = sameLesson
    expired_qr = true
    flags.push('expired-qr')
  }

  const elapsed_sec = Math.round((now - new Date(session.created_at).getTime()) / 1000)

  // Lấy lesson_id của session hiện tại
  const { data: sessionInfo } = await supabaseAdmin
    .from('sessions').select('lesson_id').eq('id', session.id).single()
  const lessonId = sessionInfo?.lesson_id || null

  // Kiểm tra đã điểm danh trong buổi này chưa (tất cả sessions cùng lesson)
  if (lessonId) {
    const { data: sessionsSameLesson } = await supabaseAdmin
      .from('sessions').select('id').eq('lesson_id', lessonId)
    if (sessionsSameLesson?.length) {
      const ids = sessionsSameLesson.map(s=>s.id)
      const { data: alreadyIn } = await supabaseAdmin
        .from('attendances').select('id').eq('mssv', mssv).in('session_id', ids).limit(1)
      if (alreadyIn?.length)
        return res.status(400).json({ ok:false, reason:'Bạn đã điểm danh buổi này rồi.' })
    }
  }

  // GPS checks
  if (!gps_granted) flags.push('no-gps')
  if (gps_granted && lat && lng) {
    const { data: existing } = await supabaseAdmin
      .from('attendances').select('lat,lng').eq('session_id', session.id).eq('gps_granted',true).not('lat','is',null)
    if (existing?.length >= 5) {
      const dist = haversineM(lat, lng, median(existing.map(r=>r.lat)), median(existing.map(r=>r.lng)))
      if (dist > 200) flags.push('gps-outlier')
    }
  }

  // Trễ — tính theo duration_sec của session (giáo viên tự set)
  const duration = session.duration_sec || 60
  if (elapsed_sec > duration && !expired_qr) flags.push('late')

  // Device fingerprint
  let sharedWithName = null
  if (fingerprint) {
    const { data: sameDevice } = await supabaseAdmin
      .from('attendances').select('id,flags,mssv,name,status')
      .eq('session_id', session.id).eq('fingerprint', fingerprint).neq('mssv', mssv).limit(1)
    if (sameDevice?.length) {
      const prev = sameDevice[0]
      sharedWithName = prev.name  // lưu tên SV dùng chung để ghi vào flag
      flags.push('device-reuse')
      // Cập nhật SV trước: thêm flag device-shared + set pending
      const prevFlags = prev.flags||[]
      const newPrevFlags = prevFlags.includes('device-shared') ? prevFlags : [...prevFlags,'device-shared']
      // Thêm tên người dùng chung vào flags của SV trước
      const newPrevFlagsWithName = newPrevFlags.filter(f=>!f.startsWith('shared-with:'))
      newPrevFlagsWithName.push('shared-with:' + name)
      await supabaseAdmin.from('attendances')
        .update({ flags: newPrevFlagsWithName, status: 'pending' })
        .eq('id', prev.id)
    }
    const ninetyAgo = new Date(now-90000).toISOString()
    const { data: rapid } = await supabaseAdmin
      .from('attendances').select('mssv,name').eq('fingerprint', fingerprint)
      .neq('mssv', mssv).gte('submitted_at', ninetyAgo).limit(1)
    if (rapid?.length && !flags.includes('device-reuse')) {
      flags.push('device-rapid')
      sharedWithName = sharedWithName || rapid[0].name
    }
  }

  // Xác định status ban đầu
  const status = flags.length > 0 ? 'pending' : 'valid'

  // Encode shared_with name into flags array as "shared-with:TênSV"
  // (tránh lỗi schema cache với cột shared_with mới)
  if (sharedWithName) {
    flags.push('shared-with:' + sharedWithName)
  }

  const { error } = await supabaseAdmin.from('attendances').insert({
    session_id: session.id,
    name, mssv, gps_granted,
    lat: lat||null, lng: lng||null, gps_accuracy: gps_accuracy||null,
    fingerprint: fingerprint||null,
    elapsed_sec, flags, expired_qr, status
  })

  if (error) return res.status(500).json({ ok:false, reason:'DB error: ' + error.message })
  return res.status(200).json({ ok:true, flags })
  } catch(e) {
    return res.status(500).json({ ok:false, reason:'Exception: ' + e.message })
  }
}
