# Chăm sóc lại khách đã nhắn (đợt 3 ngày)

Đọc file này trước khi dùng tab **Chăm sóc lại** ở `/quan-ly`.

## Vấn đề

- Facebook chỉ cho Page gửi tin qua API trong **24 giờ** kể từ tin cuối của khách. Quá giờ thì API từ chối.
- Nhưng khách hỏi rồi im thì phải chăm lại, nhịp khoảng **3 ngày một lần**, tới khi khách chốt hoặc từ chối.
- Hộp thư Trang (giao diện người dùng trên Facebook) không dính rào 24h — nên đợt chăm sóc được gửi qua đó.

## Ba tầng

### Tầng 1 — worker tự lập danh sách, mỗi sáng
- Cron `0 23 * * *` (06:00 giờ Việt Nam) lọc khách có tin cuối **≥ `NGAY_CHAM` ngày** (mặc định 3) và chưa được chăm trong nhịp đó
  (khoá KV `cham:<psid>` ghi ngày gửi lần cuối).
- **Nhóm bỏ qua** (không đưa vào đợt), hai nguồn:
  1. AI đọc cả cuộc chat khi lập đợt và xếp: `tu-choi` (khách đã từ chối thẳng), `da-xong` (đã mua/đã xong, không việc gì mở),
     `khong-phai-khach` (spam, chào hàng, đối tác, ứng viên), `khac`. Ghi `cham-nhan:<psid>` 90 ngày.
  2. Bạn gắn tay ở bàn trực: nút **Không chăm sóc lại khách này** → `bo-qua:<psid>`.
- Mỗi khách còn lại: AI xác định **bước đang kẹt** (nhu cầu → báo giá → đồng ý → thực hiện → xong) và soạn **một câu chăm sóc riêng**
  theo bước, nối tiếp mạch chat cũ, không chào lại từ đầu. Tối đa `CHAM_TOI_DA` khách/đợt (mặc định 30) để giữ nhịp gửi.

### Tầng 2 — bạn duyệt trên trang quản lý
- Mỗi khách một dòng: tên, số ngày im, bước, câu soạn sẵn, ô tick. Bấm vào câu để sửa, bấm ra ngoài là lưu.
- Bỏ tick người không muốn gửi → **Duyệt đợt này**.
- Lập tay bất cứ lúc nào: **Lập danh sách ngay** với nhịp và số khách tuỳ chọn (ví dụ "im từ 1 ngày · tối đa 5" để xem thử).

### Tầng 3 — gửi đi, hai đường
1. **Claude extension trong Chrome** (dùng ngay, không cần xin phép): sau khi Duyệt, bấm **Chép lệnh** → một đoạn lệnh gồm danh sách
   tên khách + câu gửi. Dán vào cột Claude trong Chrome, nó mở hộp thư Trang, tìm tên, dán, gửi từng người, chờ ~20 giây giữa hai người.
   Xong: worker tự nhận "đã gửi" khi quét hộp thư thấy tin Page mới khớp 30 ký tự đầu của câu, hoặc bạn bấm **Đã gửi** / **Đã gửi hết đợt**.
2. **Graph API với thẻ `HUMAN_AGENT`** (cần Facebook duyệt một lần): cho phép gửi trong **7 ngày** kể từ tin cuối của khách.
   developers.facebook.com → App Review → Permissions → `Human Agent`; cần Business Verification và video quay cảnh người thật trả lời khách.
   Được duyệt thì nút **API** ở từng dòng gửi thẳng, không cần extension. Chưa duyệt thì nút báo lỗi, không gửi gì.

## Theo dõi sau khi gửi
- `cham:<psid>` = ngày gửi + câu đã gửi. Hết nhịp mới được vào đợt tiếp.
- Khách **rép** sau đợt chăm → dòng đó hiện "· đã rép", bot tiếp tục trả lời theo luật thường (tin chăm sóc nằm trong lịch sử nên bot có mạch).
- Dải trên tab Chăm sóc lại: đợt trước gửi bao nhiêu, bao nhiêu rép.

## Rủi ro cần biết
- Extension bấm trong hộp thư giống người thật, nhưng theo điều khoản Facebook vẫn là công cụ tự động. Rủi ro thấp khi vài chục tin/ngày
  nội dung khác nhau; tăng khi hàng trăm tin giống nhau trong một giờ → giữ `CHAM_TOI_DA`, không gửi một mẫu cho cả đợt.
- Tuỳ chỉnh cách AI soạn câu chăm sóc: ô **Dặn em về cách chăm sóc** ở tab này (cùng cơ chế luật dặn thêm, không cần deploy).
