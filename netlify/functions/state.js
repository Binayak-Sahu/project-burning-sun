/* ============================================================
   state.js — the shared copy of the board.

   GET  /.netlify/functions/state          read it (open to anyone)
   POST /.netlify/functions/state          merge a change in (needs the PIN)
   POST { op: 'auth' }                     check a PIN without writing

   Storage is Netlify Blobs, which needs no setup and no database.
   The PIN lives in the BURN_PIN environment variable so it is never
   shipped to the browser. Set it in Netlify under
   Site configuration -> Environment variables.
   ============================================================ */
const { getStore } = require('@netlify/blobs');
const { merge } = require('../../js/merge.js');

const KEY = 'board';
const PIN = () => String(process.env.BURN_PIN || '1234');

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Burn-Pin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const reply = (code, body) => ({ statusCode: code, headers, body: JSON.stringify(body) });

/* Constant-time-ish compare, so a wrong PIN does not leak its length
   through response timing. */
function pinOk(given) {
  const a = String(given || ''), b = PIN();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };

  let store;
  try {
    store = getStore({ name: 'burning-sun', consistency: 'strong' });
  } catch (e) {
    return reply(503, { error: 'Blob storage is not available on this deploy.' });
  }

  /* ---------- read ---------- */
  if (event.httpMethod === 'GET') {
    try {
      const doc = await store.get(KEY, { type: 'json' });
      return reply(200, { doc: doc || null, rev: doc ? doc.rev || 0 : 0 });
    } catch (e) {
      return reply(500, { error: 'Could not read the shared board.' });
    }
  }

  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return reply(400, { error: 'That request body was not JSON.' }); }

  const given = event.headers['x-burn-pin'] || body.pin;

  if (body.op === 'auth') {
    return pinOk(given)
      ? reply(200, { ok: true })
      : reply(401, { ok: false, error: 'Wrong PIN.' });
  }

  if (!pinOk(given)) {
    return reply(401, { error: 'Editing needs the PIN. Ask whoever set this site up.' });
  }
  if (!body.doc || !Array.isArray(body.doc.chapters)) {
    return reply(400, { error: 'No chapters in that payload.' });
  }

  /* ---------- merge and write ----------
     Read-merge-write. Netlify Blobs strong consistency plus the
     field-level timestamps in merge.js mean a simultaneous write from
     someone else is absorbed rather than overwritten. */
  try {
    const current = await store.get(KEY, { type: 'json' });
    const merged = merge(current, body.doc);
    merged.rev = ((current && current.rev) || 0) + 1;
    merged.updatedAt = new Date().toISOString();
    await store.setJSON(KEY, merged);
    return reply(200, { doc: merged, rev: merged.rev });
  } catch (e) {
    return reply(500, { error: 'Could not save to the shared board.' });
  }
};
