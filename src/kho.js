// Kho nhớ tạm trên Cloudflare KV. Mỗi khách (PSID) có:
//  - ls:<psid>     lịch sử 20 lượt gần nhất để AI nhớ ngữ cảnh; METADATA của khoá là chỉ mục hội thoại
//                  (ten, cuoi, role, ai, t, n) để trang quản lý liệt kê mà không phải đọc từng khách
//  - nguoi:<psid>  dấu "người thật đang trả lời", bot im trong GIO_NGUOI_TRUC giờ
//  - mid:<mid>     dấu đã xử lý tin này (Facebook có thể gửi lại cùng một tin)
//  - tt:<psid>     tóm tắt AI cả cuộc chat (khách là ai, bước, đã trao đổi, còn thiếu, việc tiếp theo)
//  - cham:<psid>   lần chăm sóc lại gần nhất {luc, cau, ngay, cach, rep}
//  - cham-nhan:<psid>  AI đã xếp khách vào nhóm bỏ qua (từ chối, đã xong, vật tư...) khi lập đợt
//  - bo-qua:<psid> anh gắn tay "không chăm nữa"
// Toàn cục: bot:trang-thai (bat|tat), chuyen-list (khách cần người), log (lỗi gần nhất),
//  luat-them (luật anh dặn thêm qua trang), dan-cho (lời dặn chờ anh gật), cham-dot:<ngay> (đợt chăm sóc)

const GIOI_HAN_LICH_SU = 20;
const NGAY = 60 * 60 * 24;

export async function layLichSu(env, psid) {
  const raw = await env.KHO.get(`ls:${psid}`);
  return raw ? JSON.parse(raw) : [];
}

// Ai gửi một lượt trong lịch sử: khach | bot | nguoi (chủ doanh nghiệp gõ tay) | app (phần mềm khác) | nao (Claude trên máy) | cham (đợt chăm sóc)
export function aiGui(m) {
  if (!m) return "";
  if (m.role === "user") return "khach";
  if (m.nguoi) return "nguoi";
  if (m.cham) return "cham";
  if (m.app) return "app";
  if (m.nao) return "nao";
  return "bot";
}

function chiMuc(ten, cat) {
  const cuoi = cat[cat.length - 1];
  if (!cuoi) return undefined;
  return { ten: String(ten || "").slice(0, 60), cuoi: String(cuoi.content || "").slice(0, 90), role: cuoi.role, ai: aiGui(cuoi), t: cuoi.t || Date.now(), n: cat.length };
}

export async function luuLichSu(env, psid, lichSu) {
  const cat = lichSu.slice(-GIOI_HAN_LICH_SU);
  const ten = await layTen(env, psid);
  await env.KHO.put(`ls:${psid}`, JSON.stringify(cat), { expirationTtl: 90 * NGAY, metadata: chiMuc(ten, cat) });
}

// Danh sách mọi hội thoại còn trong kho (90 ngày), mới nhất trước. Khoá cũ chưa có chỉ mục thì đọc một lần rồi ghi lại.
export async function danhSachHoiThoai(env) {
  const ra = [];
  let cursor;
  do {
    const r = await env.KHO.list({ prefix: "ls:", cursor, limit: 1000 });
    for (const k of r.keys) {
      const psid = k.name.slice(3);
      if (psid.startsWith("thu-")) continue;
      let md = k.metadata;
      if (!md || !md.t) {
        const ls = await layLichSu(env, psid);
        if (!ls.length) continue;
        await luuLichSu(env, psid, ls);
        md = chiMuc(await layTen(env, psid), ls);
      }
      ra.push({ psid, ...md });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  ra.sort((a, b) => (b.t || 0) - (a.t || 0));
  return ra;
}

export async function daXuLy(env, mid) {
  if (!mid) return false;
  const co = await env.KHO.get(`mid:${mid}`);
  if (co) return true;
  await env.KHO.put(`mid:${mid}`, "1", { expirationTtl: NGAY });
  return false;
}

export async function nguoiDangTruc(env, psid) {
  return Boolean(await env.KHO.get(`nguoi:${psid}`));
}

export async function danhDauNguoiTruc(env, psid) {
  const gio = Number(env.GIO_NGUOI_TRUC || 6);
  await env.KHO.put(`nguoi:${psid}`, new Date().toISOString(), { expirationTtl: Math.max(60, gio * 3600) });
}

export async function botDangBat(env) {
  const tt = await env.KHO.get("bot:trang-thai");
  return tt !== "tat";
}

export async function datTrangThaiBot(env, bat) {
  await env.KHO.put("bot:trang-thai", bat ? "bat" : "tat");
}

async function themVaoDanhSach(env, khoa, muc, toiDa) {
  const raw = await env.KHO.get(khoa);
  const ds = raw ? JSON.parse(raw) : [];
  ds.unshift({ luc: new Date().toISOString(), ...muc });
  await env.KHO.put(khoa, JSON.stringify(ds.slice(0, toiDa)));
}

export const ghiChuyenNguoi = (env, muc) => themVaoDanhSach(env, "chuyen-list", muc, 100);
export const ghiLog = (env, muc) => themVaoDanhSach(env, "log", muc, 50);

export async function docDanhSach(env, khoa) {
  const raw = await env.KHO.get(khoa);
  return raw ? JSON.parse(raw) : [];
}

// Hàng đợi "khách chờ trả lời" cho bộ não bên ngoài (Claude Code trên máy anh).
export async function danhDauCho(env, psid, tin) {
  await env.KHO.put(`cho:${psid}`, JSON.stringify({ psid, tin, luc: new Date().toISOString() }), { expirationTtl: 2 * NGAY });
  const raw = await env.KHO.get("cho-list");
  const ds = raw ? JSON.parse(raw) : [];
  if (!ds.includes(psid)) ds.push(psid);
  await env.KHO.put("cho-list", JSON.stringify(ds.slice(-500)));
}

export async function xoaCho(env, psid) {
  await env.KHO.delete(`cho:${psid}`);
  const raw = await env.KHO.get("cho-list");
  const ds = (raw ? JSON.parse(raw) : []).filter(p => p !== psid);
  await env.KHO.put("cho-list", JSON.stringify(ds));
}

export async function danhSachCho(env) {
  const raw = await env.KHO.get("cho-list");
  const ds = raw ? JSON.parse(raw) : [];
  const ra = [];
  for (const psid of ds) {
    const c = await env.KHO.get(`cho:${psid}`);
    if (c) ra.push(JSON.parse(c));
  }
  return ra;
}

export async function layTen(env, psid) { return (await env.KHO.get(`ten:${psid}`)) || ""; }
export async function luuTen(env, psid, ten) { if (ten) await env.KHO.put(`ten:${psid}`, ten, { expirationTtl: 90 * NGAY }); }

// Bot tự "chuyển người": im NGẮN (mặc định 10 phút) để chủ tiệm kịp vào; không ai vào thì bot lại trả lời.
export async function danhDauChoNguoi(env, psid) {
  const phut = Number(env.PHUT_CHO_NGUOI ?? 0);
  if (phut <= 0) return; // 0 = không im; bot nói tiếp, chỉ ghi sổ để chủ tiệm biết
  await env.KHO.put(`nguoi:${psid}`, "cho-nguoi", { expirationTtl: Math.max(60, phut * 60) });
}

// ===== Tóm tắt AI =====
export const docTomTat = (env, psid) => env.KHO.get(`tt:${psid}`, "json");
export const luuTomTat = (env, psid, tt) => env.KHO.put(`tt:${psid}`, JSON.stringify(tt), { expirationTtl: 90 * NGAY });

// ===== Luật anh dặn thêm qua trang quản lý (bot đọc ngay, không cần deploy) =====
export const docLuatThem = env => docDanhSach(env, "luat-them");          // [{id, luat, hieu, goc, luc, bat}]
export const luuLuatThem = (env, ds) => env.KHO.put("luat-them", JSON.stringify(ds));
export const docDanCho = env => docDanhSach(env, "dan-cho");              // lời dặn AI đã hiểu, chờ anh gật
export const luuDanCho = (env, ds) => env.KHO.put("dan-cho", JSON.stringify(ds.slice(0, 20)));

// ===== Chăm sóc lại =====
export const docCham = (env, psid) => env.KHO.get(`cham:${psid}`, "json");
export const luuCham = (env, psid, c) => env.KHO.put(`cham:${psid}`, JSON.stringify(c), { expirationTtl: 90 * NGAY });
export const docDot = (env, ngay) => env.KHO.get(`cham-dot:${ngay}`, "json");
export const luuDot = (env, dot) => env.KHO.put(`cham-dot:${dot.ngay}`, JSON.stringify(dot), { expirationTtl: 180 * NGAY });
export const dotMoiNhat = env => env.KHO.get("cham-dot:moi-nhat");
export async function ghiDotMoiNhat(env, ngay) {
  await env.KHO.put("cham-dot:moi-nhat", ngay);
  const ds = await docDanhSach(env, "cham-dot-list");
  const moi = [ngay, ...ds.filter(n => n !== ngay)].slice(0, 60);
  await env.KHO.put("cham-dot-list", JSON.stringify(moi));
}

// Khách vừa nhắn: nếu đang trong đợt chăm sóc gần đây và chưa ghi rép → ghi rép (để thống kê đợt).
export async function ghiRep(env, psid) {
  const c = await docCham(env, psid);
  if (!c || c.rep) return;
  c.rep = true; c.repLuc = new Date().toISOString();
  await luuCham(env, psid, c);
}
