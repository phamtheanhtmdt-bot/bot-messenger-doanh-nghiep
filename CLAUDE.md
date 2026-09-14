# Hướng dẫn cho Claude Code khi giúp chủ doanh nghiệp dựng bot này

Người dùng là chủ doanh nghiệp, KHÔNG phải lập trình viên. Họ mở thư mục này trong ứng dụng Claude Code và nhờ bạn làm từng phần
của `docs/checklist-hoc-vien.md`. Việc của bạn: làm thay họ mọi thứ chạy được bằng lệnh, và chỉ dẫn từng cú bấm cho những
việc phải làm trên Facebook/Cloudflare.

## Cách làm việc
- Luôn đọc `docs/checklist-hoc-vien.md` trước, làm đúng phần người dùng yêu cầu, báo "đạt/chưa đạt" theo mục KIỂM TRA ĐẠT của từng bước.
- Nói tiếng Việt đời thường, giải thích thuật ngữ ngay tại chỗ. Một lần chỉ hỏi một thứ.
- Cần giá trị bí mật (token, App Secret, khoá AI): bảo người dùng dán vào chat, rồi ghi ra file tạm không xuống dòng và
  `npx wrangler secret put TÊN < file`, xong xoá file. KHÔNG bao giờ in lại giá trị bí mật, KHÔNG ghi vào file trong git, KHÔNG commit.
- `FB_VERIFY_TOKEN` và `ADMIN_KEY`: tự sinh chuỗi ngẫu nhiên 24+ ký tự, đặt secret, rồi cho người dùng biết MỘT LẦN để họ lưu
  (`ADMIN_KEY` là mật khẩu vào trang quản lý `/quan-ly`). "Đặt lại ADMIN_KEY" = sinh khoá mới, đặt lại secret, báo khoá mới.
- Trước khi deploy lần đầu: `node -v` (≥ 20), `npm install`, `npx wrangler whoami` (chưa đăng nhập thì `npx wrangler login`), `npm test` (9 bài phải pass).
- `wrangler.toml` có 5 chỗ `<...>`: `name`, `account_id` (từ `npx wrangler whoami`), `FB_PAGE_ID`, `FB_APP_ID`, `id` của KV
  (từ `npx wrangler kv namespace create KHO`). Điền xong mới `npx wrangler deploy`.
- Sau mỗi lần sửa `kien-thuc/*.md` hoặc `src/nhan-cach.js` phải `npx wrangler deploy` thì bot mới đổi. Luật dặn thêm ở `/quan-ly` thì không cần deploy.
- Kiểm tra bot không tốn Facebook: `POST /admin/thu?key=ADMIN_KEY` với `{"psid":"a","text":"..."}`; xoá phiên thử bằng `{"psid":"a","xoa":true}`.
- Xem trạng thái: `GET /admin?key=ADMIN_KEY` → `bot`, `webhookLanCuoi`, `quetLanCuoi`, `khachCanNguoi`, `loiGanDay`.
  Webhook "chưa nhận" nhưng `quetLanCuoi` mới = bot vẫn chạy bằng đường quét mỗi phút; hướng người dùng làm lại 3.4 → 3.3 → 3.1.
- Việc trên Facebook (tạo app, token, webhook, "Kiểm soát cuộc trò chuyện") không làm được bằng lệnh: chỉ dẫn từng cú bấm theo checklist, rồi kiểm tra kết quả bằng `/admin`.
- Tên miền riêng cho trang quản lý (5.7): bỏ `#` ở khối `routes` trong `wrangler.toml`, đổi `pattern` và `zone_name` theo tên miền
  người dùng (zone phải ở cùng tài khoản Cloudflare), hướng dẫn thêm DNS `AAAA <sub> 100:: Proxied` trên Dashboard, rồi deploy.
  Nếu deploy báo lỗi zone không thuộc tài khoản → tên miền chưa chuyển về Cloudflare, dùng workers.dev.
- Không sửa `src/index.js`, `src/facebook.js`, `src/kho.js`, `src/ai.js`, `src/quan-ly.js`, `src/trang/quan-ly.html` trừ khi người dùng
  yêu cầu rõ. Nội dung để sửa là `kien-thuc/doanh-nghiep.md`, `kien-thuc/kich-ban.md`, `src/nhan-cach.js`, `wrangler.toml`.
- "Đổi bot sang đóng vai chính chủ": sửa dòng đầu `NHAN_CACH` thành "Bạn LÀ [TÊN CHỦ], chủ ..." và câu trả lời khi khách hỏi máy/người
  thành câu khéo (không nhận là máy, không khẳng định là người), giữ nguyên phần còn lại.

## Sơ đồ
Khách nhắn Fanpage → Facebook webhook (hoặc worker tự quét hộp thư mỗi phút qua Graph API) → Worker (Cloudflare) → gọi AI ở AI_BASE_URL
với sách giáo khoa + luật dặn thêm → gửi trả khách qua Messenger Send API. Chủ doanh nghiệp tự trả lời khách nào → bot im 6 giờ với khách đó.
Khách cần người → nhãn "Cần người" ở `/quan-ly`. Cron 23:00 UTC lập đợt chăm sóc lại khách im ≥ NGAY_CHAM ngày (xem `docs/cham-soc-lai.md`).
