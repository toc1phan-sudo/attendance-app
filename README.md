# Hướng dẫn deploy app Điểm danh

## Bạn đã làm xong:
- [x] Bước 1–3: Tạo Supabase, chạy SQL, lấy API keys

---

## Bước 4: Tạo tài khoản GitHub (miễn phí)

1. Vào **github.com** → Sign up → đăng ký bằng email
2. Xác nhận email → đăng nhập vào GitHub

---

## Bước 5: Upload code lên GitHub

1. Vào **github.com/new** để tạo repository mới
2. Điền:
   - **Repository name:** `attendance-app`
   - Chọn **Private** (để bảo mật)
3. Nhấn **"Create repository"**
4. Ở trang tiếp theo, nhấn **"uploading an existing file"**
5. **Kéo thả toàn bộ folder** `attendance-app` vào trang
6. Nhấn **"Commit changes"**

---

## Bước 6: Deploy lên Vercel

1. Vào **vercel.com** → Sign up → chọn **"Continue with GitHub"**
2. Sau khi đăng nhập → nhấn **"Add New Project"**
3. Tìm repo `attendance-app` → nhấn **"Import"**
4. Ở phần **"Environment Variables"**, thêm 4 biến sau:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://avbjvmhhyuyvwbdvrvgs.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_z4yXoPUatokS2pnlHX6EtA_42OWXqmD` |
| `SUPABASE_SERVICE_KEY` | `sb_secret_nfwY_henNHAprRrNZJ_vJg_z4SZLQ8a` |
| `TEACHER_PASSWORD` | `giaovien2025` (đổi thành mật khẩu bạn muốn) |

5. Nhấn **"Deploy"** → chờ khoảng 2 phút
6. Vercel sẽ cấp cho bạn URL dạng: `https://attendance-app-xxx.vercel.app`

---

## Bước 7: Sử dụng

### Giáo viên:
- Mở: `https://attendance-app-xxx.vercel.app/teacher`
- Nhập mật khẩu (mặc định: `giaovien2025`)
- Tạo lớp → Bắt đầu điểm danh → Chiếu QR lên màn hình

### Sinh viên:
- Mở: `https://attendance-app-xxx.vercel.app/attend`
- Hoặc quét QR (QR sẽ tự mở thẳng trang này)
- Nhập họ tên + MSSV + cho phép vị trí → Xác nhận

---

## Đổi mật khẩu giáo viên:
1. Vào Vercel → Project → Settings → Environment Variables
2. Sửa giá trị `TEACHER_PASSWORD`
3. Nhấn **Redeploy**

---

## Lưu ý bảo mật:
- File `.env.local` chứa API keys — **không chia sẻ file này với ai**
- Secret key đã được nhúng vào Vercel, không lộ ra ngoài
- Nên đổi `TEACHER_PASSWORD` thành mật khẩu mạnh hơn trước khi dùng thật
