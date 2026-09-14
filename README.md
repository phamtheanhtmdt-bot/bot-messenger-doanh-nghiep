# Bot Messenger cho doanh nghiệp + trang quản lý

Bot trả lời tin nhắn Fanpage bằng AI, cho mọi ngành: spa, nhà hàng, bán lẻ, tư vấn, đào tạo, sửa chữa...
Khách nhắn, bot đọc "sách giáo khoa" về doanh nghiệp của bạn rồi trả lời trong vài giây. Khách muốn chốt, mặc cả,
khiếu nại, hay hỏi thứ không có trong sách, bot mời khách liên hệ trực tiếp và gắn nhãn **Cần người** để bạn vào.

Kèm theo là **trang quản lý** `/quan-ly` — website riêng của bạn, mở trên máy tính hay điện thoại: xem mọi cuộc chat,
AI tóm tắt từng khách, trả lời tay, dặn thêm luật cho bot không cần sửa code, và mỗi sáng có sẵn đợt chăm sóc lại khách im lâu.

**Bạn không cần biết code.** Mở thư mục này trong ứng dụng **Claude Code**, làm theo
[docs/checklist-hoc-vien.md](docs/checklist-hoc-vien.md): mỗi bước có sẵn câu để nói với Claude Code, Claude chạy lệnh giúp bạn.

```
Khách nhắn Fanpage ──► Facebook gõ cửa Worker (webhook, tức thì)
                   └─► Worker tự đọc hộp thư mỗi phút (phòng khi Facebook không gõ cửa)
                          ↓ Worker hỏi AI (OpenAI hoặc dịch vụ tương thích) kèm sách giáo khoa của bạn
                          ↓ Worker gửi trả khách, mỗi ý một tin, có "đang gõ"
                          ↓ Bạn xem tất cả ở /quan-ly
```

Chạy hoàn toàn trên Cloudflare Worker (gói miễn phí đủ dùng), không cần máy bật. Chỉ tốn tiền AI theo tin.

## Bạn sửa gì, không sửa gì

| Đường dẫn | Là gì | Bạn có sửa không |
|---|---|---|
| `kien-thuc/doanh-nghiep.md` | Sách giáo khoa: doanh nghiệp là ai, sản phẩm, giá, quy trình, câu hay hỏi, điều được hứa | **Có, bắt buộc** |
| `kien-thuc/kich-ban.md` | Kịch bản nói chuyện (hỏi gì trước, khi nào báo giá, khi nào chuyển người) | Nên |
| `src/nhan-cach.js` | Tính cách, xưng hô, luật cứng; đóng vai trợ lý hay chính chủ; 2 câu dự phòng khi AI hỏng | Có |
| `wrangler.toml` | Cấu hình: 5 chỗ `<...>` Claude Code điền giúp; tên miền riêng (tuỳ chọn) | Claude điền |
| `src/index.js`, `facebook.js`, `kho.js`, `ai.js`, `quan-ly.js` | Bộ máy: webhook, quét hộp thư, gửi tin, kho nhớ, gọi AI, API trang quản lý | Không |
| `src/trang/quan-ly.html` | Giao diện trang quản lý (một file, không thư viện ngoài) | Không |
| `docs/kich-ban-test.md` | Test theo vai trước khi cho khách thật | Đọc |
| `docs/cham-soc-lai.md` | Cách đợt chăm sóc lại hoạt động và hai đường gửi | Đọc |
| `CLAUDE.md` | Hướng dẫn cho Claude Code cách giúp bạn | Không |

## Trang quản lý `/quan-ly`

Đăng nhập một lần bằng `ADMIN_KEY`, máy nhớ 30 ngày (cookie). Hai màn:

- **Hội thoại** (bốn cột): danh sách khách 90 ngày với nhãn ai đang trực (bot / bạn / cần người / lỗi) · khung chat, trả lời tay
  (gửi xong bot im 6 giờ với khách đó) · **Thông tin = AI tóm tắt cả cuộc chat** (khách là ai, đang ở bước nào trong 5 bước,
  đã trao đổi gì, còn thiếu gì để chốt, việc tiếp theo) · **Dặn thêm cho em**: gõ một câu, AI viết thành luật + nhắc lại cách hiểu,
  bạn bấm Áp dụng là bot theo ngay, không cần deploy (luật lưu trong KV `luat-them`).
- **Chăm sóc lại**: cron 06:00 sáng (VN) lập đợt khách im ≥ `NGAY_CHAM` ngày, AI xếp nhóm bỏ qua (từ chối / đã xong / không phải khách)
  và soạn một câu riêng cho từng người, tối đa `CHAM_TOI_DA` khách/đợt. Bạn sửa/tick/duyệt rồi gửi bằng Claude extension trong Chrome
  (né rào 24 giờ của Facebook), hoặc nút API bằng thẻ Human Agent nếu app đã được Facebook duyệt. Xem `docs/cham-soc-lai.md`.

Trang chỉ là lớp vỏ gọi các đường `/admin/*` bên dưới; ai có `ADMIN_KEY` gọi thẳng API cũng được.

## Cửa quản trị (thay `KEY` bằng ADMIN_KEY, hoặc dùng cookie sau khi đăng nhập /quan-ly)

```
GET  /admin?key=KEY                               trạng thái, khách cần người, lỗi gần đây, webhook/quét lần cuối
POST /admin/bot?key=KEY&trang_thai=tat|bat        tắt / bật bot
POST /admin/thu?key=KEY  {"psid":"a","text":".."}  hỏi AI thử, KHÔNG gửi Facebook  ({"psid":"a","xoa":true} xoá phiên thử)
POST /admin/quet?key=KEY                          quét hộp thư ngay (thay vì đợi cron mỗi phút)
GET  /admin/khach?key=KEY&psid=<PSID>             lịch sử một khách
POST /admin/gui          {"psid","text","nguoi":true}  gửi tin cho khách; nguoi:true = ghi là người thật, bot im 6h
POST /admin/mo-lai?psid= / POST /admin/im {"psid"}     bot nói lại ngay / bot im hẳn 6h với một khách

GET  /admin/hoi-thoai?so=120&q=                  danh sách hội thoại + trạng thái
GET  /admin/khach-day-du?psid=                   lịch sử + tóm tắt cache + chăm sóc + bỏ qua
POST /admin/tom-tat      {"psid"}                AI tóm tắt lại
POST /admin/bo-qua       {"psid","bat":true|false,"ly_do"}   gắn/bỏ "không chăm nữa"
GET  /admin/dan · POST /admin/dan {"text"} · POST /admin/dan/duyet {"id","luat"} · /dan/bo · /dan/bat {"id","bat"} · /dan/xoa
GET  /admin/cham-soc     đợt mới nhất + đợt trước + thống kê
POST /admin/cham-soc/lap {"toi_da":30,"nhip_ngay":3}   lập đợt ngay (chạy nền, poll GET để xem tiến độ)
POST /admin/cham-soc/sua {"psid","cau","chon"}   sửa câu / tick
POST /admin/cham-soc/duyet                       khoá đợt, trả về lệnh cho Claude extension
POST /admin/cham-soc/da-gui {"psid":[...]}       đánh dấu đã gửi
POST /admin/cham-soc/gui-api {"psid"}            gửi thẳng bằng thẻ HUMAN_AGENT (chưa có quyền thì trả chuaQuyen:true)
```

## Secrets (không bao giờ ghi vào file trong git)

`FB_PAGE_TOKEN`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `ADMIN_KEY`, `OPENAI_API_KEY`. Claude Code đặt giúp bằng
`npx wrangler secret put`, bạn chỉ dán giá trị vào chat khi được hỏi. `ADMIN_KEY` là mật khẩu vào trang quản lý.

## Điều bot làm để không loạn inbox

- Bạn tự trả lời khách nào (Hộp thư Trang hoặc ở /quan-ly) → bot im với khách đó `GIO_NGUOI_TRUC` giờ (mặc định 6).
  Tin do phần mềm khác gửi (Pancake, Botcake...) chỉ ghi vào lịch sử, không làm bot im.
- App khác xin quyền hội thoại → worker nhường ngay. Facebook gửi lại cùng một tin → chỉ trả lời một lần.
- Quét hộp thư mỗi phút chỉ trả lời tin mới trong `PHUT_TUOI` phút; tin cũ hơn chỉ ghi lịch sử (không trả lời muộn).
- AI hỏng (hết tiền, khoá sai) → khách vẫn nhận câu `CAU_KHI_AI_LOI` trong `src/nhan-cach.js`, lỗi ghi ở `/admin`.

## Giới hạn cần biết

- Facebook chỉ cho bot trả lời khách đã nhắn trong 24 giờ gần nhất. Khách im lâu hơn: màn Chăm sóc lại.
- Chỉ MỘT app được bật "Kiểm soát cuộc trò chuyện" trên Page.
- Tốn tiền AI theo tin (vài trăm đồng một tin). Không bật nạp tiền tự động ở nhà cung cấp AI.
- Lịch sử chat giữ 90 ngày trong KV, tối đa 20 lượt gần nhất mỗi khách được đưa cho AI.

## Chạy thử tại máy / kiểm tra

```
npm test                          # 9 bài tự kiểm, không gọi Facebook hay AI
npx wrangler dev --local          # chạy worker ở máy (cần .dev.vars, xem .dev.vars.example)
```

Giấy phép MIT. Tác giả: Phạm Thế Anh.
