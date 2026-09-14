// Các đường /admin/* phục vụ TRANG QUẢN LÝ (/quan-ly): danh sách hội thoại, tóm tắt AI, dặn thêm luật,
// đợt chăm sóc lại. Đường cũ (bot, thu, gui, mo-lai, quet, khach, cho-xu-ly) vẫn ở index.js.

import * as kho from "./kho.js";
import { tomTatKhach, soanChamSoc, hieuLoiDan, BUOC } from "./ai.js";
import { guiTinNguoiTruc } from "./facebook.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const NGAY_MS = 86400000;

// yyyy-mm-dd theo giờ Việt Nam (UTC+7)
export function ngayVN(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// Trạng thái một hội thoại để hiện nhãn: nguoi (chủ trực) | im (bot tự im ngắn) | can-nguoi | loi | bot
async function trangThaiKhach(env, psid, canNguoi, loiPsid) {
  const dau = await env.KHO.get(`nguoi:${psid}`);
  if (dau && dau !== "cho-nguoi") {
    const gio = Number(env.GIO_NGUOI_TRUC || 6);
    return { trangThai: "nguoi", imToi: new Date(Date.parse(dau) + gio * 3600 * 1000).toISOString() };
  }
  if (dau === "cho-nguoi") return { trangThai: "im" };
  if (canNguoi.has(psid)) return { trangThai: "can-nguoi", lyDo: canNguoi.get(psid) };
  if (loiPsid.has(psid)) return { trangThai: "loi" };
  return { trangThai: "bot" };
}

export async function xuLyQuanLy(request, url, env, ctx) {
  const p = url.pathname;
  const b = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  // ---- Danh sách hội thoại (mới nhất trước), kèm trạng thái ----
  if (p === "/admin/hoi-thoai" && request.method === "GET") {
    const gioiHan = Math.min(200, Number(url.searchParams.get("so") || 80));
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    let ds = await kho.danhSachHoiThoai(env);
    if (q) ds = ds.filter(h => (h.ten || "").toLowerCase().includes(q) || (h.cuoi || "").toLowerCase().includes(q));
    ds = ds.slice(0, gioiHan);
    const moc = Date.now() - NGAY_MS;
    const canNguoi = new Map();
    for (const c of await kho.docDanhSach(env, "chuyen-list")) if (Date.parse(c.luc) > moc && !canNguoi.has(c.psid)) canNguoi.set(c.psid, c.lyDo || "");
    const loiPsid = new Set((await kho.docDanhSach(env, "log")).filter(l => l.psid && Date.parse(l.luc) > moc).map(l => l.psid));
    const ra = await Promise.all(ds.map(async h => ({ ...h, ...(await trangThaiKhach(env, h.psid, canNguoi, loiPsid)) })));
    return json({ soKhach: ra.length, tong: (await kho.danhSachHoiThoai(env)).length, khach: ra });
  }

  // ---- Một khách: lịch sử đầy đủ + tóm tắt (cache) + chăm sóc + bỏ qua ----
  if (p === "/admin/khach-day-du" && request.method === "GET") {
    const psid = url.searchParams.get("psid");
    if (!psid) return json({ loi: "thiếu psid" }, 400);
    const [ten, lichSu, tomTat, cham, boQua, nhan, nguoi] = await Promise.all([
      kho.layTen(env, psid), kho.layLichSu(env, psid), kho.docTomTat(env, psid), kho.docCham(env, psid),
      env.KHO.get(`bo-qua:${psid}`, "json"), env.KHO.get(`cham-nhan:${psid}`, "json"), env.KHO.get(`nguoi:${psid}`),
    ]);
    const gio = Number(env.GIO_NGUOI_TRUC || 6);
    return json({
      psid, ten, lichSu, tomTat, cham, boQua, nhan,
      nguoiTruc: nguoi && nguoi !== "cho-nguoi" ? { tu: nguoi, toi: new Date(Date.parse(nguoi) + gio * 3600 * 1000).toISOString() } : null,
      imNgan: nguoi === "cho-nguoi",
      tomTatCu: Boolean(tomTat && tomTat.soTin !== lichSu.length),
    });
  }

  // ---- Tóm tắt AI (làm mới) ----
  if (p === "/admin/tom-tat" && request.method === "POST") {
    const psid = b.psid || url.searchParams.get("psid");
    if (!psid) return json({ loi: "thiếu psid" }, 400);
    const lichSu = await kho.layLichSu(env, psid);
    if (!lichSu.length) return json({ loi: "khách chưa có lịch sử" }, 404);
    try {
      const tt = await tomTatKhach(env, lichSu, await kho.layTen(env, psid));
      await kho.luuTomTat(env, psid, tt);
      return json({ ok: true, tomTat: tt });
    } catch (e) {
      await kho.ghiLog(env, { loai: "tom-tat", psid, loi: String(e.message || e) });
      return json({ ok: false, loi: String(e.message || e) }, 502);
    }
  }

  // ---- Bot im hẳn với một khách (như chủ vừa gõ tay) ----
  if (p === "/admin/im" && request.method === "POST") {
    const psid = b.psid || url.searchParams.get("psid");
    if (!psid) return json({ loi: "thiếu psid" }, 400);
    await kho.danhDauNguoiTruc(env, psid);
    await kho.xoaCho(env, psid);
    return json({ ok: true });
  }

  // ---- Không chăm nữa / chăm lại ----
  if (p === "/admin/bo-qua" && request.method === "POST") {
    const psid = b.psid || url.searchParams.get("psid");
    if (!psid) return json({ loi: "thiếu psid" }, 400);
    if (b.bat === false) { await env.KHO.delete(`bo-qua:${psid}`); await env.KHO.delete(`cham-nhan:${psid}`); return json({ ok: true, boQua: null }); }
    const muc = { luc: new Date().toISOString(), lyDo: String(b.ly_do || "chủ gắn tay") };
    await env.KHO.put(`bo-qua:${psid}`, JSON.stringify(muc));
    return json({ ok: true, boQua: muc });
  }

  // ---- Dặn thêm cho em ----
  if (p === "/admin/dan" && request.method === "GET") {
    return json({ luat: await kho.docLuatThem(env), cho: await kho.docDanCho(env) });
  }
  if (p === "/admin/dan" && request.method === "POST") {
    const text = String(b.text || "").trim();
    if (!text) return json({ loi: "thiếu text" }, 400);
    try {
      const kq = await hieuLoiDan(env, text, await kho.docLuatThem(env));
      const muc = { id: Date.now().toString(36), goc: text, ...kq, luc: new Date().toISOString() };
      const cho = await kho.docDanCho(env);
      cho.unshift(muc);
      await kho.luuDanCho(env, cho);
      return json({ ok: true, dan: muc });
    } catch (e) {
      return json({ ok: false, loi: String(e.message || e) }, 502);
    }
  }
  if (p === "/admin/dan/duyet" && request.method === "POST") {
    const cho = await kho.docDanCho(env);
    const muc = cho.find(m => m.id === b.id);
    if (!muc) return json({ loi: "không thấy lời dặn này" }, 404);
    const luat = await kho.docLuatThem(env);
    luat.push({ id: muc.id, luat: String(b.luat || muc.luat).trim(), hieu: muc.hieu, goc: muc.goc, luc: new Date().toISOString(), bat: true });
    await kho.luuLuatThem(env, luat);
    await kho.luuDanCho(env, cho.filter(m => m.id !== b.id));
    return json({ ok: true, luat });
  }
  if (p === "/admin/dan/bo" && request.method === "POST") {
    await kho.luuDanCho(env, (await kho.docDanCho(env)).filter(m => m.id !== b.id));
    return json({ ok: true });
  }
  if (p === "/admin/dan/bat" && request.method === "POST") {
    const luat = await kho.docLuatThem(env);
    const l = luat.find(x => x.id === b.id);
    if (!l) return json({ loi: "không thấy luật" }, 404);
    l.bat = b.bat !== false;
    await kho.luuLuatThem(env, luat);
    return json({ ok: true, luat });
  }
  if (p === "/admin/dan/xoa" && request.method === "POST") {
    const luat = (await kho.docLuatThem(env)).filter(x => x.id !== b.id);
    await kho.luuLuatThem(env, luat);
    return json({ ok: true, luat });
  }

  // ---- Chăm sóc lại ----
  if (p === "/admin/cham-soc" && request.method === "GET") {
    const ngay = url.searchParams.get("ngay") || (await kho.dotMoiNhat(env));
    const dot = ngay ? await kho.docDot(env, ngay) : null;
    const dsNgay = await kho.docDanhSach(env, "cham-dot-list");
    const truoc = dsNgay.find(n => n !== (dot && dot.ngay));
    const dotTruoc = truoc ? await thongKeDot(env, await kho.docDot(env, truoc)) : null;
    return json({ dot: dot ? await themRep(env, dot) : null, dotTruoc, cacNgay: dsNgay, nhipNgay: Number(env.NGAY_CHAM || 3), toiDa: Number(env.CHAM_TOI_DA || 30), buoc: BUOC });
  }
  if (p === "/admin/cham-soc/lap" && request.method === "POST") {
    const ngay = ngayVN();
    const dangCo = await kho.docDot(env, ngay);
    if (dangCo && dangCo.dangLap && Date.now() - Date.parse(dangCo.batDau) < 20 * 60 * 1000) return json({ ok: true, dangLap: true, ngay });
    ctx.waitUntil(lapDotChamSoc(env, { toiDa: Number(b.toi_da) || undefined, nhip: Number(b.nhip_ngay) || undefined }).catch(e => kho.ghiLog(env, { loai: "cham-soc-lap", loi: String(e.message || e) })));
    return json({ ok: true, dangLap: true, ngay });
  }
  if (p === "/admin/cham-soc/sua" && request.method === "POST") {
    const dot = await kho.docDot(env, b.ngay || (await kho.dotMoiNhat(env)));
    if (!dot) return json({ loi: "chưa có đợt" }, 404);
    const k = dot.khach.find(x => x.psid === b.psid);
    if (!k) return json({ loi: "không thấy khách trong đợt" }, 404);
    if (typeof b.cau === "string") k.cau = b.cau.trim();
    if (typeof b.chon === "boolean") k.chon = b.chon;
    if (b.bo_hang) { k.chon = false; k.boHang = true; }
    await kho.luuDot(env, dot);
    return json({ ok: true, khach: k });
  }
  // Chủ bấm Duyệt → khoá danh sách, trả về đoạn lệnh cho Claude extension
  if (p === "/admin/cham-soc/duyet" && request.method === "POST") {
    const dot = await kho.docDot(env, b.ngay || (await kho.dotMoiNhat(env)));
    if (!dot) return json({ loi: "chưa có đợt" }, 404);
    const chon = dot.khach.filter(k => k.chon && k.cau && !k.daGui);
    for (const k of chon) k.duyet = new Date().toISOString();
    dot.duyetLuc = new Date().toISOString();
    await kho.luuDot(env, dot);
    return json({ ok: true, soKhach: chon.length, lenh: lenhChoExtension(chon) });
  }
  // Đánh dấu đã gửi (chủ bấm sau khi extension gửi xong)
  if (p === "/admin/cham-soc/da-gui" && request.method === "POST") {
    const dot = await kho.docDot(env, b.ngay || (await kho.dotMoiNhat(env)));
    if (!dot) return json({ loi: "chưa có đợt" }, 404);
    const ds = Array.isArray(b.psid) ? b.psid : [b.psid];
    let so = 0;
    for (const psid of ds) {
      const k = dot.khach.find(x => x.psid === psid);
      if (!k || k.daGui) continue;
      await danhDauDaGui(env, dot, k, "extension");
      so++;
    }
    await kho.luuDot(env, dot);
    return json({ ok: true, so });
  }
  // Gửi thẳng qua Graph API bằng thẻ HUMAN_AGENT (cần app được duyệt quyền)
  if (p === "/admin/cham-soc/gui-api" && request.method === "POST") {
    const dot = await kho.docDot(env, b.ngay || (await kho.dotMoiNhat(env)));
    if (!dot) return json({ loi: "chưa có đợt" }, 404);
    const k = dot.khach.find(x => x.psid === b.psid);
    if (!k || !k.cau) return json({ loi: "không thấy khách hoặc chưa có câu" }, 404);
    try {
      await guiTinNguoiTruc(env, k.psid, k.cau);
    } catch (e) {
      const loi = String(e.message || e);
      const chuaQuyen = /HUMAN_AGENT|permission|\(#10\)|\(#100\)|tag/i.test(loi);
      return json({ ok: false, loi, chuaQuyen }, 502);
    }
    await danhDauDaGui(env, dot, k, "api");
    await kho.luuDot(env, dot);
    return json({ ok: true });
  }

  return null; // không phải đường của trang quản lý
}

// Ghi vào kho: cham:<psid>, lịch sử (để bot có mạch), và đợt.
async function danhDauDaGui(env, dot, k, cach) {
  const luc = new Date().toISOString();
  k.daGui = luc; k.cach = cach;
  await kho.luuCham(env, k.psid, { luc, cau: k.cau, ngay: dot.ngay, cach });
  const ls = await kho.layLichSu(env, k.psid);
  ls.push({ role: "assistant", content: k.cau, t: Date.now(), cham: true });
  await kho.luuLichSu(env, k.psid, ls);
}

// Đợt được quét hộp thư nhận ra là đã gửi (tin Page do app khác gửi trùng câu trong đợt)
export async function danhDauDaGuiTuDong(env, psid, noiDung) {
  const ngay = await kho.dotMoiNhat(env);
  if (!ngay) return false;
  const dot = await kho.docDot(env, ngay);
  if (!dot) return false;
  const k = dot.khach.find(x => x.psid === psid && x.chon && x.cau && !x.daGui);
  if (!k) return false;
  const a = k.cau.slice(0, 30).toLowerCase(), c = String(noiDung || "").slice(0, 30).toLowerCase();
  if (a !== c) return false;
  await danhDauDaGui(env, dot, k, "extension (tự nhận)");
  await kho.luuDot(env, dot);
  return true;
}

function lenhChoExtension(chon) {
  const dong = chon.map((k, i) => `${i + 1}. ${k.ten || k.psid} — "${k.cau}"`).join("\n");
  return `Mở hộp thư Trang trên Facebook. Với MỖI khách trong danh sách dưới đây: tìm đúng tên trong danh sách hội thoại, mở hội thoại, dán nguyên câu đã cho vào ô trả lời, bấm gửi, chờ khoảng 20 giây rồi sang người tiếp. Không gửi cho ai ngoài danh sách, không sửa câu, không gửi thêm gì khác. Nếu không tìm thấy tên thì bỏ qua người đó. Gửi xong báo lại: đã gửi được cho ai, chưa gửi được cho ai.\n\n${dong}`;
}

async function themRep(env, dot) {
  for (const k of dot.khach) {
    if (!k.daGui) continue;
    const c = await kho.docCham(env, k.psid);
    k.rep = Boolean(c && c.rep && Date.parse(c.luc) >= Date.parse(k.daGui) - 1000);
  }
  return dot;
}

async function thongKeDot(env, dot) {
  if (!dot) return null;
  await themRep(env, dot);
  const daGui = dot.khach.filter(k => k.daGui);
  return { ngay: dot.ngay, soKhach: dot.khach.length, gui: daGui.length, rep: daGui.filter(k => k.rep).length, boQua: dot.boQua };
}

// Lập đợt chăm sóc: lọc khách im ≥ NGAY_CHAM ngày, chưa chăm trong nhịp, không thuộc nhóm bỏ qua; AI soạn câu cho tối đa CHAM_TOI_DA người.
export async function lapDotChamSoc(env, { toiDa, nhip: nhipTay } = {}) {
  const ngay = ngayVN();
  const nhip = nhipTay || Number(env.NGAY_CHAM || 3); // lập tay có thể đổi nhịp (ví dụ im từ 1 ngày); cron sáng dùng NGAY_CHAM
  const gioiHan = toiDa || Number(env.CHAM_TOI_DA || 30);
  const cu = await kho.docDot(env, ngay);
  const dot = {
    ngay, batDau: new Date().toISOString(), dangLap: true, nhip, gioiHan,
    tienDo: { xong: 0, tong: 0 }, ungVien: 0, boQua: {}, boQuaTong: 0,
    khach: cu ? cu.khach.filter(k => k.daGui) : [], // giữ người đã gửi hôm nay nếu lập lại
  };
  await kho.luuDot(env, dot);
  await kho.ghiDotMoiNhat(env, ngay);

  const moc = Date.now() - nhip * NGAY_MS;
  const daCo = new Set(dot.khach.map(k => k.psid));
  const ung = [];
  const dem = nhom => { dot.boQua[nhom] = (dot.boQua[nhom] || 0) + 1; dot.boQuaTong++; };
  for (const h of await kho.danhSachHoiThoai(env)) {
    if (!h.t || h.t > moc || daCo.has(h.psid)) continue;
    const [cham, boQua, nhan] = await Promise.all([kho.docCham(env, h.psid), env.KHO.get(`bo-qua:${h.psid}`), env.KHO.get(`cham-nhan:${h.psid}`, "json")]);
    if (cham && Date.parse(cham.luc) > moc) continue;                  // vừa chăm trong nhịp
    if (boQua) { dem("chu-gan"); continue; }
    if (nhan && nhan.boQua) { dem(nhan.nhom || "khac"); continue; }
    ung.push(h);
  }
  dot.ungVien = ung.length;
  dot.tienDo.tong = Math.min(ung.length, gioiHan);
  await kho.luuDot(env, dot);

  for (const h of ung.slice(0, gioiHan)) {
    const lichSu = await kho.layLichSu(env, h.psid);
    const soNgayIm = Math.max(1, Math.round((Date.now() - h.t) / NGAY_MS));
    try {
      const kq = await soanChamSoc(env, lichSu, h.ten, soNgayIm);
      if (kq.boQua) {
        dem(kq.nhom);
        await env.KHO.put(`cham-nhan:${h.psid}`, JSON.stringify({ boQua: true, nhom: kq.nhom, luc: new Date().toISOString() }), { expirationTtl: 90 * 86400 });
      } else {
        dot.khach.push({ psid: h.psid, ten: h.ten, t: h.t, soNgayIm, buoc: kq.buoc, cau: kq.cau, chon: Boolean(kq.cau), model: kq.model });
      }
    } catch (e) {
      dot.khach.push({ psid: h.psid, ten: h.ten, t: h.t, soNgayIm, buoc: 0, cau: "", chon: false, loi: String(e.message || e) });
    }
    dot.tienDo.xong++;
    await kho.luuDot(env, dot);
  }
  dot.dangLap = false;
  dot.ketThuc = new Date().toISOString();
  await kho.luuDot(env, dot);
  return dot;
}
