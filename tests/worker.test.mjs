// Chạy: npm test (Node 22.15+ hoặc 24). Kho KV giả trong bộ nhớ, không gọi Facebook hay AI.
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

// Wrangler cho import .md/.html thành chuỗi; ở Node phải tự làm điều đó.
registerHooks({ load(url, context, next) {
  if (/\.(md|html)$/.test(url)) return { format: "module", source: "export default " + JSON.stringify(readFileSync(new URL(url), "utf8")), shortCircuit: true };
  return next(url, context);
} });
const { default: worker } = await import("../src/index.js");
const { bocJsonBatKy, danhSachModel } = await import("../src/ai.js");

function moi() {
  const store = new Map();
  const env = {
    ADMIN_KEY: "khoa-thu", FB_VERIFY_TOKEN: "bat-tay", FB_PAGE_ID: "1", FB_APP_ID: "2", CHE_DO: "worker",
    KHO: {
      async get(k, kieu) { const v = store.get(k); if (v == null) return null; return kieu === "json" ? JSON.parse(v) : v; },
      async put(k, v) { store.set(k, typeof v === "string" ? v : JSON.stringify(v)); },
      async delete(k) { store.delete(k); },
      async list({ prefix = "" } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name, metadata: null })), list_complete: true }; },
    },
  };
  const goi = (path, options) => worker.fetch(new Request("https://bot.test" + path, options), env, { waitUntil() {} });
  return { store, env, goi };
}

test("trang chủ báo đang chạy và chỉ đường tới /quan-ly", async () => {
  const { goi } = moi();
  const r = await goi("/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /quan-ly/);
});

test("bắt tay webhook: đúng verify token thì trả challenge, sai thì 403", async () => {
  const { goi } = moi();
  const ok = await goi("/webhook?hub.mode=subscribe&hub.verify_token=bat-tay&hub.challenge=123");
  assert.equal(await ok.text(), "123");
  const sai = await goi("/webhook?hub.mode=subscribe&hub.verify_token=xxx&hub.challenge=123");
  assert.equal(sai.status, 403);
});

test("webhook POST không có chữ ký thì bị từ chối 403", async () => {
  const { goi } = moi();
  const r = await goi("/webhook", { method: "POST", body: "{}" });
  assert.equal(r.status, 403);
});

test("/admin đòi khoá; có khoá thì trả trạng thái", async () => {
  const { goi } = moi();
  assert.equal((await goi("/admin")).status, 401);
  const r = await goi("/admin?key=khoa-thu");
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.bot, "bat");
  assert.equal(d.cheDo, "worker");
  assert.ok("quetLanCuoi" in d && "webhookLanCuoi" in d && Array.isArray(d.khachCanNguoi));
});

test("tắt/bật bot qua /admin/bot", async () => {
  const { goi } = moi();
  await goi("/admin/bot?key=khoa-thu&trang_thai=tat", { method: "POST" });
  assert.equal((await (await goi("/admin?key=khoa-thu")).json()).bot, "tat");
  await goi("/admin/bot?key=khoa-thu&trang_thai=bat", { method: "POST" });
  assert.equal((await (await goi("/admin?key=khoa-thu")).json()).bot, "bat");
});

test("/quan-ly: chưa đăng nhập thấy form 401, đăng nhập đúng thì đặt cookie và vào được", async () => {
  const { goi } = moi();
  const r = await goi("/quan-ly");
  assert.equal(r.status, 401);
  assert.match(await r.text(), /Bàn trực bot/);
  const form = new FormData(); form.set("key", "khoa-thu");
  const dn = await goi("/quan-ly/dang-nhap", { method: "POST", body: form });
  assert.equal(dn.status, 303);
  const cookie = dn.headers.get("set-cookie");
  assert.match(cookie, /^qk=/);
  const trang = await goi("/quan-ly", { headers: { cookie: cookie.split(";")[0] } });
  assert.equal(trang.status, 200);
  assert.match(await trang.text(), /Chăm sóc lại/);
});

test("danh sách hội thoại rỗng lúc đầu, có khách sau khi ghi lịch sử", async () => {
  const { goi } = moi();
  const r0 = await (await goi("/admin/hoi-thoai?key=khoa-thu")).json();
  assert.equal(r0.soKhach, 0);
});

test("bóc JSON chịu được chữ thừa và xuống dòng thật trong chuỗi", () => {
  const o = bocJsonBatKy('Đây là trả lời:\n{"tra_loi": "Dạ em chào anh\nGiá 350k ạ", "chuyen_nguoi": false, "ly_do": ""} cảm ơn');
  assert.equal(o.tra_loi, "Dạ em chào anh\nGiá 350k ạ");
  assert.equal(o.chuyen_nguoi, false);
});

test("MODEL là danh sách cách nhau dấu phẩy", () => {
  assert.deepEqual(danhSachModel({ MODEL: "gpt-4.1, gpt-4.1-mini ,claude-haiku-4-5" }), ["gpt-4.1", "gpt-4.1-mini", "claude-haiku-4-5"]);
});
