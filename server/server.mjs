import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';

import { openDatabase } from './db.mjs';
import { applyCors, createRateLimiter } from './security.mjs';
import { handleLogin, handleLogout, handleMe, handleRegister } from './routes/auth.mjs';
import { handleGetLearningPath, handlePostProgress, handleProgressSummary } from './routes/learning-path.mjs';

const port = Number(process.env.PORT || 8787);
const databasePath = process.env.DATABASE_PATH || 'data/senasv.sqlite';
const participantSalt = process.env.PARTICIPANT_SALT || randomUUID();
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || 'http://localhost:4173,http://localhost:4175,https://pendragon503.github.io')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

// Cookies that carry the session must be sent as SameSite=None; Secure once the
// frontend and API live on different origins (the default production setup, e.g.
// GitHub Pages -> api.example.com). Set INSECURE_COOKIES=1 only for plain-http
// local development, where SameSite=None would be rejected by the browser.
const secureCookies = process.env.INSECURE_COOKIES !== '1';

const config = {
  sessionCookieName: 'senasv_session',
  metricsConsentCookieName: 'senasv_metrics_consent',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
  secureCookies,
};

if (!process.env.PARTICIPANT_SALT) {
  console.warn('PARTICIPANT_SALT no está configurado; define un secreto estable antes de producción.');
}

const { database, statements } = openDatabase(databasePath);

// Housekeeping: purge expired sessions periodically instead of on every request.
setInterval(() => {
  try {
    statements.deleteExpiredSessions.run(new Date().toISOString());
  } catch (error) {
    console.warn('No se pudieron limpiar las sesiones expiradas.', error);
  }
}, 60 * 60 * 1000).unref();

const consumeContributionRateToken = createRateLimiter(30, 60_000);
const consumeAuthRateToken = createRateLimiter(10, 60_000);
const consumeMetricsRateToken = createRateLimiter(60, 60_000);

const ctx = {
  database,
  statements,
  config,
  sendJson,
  readJson,
  consumeAuthRateToken,
  consumeMetricsRateToken,
};

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || '';
  applyCors(response, origin, allowedOrigins);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (!allowedOrigins.has(origin) && origin !== '') {
    sendJson(response, 403, { error: 'Origen no autorizado.' });
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/api/v1/health') {
    sendJson(response, 200, { status: 'ok', service: 'senasv-learning-api' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/metrics/summary') {
    const totals = database.prepare(`
      SELECT COUNT(*) AS samples, COUNT(DISTINCT participant_hash) AS participants,
             COUNT(DISTINCT label) AS labels
      FROM contributions
    `).get();
    const byLabel = database.prepare(`
      SELECT label, COUNT(*) AS samples, COUNT(DISTINCT participant_hash) AS participants
      FROM contributions GROUP BY label ORDER BY CAST(label AS INTEGER), label
    `).all();
    sendJson(response, 200, { ...totals, byLabel });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/contributions/batch') {
    if (!consumeContributionRateToken(request.socket.remoteAddress || 'unknown')) {
      sendJson(response, 429, { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' });
      return;
    }
    try {
      const body = await readJson(request, 600_000);
      const validated = validateBatch(body);
      const participantHash = createHmac('sha256', participantSalt)
        .update(validated.participantId)
        .digest('hex');
      database.exec('BEGIN');
      try {
        for (const sample of validated.samples) {
          statements.insertContribution.run(
            participantHash,
            sample.label,
            JSON.stringify(sample.features),
            sample.features.length,
            sample.capturedAt,
            validated.consentVersion,
            validated.appVersion,
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      sendJson(response, 201, { accepted: validated.samples.length });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Solicitud inválida.' });
    }
    return;
  }

  // --- Autenticación -------------------------------------------------------
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/register') {
    await handleRegister(request, response, ctx);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/login') {
    await handleLogin(request, response, ctx);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
    handleLogout(request, response, ctx);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/auth/me') {
    handleMe(request, response, ctx);
    return;
  }

  // --- Ruta de aprendizaje global y métricas de progreso -------------------
  if (request.method === 'GET' && url.pathname === '/api/v1/learning-path') {
    handleGetLearningPath(request, response, ctx);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/learning-path/progress') {
    await handlePostProgress(request, response, ctx);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/v1/learning-path/progress/summary') {
    handleProgressSummary(request, response, ctx);
    return;
  }

  sendJson(response, 404, { error: 'Ruta no encontrada.' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`SeñaSV learning API listening on http://0.0.0.0:${port}`);
  if (!secureCookies) {
    console.warn('INSECURE_COOKIES=1: cookies de sesión sin flag Secure. Solo para desarrollo local por HTTP.');
  }
});

function validateBatch(body) {
  if (!body || typeof body !== 'object') throw new Error('El cuerpo debe ser un objeto JSON.');
  if (typeof body.participantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.participantId)) {
    throw new Error('Identificador de participante inválido.');
  }
  if (body.consentVersion !== '2026-09-24') throw new Error('Versión de consentimiento inválida.');
  if (typeof body.appVersion !== 'string' || body.appVersion.length > 30) throw new Error('Versión de aplicación inválida.');
  if (!Array.isArray(body.samples) || body.samples.length < 1 || body.samples.length > 40) {
    throw new Error('El lote debe contener entre 1 y 40 muestras.');
  }
  const samples = body.samples.map((sample) => {
    if (!sample || typeof sample !== 'object') throw new Error('Muestra inválida.');
    const label = String(sample.label || '').toUpperCase();
    if (!/^(?:[A-ZÑ]|CH|LL|RR|(?:100|[1-9]?[0-9]))$/.test(label)) throw new Error(`Etiqueta inválida: ${label}`);
    if (!Array.isArray(sample.features) || sample.features.length !== 126) throw new Error('Cada muestra debe contener 126 características.');
    const features = sample.features.map((value) => Number(value));
    if (features.some((value) => !Number.isFinite(value) || Math.abs(value) > 20)) throw new Error('La muestra contiene valores fuera de rango.');
    const capturedAt = new Date(sample.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new Error('Fecha de captura inválida.');
    return { label, features, capturedAt: capturedAt.toISOString() };
  });
  return { participantId: body.participantId, consentVersion: body.consentVersion, appVersion: body.appVersion, samples };
}

function readJson(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error('El cuerpo excede el tamaño permitido.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectBody(new Error('JSON inválido.')); }
    });
    request.on('error', rejectBody);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
