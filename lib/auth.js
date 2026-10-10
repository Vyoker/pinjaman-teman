'use strict';

const crypto = require('crypto');
const { getJSON, setJSON, kv } = require('./store');

const SESSION_TTL = 7 * 24 * 3600; // 7 hari

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

async function createSession({ phone, role, name }) {
  const token = crypto.randomBytes(32).toString('hex');
  await setJSON('sess:' + token, { phone, role, name }, { ex: SESSION_TTL });
  return token;
}

async function getSession(req) {
  const h = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!h || !h.startsWith('Bearer ')) return null;
  const token = h.slice(7).trim();
  if (!token) return null;
  const sess = await getJSON('sess:' + token);
  return sess ? { ...sess, token } : null;
}

async function destroySession(req) {
  const sess = await getSession(req);
  if (sess) await kv().del('sess:' + sess.token);
}

/** Baca JSON body (untuk runtime Node tanpa framework). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Body bukan JSON valid.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

/** Bungkus handler dengan autentikasi. opts.admin=true => hanya admin. */
function requireAuth(handler, opts = {}) {
  return async (req, res) => {
    try {
      const sess = await getSession(req);
      if (!sess) return send(res, 401, { ok: false, error: 'Belum login.' });
      if (opts.admin && sess.role !== 'admin') return send(res, 403, { ok: false, error: 'Khusus admin.' });
      req.session = sess;
      return handler(req, res);
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || 'Kesalahan server.' });
    }
  };
}

function normPhone(p) {
  return String(p || '').replace(/[^0-9]/g, '');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  readBody,
  send,
  requireAuth,
  normPhone,
  SESSION_TTL,
};
