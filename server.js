'use strict';

// Isla ID Studio: lightweight optional server for cross-device scan notifications.
// Uses only Node.js built-in modules and stores temporary sessions in memory.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const sessions = new Map();
const SESSION_IDLE_MS = 90_000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(payload));
}

function readJson(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('El contenido de la solicitud es demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (_) { reject(new Error('El cuerpo de la solicitud no es JSON válido.')); }
    });
    req.on('error', reject);
  });
}

function checksum(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function parsePayload(payload) {
  if (typeof payload !== 'string') return null;
  const parts = payload.trim().split('|');
  if (parts.length !== 4 || parts[0] !== 'ISLA-ID' || parts[1] !== '1') return null;
  const reference = parts[2];
  if (!/^ISL-[0-9A-F]{16}$/.test(reference)) return null;
  const core = `ISLA-ID|1|${reference}`;
  if (checksum(core) !== parts[3].toUpperCase()) return null;
  return { reference };
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizeCredential(raw, reference) {
  if (!raw || typeof raw !== 'object') return null;
  const templates = new Set(['grenada', 'colombia', 'japan', 'canada', 'barbados', 'forest']);
  const template = templates.has(raw.template) ? raw.template : 'grenada';
  const accent = /^#[0-9a-fA-F]{6}$/.test(raw.accent || '') ? raw.accent : '#e5bd69';
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  const photo = typeof raw.photo === 'string'
    && raw.photo.length <= 185000
    && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.photo)
      ? raw.photo
      : '';

  return {
    reference,
    name: cleanText(raw.name, 80) || 'Sin nombre',
    displayName: cleanText(raw.displayName, 100) || cleanText(raw.name, 80) || 'Sin nombre',
    nationality: cleanText(raw.nationality, 60) || '—',
    birth: validDate(raw.birth),
    expiry: validDate(raw.expiry),
    subtitle: cleanText(raw.subtitle, 100),
    template,
    accent,
    photo
  };
}

function expireOldSessions() {
  const now = Date.now();
  for (const [reference, session] of sessions.entries()) {
    if (now - session.lastSeen > SESSION_IDLE_MS) sessions.delete(reference);
  }
}

setInterval(expireOldSessions, 30_000).unref();

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, service: 'isla-id-studio' });
  }

  if (url.pathname === '/api/session' && req.method === 'POST') {
    try {
      const body = await readJson(req, 220_000);
      const reference = String(body.reference || '').toUpperCase();
      if (!/^ISL-[0-9A-F]{16}$/.test(reference)) {
        return sendJson(res, 400, { ok: false, error: 'Referencia inválida.' });
      }
      const now = Date.now();
      const credential = sanitizeCredential(body.credential, reference);
      sessions.set(reference, { createdAt: now, lastSeen: now, scanned: false, scannedAt: null, credential });
      return sendJson(res, 201, { ok: true, reference });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (url.pathname === '/api/session' && req.method === 'GET') {
    const reference = String(url.searchParams.get('reference') || '').toUpperCase();
    if (!/^ISL-[0-9A-F]{16}$/.test(reference)) {
      return sendJson(res, 400, { ok: false, error: 'Referencia inválida.' });
    }
    const session = sessions.get(reference);
    if (!session) return sendJson(res, 200, { ok: true, active: false, scanned: false });
    if (Date.now() - session.lastSeen > SESSION_IDLE_MS) {
      sessions.delete(reference);
      return sendJson(res, 200, { ok: true, active: false, scanned: false });
    }
    if (!session.scanned) session.lastSeen = Date.now();
    return sendJson(res, 200, { ok: true, active: true, scanned: session.scanned, scannedAt: session.scannedAt });
  }

  if (url.pathname === '/api/scan' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const parsed = parsePayload(body.payload);
      if (!parsed) return sendJson(res, 400, { ok: false, error: 'El QR no es válido.' });
      const session = sessions.get(parsed.reference);
      const active = !!session && Date.now() - session.lastSeen <= 15_000;
      const credential = session && session.credential ? session.credential : null;
      if (active && !session.scanned) {
        session.scanned = true;
        session.scannedAt = Date.now();
        session.lastSeen = Date.now();
        return sendJson(res, 200, { ok: true, notified: true, credential });
      }
      return sendJson(res, 200, { ok: true, notified: false, credential });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Ruta API no encontrada.' });
}

function serveFile(req, res, url) {
  let requestedPath;
  try { requestedPath = decodeURIComponent(url.pathname); }
  catch (_) { res.writeHead(400); return res.end('Bad request'); }
  if (requestedPath === '/') requestedPath = '/index.html';
  const normalized = path.normalize(requestedPath).replace(/^([/\\]*\.\.[/\\])+/, '');
  const filename = path.resolve(ROOT, '.' + normalized);
  if (!filename.startsWith(ROOT + path.sep) && filename !== path.join(ROOT, 'index.html')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.stat(filename, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Archivo no encontrado.');
    }
    const contentType = MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': path.extname(filename) === '.html' ? 'no-store' : 'public, max-age=1800'
    });
    fs.createReadStream(filename).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch (_) { res.writeHead(400); return res.end('Bad request'); }
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end('Method not allowed');
  }
  serveFile(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Isla ID Studio disponible en el puerto ${PORT}`);
});
