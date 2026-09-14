// Gọi AI qua máy chủ tương thích OpenAI (chat/completions, HTTP thuần).
// Máy chủ đặt ở [vars] AI_BASE_URL (OpenAI hoặc dịch vụ tương thích OpenAI).
// MODEL là DANH SÁCH cách nhau bằng dấu phẩy: con đầu lỗi (hết hạn mức, 5xx, không có model)
// thì thử con sau. Ghim tên model cụ thể, KHÔNG dùng bí danh best/cheap/fast, KHÔNG dùng deepseek.
//
// Bốn việc:
//   hoiAI        trả lời khách (webhook, /admin/thu)
//   tomTatKhach  đọc cả cuộc chat → khách là ai, bước, đã trao đổi, còn thiếu, việc tiếp theo (trang quản lý)
//   soanChamSoc  khách im N ngày → có nên nhắn lại không, nhóm bỏ qua, một câu chăm sóc (đợt 3 ngày)
//   hieuLoiDan   chủ dặn một câu → viết thành luật ngắn + nhắc lại cách hiểu để chủ gật (ô "Dặn thêm cho em")

import KIEN_THUC from "../kien-thuc/doanh-nghiep.md";
import KICH_BAN from "../kien-thuc/kich-ban.md";
import { NHAN_CACH } from "./nhan-cach.js";
import * as kho from "./kho.js";

const MAC_DINH_URL = "https://api.openai.com/v1";
const MAC_DINH_MODEL = "gpt-4.1";

// Thang bước của một khách, dùng chung cho tóm tắt và chăm sóc lại. Dùng chung mọi ngành:
// hỏi nhu cầu → báo giá → khách đồng ý (chốt đơn/lịch) → đang thực hiện/giao → đã xong.
export const BUOC = {
  0: "chưa rõ",
  1: "hỏi nhu cầu",
  2: "đã báo giá / tư vấn",
  3: "khách đồng ý, đang chốt",
  4: "đang thực hiện / giao",
  5: "đã xong",
};

async function khoiLuatThem(env) {
  const luat = (await kho.docLuatThem(env)).filter(l => l.bat !== false);
  if (!luat.length) return "";
  return `\n\n===== LUẬT CHỦ DẶN THÊM (ưu tiên cao nhất, nếu trái với phần trên thì theo phần này) =====\n${luat.map((l, i) => `${i + 1}. ${l.luat}`).join("\n")}`;
}

async function ghepSystem(env) {
  return `${NHAN_CACH}

===== SÁCH GIÁO KHOA VỀ DOANH NGHIỆP (nguồn sự thật duy nhất) =====
${KIEN_THUC}

===== KỊCH BẢN NÓI CHUYỆN =====
${KICH_BAN}${await khoiLuatThem(env)}`;
}

export function danhSachModel(env) {
  return String(env.MODEL || MAC_DINH_MODEL).split(",").map(s => s.trim()).filter(Boolean);
}

// Lấy khối JSON đầu tiên trong câu trả lời. Không bóc được thì trả null.
export function bocJsonBatKy(text) {
  const bat = text.indexOf("{");
  const ket = text.lastIndexOf("}");
  if (bat < 0 || ket <= bat) return null;
  try {
    // model hay để xuống dòng thật bên trong chuỗi JSON → đổi thành \n rồi mới parse
    const tho = text.slice(bat, ket + 1).replace(/"(?:[^"\\]|\\.)*"/gs, m => m.replace(/\r?\n/g, "\\n"));
    return JSON.parse(tho);
  } catch { return null; }
}

function bocJson(text) {
  const o = bocJsonBatKy(text);
  if (o && typeof o.tra_loi === "string") {
    return { traLoi: o.tra_loi.trim(), chuyenNguoi: Boolean(o.chuyen_nguoi), lyDo: o.ly_do || "" };
  }
  return { traLoi: text.trim(), chuyenNguoi: false, lyDo: "khong-phai-json" };
}

async function goiMotModel(env, base, model, messages, tuyChon) {
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: tuyChon.maxTokens, temperature: tuyChon.temperature }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`${model} → ${r.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

// Gọi lần lượt các model cho tới khi một con trả lời. Ra: { text, usage, model, daThu, tuChoi }.
export async function goiAI(env, messages, { maxTokens = 600, temperature = 0.4 } = {}) {
  if (!env.OPENAI_API_KEY) throw new Error("Chưa đặt secret OPENAI_API_KEY");
  const base = (env.AI_BASE_URL || MAC_DINH_URL).replace(/\/+$/, "");
  const loi = [];
  for (const model of danhSachModel(env)) {
    let data;
    try {
      data = await goiMotModel(env, base, model, messages, { maxTokens, temperature });
    } catch (e) {
      loi.push(String(e.message));
      if (e.status === 401) break; // khoá sai thì đổi model cũng vô ích
      continue;
    }
    const choice = data.choices?.[0];
    if (!choice) { loi.push(`${model} → không có choices`); continue; }
    if (choice.finish_reason === "content_filter") return { text: "", tuChoi: true, usage: data.usage, model: data.model || model, daThu: loi };
    return { text: choice.message?.content || "", usage: data.usage, model: data.model || model, daThu: loi };
  }
  throw new Error("Mọi model đều lỗi: " + loi.join(" | "));
}

const lichSuThanhMessages = ls => ls.map(m => ({ role: m.role, content: m.content }));

export async function hoiAI(env, lichSu, tinMoi) {
  const r = await goiAI(env, [
    { role: "system", content: await ghepSystem(env) },
    ...lichSuThanhMessages(lichSu),
    { role: "user", content: tinMoi },
  ]);
  if (r.tuChoi) return { traLoi: "", chuyenNguoi: true, lyDo: "ai-tu-choi", usage: r.usage, model: r.model };
  return { ...bocJson(r.text), usage: r.usage, model: r.model, daThu: r.daThu };
}

// Cuộc chat viết thành văn bản một khối cho AI đọc (kèm ai gửi và giờ).
function chatThanhVanBan(lichSu) {
  const ten = { khach: "KHÁCH", bot: "PAGE (bot)", nguoi: "PAGE (chủ gõ tay)", app: "PAGE (phần mềm khác)", nao: "PAGE (bot)", cham: "PAGE (tin chăm sóc)" };
  return lichSu.map(m => {
    const gio = m.t ? new Date(m.t).toISOString().slice(0, 16).replace("T", " ") : "";
    return `[${gio}] ${ten[kho.aiGui(m)] || m.role}: ${m.content}`;
  }).join("\n");
}

const THANG_BUOC = Object.entries(BUOC).map(([k, v]) => `${k} = ${v}`).join("; ");

// Tóm tắt cả cuộc chat cho người trực. Ra: { khach, buoc, daTraoDoi[], conThieu[], viecTiepTheo, gap, model }.
export async function tomTatKhach(env, lichSu, ten) {
  const system = `Bạn là trợ lý nội bộ của Page. Bạn đọc TOÀN BỘ cuộc chat giữa Page và một khách rồi tóm tắt cho người trực, để ai đọc cũng biết ngay phải làm gì tiếp.

Sách giáo khoa về doanh nghiệp (để biết sản phẩm, giá, quy trình mua/đặt, khách cần cung cấp gì khi chốt):
${KIEN_THUC}

Thang bước: ${THANG_BUOC}.

Trả về DUY NHẤT một khối JSON, tiếng Việt đời thường, không markdown:
{"khach": "<1-2 câu: khách là ai, cần gì, ở đâu, đã mua/đặt gì chưa; chỉ nói điều có trong chat>",
 "buoc": <số 0-5>,
 "da_trao_doi": ["<3-4 gạch đầu dòng ngắn: Page đã hứa/báo gì, khách đã đồng ý/hỏi gì, cái gì chưa ai nói>"],
 "con_thieu": ["<những thông tin khách chưa cung cấp mà quy trình trong sách cần (tên, SĐT, địa chỉ, ngày giờ, số lượng...); rỗng nếu chưa tới bước đó>"],
 "viec_tiep_theo": "<MỘT câu mệnh lệnh cho người trực: làm gì ngay bây giờ>",
 "gap": <true nếu khách đang chờ câu trả lời của Page (tin cuối là của khách và hỏi/đồng ý/khiếu nại), false nếu không>}`;
  const r = await goiAI(env, [
    { role: "system", content: system },
    { role: "user", content: `Tên Facebook của khách: ${ten || "(chưa rõ)"}\n\n===== CUỘC CHAT =====\n${chatThanhVanBan(lichSu)}` },
  ], { maxTokens: 700, temperature: 0.2 });
  const o = bocJsonBatKy(r.text) || {};
  return {
    khach: String(o.khach || "").trim(),
    buoc: Math.min(5, Math.max(0, Number(o.buoc) || 0)),
    daTraoDoi: Array.isArray(o.da_trao_doi) ? o.da_trao_doi.map(String) : [],
    conThieu: Array.isArray(o.con_thieu) ? o.con_thieu.map(String) : [],
    viecTiepTheo: String(o.viec_tiep_theo || "").trim(),
    gap: Boolean(o.gap),
    model: r.model,
    soTin: lichSu.length,
    luc: new Date().toISOString(),
  };
}

// Khách im N ngày: có nên nhắn lại không, thuộc nhóm bỏ qua nào, và MỘT câu chăm sóc.
// Ra: { boQua, nhom, buoc, cau, model }. nhom: tu-choi | da-xong | khong-phai-khach | khac | "" (không bỏ qua).
export async function soanChamSoc(env, lichSu, ten, soNgayIm) {
  const system = `${NHAN_CACH}

===== SÁCH GIÁO KHOA =====
${KIEN_THUC}

===== KỊCH BẢN =====
${KICH_BAN}${await khoiLuatThem(env)}

===== VIỆC LÚC NÀY: CHĂM SÓC LẠI KHÁCH IM LẶNG =====
Khách này đã im ${soNgayIm} ngày. Bạn đọc cả cuộc chat rồi quyết định:
1. CÓ NÊN NHẮN LẠI KHÔNG. Đặt bo_qua = true và ghi nhom nếu khách thuộc một trong các nhóm:
   - "tu-choi": khách đã từ chối thẳng (không cần, không quan tâm, đừng nhắn, đã mua chỗ khác) hoặc Page đã nói "không cần thì em dừng".
   - "da-xong": khách đã mua / đã dùng dịch vụ / đơn đã hoàn thành và không có việc gì mở.
   - "khong-phai-khach": tin rác, quảng cáo, người chào hàng, đối tác, ứng viên xin việc — không phải khách mua.
   - "khac": lý do khác không nên nhắn (ví dụ khách nói đang bận để sau và đã được nhắn lại rồi).
   Không thuộc nhóm nào → bo_qua = false, nhom = "".
2. XÁC ĐỊNH BƯỚC theo thang: ${THANG_BUOC}.
3. SOẠN MỘT TIN CHĂM SÓC (nếu bo_qua = false): đúng giọng trong phần tính cách, xưng hô đúng như đã dùng trong chat, nối tiếp mạch cũ, KHÔNG chào lại từ đầu, KHÔNG nhắc "em nhắn mấy lần". Nội dung theo bước: bước 1 → gợi lại nhu cầu, mời xem sản phẩm/dịch vụ hợp nhất; bước 2 → hỏi khách còn băn khoăn gì về gói/giá, nhắc điểm mạnh hoặc quà tặng nếu sách có; bước 3 → nhắc thông tin còn thiếu để chốt; bước 4 → báo tiến độ / hỏi thêm thông tin; bước 5 → hỏi thăm dùng ổn không, xin đánh giá hoặc giới thiệu bạn bè. Tin này gửi bằng một lần dán, nên viết MỘT ĐOẠN 1-2 câu, không xuống dòng, không markdown, tối đa 1 emoji, kết bằng một câu hỏi ngắn.

Trả về DUY NHẤT một khối JSON: {"bo_qua": true|false, "nhom": "<mã nhóm hoặc rỗng>", "buoc": <0-5>, "cau": "<tin chăm sóc, rỗng nếu bo_qua>"}`;
  const r = await goiAI(env, [
    { role: "system", content: system },
    { role: "user", content: `Tên Facebook của khách: ${ten || "(chưa rõ)"}\n\n===== CUỘC CHAT =====\n${chatThanhVanBan(lichSu)}` },
  ], { maxTokens: 500, temperature: 0.5 });
  const o = bocJsonBatKy(r.text) || {};
  const boQua = Boolean(o.bo_qua);
  return {
    boQua,
    nhom: boQua ? String(o.nhom || "khac") : "",
    buoc: Math.min(5, Math.max(0, Number(o.buoc) || 0)),
    cau: boQua ? "" : String(o.cau || "").replace(/\s*\n+\s*/g, " ").trim(),
    model: r.model,
  };
}

// Chủ dặn một câu → luật ngắn cho bot + cách hiểu để chủ gật. Ra: { luat, hieu, traiVoi, model }.
export async function hieuLoiDan(env, loiDan, luatHienCo) {
  const system = `Bạn là biên tập viên luật cho bot nhắn tin của một doanh nghiệp. Chủ bot vừa gõ một lời dặn bằng tiếng Việt đời thường. Việc của bạn:
1. Viết lại thành MỘT luật ngắn (1-2 câu) ở dạng mệnh lệnh cho bot, rõ điều kiện "khi ... thì ...", dùng đúng từ ngữ của nghề trong sách giáo khoa (sản phẩm, gói, báo giá, đặt lịch, chuyển người...). Không thêm ý chủ không nói.
2. Nhắc lại cách hiểu bằng 1-2 câu tiếng Việt đời thường, mở đầu bằng "Em hiểu là", có ví dụ cụ thể một tình huống, để chủ xác nhận trước khi áp dụng.
3. Nếu lời dặn trái với luật hiện có nào (bên dưới) thì ghi ngắn ở "trai_voi", không thì để rỗng.

Tính cách và luật cứng hiện tại của bot:
${NHAN_CACH}

Luật chủ đã dặn thêm trước đó:
${luatHienCo.length ? luatHienCo.map((l, i) => `${i + 1}. ${l.luat}`).join("\n") : "(chưa có)"}

Trả về DUY NHẤT một khối JSON: {"luat": "...", "hieu": "Em hiểu là ...", "trai_voi": ""}`;
  const r = await goiAI(env, [
    { role: "system", content: system },
    { role: "user", content: loiDan },
  ], { maxTokens: 400, temperature: 0.2 });
  const o = bocJsonBatKy(r.text) || {};
  return { luat: String(o.luat || loiDan).trim(), hieu: String(o.hieu || "").trim(), traiVoi: String(o.trai_voi || "").trim(), model: r.model };
}
