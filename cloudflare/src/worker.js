const CONSENT_VERSION = '2026-09-24';
const MAX_BATCH_SIZE = 40;
const FEATURE_COUNT = 126;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = new Set(
      (env.ALLOWED_ORIGINS || 'https://pendragon503.github.io,http://localhost:4173,http://localhost:4175')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const corsHeaders = cors(origin, allowedOrigins);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (origin && !allowedOrigins.has(origin)) {
      return json({ error: 'Origen no autorizado.' }, 403, corsHeaders);
    }

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/health') {
        return json({ status: 'ok', service: 'senasv-collective-learning', storage: 'cloudflare-d1' }, 200, corsHeaders);
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/contributions/batch') {
        return await storeBatch(request, env, corsHeaders);
      }

      if (request.method === 'DELETE' && url.pathname === '/api/v1/contributions/participant') {
        return await deleteParticipant(request, env, corsHeaders);
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/metrics/summary') {
        return await metricsSummary(env, corsHeaders);
      }

      return json({ error: 'Ruta no encontrada.' }, 404, corsHeaders);
    } catch (error) {
      console.error(error);
      return json({ error: 'No fue posible procesar la solicitud.' }, 500, corsHeaders);
    }
  },
};

async function storeBatch(request, env, headers) {
  const body = await safeJson(request);
  const validated = validateBatch(body);
  if (!validated.ok) return json({ error: validated.error }, 400, headers);
  if (!env.PARTICIPANT_SALT) return json({ error: 'El servidor no tiene configurado el secreto de anonimización.' }, 503, headers);

  const participantHash = await hmac(validated.value.participantId, env.PARTICIPANT_SALT);
  const statements = validated.value.samples.map((sample) =>
    env.DB.prepare(`
      INSERT OR IGNORE INTO contributions
        (submission_id, participant_hash, label, features_json, feature_count, captured_at, consent_version, app_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      sample.id,
      participantHash,
      sample.label,
      JSON.stringify(sample.features),
      FEATURE_COUNT,
      sample.capturedAt,
      CONSENT_VERSION,
      validated.value.appVersion,
    ),
  );
  const results = await env.DB.batch(statements);
  const accepted = results.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
  return json({ accepted, duplicates: validated.value.samples.length - accepted }, 201, headers);
}

async function deleteParticipant(request, env, headers) {
  const body = await safeJson(request);
  if (!body || !isUuid(body.participantId)) return json({ error: 'Identificador de participante inválido.' }, 400, headers);
  if (body.consentVersion !== CONSENT_VERSION) return json({ error: 'Versión de consentimiento inválida.' }, 400, headers);
  if (!env.PARTICIPANT_SALT) return json({ error: 'El servidor no tiene configurado el secreto de anonimización.' }, 503, headers);
  const participantHash = await hmac(body.participantId, env.PARTICIPANT_SALT);
  const result = await env.DB.prepare('DELETE FROM contributions WHERE participant_hash = ?').bind(participantHash).run();
  return json({ deleted: Number(result.meta?.changes || 0) }, 200, headers);
}

async function metricsSummary(env, headers) {
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS samples,
           COUNT(DISTINCT participant_hash) AS participants,
           COUNT(DISTINCT label) AS labels
    FROM contributions
  `).first();
  const labels = await env.DB.prepare(`
    SELECT label, COUNT(*) AS samples, COUNT(DISTINCT participant_hash) AS participants
    FROM contributions
    GROUP BY label
    ORDER BY CASE WHEN label GLOB '[0-9]*' THEN 0 ELSE 1 END, CAST(label AS INTEGER), label
  `).all();
  return json({
    samples: Number(totals?.samples || 0),
    participants: Number(totals?.participants || 0),
    labels: Number(totals?.labels || 0),
    byLabel: labels.results || [],
  }, 200, headers);
}

function validateBatch(body) {
  if (!body || typeof body !== 'object') return failure('El cuerpo debe ser un objeto JSON.');
  if (!isUuid(body.participantId)) return failure('Identificador de participante inválido.');
  if (body.consentVersion !== CONSENT_VERSION) return failure('Versión de consentimiento inválida.');
  if (typeof body.appVersion !== 'string' || body.appVersion.length < 1 || body.appVersion.length > 30) return failure('Versión de aplicación inválida.');
  if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > MAX_BATCH_SIZE) {
    return failure(`El lote debe contener entre 1 y ${MAX_BATCH_SIZE} muestras.`);
  }

  const samples = [];
  for (const input of body.samples) {
    if (!input || typeof input !== 'object' || !isUuid(input.id)) return failure('Identificador de muestra inválido.');
    const label = String(input.label || '').toUpperCase();
    if (!/^(?:[A-ZÑ]|CH|LL|RR|(?:100|[1-9]?[0-9]))$/.test(label)) return failure(`Etiqueta inválida: ${label}`);
    if (!Array.isArray(input.features) || input.features.length !== FEATURE_COUNT) return failure(`Cada muestra debe contener ${FEATURE_COUNT} características.`);
    const features = input.features.map(Number);
    if (features.some((value) => !Number.isFinite(value) || Math.abs(value) > 20)) return failure('La muestra contiene valores fuera de rango.');
    const capturedAt = new Date(input.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) return failure('Fecha de captura inválida.');
    samples.push({ id: input.id, label, features, capturedAt: capturedAt.toISOString() });
  }

  return { ok: true, value: { participantId: body.participantId, appVersion: body.appVersion, samples } };
}

function failure(error) {
  return { ok: false, error };
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function safeJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 600_000) return null;
  try { return await request.json(); } catch { return null; }
}

async function hmac(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cors(origin, allowedOrigins) {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  if (allowedOrigins.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
