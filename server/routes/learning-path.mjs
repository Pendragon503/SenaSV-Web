import { firstLessonId, isValidLessonId, learningPath, modules, nextLessonId } from '../catalog.mjs';
import { parseCookies } from '../security.mjs';
import { getAuthenticatedUser } from './auth.mjs';

function buildStatusMap(progressRows) {
  const byLesson = new Map(progressRows.map((row) => [row.lesson_id, row]));
  const statusMap = new Map();
  let previousCompleted = true; // the first lesson is always available
  for (const lesson of learningPath) {
    const row = byLesson.get(lesson.id);
    if (row?.status === 'completed') {
      statusMap.set(lesson.id, 'completed');
      previousCompleted = true;
    } else if (previousCompleted) {
      statusMap.set(lesson.id, row?.status === 'in-progress' ? 'in-progress' : 'available');
      previousCompleted = false;
    } else {
      statusMap.set(lesson.id, 'locked');
    }
  }
  return { statusMap, byLesson };
}

export function handleGetLearningPath(request, response, ctx) {
  const user = getAuthenticatedUser(request, ctx);
  const progressRows = user ? ctx.statements.getProgressForUser.all(user.id) : [];
  const { statusMap, byLesson } = buildStatusMap(progressRows);

  const payload = {
    authenticated: Boolean(user),
    modules: modules.map((module) => ({
      id: module.id,
      title: module.title,
      lessons: module.lessons.map((lesson) => {
        const row = byLesson.get(lesson.id);
        return {
          id: lesson.id,
          label: lesson.label,
          order: lesson.order,
          status: statusMap.get(lesson.id),
          attempts: row?.attempts ?? 0,
          bestAccuracy: row?.best_accuracy ?? null,
          completedAt: row?.completed_at ?? null,
        };
      }),
    })),
  };
  ctx.sendJson(response, 200, payload);
}

function metricsConsentGranted(request, ctx) {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[ctx.config.metricsConsentCookieName] === 'accepted';
}

function validateProgressBody(body) {
  const lessonId = String(body?.lessonId || '');
  if (!isValidLessonId(lessonId)) throw new Error('Lección desconocida.');
  const accuracy = Number(body?.accuracy);
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    throw new Error('accuracy debe ser un número entre 0 y 1.');
  }
  const completed = Boolean(body?.completed);
  const capturedAt = new Date(body?.capturedAt ?? Date.now());
  if (Number.isNaN(capturedAt.getTime())) throw new Error('Fecha de captura inválida.');
  return { lessonId, accuracy, completed, capturedAt: capturedAt.toISOString() };
}

export async function handlePostProgress(request, response, ctx) {
  const user = getAuthenticatedUser(request, ctx);
  if (!user) {
    ctx.sendJson(response, 401, { error: 'Inicia sesión para guardar tu progreso.' });
    return;
  }
  if (!metricsConsentGranted(request, ctx)) {
    ctx.sendJson(response, 403, {
      error: 'Falta autorización para la captación de métricas.',
      cookie: ctx.config.metricsConsentCookieName,
      expectedValue: 'accepted',
    });
    return;
  }
  if (!ctx.consumeMetricsRateToken(String(user.id))) {
    ctx.sendJson(response, 429, { error: 'Demasiadas solicitudes. Intenta nuevamente en un minuto.' });
    return;
  }

  try {
    const body = await ctx.readJson(request, 10_000);
    const { lessonId, accuracy, completed, capturedAt } = validateProgressBody(body);

    const progressRows = ctx.statements.getProgressForUser.all(user.id);
    const { statusMap } = buildStatusMap(progressRows);
    const currentStatus = statusMap.get(lessonId);
    if (currentStatus === 'locked') {
      ctx.sendJson(response, 409, { error: 'Esta lección todavía está bloqueada.' });
      return;
    }

    ctx.statements.upsertProgress.run(
      user.id,
      lessonId,
      completed ? 'completed' : 'in-progress',
      accuracy,
      capturedAt,
      completed ? capturedAt : null,
    );

    const row = ctx.statements.getProgressRow.get(user.id, lessonId);
    ctx.sendJson(response, 200, {
      lessonId,
      status: row.status,
      attempts: row.attempts,
      bestAccuracy: row.best_accuracy,
      completedAt: row.completed_at,
      nextLessonId: completed ? nextLessonId(lessonId) : null,
    });
  } catch (error) {
    ctx.sendJson(response, 400, { error: error instanceof Error ? error.message : 'Solicitud inválida.' });
  }
}

export function handleProgressSummary(request, response, ctx) {
  const user = getAuthenticatedUser(request, ctx);
  if (!user) {
    ctx.sendJson(response, 401, { error: 'Inicia sesión para ver tu progreso.' });
    return;
  }
  const progressRows = ctx.statements.getProgressForUser.all(user.id);
  const completed = progressRows.filter((row) => row.status === 'completed');
  const accuracies = completed.map((row) => row.best_accuracy).filter((value) => typeof value === 'number');
  const averageAccuracy = accuracies.length
    ? accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length
    : null;

  const { statusMap } = buildStatusMap(progressRows);
  const currentLessonId = learningPath.find((lesson) => statusMap.get(lesson.id) !== 'completed' && statusMap.get(lesson.id) !== 'locked')?.id
    ?? null;

  ctx.sendJson(response, 200, {
    totalLessons: learningPath.length,
    completedLessons: completed.length,
    percentage: Math.round((completed.length / learningPath.length) * 100),
    averageAccuracy,
    currentLessonId: currentLessonId ?? firstLessonId(),
  });
}
