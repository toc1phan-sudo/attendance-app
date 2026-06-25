import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'

function getFingerprint() {
  const parts = [navigator.userAgent,navigator.language,navigator.hardwareConcurrency,screen.width+'x'+screen.height,screen.colorDepth,Intl.DateTimeFormat().resolvedOptions().timeZone]
  const str = parts.join('|')
  let h = 0x811c9dc5
  for (let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=(h*0x01000193)>>>0}
  return h.toString(16).toUpperCase()
}

export default function AttendPage() {
  const [step, setStep]             = useState('form')
  const [name, setName]             = useState('')
  const [mssv, setMssv]             = useState('')
  const [qrCode, setQrCode]         = useState('')
  const [gpsStatus, setGpsStatus]   = useState('idle')
  const [gpsCoords, setGpsCoords]   = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState(null)
  const [errorMsg, setErrorMsg]     = useState('')
  const fp = useRef(null)

  useEffect(() => {
    fp.current = getFingerprint()
    // Lấy mã session từ URL ?session=XYZ
    const params = new URLSearchParams(window.location.search)
    const s = params.get('session')
    if (s) setQrCode(s.toUpperCase())
  }, [])

  const requestGps = () => new Promise(resolve => {
    if (!navigator.geolocation) { resolve({ granted:false }); return }
    setGpsStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy }
        setGpsStatus('granted'); setGpsCoords(coords); resolve({ granted:true, coords })
      },
      () => { setGpsStatus('denied'); resolve({ granted:false }) },
      { timeout:15000, maximumAge:0, enableHighAccuracy:true }
    )
  })

  const submit = async () => {
    if (!name || !mssv || submitting) return
    setSubmitting(true)
    let gps = { granted: gpsStatus==='granted', coords: gpsCoords }
    if (gpsStatus==='idle') gps = await requestGps()

    try {
      const res = await fetch('/api/attend', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          qr_code: qrCode.trim().toUpperCase(),
          name: name.trim(), mssv: mssv.trim(),
          gps_granted: gps.granted,
          lat: gps.coords?.lat||null, lng: gps.coords?.lng||null,
          gps_accuracy: gps.coords?.acc||null,
          fingerprint: fp.current,
        })
      })
      const data = await res.json()
      if (data.ok) { setResult(data); setStep('success') }
      else { setErrorMsg(data.reason||'Có lỗi xảy ra'); setStep('error') }
    } catch { setErrorMsg('Không kết nối được. Kiểm tra mạng và thử lại.'); setStep('error') }
    setSubmitting(false)
  }

  const reset = () => { setStep('form'); setName(''); setMssv(''); setGpsStatus('idle'); setGpsCoords(null); setResult(null); setErrorMsg('') }

  const s = {
    wrap:  { maxWidth:420, margin:'0 auto', padding:'1rem' },
    card:  { background:'#fff', borderRadius:16, padding:'1.5rem', boxShadow:'0 2px 16px rgba(0,0,0,0.08)' },
    label: { fontSize:12, color:'#555', display:'block', marginBottom:5, fontWeight:500 },
    group: { marginBottom:14 },
    btn:   (off) => ({ width:'100%', padding:'12px', borderRadius:10, border:'none', background:off?'#ccc':'#111', color:'#fff', fontWeight:700, fontSize:15, cursor:off?'default':'pointer', marginTop:4 }),
  }

  return (
    <>
      <Head>
        <title>Điểm danh</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
      </Head>
      <div style={{background:'#0ea5e9',padding:'1rem',marginBottom:'1rem'}}>
        <div style={s.wrap}>
          <div style={{color:'#fff',fontWeight:700,fontSize:18}}>📋 Điểm danh</div>
          <div style={{color:'rgba(255,255,255,0.8)',fontSize:12,marginTop:2}}>Nhập thông tin để xác nhận có mặt</div>
        </div>
      </div>
      <div style={s.wrap}>
        <div style={s.card}>

          {step==='form' && (
            <>
              <div style={s.group}>
                <label style={s.label}>Họ và tên</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="Nguyễn Văn A"/>
              </div>
              <div style={s.group}>
                <label style={s.label}>Mã số sinh viên</label>
                <input value={mssv} onChange={e=>setMssv(e.target.value)} placeholder="21001234" inputMode="numeric"/>
              </div>

              {/* GPS Banner */}
              {gpsStatus==='idle' && (
                <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#0369a1',marginBottom:4}}>📍 Yêu cầu vị trí khi xác nhận</div>
                  <div style={{fontSize:12,color:'#0369a1',lineHeight:1.6}}>Trình duyệt sẽ hỏi quyền vị trí.<br/>Hãy nhấn <strong>"Cho phép" / "Allow"</strong> để điểm danh hợp lệ.</div>
                </div>
              )}
              {gpsStatus==='requesting' && (
                <div style={{background:'#fef9c3',border:'1px solid #fde047',borderRadius:10,padding:'12px 14px',marginBottom:14,textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#854d0e'}}>⏳ Đang chờ bạn cho phép vị trí…</div>
                  <div style={{fontSize:12,color:'#854d0e',marginTop:4}}>Nhấn <strong>"Cho phép" / "Allow"</strong> trên hộp thoại phía trên</div>
                </div>
              )}
              {gpsStatus==='granted' && (
                <div style={{background:'#dcfce7',border:'1px solid #86efac',borderRadius:10,padding:'10px 14px',marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:20}}>✅</span>
                  <div>
                    <div style={{fontSize:13,fontWeight:600,color:'#166534'}}>Đã chia sẻ vị trí</div>
                    <div style={{fontSize:11,color:'#166534'}}>Vị trí của bạn đã được ghi nhận</div>
                  </div>
                </div>
              )}
              {gpsStatus==='denied' && (
                <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
                  <div style={{fontSize:13,fontWeight:600,color:'#9a3412',marginBottom:4}}>⚠️ Chưa cho phép vị trí</div>
                  <div style={{fontSize:12,color:'#9a3412',lineHeight:1.6,marginBottom:6}}>Tên bạn sẽ được ghi chú trong danh sách.<br/>Để bỏ ghi chú: bật lại vị trí trong cài đặt trình duyệt rồi tải lại trang.</div>
                  <div style={{fontSize:11,color:'#c2410c',fontStyle:'italic'}}>Chrome: nhấn 🔒 → Vị trí → Cho phép<br/>Safari: Cài đặt → Safari → Vị trí → Cho phép</div>
                </div>
              )}

              <button onClick={submit} disabled={!name||!mssv||submitting} style={s.btn(!name||!mssv||submitting)}>
                {submitting?(gpsStatus==='requesting'?'⏳ Đang chờ vị trí…':'Đang gửi…'):'Xác nhận điểm danh →'}
              </button>
              <p style={{fontSize:11,color:'#aaa',textAlign:'center',marginTop:10}}>Không chia sẻ đường link QR cho người khác.</p>
            </>
          )}

          {step==='success' && (
            <div style={{textAlign:'center',padding:'1.5rem 0'}}>
              <div style={{fontSize:56,marginBottom:12}}>✅</div>
              <div style={{fontSize:20,fontWeight:700,color:'#111',marginBottom:6}}>Điểm danh thành công!</div>
              <div style={{fontSize:14,color:'#555',marginBottom:2}}>{name}</div>
              <div style={{fontSize:13,color:'#888',marginBottom:2}}>{mssv}</div>
              <div style={{fontSize:12,color:'#aaa',marginBottom:20}}>{new Date().toLocaleTimeString('vi-VN')}</div>
              {result?.flags?.includes('expired-qr') && (
                <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#9a3412',marginBottom:16,textAlign:'left'}}>
                  ⚠️ Bạn dùng mã QR cũ. Điểm danh vẫn được ghi nhận nhưng giáo viên sẽ xem xét.
                </div>
              )}
              <button onClick={reset} style={{padding:'10px 28px',borderRadius:10,border:'1px solid #ddd',background:'#f8f9fa',fontSize:14}}>Quay lại</button>
            </div>
          )}

          {step==='error' && (
            <div style={{textAlign:'center',padding:'1.5rem 0'}}>
              <div style={{fontSize:56,marginBottom:12}}>❌</div>
              <div style={{fontSize:18,fontWeight:700,color:'#b91c1c',marginBottom:8}}>Điểm danh thất bại</div>
              <div style={{fontSize:14,color:'#555',marginBottom:20}}>{errorMsg}</div>
              <button onClick={reset} style={{padding:'10px 28px',borderRadius:10,border:'1px solid #ddd',background:'#f8f9fa',fontSize:14}}>Thử lại</button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
