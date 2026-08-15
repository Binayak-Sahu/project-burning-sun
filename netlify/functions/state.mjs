/* ============================================================
   state.mjs — the shared copy of the board.

   GET  /.netlify/functions/state          read it (open to anyone)
   POST /.netlify/functions/state          merge a change in (needs the PIN)
   POST { op: 'auth' }                     check a PIN without writing

   This is a v2 Netlify Function (export default, standard Request and
   Response). v2 is the runtime where Netlify Blobs configures itself,
   which the older exports.handler style did not reliably do.

   Storage is Netlify Blobs: no database, no setup. The PIN lives in the
   BURN_PIN environment variable so it never reaches a browser.
   ============================================================ */
import { getStore } from '@netlify/blobs';
import Merge from '../../js/merge.js';

const KEY = 'board';
const PIN = () => String(process.env.BURN_PIN || '1234');

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Burn-Pin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const reply = (code, body) => new Response(JSON.stringify(body), { status: code, headers });

/* Constant-time-ish compare, so a wrong PIN does not leak its length
   through response timing. */
function pinOk(given) {
  const a = String(given || ''), b = PIN();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Normally Netlify hands the function everything Blobs needs. If that
   has not happened, fall back to explicit credentials from environment
   variables before giving up — and if we do give up, say precisely why
   rather than hiding it behind a generic message. */
function openStore() {
  const opts = { name: 'burning-sun', consistency: 'strong' };
  try {
    return getStore(opts);
  } catch (autoErr) {
    const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (siteID && token) {
      return getStore({ ...opts, siteID, token });
    }
    const e = new Error(
      'Netlify Blobs is not configured for this deploy. ' +
      (siteID ? '' : 'No site ID was available. ') +
      'Redeploy from Git or the CLI so the function runs on the v2 runtime; ' +
      'if it still fails, set BLOBS_SITE_ID and BLOBS_TOKEN environment variables. ' +
      'Underlying error: ' + autoErr.message
    );
    e.detail = autoErr.message;
    throw e;
  }
}

export default async function (req) {
  /* 204 must carry a null body — the Response constructor throws on an
     empty string, which would break every CORS preflight. */
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  let store;
  try {
    store = openStore();
  } catch (e) {
    return reply(503, { error: e.message });
  }

  /* ---------- read ---------- */
  if (req.method === 'GET') {
    try {
      const doc = await store.get(KEY, { type: 'json' });
      return reply(200, { doc: doc || null, rev: doc ? doc.rev || 0 : 0 });
    } catch (e) {
      return reply(500, { error: 'Could not read the shared board: ' + e.message });
    }
  }

  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });

  let body;
  try { body = await req.json(); }
  catch (e) { return reply(400, { error: 'That request body was not JSON.' }); }

  const given = req.headers.get('x-burn-pin') || body.pin;

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
     Read, merge, write. Strong consistency plus the field-level
     timestamps in merge.js mean a simultaneous write from someone else
     is absorbed rather than overwritten. */
  try {
    const current = await store.get(KEY, { type: 'json' });
    const merged = Merge.merge(current, body.doc);
    merged.rev = ((current && current.rev) || 0) + 1;
    merged.updatedAt = new Date().toISOString();
    await store.setJSON(KEY, merged);
    return reply(200, { doc: merged, rev: merged.rev });
  } catch (e) {
    return reply(500, { error: 'Could not save to the shared board: ' + e.message });
  }
}
