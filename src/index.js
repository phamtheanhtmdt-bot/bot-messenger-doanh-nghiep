// bot-messenger-doanh-nghiep — Cloudflare Worker trả lời tin nhắn Fanpage bằng AI.
//
// Đường đi:
//   GET  /webhook   Facebook gọi một lần để "bắt tay" (kiểm FB_VERIFY_TOKEN)
//   POST /webhook   Facebook gõ cửa mỗi khi có tin mới → trả 200 ngay, xử lý nền
//   GET  /admin?key=ADMIN_KEY            trạng thái bot, khách cần người, lỗi gần đây
//   POST /admin/bot?key=...&trang_thai=bat|tat   tắt/bật bot toàn cục
//   POST /admin/thu?key=...  body {"psid":"thu","text":"..."}  hỏi AI mà KHÔNG gửi Facebook
//   GET  /quan-ly                          trang quản lý (đăng nhập bằng ADMIN_KEY, giữ cookie 30 ngày)
//   /admin/hoi-thoai, /admin/khach-day-du, /admin/tom-tat, /admin/dan*, /admin/cham-soc*  → src/quan-ly.js
//
// Bot im khi: bot bị tắt, hoặc người thật (chủ doanh nghiệp) vừa trả lời khách đó trong GIO_NGUOI_TRUC giờ.

import { kiemTraChuKy, guiTin, guiTinBot, baoDangGo, nhuongQuyen, layTenKhach, docHopThu } from "./facebook.js";
import { hoiAI } from "./ai.js";
import { CAU_KHI_AI_LOI, CAU_CHUYEN_NGUOI } from "./nhan-cach.js";
import * as kho from "./kho.js";
import { xuLyQuanLy, danhDauDaGuiTuDong, lapDotChamSoc } from "./quan-ly.js";
import TRANG_QUAN_LY from "./trang/quan-ly.html";

const HOP_THU_TRANG = "263902037430900"; // app id cố định của Page Inbox (người thật gõ)

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export default {
  // Cron mỗi phút: tự đọc hộp thư, phòng khi Facebook không đẩy webhook (hội thoại do app khác cầm).
  // Cron 23:00 UTC (= 06:00 Việt Nam): lập đợt chăm sóc lại khách im ≥ NGAY_CHAM ngày.
  async scheduled(event, env, ctx) {
    if (event.cron === "0 23 * * *") {
      ctx.waitUntil(lapDotChamSoc(env).catch(e => kho.ghiLog(env, { loai: "cham-soc-lap", loi: String(e.message || e) })));
      return;
    }
    ctx.waitUntil(quetHopThu(env).catch(e => kho.ghiLog(env, { loai: "quet", loi: String(e.message || e) })));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (p === "/webhook" && request.method === "GET") return batTay(url, env);
    if (p === "/webhook" && request.method === "POST") return nhanWebhook(request, env, ctx);
    if (p.startsWith("/admin")) return admin(request, url, env, ctx);
    if (p === "/quan-ly" || p.startsWith("/quan-ly/")) return trangQuanLy(request, url, env);
    if (p === "/") return new Response("Bot Messenger đang chạy. Trang quản lý: /quan-ly", { headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response("Not found", { status: 404 });
  },
};

function batTay(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === env.FB_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Sai verify token", { status: 403 });
}

async function nhanWebhook(request, env, ctx) {
  const raw = await request.text();
  const chuKy = await kiemTraChuKy(raw, request.headers.get("x-hub-signature-256"), env.FB_APP_SECRET);
  if (!chuKy.ok) {
    ctx.waitUntil(kho.ghiLog(env, { loai: "chu-ky", lyDo: chuKy.lyDo }));
    return new Response("Sai chữ ký", { status: 403 });
  }
  let goi;
  try { goi = JSON.parse(raw); } catch { return new Response("Không phải JSON", { status: 400 }); }
  if (goi.object !== "page") return new Response("Bỏ qua", { status: 200 });
  ctx.waitUntil(env.KHO.put("webhook:lan-cuoi", new Date().toISOString()));

  const viec = [];
  for (const entry of goi.entry || []) {
    for (const su of entry.messaging || []) viec.push(xuLySuKien(env, su));
    for (const su of entry.standby || []) viec.push(xuLySuKien(env, { ...su, standby: true }));
  }
  // Facebook cần 200 trong 20 giây; AI có thể lâu hơn → làm nền.
  ctx.waitUntil(Promise.allSettled(viec).then(async kq => {
    for (const r of kq) if (r.status === "rejected") await kho.ghiLog(env, { loai: "xu-ly", loi: String(r.reason?.message || r.reason) });
  }));
  return new Response("EVENT_RECEIVED", { status: 200 });
}

async function xuLySuKien(env, su) {
  // Sự kiện Định tuyến cuộc trò chuyện: ai xin quyền thì nhường ngay; quyền về tay app khác thì bot im 6 giờ.
  const psidHo = su.sender?.id === env.FB_PAGE_ID ? su.recipient?.id : su.sender?.id;
  if (su.request_thread_control && psidHo) {
    const appXin = String(su.request_thread_control.requested_owner_app_id || "");
    try { await nhuongQuyen(env, psidHo, appXin); } catch (e) { await kho.ghiLog(env, { loai: "nhuong", psid: psidHo, loi: String(e.message) }); }
    await kho.danhDauNguoiTruc(env, psidHo); await kho.xoaCho(env, psidHo);
    return;
  }
  const doiChu = su.pass_thread_control || su.take_thread_control;
  if (doiChu && psidHo) {
    const chuMoi = String(doiChu.new_owner_app_id || "");
    if (chuMoi && chuMoi !== String(env.FB_APP_ID)) { await kho.danhDauNguoiTruc(env, psidHo); await kho.xoaCho(env, psidHo); }
    return;
  }
  const msg = su.message;
  if (!msg) return; // delivery, read, postback... chưa dùng

  // Tin do Page gửi ra (echo). Nếu KHÔNG phải bot gửi → người thật đang trả lời → bot im một lúc.
  if (msg.is_echo) {
    const psid = su.recipient?.id;
    const laBot = msg.metadata === "bot-tiem" || String(msg.app_id || "") === String(env.FB_APP_ID);
    if (!laBot && psid) {
      // Người thật gõ trong Hộp thư Trang (không có app_id, hoặc app_id = Page Inbox) → bot im GIO_NGUOI_TRUC giờ.
      // Tin do app khác gửi (Pancake, Botcake...) → KHÔNG im, chỉ ghi vào lịch sử để bot có mạch.
      const laNguoi = !msg.app_id || String(msg.app_id) === HOP_THU_TRANG;
      if (laNguoi) { await kho.danhDauNguoiTruc(env, psid); await kho.xoaCho(env, psid); }
      if (msg.text && !(await env.KHO.get(`mid:${msg.mid}`))) {
        await env.KHO.put(`mid:${msg.mid}`, "1", { expirationTtl: 60 * 60 * 24 });
        const ls = await kho.layLichSu(env, psid);
        ls.push({ role: "assistant", content: msg.text, t: su.timestamp, nguoi: laNguoi, app: laNguoi ? undefined : String(msg.app_id) });
        await kho.luuLichSu(env, psid, ls);
      }
    }
    return;
  }

  const psid = su.sender?.id;
  if (!psid || psid === env.FB_PAGE_ID) return;
  if (await kho.daXuLy(env, msg.mid)) return;
  await kho.ghiRep(env, psid); // khách rép sau đợt chăm sóc → thống kê đợt

  const text = (msg.text || "").trim();
  const dinhKem = (msg.attachments || []).map(a => a.type).join(", ");
  const noiDung = text || (dinhKem ? `[khách gửi ${dinhKem}, không có chữ]` : "");
  if (!noiDung) return;

  const ls = await kho.layLichSu(env, psid);
  if (!(await kho.layTen(env, psid))) await kho.luuTen(env, psid, await layTenKhach(env, psid));

  // Người thật đang trực (đã tự gõ trả lời) → chỉ ghi lịch sử, không xếp hàng, không trả lời.
  // (Bot tự "chuyển người" chỉ là im ngắn: tin vẫn xếp hàng, hết giờ chờ bộ não trả lời tiếp.)
  const dauNguoi = await env.KHO.get(`nguoi:${psid}`);
  if (dauNguoi && dauNguoi !== "cho-nguoi") {
    ls.push({ role: "user", content: noiDung, t: su.timestamp });
    await kho.luuLichSu(env, psid, ls);
    return;
  }
  // Bot tắt (hoặc CHE_DO khác worker) → ghi lịch sử + xếp vào hàng chờ, không trả lời.
  if ((env.CHE_DO || "worker") !== "worker" || !(await kho.botDangBat(env))) {
    ls.push({ role: "user", content: noiDung, t: su.timestamp });
    await kho.luuLichSu(env, psid, ls);
    await kho.danhDauCho(env, psid, noiDung);
    await baoDangGo(env, psid); // khách thấy "..." ngay trong lúc bộ não soạn
    return;
  }

  await baoDangGo(env, psid);
  let kq;
  try {
    kq = await traLoi(env, psid, ls, noiDung);
  } catch (e) {
    // AI hỏng (hết tiền, mạng, khoá sai...) → vẫn nhắn khách một câu, nhường sân cho người, ghi sổ.
    ls.push({ role: "user", content: noiDung, t: Date.now() });
    await kho.luuLichSu(env, psid, ls);
    await kho.ghiChuyenNguoi(env, { psid, tin: noiDung, lyDo: "AI lỗi: " + String(e.message || e) });
    await kho.danhDauNguoiTruc(env, psid);
    await guiTinBot(env, psid, CAU_KHI_AI_LOI);
    throw e;
  }
  if (kq.traLoi) await guiTinBot(env, psid, kq.traLoi);
}

// Hỏi AI, cập nhật lịch sử, ghi sổ nếu cần người. Dùng chung cho webhook và /admin/thu.
async function traLoi(env, psid, ls, noiDung) {
  const ten = await kho.layTen(env, psid);
  const kq = await hoiAI(env, ls, ten ? `[Tên Facebook của khách: ${ten}]\n${noiDung}` : noiDung);
  let traLoi = kq.traLoi;
  if (kq.chuyenNguoi) {
    if (!traLoi) traLoi = CAU_CHUYEN_NGUOI;
    await kho.ghiChuyenNguoi(env, { psid, tin: noiDung, lyDo: kq.lyDo });
    await kho.danhDauChoNguoi(env, psid); // im ngắn cho chủ tiệm vào
  }
  ls.push({ role: "user", content: noiDung, t: Date.now() });
  if (traLoi) ls.push({ role: "assistant", content: traLoi, t: Date.now() });
  await kho.luuLichSu(env, psid, ls);
  return { ...kq, traLoi };
}

// Khoá quản trị: ?key= trên URL (cách cũ, cho script) hoặc cookie qk (trang quản lý đăng nhập một lần).
function layKey(request, url) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1];
  const k = url.searchParams.get("key");
  if (k) return k;
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)qk=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}
const coQuyen = (request, url, env) => Boolean(env.ADMIN_KEY) && layKey(request, url) === env.ADMIN_KEY;

// Trang quản lý: GET hiện trang (hoặc form đăng nhập), POST /quan-ly/dang-nhap đặt cookie, POST /quan-ly/thoat xoá cookie.
async function trangQuanLy(request, url, env) {
  const html = (t, status = 200, headers = {}) => new Response(t, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers } });
  if (url.pathname === "/quan-ly/dang-nhap" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const key = form ? String(form.get("key") || "").trim() : "";
    if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return html(formDangNhap("Sai khoá, thử lại."), 401);
    return new Response(null, { status: 303, headers: { location: "/quan-ly", "set-cookie": `qk=${encodeURIComponent(key)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (url.pathname === "/quan-ly/thoat") {
    return new Response(null, { status: 303, headers: { location: "/quan-ly", "set-cookie": "qk=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
  }
  if (!coQuyen(request, url, env)) return html(formDangNhap(), 401);
  return html(TRANG_QUAN_LY);
}

function formDangNhap(loi = "") {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đăng nhập · Bàn trực bot</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EEF1F3;font-family:"Be Vietnam Pro",system-ui,sans-serif;color:#1A232B}
form{background:#fff;border:1px solid #D9DFE3;border-radius:14px;padding:26px 28px;width:min(360px,90vw);box-shadow:0 8px 24px -12px rgba(20,30,40,.18)}
h1{font-size:17px;margin:0 0 4px}p{margin:0 0 14px;color:#4B5761;font-size:13px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #D9DFE3;border-radius:9px;margin-bottom:10px}
button{width:100%;font:inherit;font-weight:600;padding:10px;border:0;border-radius:9px;background:#0E6B6B;color:#fff;cursor:pointer}.loi{color:#C0392B;font-size:13px;margin-bottom:8px}</style>
<form method="post" action="/quan-ly/dang-nhap"><h1>Bàn trực bot</h1><p>Nhập khoá quản trị (ADMIN_KEY). Máy này sẽ nhớ 30 ngày.</p>${loi ? `<div class="loi">${loi}</div>` : ""}<input type="password" name="key" placeholder="Khoá quản trị" autofocus autocomplete="current-password"><button>Vào bàn trực</button></form>`;
}

async function admin(request, url, env, ctx) {
  if (!coQuyen(request, url, env)) return json({ loi: "sai key" }, 401);
  const p = url.pathname;
  const kq = await xuLyQuanLy(request.clone(), url, env, ctx);
  if (kq) return kq;

  if (p === "/admin" && request.method === "GET") {
    return json({
      bot: (await kho.botDangBat(env)) ? "bat" : "tat",
      cheDo: env.CHE_DO || "worker",
      khachDangCho: (await kho.danhSachCho(env)).length,
      aiBaseUrl: env.AI_BASE_URL,
      models: String(env.MODEL || ""),
      gioNguoiTruc: Number(env.GIO_NGUOI_TRUC || 6),
      webhookLanCuoi: (await env.KHO.get("webhook:lan-cuoi")) || "chưa nhận gói tin nào",
      quetLanCuoi: (await env.KHO.get("quet:lan-cuoi")) || "chưa quét",
      khachCanNguoi: await kho.docDanhSach(env, "chuyen-list"),
      loiGanDay: await kho.docDanhSach(env, "log"),
    });
  }
  if (p === "/admin/bot" && request.method === "POST") {
    const bat = url.searchParams.get("trang_thai") !== "tat";
    await kho.datTrangThaiBot(env, bat);
    return json({ bot: bat ? "bat" : "tat" });
  }
  if (p === "/admin/thu" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    const psid = `thu-${b.psid || "mac-dinh"}`;
    if (b.xoa) { await env.KHO.delete(`ls:${psid}`); return json({ daXoa: psid }); }
    if (!b.text) return json({ loi: "thiếu text" }, 400);
    const ls = await kho.layLichSu(env, psid);
    const kq = await traLoi(env, psid, ls, b.text);
    return json({ traLoi: kq.traLoi, chuyenNguoi: kq.chuyenNguoi, lyDo: kq.lyDo, model: kq.model, daThu: kq.daThu, usage: kq.usage });
  }
  // Bộ não bên ngoài lấy danh sách khách đang chờ, kèm lịch sử.
  if (p === "/admin/cho-xu-ly" && request.method === "GET") {
    const ds = await kho.danhSachCho(env);
    const ra = [];
    for (const c of ds) {
      const dau = await env.KHO.get(`nguoi:${c.psid}`);
      if (dau && dau !== "cho-nguoi") continue; // chỉ người thật mới chặn; "cho-nguoi" (im ngắn) hết hạn thì KV tự xoá
      ra.push({ ...c, ten: await kho.layTen(env, c.psid), lichSu: await kho.layLichSu(env, c.psid) });
    }
    return json({ soKhach: ra.length, khach: ra });
  }
  // Bộ não bên ngoài gửi tin cho khách qua worker (token Page ở đây, không rời khỏi Cloudflare).
  if (p === "/admin/gui" && request.method === "POST") {
    const b = await request.json().catch(() => ({}));
    if (!b.psid || !b.text) return json({ loi: "thiếu psid hoặc text" }, 400);
    const ls = await kho.layLichSu(env, b.psid);
    try {
      await guiTinBot(env, b.psid, b.text);
    } catch (e) {
      await kho.ghiLog(env, { loai: "gui", psid: b.psid, loi: String(e.message || e) });
      return json({ ok: false, loi: String(e.message || e) }, 502);
    }
    // Chủ gõ tay từ trang quản lý (nguoi: true) → ghi là người thật, bot im GIO_NGUOI_TRUC giờ với khách này.
    ls.push(b.nguoi ? { role: "assistant", content: b.text, t: Date.now(), nguoi: true } : { role: "assistant", content: b.text, t: Date.now(), nao: b.nao || "may-tinh" });
    await kho.luuLichSu(env, b.psid, ls);
    await kho.xoaCho(env, b.psid);
    if (b.nguoi) await kho.danhDauNguoiTruc(env, b.psid);
    if (b.chuyen_nguoi) {
      await kho.ghiChuyenNguoi(env, { psid: b.psid, tin: b.tin || "", lyDo: b.ly_do || "" });
      await kho.danhDauChoNguoi(env, b.psid); // im ngắn cho chủ tiệm vào; hội thoại vẫn giữ ở app để bot nói tiếp nếu không ai vào
    }
    return json({ ok: true });
  }
  // Xoá dấu người trực / im ngắn cho một khách (khi cần bot nói lại ngay)
  if (p === "/admin/mo-lai" && request.method === "POST") {
    const psid = url.searchParams.get("psid");
    if (!psid) return json({ loi: "thiếu psid" }, 400);
    await env.KHO.delete(`nguoi:${psid}`);
    const ls = await kho.layLichSu(env, psid);
    const cuoi = [...ls].reverse().find(m => m.role === "user");
    if (cuoi && url.searchParams.get("xep_hang") === "1") await kho.danhDauCho(env, psid, cuoi.content);
    return json({ ok: true, psid, xepHang: Boolean(cuoi && url.searchParams.get("xep_hang") === "1") });
  }
  // Quét hộp thư ngay (thay vì đợi cron), trả về tóm tắt
  if (p === "/admin/quet" && request.method === "POST") {
    return json(await quetHopThu(env));
  }
  if (p === "/admin/khach" && request.method === "GET") {
    const psid = url.searchParams.get("psid");
    return json({ psid, ten: await kho.layTen(env, psid), lichSu: await kho.layLichSu(env, psid), nguoiTruc: await kho.nguoiDangTruc(env, psid) });
  }
  return json({ loi: "không có đường này" }, 404);
}


// ===== Quét hộp thư qua Graph API =====
// Với mỗi hội thoại mới nhất: nếu tin cuối là của Page mà KHÔNG phải bot gửi → người/app khác đang trực → bot im 6 giờ.
// Nếu có tin khách chưa xử lý (chưa có mid trong kho) và còn TƯƠI (≤ PHUT_TUOI phút) → xử lý y như webhook.
// Tin khách cũ hơn thì chỉ ghi lịch sử, không trả lời muộn (trả lời "không cần" sau 6 tiếng là phản tác dụng).
async function quetHopThu(env) {
  const phutTuoi = Number(env.PHUT_TUOI || 10);
  const gio = Date.now();
  const ds = await docHopThu(env, 25);
  const tomTat = { hoiThoai: ds.length, daTraLoi: 0, ghiLichSu: 0, nguoiTruc: 0, boQua: 0 };
  for (const c of ds) {
    const khach = (c.participants?.data || []).find(pp => pp.id !== env.FB_PAGE_ID);
    if (!khach) continue;
    const psid = khach.id;
    const tins = [...(c.messages?.data || [])].reverse(); // cũ → mới
    if (!tins.length) continue;
    if (!(await kho.layTen(env, psid))) await kho.luuTen(env, psid, khach.name || "");
    const cuoi = tins[tins.length - 1];
    if (cuoi.from?.id === env.FB_PAGE_ID) {
      // Page vừa nói cuối cùng. Bot gửi thì thôi; người/app khác gửi thì ghi vào lịch sử để bot có mạch (một lần cho mỗi mid).
      // Qua đường quét không biết là người hay app → KHÔNG đánh dấu trực (người thật gõ đã được bắt qua echo webhook).
      if (!(await env.KHO.get(`sent:${cuoi.id}`)) && !(await env.KHO.get(`mid:${cuoi.id}`))) {
        await env.KHO.put(`mid:${cuoi.id}`, "1", { expirationTtl: 60 * 60 * 24 });
        if (cuoi.message) {
          // Trùng câu trong đợt chăm sóc đang mở → extension vừa gửi xong, tự đánh dấu (hàm này tự ghi lịch sử)
          if (await danhDauDaGuiTuDong(env, psid, cuoi.message)) { tomTat.ghiLichSu++; continue; }
          const ls = await kho.layLichSu(env, psid);
          ls.push({ role: "assistant", content: cuoi.message, t: Date.parse(cuoi.created_time || 0), app: "khac" });
          await kho.luuLichSu(env, psid, ls); tomTat.ghiLichSu++;
        }
      }
      continue;
    }
    // Tin cuối là của khách: gom các tin khách liên tiếp ở cuối chưa xử lý
    const moi = [];
    for (let i = tins.length - 1; i >= 0 && tins[i].from?.id !== env.FB_PAGE_ID; i--) moi.unshift(tins[i]);
    for (const m of moi) {
      if (await env.KHO.get(`mid:${m.id}`)) continue;
      const t = Date.parse(m.created_time || 0);
      const su = { sender: { id: psid }, recipient: { id: env.FB_PAGE_ID }, timestamp: t,
                   message: { mid: m.id, text: m.message || "", attachments: (m.attachments?.data || []).map(a => ({ type: a.mime_type?.split("/")[0] || "file" })) } };
      if (gio - t > phutTuoi * 60 * 1000) {
        // cũ: chỉ ghi lịch sử + đánh dấu đã thấy
        await env.KHO.put(`mid:${m.id}`, "1", { expirationTtl: 60 * 60 * 24 });
        const ls = await kho.layLichSu(env, psid);
        if (m.message) { ls.push({ role: "user", content: m.message, t }); await kho.luuLichSu(env, psid, ls); await kho.ghiRep(env, psid); }
        tomTat.ghiLichSu++;
        continue;
      }
      await xuLySuKien(env, su); // daXuLy() bên trong sẽ ghi mid
      tomTat.daTraLoi++;
    }
  }
  await env.KHO.put("quet:lan-cuoi", new Date().toISOString());
  return tomTat;
}
