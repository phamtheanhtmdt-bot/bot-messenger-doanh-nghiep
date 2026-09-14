# Kịch bản test tay bot Messenger + trang quản lý

Làm sau khi đã xong checklist tới phần 5. Cần 2 vai: **Khách** (một nick Facebook KHÔNG phải admin Page)
và **Chủ** (mở `https://<worker>/quan-ly` trên máy tính).

## A. Bot trả lời (12 bước)

| # | Vai | Làm gì | Mong đợi |
|---|---|---|---|
| 1 | Khách | Nhắn "Chào, cho hỏi [sản phẩm/dịch vụ chính]" | Trong ~10 giây bot chào, xưng em, hỏi lại một câu về nhu cầu |
| 2 | Khách | Hỏi "Giá bao nhiêu?" | Bot nói đúng giá trong `kien-thuc/doanh-nghiep.md`, KHÔNG bịa số khác |
| 3 | Khách | Hỏi "Giảm giá được không?" | Bot không hứa, trả lời theo mục 4 của sách |
| 4 | Khách | "Chốt luôn" / "Đặt cho mình" | Bot thu thông tin, mời liên hệ trực tiếp; ở /quan-ly khách có nhãn vàng **Cần người** |
| 5 | Khách | Hỏi tiếp một câu có trong sách sau #4 | Bot vẫn trả lời, không im |
| 6 | Chủ | Vào Hộp thư Trang (Business Suite), tự gõ trả lời khách | Bot im với khách đó 6 giờ; /quan-ly hiện "Chủ đang trực · bot im tới …" |
| 7 | Khách | Gửi một tấm ảnh, không chữ | Bot cảm ơn, hỏi khách cần gì với ảnh |
| 8 | Khách | Hỏi lạc đề "Bầu cử Mỹ ai thắng?" | Bot kéo về việc của doanh nghiệp, không tranh luận |
| 9 | Khách | "Em là người hay máy?" | Bot trả lời như dòng đã ghi trong `src/nhan-cach.js` |
| 10 | Chủ | Bấm công tắc **Bot** ở thanh trên → tắt, rồi khách nhắn | Bot im hoàn toàn; bật lại thì trả lời |
| 11 | Khách | Nhắn hai tin liền nhau | Bot trả lời đúng cả hai ý, không trả lời trùng |
| 12 | Chủ | Hỏi Claude Code: "kiểm tra /admin có lỗi gì không" | Claude đọc `loiGanDay` và giải thích |

Thử AI không tốn Facebook: nói với Claude Code "hỏi thử bot: [câu của khách]" — Claude gọi `/admin/thu` và cho bạn xem câu trả lời.

## B. Trang quản lý `/quan-ly` (15 bước)

| # | Vai | Làm gì | Mong đợi |
|---|---|---|---|
| Q0 | Chủ | Mở /quan-ly lần đầu (chưa đặt mã) | Màn "Lần đầu mở bàn trực": gõ mã 2 lần; lệch nhau hoặc dưới 6 ký tự thì báo đỏ; đúng thì vào thẳng bàn trực |
| Q1 | Chủ | Thoát, mở /quan-ly, gõ sai mã | Báo "Sai mã, thử lại"; không còn hỏi đặt mã nữa |
| Q2 | Chủ | Gõ đúng mã đã đặt | Vào bàn trực; đóng tab mở lại không phải gõ mã nữa (cookie 30 ngày) |
| Q3 | Chủ | Nhìn thanh trên | Có "webhook … trước", "quét … trước", công tắc "Bot đang bật" xanh |
| Q4 | Chủ | Bấm lọc "Cần người" | Chỉ còn khách có nhãn vàng; số đỏ trên tab Hội thoại bằng số dòng |
| Q5 | Chủ | Bấm một khách | Cột giữa hiện chat: khách trắng, bot xanh ngọc, chủ gõ tay vàng, phần mềm khác tím. Cột "Thông tin" hiện "đang tóm tắt…" rồi ra các khối: khách là ai · bước · đã trao đổi · còn thiếu · việc tiếp theo |
| Q6 | Khách | Nhắn thêm một tin cho khách vừa mở | Trong ≤30 giây chat có tin mới, dòng "AI đọc N tin" báo "có tin mới, đang cập nhật…" rồi tóm tắt đổi |
| Q7 | Chủ | Gõ trả lời ở ô dưới, Ctrl+Enter | Khách nhận tin; trong chat tin màu vàng "Chủ · tay"; đầu chat báo "bot im tới …"; nút đổi thành "Mở lại bot" |
| Q8 | Khách | Nhắn tiếp | Bot IM (đang có người trực) |
| Q9 | Chủ | Bấm "Mở lại bot" rồi Khách nhắn | Bot trả lời lại |
| Q10 | Chủ | Chọn khách đã im > 24 giờ, gửi tay | Báo đỏ "Facebook không cho gửi vì khách im quá 24 giờ. Dùng màn Chăm sóc lại" |
| Q11 | Chủ | Cột phải gõ "khách hỏi giá thì hỏi số lượng trước rồi mới báo" → Dặn em | Hiện "Em hiểu là …" + luật đã viết gọn + nút Áp dụng / Bỏ. Chưa bấm thì bot chưa đổi |
| Q12 | Chủ | Bấm Áp dụng, rồi nói với Claude "hỏi thử bot: giá bao nhiêu?" | Bot hỏi số lượng thay vì báo giá ngay. Cột phải đếm "1 luật đang chạy". Bấm tắt luật → bot báo giá như cũ |
| Q13 | Chủ | Tab Chăm sóc lại → "im từ 1 ngày · tối đa 5" → Lập danh sách ngay | Thanh tiến độ chạy; xong ra bảng, mỗi khách một câu riêng, bước, số ngày im; dải trên có số bỏ qua theo nhóm |
| Q14 | Chủ | Sửa một câu, bỏ tick một người → Duyệt đợt này | Toast "Đã lưu câu"; cột phải hiện lệnh chỉ gồm người được tick; "Chép lệnh" đưa vào clipboard |
| Q15 | Chủ | Thu nhỏ cửa sổ dưới 1100px hoặc mở trên điện thoại | Các cột xếp dọc, có nút chuyển danh sách ↔ chat, không cột nào bị cắt chữ |
