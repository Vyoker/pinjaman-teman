'use strict';

/**
 * Adapter penyimpanan.
 * - Produksi (Vercel): pakai @vercel/kv (butuh KV_REST_API_URL & KV_REST_API_TOKEN).
 * - Tanpa env KV (dev/tes): fallback memori per-instance. JANGAN dipakai produksi.
 */

function createMemoryKv() {
  const map = new Map();
  const exp = new Map(); // key -> epoch ms kedaluwarsa
  function alive(k) {
    if (!exp.has(k)) return true;
    if (Date.now() > exp.get(k)) { map.delete(k); exp.delete(k); return false; }
    return true;
  }
  return {
    async get(k) { return alive(k) && map.has(k) ? map.get(k) : null; },
    async set(k, v, opts) {
      map.set(k, v);
      if (opts && opts.ex) exp.set(k, Date.now() + opts.ex * 1000);
      else exp.delete(k);
      return 'OK';
    },
    async incr(k) {
      const cur = Number((await this.get(k)) || 0) + 1;
      await this.set(k, String(cur));
      return cur;
    },
    async del(k) { map.delete(k); exp.delete(k); return 1; },
    __memory: true,
  };
}

let _kv = null;

function kv() {
  if (_kv) return _kv;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      _kv = require('@vercel/kv').kv;
    } catch (e) {
      throw new Error('@vercel/kv belum terinstal. Jalankan: npm install @vercel/kv');
    }
  } else {
    _kv = createMemoryKv();
  }
  return _kv;
}

function isMemoryMode() {
  return !(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function getJSON(key) {
  const raw = await kv().get(key);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function setJSON(key, obj, opts) {
  return kv().set(key, JSON.stringify(obj), opts);
}

async function nextId(prefix) {
  const n = await kv().incr('seq:' + prefix);
  return prefix + '-' + String(n).padStart(5, '0');
}

// Kunci:
//   user:<phone>   -> { name, phone, pass, status:'pending'|'active'|'rejected', limit, createdAt }
//   loan:<id>      -> { id, borrowerPhone, borrowerName, pokok, tenorHari, metode, nCicilan,
//                       bunga, biayaLayanan, total, schedule:[{n,dueInDays,dueDate,amount,status,paidAt,payMethod}],
//                       status:'diajukan'|'berjalan'|'lunas'|'ditolak', createdAt, approvedAt, disbursedAt }
//   claim:<id>     -> { id, loanId, schedIdx, amount, payMethod, status:'menunggu'|'diterima'|'ditolak', createdAt, decidedAt }
//   sess:<token>   -> { phone, role:'admin'|'borrower', name }  (TTL 7 hari)
//   settings       -> { dana, shopeepay, qrisNote }

module.exports = { kv, getJSON, setJSON, nextId, isMemoryMode };
