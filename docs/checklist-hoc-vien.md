# Checklist: tự dựng bot Messenger + trang quản lý cho doanh nghiệp của bạn

Kết quả cuối cùng bạn có được:

1. **Bot** chạy 24/24 trên Cloudflare, khách nhắn Fanpage là bot đọc "sách giáo khoa" về doanh nghiệp rồi trả lời trong vài giây.
2. **Trang quản lý** (một website riêng, địa chỉ `https://<worker>/quan-ly`) để bạn mở trên máy tính hay điện thoại:
   xem mọi cuộc chat, AI tóm tắt từng khách, tự trả lời tay, dặn thêm luật cho bot mà không cần sửa code,
   và mỗi sáng có sẵn danh sách khách im lâu kèm câu chăm sóc AI soạn để bạn duyệt.

Bạn làm việc qua **ứng dụng Claude Code** trên máy tính: mở thư mục dự án, gõ câu yêu cầu, Claude chạy lệnh giúp.
Mỗi bước có (a) việc bạn tự bấm trên Facebook/Cloudflare, hoặc (b) một câu **in đậm** để nói với Claude Code.
Mỗi bước có cách KIỂM TRA ĐẠT; chưa đạt thì chưa sang bước sau. Lần đầu mất khoảng 2 giờ.

Đường đi của một tin nhắn (để bạn hiểu mình đang dựng cái gì):

```
Khách nhắn Fanpage ──► Facebook gõ cửa Worker (webhook, tức thì)
                   └─► Worker tự đọc hộp thư mỗi phút (phòng khi Facebook không gõ cửa)
                                  │
                                  ▼
                       Worker hỏi AI (OpenAI hoặc dịch vụ tương thích) kèm sách giáo khoa
                                  │
                                  ▼
                       Worker gửi trả khách qua Messenger, mỗi ý một tin
                                  │
                                  ▼
                       Bạn xem tất cả ở trang quản lý /quan-ly
```

## 0. Cần có trước khi bắt đầu

- [ ] Fanpage mà bạn là **quản trị viên**.
- [ ] Tài khoản Facebook đó vào được https://developers.facebook.com.
- [ ] Tài khoản Cloudflare miễn phí: https://dash.cloudflare.com (đăng ký bằng email, không cần thẻ).
- [ ] Ứng dụng **Claude Code** đã cài và đăng nhập (claude.ai/code → tải bản máy tính).
- [ ] Máy có **Node.js 20+** (nodejs.org, bản LTS) và **Git** (git-scm.com). Kiểm tra: mở Claude Code, nói
      **"kiểm tra máy tôi đã có node và git chưa"** → Claude báo số phiên bản.
- [ ] Một **khoá API AI**: OpenAI (platform.openai.com → API keys) hoặc dịch vụ tương thích OpenAI mà giảng viên chỉ định.
      Nạp ít (10–20 USD), **không bật nạp tiền tự động**.
- [ ] Tải mã: vào https://github.com/phamtheanhtmdt-bot/bot-messenger-doanh-nghiep → nút **Code** → **Download ZIP** → giải nén
      vào một thư mục dễ nhớ, ví dụ `D:\bot-messenger`. Rồi mở Claude Code → **Open folder** → chọn thư mục đó.
      Đạt khi trong thư mục có `CLAUDE.md`, `src`, `kien-thuc`, `docs`.

## 1. Tạo ứng dụng Facebook (làm tay, một lần)

- [ ] 1.1 developers.facebook.com → My Apps → **Create App** → chọn **Business** → đặt tên (ví dụ "Bot [tên doanh nghiệp]").
      Đạt khi góc trên có **App ID** (số 15 chữ số). Ghi lại.
- [ ] 1.2 Dashboard → **Add product** → **Messenger** → Set up.
- [ ] 1.3 Messenger → Settings → **Access Tokens** → Add or remove Pages → chọn Page → **Generate token**. Giữ tick 3 quyền:
      `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`. Chép token, giữ ở chỗ an toàn (sẽ dán cho Claude ở 2.4).
      Đạt khi dán token vào developers.facebook.com/tools/debug/accesstoken thấy **Valid: True**, Scopes có cả 3 quyền trên.
      Thiếu `pages_manage_metadata` thì bot vẫn đọc được hộp thư mỗi phút, nhưng Facebook sẽ không gõ cửa webhook (trả lời chậm hơn ~1 phút).
- [ ] 1.4 Settings → Basic → **App Secret** → Show → chép.
- [ ] 1.5 Công tắc **App Mode** ở thanh trên → **Live**.
      Nếu về sau bot chỉ nhắn được cho chính bạn, app cần xin Advanced Access cho pages_messaging (App Review) hoặc xác minh doanh nghiệp.
- [ ] 1.6 Lấy **ID Trang**: vào Page → Giới thiệu → cuối trang có "ID Trang". Ghi lại.

## 2. Dựng worker trên Cloudflare (Claude Code làm giúp)

- [ ] 2.1 Nói với Claude Code: **"Đọc CLAUDE.md và làm phần 2 của docs/checklist-hoc-vien.md. Bắt đầu từ kiểm tra máy và đăng nhập Cloudflare."**
      Claude chạy `npm install`, rồi `npx wrangler login` → trình duyệt mở → bấm **Allow**.
      Đạt khi Claude báo `whoami` in ra email và Account ID của bạn.
- [ ] 2.2 Claude tạo kho nhớ (`kv namespace create KHO`) và điền 5 chỗ `<...>` trong `wrangler.toml`. Claude sẽ hỏi bạn
      **tên worker** (chữ thường không dấu, ví dụ `bot-an-spa`), **ID Trang** (1.6), **App ID** (1.1).
- [ ] 2.3 Claude chạy `npm test` (9 bài tự kiểm, phải pass hết) rồi `npx wrangler deploy`. Đạt khi Claude đưa bạn địa chỉ
      `https://<tên>.<tài-khoản>.workers.dev` và mở lên thấy chữ "Bot Messenger đang chạy".
- [ ] 2.4 Đặt 5 secret. Claude sẽ hỏi lần lượt, bạn dán vào chat: **Page token** (1.3), **App Secret** (1.4), **khoá AI** (phần 0).
      Hai cái còn lại (`FB_VERIFY_TOKEN`, `ADMIN_KEY`) Claude tự sinh chuỗi ngẫu nhiên và cho bạn biết để giữ.
      `ADMIN_KEY` chính là **mật khẩu vào trang quản lý** — lưu vào nơi bạn giữ mật khẩu.
      Đạt khi Claude báo 5 dòng "Success! Uploaded secret".
- [ ] 2.5 Kiểm tra bắt tay: nói **"kiểm tra bắt tay webhook"**. Đạt khi Claude báo worker trả đúng challenge.
- [ ] 2.6 Mở trang quản lý: vào `https://<worker>/quan-ly` trên trình duyệt → gõ `ADMIN_KEY` → **Vào bàn trực**.
      Đạt khi thấy màn bốn cột, thanh trên có "Bot đang bật", chưa có khách nào. Đóng tab mở lại không phải gõ khoá (nhớ 30 ngày).

## 3. Nối Facebook với worker (làm tay, Claude kiểm tra)

- [ ] 3.1 developers.facebook.com → app → Messenger → Settings → **Webhooks** → Add Callback URL:
      URL = `https://<worker>/webhook`, Verify token = `FB_VERIFY_TOKEN` (Claude đã cho ở 2.4) → Verify and save.
      Đạt khi Facebook không báo lỗi.
- [ ] 3.2 Cùng chỗ → Add subscriptions → tick `messages`, `message_echoes`, `standby`, `messaging_handovers`.
- [ ] 3.3 Access Tokens → dòng Page của bạn → **Add subscriptions**.
- [ ] 3.4 **Handover — cho app của bạn cầm lái hộp thư.** Facebook → Trang → Cài đặt → Nhắn tin → **Nhắn tin nâng cao** →
      **Ứng dụng đã kết nối** (Connected apps) → dòng app của bạn → Chỉnh sửa → bật **Kiểm soát cuộc trò chuyện**.
      Page có AI của Meta thì bật thêm **Kiểm soát các cuộc trò chuyện với Business AI**, và tắt AI của Meta trong
      Business Suite → Hộp thư → Tự động hoá. Chỉ MỘT app được bật "Kiểm soát"; Pancake/Botcake (nếu có) để "kênh dự phòng".
      Không thấy công tắc này = token thiếu `pages_manage_metadata` (1.3).
- [ ] 3.5 Kiểm tra sống: từ một nick khác nhắn "alo" vào Page. Mở trang quản lý: thanh trên phải hiện
      **"webhook … trước"** có giờ, và khách đó xuất hiện trong danh sách bên trái.
      Chỉ thấy "quét … trước" mà webhook "chưa có": bot vẫn chạy (đọc hộp thư mỗi phút) nhưng chậm; xem lại 3.4 → 3.3 → 3.1.

## 4. Dạy bot về doanh nghiệp của bạn

- [ ] 4.1 Mở `kien-thuc/doanh-nghiep.md`, điền các chỗ [ngoặc vuông]: bạn là ai, sản phẩm và giá, quy trình mua, câu hay hỏi,
      3 điều được hứa, khi nào chuyển người. Có 4 ví dụ ở cuối file để tham khảo, xoá khi xong.
      Hoặc nói với Claude: **"Phỏng vấn tôi để điền kien-thuc/doanh-nghiep.md"** rồi trả lời từng câu.
- [ ] 4.2 Mở `src/nhan-cach.js`: thay [TÊN DOANH NGHIỆP], [TÊN CHỦ], [KÊNH LIÊN HỆ TRỰC TIẾP] — cả ở phần tính cách
      lẫn hai câu `CAU_KHI_AI_LOI`, `CAU_CHUYEN_NGUOI` ở cuối file (bot nói hai câu này khi AI hỏng hoặc khi chuyển người).
      Muốn bot đóng vai chính bạn (không phải trợ lý) thì nói với Claude: **"đổi bot sang đóng vai chính chủ"**.
- [ ] 4.3 Nói **"deploy lại"**.
- [ ] 4.4 Nói **"hỏi thử bot: [một câu khách hay hỏi về giá]"**. Đạt khi câu trả lời đúng giá trong sách, không bịa,
      chia 2–3 dòng ngắn, xưng hô "anh/chị" khi chưa biết khách.
- [ ] 4.5 Kiểm tra bot đang bật: thanh trên trang quản lý hiện **"Bot đang bật"** (xanh). Nếu "Bot đang TẮT" thì bấm công tắc.

## 5. Dùng trang quản lý (website của bạn)

Trang có hai màn, chọn ở thanh trên. Làm lần lượt để quen tay:

- [ ] 5.1 **Hội thoại** — bấm một khách: cột giữa là chat (khách trắng, bot xanh ngọc, bạn gõ tay vàng, phần mềm khác tím),
      cột "Thông tin" là **AI tóm tắt cả cuộc chat**: khách là ai · đang ở bước nào (nhu cầu → báo giá → đồng ý → thực hiện → xong)
      · đã trao đổi gì · còn thiếu gì để chốt · **việc tiếp theo** bạn nên làm.
- [ ] 5.2 **Trả lời tay**: gõ vào ô dưới chat, Ctrl+Enter. Khách nhận tin ngay; bot **tự im 6 giờ** với khách đó để bạn nói tiếp.
      Muốn bot nói lại ngay: bấm **Mở lại bot**. Muốn bot im hẳn 6 giờ mà không gửi gì: bấm **Bot im hẳn**.
- [ ] 5.3 **Dặn thêm cho em** (cột phải): gõ một câu đời thường, ví dụ *"khách hỏi giá thì hỏi số lượng trước rồi mới báo"*.
      AI viết lại thành luật + nhắc lại "Em hiểu là…" → bạn bấm **Áp dụng**. Bot đổi ngay, **không cần deploy**.
      Luật sai thì bấm tắt hoặc xoá. Kiểm tra: **"hỏi thử bot: giá bao nhiêu"** → bot làm theo luật mới.
- [ ] 5.4 **Chăm sóc lại** — mỗi 06:00 sáng (giờ VN) worker tự lập danh sách khách **im ≥ 3 ngày**, AI xếp nhóm bỏ qua
      (từ chối / đã xong / không phải khách) và **soạn một câu riêng cho từng người**. Bạn sửa câu, tick, bấm **Duyệt đợt này**.
      Lần đầu chưa có khách đủ 3 ngày thì bấm **Lập danh sách ngay** với "im từ 1 ngày" để xem thử.
- [ ] 5.5 **Gửi đợt chăm sóc**: Facebook không cho bot gửi cho khách im quá 24 giờ, nên có hai đường:
      - Đường 1 (dùng ngay): bấm **Chép lệnh**, dán vào **Claude trong Chrome** (extension), nó mở hộp thư Trang và gửi từng người.
        Xong worker tự nhận "đã gửi" khi quét hộp thư, hoặc bạn bấm **Đã gửi**.
      - Đường 2 (cần xin phép): nút **API** gửi bằng thẻ Human Agent — phải xin App Review với Facebook một lần. Chưa xin thì nút báo lỗi, không sao.
      Chi tiết ở `docs/cham-soc-lai.md`.
- [ ] 5.6 Mở trang trên **điện thoại**: vẫn dùng được, các cột xếp dọc, có nút chuyển giữa danh sách ↔ chat.
- [ ] 5.7 (Tuỳ chọn) **Tên miền riêng** cho trang quản lý, ví dụ `bot.tencuaban.com`, nếu tên miền của bạn đang ở Cloudflare:
      nói với Claude **"gắn tên miền bot.tencuaban.com cho trang quản lý"** → Claude mở 3 dòng `routes` trong `wrangler.toml`,
      hướng dẫn bạn thêm bản ghi DNS `AAAA bot 100:: Proxied` trên Dashboard, rồi deploy. Không có tên miền thì dùng địa chỉ workers.dev, đủ dùng.

## 6. Test theo vai trước khi cho khách thật

- [ ] Khách hỏi giá → đúng giá, không bịa.
- [ ] Khách xin giảm giá → không hứa.
- [ ] Khách "chốt luôn" → bot thu thông tin, mời liên hệ trực tiếp; trang quản lý gắn nhãn **Cần người** cho khách đó.
- [ ] Khách hỏi tiếp sau khi chốt → bot vẫn trả lời.
- [ ] Bạn trả lời tay một khách ở trang quản lý → bot im với khách đó 6 giờ; tin của bạn màu vàng trong chat.
- [ ] Khách gửi ảnh không chữ → bot hỏi lại, không đoán.
- [ ] Đủ 12 bước bot + 15 bước trang quản lý ở `docs/kich-ban-test.md`.

## 7. Vận hành và khi hỏng

- [ ] Mỗi sáng mở trang quản lý: lọc **Cần người** để trả lời khách đang chờ; tab **Chăm sóc lại** duyệt đợt hôm nay.
- [ ] Đổi giá, đổi sản phẩm: sửa `kien-thuc/doanh-nghiep.md` → "deploy lại". Đổi cách nói chuyện nhỏ: dùng "Dặn thêm cho em", không cần deploy.
- [ ] Không bao giờ đưa token, secret, khoá AI, `ADMIN_KEY` vào file trong git, vào chat nhóm, hay trang web lạ.
- [ ] Thanh trên báo webhook "chưa có" nhưng quét vẫn chạy: bot hoạt động nhưng chậm ~1 phút; kiểm 3.4 → 3.3 → 3.1 → token (1.3).
- [ ] Bot gửi lỗi "app khác đang kiểm soát": xem 3.4, chỉ một app được bật "Kiểm soát cuộc trò chuyện".
- [ ] Bot trả lời câu `CAU_KHI_AI_LOI` cho mọi khách: khoá AI hết tiền hoặc sai. Nói với Claude **"xem /admin có lỗi gì"** → đọc `loiGanDay`.
- [ ] Gửi tay báo "khách im quá 24 giờ": luật Facebook, dùng màn Chăm sóc lại.
- [ ] Quên `ADMIN_KEY`: nói với Claude **"đặt lại ADMIN_KEY"** → Claude sinh khoá mới và đặt secret; khoá cũ hết tác dụng.
