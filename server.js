// Certifide PDF Generation Service
// ----------------------------------
// Accepts structured inspection JSON from Laravel, renders a beautiful A4 PDF
// using Puppeteer + headless Chromium, and POSTs the result back to Laravel's
// /api/pdf-callback endpoint.
//
//   POST /generate-pdf   { inspection_payload, callback_url, pdf_job_id }
//   GET  /health

import express from 'express';
import puppeteer from 'puppeteer';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateInspectionHtml } from './templates/inspection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT            = parseInt(process.env.PORT            || '3000', 10);
const SECRET          = process.env.PDF_SERVICE_SECRET       || '';
const CALLBACK_SECRET = process.env.LARAVEL_CALLBACK_SECRET  || '';
const NAV_TIMEOUT     = parseInt(process.env.RENDER_TIMEOUT_MS || '90000', 10);
const MAX_BODY        = process.env.MAX_BODY                 || '5mb';

// Temp directory for PDF bytes while we POST them back to Laravel
const TEMP_DIR = path.join(tmpdir(), 'certifide-pdfs');
await mkdir(TEMP_DIR, { recursive: true });

// ─── Shared browser (relaunched automatically if it crashes) ──────────────
let browser  = null;
let launching = null;

async function getBrowser() {
  if (browser && browser.connected) return browser;
  if (launching) return launching;
  launching = puppeteer
    .launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    })
    .then((b) => {
      browser  = b;
      launching = null;
      b.on('disconnected', () => { browser = null; });
      return b;
    })
    .catch((e) => { launching = null; throw e; });
  return launching;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function authorized(req, res) {
  if (!SECRET) return true;
  const got  = Buffer.from(req.get('x-api-key') || '');
  const want = Buffer.from(SECRET);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    res.status(401).json({ status: 'error', message: 'Invalid or missing x-api-key' });
    return false;
  }
  return true;
}

function safeFilename(ref, fallback = 'certifide-report') {
  const base = String(ref || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100) || fallback;
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

// POST the rendered PDF back to Laravel as multipart/form-data.
// Requires Node 18+ (built-in fetch + FormData).
async function deliverToLaravel(callbackUrl, pdfJobId, tmpPath, filename) {
  const pdfBytes = await readFile(tmpPath);
  const blob     = new Blob([pdfBytes], { type: 'application/pdf' });
  const form     = new FormData();
  form.append('pdf',        blob, filename);
  form.append('pdf_job_id', String(pdfJobId));

  const headers = { Accept: 'application/json' };
  if (CALLBACK_SECRET) headers['x-api-key'] = CALLBACK_SECRET;

  const res = await fetch(callbackUrl, {
    method:  'POST',
    headers,
    body:    form,
    signal:  AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Laravel callback HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json().catch(() => ({ status: 'ok' }));
}

// Notify Laravel of a failure (JSON body, no file).
async function notifyFailure(callbackUrl, pdfJobId, errorMsg) {
  try {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (CALLBACK_SECRET) headers['x-api-key'] = CALLBACK_SECRET;

    await fetch(callbackUrl, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ pdf_job_id: pdfJobId, error: errorMsg }),
      signal:  AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.error('[pdf] also failed to notify Laravel of failure:', e.message);
  }
}

// ─── Express app ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: MAX_BODY }));

app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) }),
);

app.post('/generate-pdf', async (req, res) => {
  if (!authorized(req, res)) return;

  const { inspection_payload, callback_url, pdf_job_id } = req.body || {};

  if (!inspection_payload || typeof inspection_payload !== 'object') {
    return res.status(422).json({ status: 'error', message: '"inspection_payload" (object) is required.' });
  }
  if (!callback_url || typeof callback_url !== 'string') {
    return res.status(422).json({ status: 'error', message: '"callback_url" (string) is required.' });
  }
  if (pdf_job_id === undefined || pdf_job_id === null) {
    return res.status(422).json({ status: 'error', message: '"pdf_job_id" is required.' });
  }

  // Respond immediately — Laravel must not time out waiting for Puppeteer
  res.json({
    status:  'accepted',
    message: 'PDF generation started. Result will be POSTed to callback_url.',
  });

  // ─── Async render → deliver (runs after response is flushed) ────────────
  const refNumber = inspection_payload?.inspection?.reference_number ?? randomUUID();
  const filename  = safeFilename(refNumber);
  const tmpPath   = path.join(TEMP_DIR, `${randomUUID()}.pdf`);
  let page;

  try {
    console.log(`[pdf] render start  job=${pdf_job_id}  ref=${refNumber}`);

    const html = generateInspectionHtml(inspection_payload);

    const b = await getBrowser();
    page    = await b.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: NAV_TIMEOUT });

    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    await writeFile(tmpPath, pdfBuffer);
    console.log(`[pdf] render done   job=${pdf_job_id}  size=${pdfBuffer.length}B`);

    await deliverToLaravel(callback_url, pdf_job_id, tmpPath, filename);
    console.log(`[pdf] delivered     job=${pdf_job_id}`);
  } catch (err) {
    console.error(`[pdf] failed        job=${pdf_job_id}`, err.message);
    await notifyFailure(callback_url, pdf_job_id, err.message);
  } finally {
    if (page) await page.close().catch(() => {});
    unlink(tmpPath).catch(() => {});
  }
});

// ─── Start ────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Certifide PDF service  →  http://localhost:${PORT}`);
  if (!SECRET)          console.warn('WARNING: PDF_SERVICE_SECRET is empty — /generate-pdf is unauthenticated');
  if (!CALLBACK_SECRET) console.warn('WARNING: LARAVEL_CALLBACK_SECRET is empty — callback has no auth header');
});

// Graceful shutdown — don't leave a zombie Chromium
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`[pdf] ${sig} received, shutting down`);
    try { if (browser) await browser.close(); } catch {}
    process.exit(0);
  });
}
