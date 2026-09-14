// Nói chuyện với Facebook Messenger Platform (Graph API v21.0).
// - kiemTraChuKy: xác minh gói tin do Facebook gửi (chữ ký HMAC SHA-256 bằng App Secret)
// - guiTin: gửi một tin chữ cho khách (tự cắt nếu dài hơn 2000 ký tự)
// - baoDangGo: bật dấu "..." đang gõ cho khách thấy

const GRAPH = "https://graph.facebook.com/v21.0";

export async function kiemTraChuKy(rawBody, header, appSecret) {
  if (!appSecret) return { ok: false, lyDo: "chua-co-app-secret" };
  if (!header || !header.startsWith("sha256=")) return { ok: false, lyDo: "thieu-header" };
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  const nhan = header.slice(7).toLowerCase();
  // so sánh từng ký tự, không thoát sớm (tránh lộ qua thời gian)
  if (hex.length !== nhan.length) return { ok: false, lyDo: "sai-do-dai" };
  let khac = 0;
  for (let i = 0; i < hex.length; i++) khac |= hex.charCodeAt(i) ^ nhan.charCodeAt(i);
  return khac === 0 ? { ok: true } : { ok: false, lyDo: "sai-chu-ky" };
}

async function goiGraph(env, body) {
  const r = await fetch(`${GRAPH}/me/messages?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw new Error(`Facebook ${r.status}: ${data.error?.message || JSON.stringify(data)}`);
  }
  return data;
}

export async function baoDangGo(env, psid) {
  try {
    await goiGraph(env, { recipient: { id: psid }, sender_action: "typing_on" });
  } catch { /* chỉ là hiệu ứng, lỗi thì bỏ qua */ }
}

// Cắt tin dài thành nhiều tin ≤ 1900 ký tự, ưu tiên cắt ở chỗ xuống dòng.
export function catTin(text, gioiHan = 1900) {
  const ra = [];
  let con = (text || "").trim();
  while (con.length > gioiHan) {
    let cat = con.lastIndexOf("\n", gioiHan);
    if (cat < gioiHan / 2) cat = con.lastIndexOf(" ", gioiHan);
    if (cat < gioiHan / 2) cat = gioiHan;
    ra.push(con.slice(0, cat).trim());
    con = con.slice(cat).trim();
  }
  if (con) ra.push(con);
  return ra;
}

export async function guiTin(env, psid, text) {
  const ketQua = [];
  for (const doan of catTin(text)) {
    const kq = await goiGraph(env, {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text: doan, metadata: "bot-tiem" },
    });
    // nhớ mid tin mình gửi, để lúc quét hộp thư phân biệt "bot gửi" với "người/app khác gửi"
    if (kq.message_id && env.KHO) await env.KHO.put(`sent:${kq.message_id}`, "1", { expirationTtl: 60 * 60 * 48 });
    ketQua.push(kq);
  }
  return ketQua;
}

// Đọc các hội thoại mới nhất qua Graph API (đường này không bị Handover chặn).
export async function docHopThu(env, soLuong = 25) {
  const url = `${GRAPH}/${env.FB_PAGE_ID}/conversations?fields=id,updated_time,participants,messages.limit(6){id,message,from,created_time,attachments}&limit=${soLuong}&access_token=${env.FB_PAGE_TOKEN}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Đọc hộp thư: ${d.error?.message || r.status}`);
  return d.data || [];
}

// ===== Handover Protocol (Định tuyến cuộc trò chuyện) =====
// Khi app của bạn bật "Kiểm soát cuộc trò chuyện", mỗi hội thoại chỉ một app được gửi tin.
// Bot trước khi gửi thì giành quyền về mình; ai xin (Pancake, Botcake) thì nhường ngay.
const HOP_THU_TRANG = "263902037430900"; // app id cố định của Page Inbox

async function goiHandover(env, duong, body) {
  const r = await fetch(`${GRAPH}/me/${duong}?access_token=${env.FB_PAGE_TOKEN}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(`${duong}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

export const giànhQuyen = (env, psid) => goiHandover(env, "take_thread_control", { recipient: { id: psid }, metadata: "bot-tiem" });
export const nhuongQuyen = (env, psid, appId = HOP_THU_TRANG) =>
  goiHandover(env, "pass_thread_control", { recipient: { id: psid }, target_app_id: appId, metadata: "bot-tiem nhuong" });

const cho = ms => new Promise(r => setTimeout(r, ms));

// Tách lời đáp thành nhiều tin: mỗi dòng là một tin (bot viết mỗi ý một dòng).
export function tachTin(text) {
  return (text || "").split(/\r?\n+/).map(d => d.trim()).filter(Boolean).slice(0, 5);
}

// Gửi nhiều tin liên tiếp như người gõ: bật "đang gõ", nghỉ theo độ dài, rồi gửi.
async function guiNhieuTin(env, psid, text) {
  const ds = tachTin(text);
  const ra = [];
  for (let i = 0; i < ds.length; i++) {
    if (i > 0) {
      await baoDangGo(env, psid);
      await cho(Math.min(1800, 500 + ds[i].length * 15));
    }
    ra.push(await guiTin(env, psid, ds[i]));
  }
  return ra;
}

// Gửi cho khách; nếu app khác đang cầm hội thoại (#10 / 2018300) thì giành quyền rồi gửi lại một lần.
export async function guiTinBot(env, psid, text) {
  try {
    return await guiNhieuTin(env, psid, text);
  } catch (e) {
    if (!/2018300|kiểm soát thread|controls this thread|another app/i.test(String(e.message))) throw e;
    await giànhQuyen(env, psid);
    return await guiNhieuTin(env, psid, text);
  }
}

// Tên Facebook của khách (chỉ lấy được với người đã nhắn Page). Trả "" nếu không lấy được.
export async function layTenKhach(env, psid) {
  try {
    const r = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name,name&access_token=${env.FB_PAGE_TOKEN}`);
    const d = await r.json();
    if (d.error) return "";
    return d.name || [d.first_name, d.last_name].filter(Boolean).join(" ");
  } catch { return ""; }
}

// Gửi MỘT tin ngoài cửa sổ 24 giờ bằng thẻ HUMAN_AGENT (cho phép tới 7 ngày sau tin cuối của khách).
// Chỉ chạy khi app đã được Facebook duyệt quyền Human Agent; chưa duyệt thì Facebook trả lỗi và hàm ném lỗi.
export async function guiTinNguoiTruc(env, psid, text) {
  const kq = await goiGraph(env, {
    recipient: { id: psid },
    messaging_type: "MESSAGE_TAG",
    tag: "HUMAN_AGENT",
    message: { text: catTin(text)[0] || "", metadata: "bot-tiem cham-soc" },
  });
  if (kq.message_id && env.KHO) await env.KHO.put(`sent:${kq.message_id}`, "1", { expirationTtl: 60 * 60 * 48 });
  return kq;
}
