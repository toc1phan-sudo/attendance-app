import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'

// Fingerprint tốt hơn — thêm nhiều tín hiệu, tránh nhầm giữa các máy cùng model
function getFingerprint() {
  try {
    const nav = navigator
    const parts = [
      nav.userAgent,
      nav.language,
      nav.languages?.join(',') || '',
      String(nav.hardwareConcurrency || ''),
      String(nav.deviceMemory || ''),
      screen.width + 'x' + screen.height,
      String(screen.colorDepth),
      String(screen.pixelDepth || ''),
      String(window.devicePixelRatio || ''),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      nav.platform || '',
      // Canvas fingerprint nhẹ
      (() => {
        try {
          const c = document.createElement('canvas')
          const ctx = c.getContext('2d')
          ctx.fillText('fp', 2, 15)
          return c.toDataURL().slice(-20)
        } catch { return '' }
      })(),
    ]
    const str = parts.join('|')
    let h = 0x811c9dc5
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0 }
    return h.toString(16).toUpperCase()
  } catch { return 'FP_ERR' }
}

export default function AttendPage() {
  const [step, setStep]             = useState('loading') // loading|form|success|error
  const [name, setName]             = useState('')
  const [mssv, setMssv]             = useState('')
  const [qrCode, setQrCode]         = useState('')
  const [gpsStatus, setGpsStatus]   = useState('idle') // idle|requesting|granted|denied
  const [gpsCoords, setGpsCoords]   = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult]         = useState(null)
  const [errorMsg, setErrorMsg]     = useState('')
  const fp = useRef(null)

  useEffect(() => {
    // Delay nhẹ để tránh màn hình đen trên Android cũ
    const init = () => {
      try { fp.current = getFingerprint() } catch { fp.current = 'FALLBACK' }
      const params = new URLSearchParams(window.location.search)
      const s = params.get('session')
      if (s) setQrCode(s.toUpperCase())
      setStep('form')
    }
    if (document.readyState === 'complete') init()
    else window.addEventListener('load', init)
    return () => window.removeEventListener('load', init)
  }, [])

  const requestGps = () => new Promise(resolve => {
    if (!navigator.geolocation) { resolve({ granted: false }); return }
    setGpsStatus('requesting')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
        setGpsStatus('granted'); setGpsCoords(coords); resolve({ granted: true, coords })
      },
      () => { setGpsStatus('denied'); resolve({ granted: false }) },
      { timeout: 15000, maximumAge: 0, enableHighAccuracy: true }
    )
  })

  // Thử lại GPS mà không cần tải lại trang
  const retryGps = () => {
    setGpsStatus('idle')
    setGpsCoords(null)
    setTimeout(() => requestGps(), 100)
  }

  const submit = async () => {
    if (!name || !mssv || submitting) return
    setSubmitting(true)
    let gps = { granted: gpsStatus === 'granted', coords: gpsCoords }
    if (gpsStatus === 'idle') gps = await requestGps()

    try {
      const res = await fetch('/api/attend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qr_code: qrCode.trim().toUpperCase(),
          name: name.trim(), mssv: mssv.trim(),
          gps_granted: gps.granted,
          lat: gps.coords?.lat || null,
          lng: gps.coords?.lng || null,
          gps_accuracy: gps.coords?.acc || null,
          fingerprint: fp.current,
        })
      })
      const data = await res.json()
      if (data.ok) { setResult(data); setStep('success') }
      else { setErrorMsg(data.reason || 'Có lỗi xảy ra'); setStep('error') }
    } catch { setErrorMsg('Không kết nối được. Kiểm tra mạng và thử lại.'); setStep('error') }
    setSubmitting(false)
  }

  const reset = () => {
    setStep('form'); setName(''); setMssv('')
    setGpsStatus('idle'); setGpsCoords(null); setResult(null); setErrorMsg('')
  }

  const S = {
    wrap:  { maxWidth: 420, margin: '0 auto', padding: '1rem' },
    card:  { background: '#fff', borderRadius: 16, padding: '1.5rem', boxShadow: '0 2px 16px rgba(0,0,0,0.08)' },
    label: { fontSize: 12, color: '#555', display: 'block', marginBottom: 5, fontWeight: 500 },
    group: { marginBottom: 14 },
    btn:   (off) => ({ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: off ? '#ccc' : '#111', color: '#fff', fontWeight: 700, fontSize: 15, cursor: off ? 'default' : 'pointer', marginTop: 4 }),
  }

  // Loading state — tránh màn hình đen Android
  if (step === 'loading') return (
    <>
      <Head>
        <title>Điểm danh</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
      </Head>
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 14 }}>Đang tải…</div>
        </div>
      </div>
    </>
  )

  return (
    <>
      <Head>
        <title>Điểm danh</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
        <meta name="theme-color" content="#0ea5e9"/>
      </Head>

      <div style={{ background: '#0ea5e9', padding: '1rem', marginBottom: '1rem' }}>
        <div style={S.wrap}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/logo.png" alt="Logo" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 4 }} onError={e => e.target.style.display = 'none'}/>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>📋 Điểm danh</div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11 }}>Cao đẳng Y tế Bình Dương</div>
            </div>
          </div>
        </div>
      </div>

      <div style={S.wrap}>
        <div style={S.card}>

          {/* ── FORM ── */}
          {step === 'form' && (
            <>
              <div style={S.group}>
                <label style={S.label}>Họ và tên</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Nguyễn Văn A"
                  style={{ fontSize: 16 }}/>
              </div>
              <div style={S.group}>
                <label style={S.label}>Mã số sinh viên</label>
                <input value={mssv} onChange={e => setMssv(e.target.value)} placeholder="21001234"
                  inputMode="numeric" style={{ fontSize: 16 }}/>
              </div>

              {/* GPS Banner */}
              {gpsStatus === 'idle' && (
                <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0369a1', marginBottom: 4 }}>📍 Yêu cầu vị trí khi xác nhận</div>
                  <div style={{ fontSize: 12, color: '#0369a1', lineHeight: 1.6 }}>
                    Trình duyệt sẽ hỏi quyền vị trí.<br/>
                    Hãy nhấn <strong>"Cho phép" / "Allow"</strong> để điểm danh hợp lệ.
                  </div>
                </div>
              )}

              {gpsStatus === 'requesting' && (
                <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, padding: '12px 14px', marginBottom: 14, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#854d0e' }}>⏳ Đang chờ bạn cho phép vị trí…</div>
                  <div style={{ fontSize: 12, color: '#854d0e', marginTop: 4 }}>
                    Nhấn <strong>"Cho phép" / "Allow"</strong> trên hộp thoại phía trên
                  </div>
                </div>
              )}

              {gpsStatus === 'granted' && (
                <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>✅</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>Đã chia sẻ vị trí</div>
                    <div style={{ fontSize: 11, color: '#166534' }}>Vị trí của bạn đã được ghi nhận</div>
                  </div>
                </div>
              )}

              {gpsStatus === 'denied' && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#9a3412', marginBottom: 6 }}>⚠️ Chưa cho phép vị trí</div>
                  <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.6, marginBottom: 10 }}>
                    Nếu bấm nhầm "Từ chối", nhấn nút bên dưới để thử lại.<br/>
                    Hoặc vào cài đặt trình duyệt bật lại vị trí.
                  </div>
                  {/* Nút thử lại GPS — không cần tải lại trang */}
                  <button onClick={retryGps}
                    style={{ width: '100%', padding: '9px', borderRadius: 8, border: 'none', background: '#ea580c', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
                    🔄 Thử lại "Cho phép vị trí"
                  </button>
                  <div style={{ fontSize: 11, color: '#c2410c', fontStyle: 'italic' }}>
                    Nếu không hiện hộp thoại: Chrome → nhấn 🔒 trên thanh địa chỉ → Vị trí → Cho phép → tải lại trang<br/>
                    Safari: Cài đặt → Safari → Vị trí → Cho phép
                  </div>
                </div>
              )}

              <button onClick={submit} disabled={!name || !mssv || submitting} style={S.btn(!name || !mssv || submitting)}>
                {submitting
                  ? (gpsStatus === 'requesting' ? '⏳ Đang chờ vị trí…' : 'Đang gửi…')
                  : 'Xác nhận điểm danh →'}
              </button>
              <p style={{ fontSize: 11, color: '#aaa', textAlign: 'center', marginTop: 10 }}>
                Không chia sẻ đường link QR cho người khác.
              </p>
            </>
          )}

          {/* ── SUCCESS ── */}
          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 6 }}>Điểm danh thành công!</div>
              <div style={{ fontSize: 14, color: '#555', marginBottom: 2 }}>{name}</div>
              <div style={{ fontSize: 13, color: '#888', marginBottom: 2 }}>{mssv}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginBottom: 20 }}>{new Date().toLocaleTimeString('vi-VN')}</div>
              {result?.flags?.includes('expired-qr') && (
                <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#9a3412', marginBottom: 16, textAlign: 'left' }}>
                  ⚠️ Bạn dùng mã QR cũ. Điểm danh vẫn được ghi nhận nhưng giáo viên sẽ xem xét.
                </div>
              )}
              <button onClick={reset} style={{ padding: '10px 28px', borderRadius: 10, border: '1px solid #ddd', background: '#f8f9fa', fontSize: 14 }}>
                Quay lại
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>❌</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#b91c1c', marginBottom: 8 }}>Điểm danh thất bại</div>
              <div style={{ fontSize: 14, color: '#555', marginBottom: 20 }}>{errorMsg}</div>
              <button onClick={reset} style={{ padding: '10px 28px', borderRadius: 10, border: '1px solid #ddd', background: '#f8f9fa', fontSize: 14 }}>
                Thử lại
              </button>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
