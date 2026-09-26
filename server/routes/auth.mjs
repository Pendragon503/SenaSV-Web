import {
  appendSetCookie,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeCookie,
  verifyPassword,
} from '../security.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getAuthenticatedUser(request, ctx) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ctx.config.sessionCookieName];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const session = ctx.statements.findSession.get(tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    ctx.statements.deleteSession.run(tokenHash);
    return null;
  }
  return { id: session.user_id, email: session.email, createdAt: session.created_at };
}

function issueSession(response, user, request, ctx) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ctx.config.sessionTtlDays * 24 * 60 * 60 * 1000);
  ctx.statements.insertSession.run(
    hashSessionToken(token),
    user.id,
    expiresAt.toISOString(),
    String(request.headers['user-agent'] || '').slice(0, 200),
  );
  appendSetCookie(
    response,
    serializeCookie(ctx.config.sessionCookieName, token, {
      httpOnly: true,
      secure: ctx.config.secureCookies,
      sameSite: ctx.config.secureCookies ? 'None' : 'Lax',
      maxAgeSeconds: ctx.config.sessionTtlDays * 24 * 60 * 60,
    }),
  );
}

function validateCredentials(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('Correo electrónico inválido.');
  if (password.length < 8 || password.length > 128) {
    throw new Error('La contraseña debe tener entre 8 y 128 caracteres.');
  }
  return { email, password };
}

export async function handleRegister(request, response, ctx) {
  if (!ctx.consumeAuthRateToken(clientKey(request))) {
    ctx.sendJson(response, 429, { error: 'Demasiados intentos. Intenta nuevamente en un minuto.' });
    return;
  }
  try {
    const body = await ctx.readJson(request, 10_000);
    const { email, password } = validateCredentials(body);
    if (ctx.statements.findUserByEmail.get(email)) {
      ctx.sendJson(response, 409, { error: 'Ya existe una cuenta con ese correo.' });
      return;
    }
    const passwordHash = hashPassword(password);
    const { lastInsertRowid } = ctx.statements.insertUser.run(email, passwordHash);
    const user = ctx.statements.findUserById.get(Number(lastInsertRowid));
    issueSession(response, user, request, ctx);
    ctx.sendJson(response, 201, { id: user.id, email: user.email, createdAt: user.created_at });
  } catch (error) {
    ctx.sendJson(response, 400, { error: error instanceof Error ? error.message : 'Solicitud inválida.' });
  }
}

export async function handleLogin(request, response, ctx) {
  if (!ctx.consumeAuthRateToken(clientKey(request))) {
    ctx.sendJson(response, 429, { error: 'Demasiados intentos. Intenta nuevamente en un minuto.' });
    return;
  }
  try {
    const body = await ctx.readJson(request, 10_000);
    const { email, password } = validateCredentials(body);
    const user = ctx.statements.findUserByEmail.get(email);
    // Run verifyPassword even on a missing user (against a fixed dummy hash) so a
    // nonexistent email does not resolve measurably faster than a wrong password.
    const passwordHash = user?.password_hash ?? DUMMY_HASH;
    const ok = verifyPassword(password, passwordHash);
    if (!user || !ok) {
      ctx.sendJson(response, 401, { error: 'Correo o contraseña incorrectos.' });
      return;
    }
    issueSession(response, user, request, ctx);
    ctx.sendJson(response, 200, { id: user.id, email: user.email, createdAt: user.created_at });
  } catch (error) {
    ctx.sendJson(response, 400, { error: error instanceof Error ? error.message : 'Solicitud inválida.' });
  }
}

export function handleLogout(request, response, ctx) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ctx.config.sessionCookieName];
  if (token) ctx.statements.deleteSession.run(hashSessionToken(token));
  appendSetCookie(
    response,
    serializeCookie(ctx.config.sessionCookieName, '', {
      httpOnly: true,
      secure: ctx.config.secureCookies,
      sameSite: ctx.config.secureCookies ? 'None' : 'Lax',
      maxAgeSeconds: 0,
    }),
  );
  ctx.sendJson(response, 200, { ok: true });
}

export function handleMe(request, response, ctx) {
  const user = getAuthenticatedUser(request, ctx);
  if (!user) {
    ctx.sendJson(response, 401, { error: 'No autenticado.' });
    return;
  }
  ctx.sendJson(response, 200, user);
}

function clientKey(request) {
  return request.socket.remoteAddress || 'unknown';
}

// Fixed-format placeholder so a login against an unknown email still pays the
// scrypt cost, keeping timing similar to a real "wrong password" response.
const DUMMY_HASH = hashPassword('senasv-dummy-password-for-timing');
