# Backend de aprendizaje SeñaSV

API para SeñaSV: almacena matrices normalizadas aportadas voluntariamente durante
el entrenamiento, gestiona cuentas de usuario y expone la **ruta de aprendizaje
global** con captura de métricas de progreso autorizada por cookie.

## Ejecutar

Requiere Node.js 22.5 o posterior (usa `node:sqlite`, experimental).

```powershell
$env:PARTICIPANT_SALT='cambia-este-secreto'
$env:ALLOWED_ORIGINS='http://localhost:4173,https://pendragon503.github.io'
pnpm backend
```

Variables opcionales:

- `PORT`: puerto HTTP, predeterminado `8787`.
- `DATABASE_PATH`: archivo SQLite, predeterminado `data/senasv.sqlite`.
- `PARTICIPANT_SALT`: secreto estable usado para el hash HMAC de contribuciones anónimas.
- `ALLOWED_ORIGINS`: lista de orígenes permitidos separados por coma. Solo estos
  orígenes reciben `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials`,
  requisito para que el navegador envíe la cookie de sesión.
- `SESSION_TTL_DAYS`: duración de la sesión de usuario, predeterminado `30`.
- `INSECURE_COOKIES=1`: quita el flag `Secure` y usa `SameSite=Lax` en vez de
  `None` para las cookies de sesión. **Solo** para desarrollo local por HTTP;
  en producción (HTTPS, frontend y API en dominios distintos) no debe definirse.

El frontend utiliza `VITE_API_URL`. Ejemplo: `VITE_API_URL=https://api.example.com pnpm build`.
Las peticiones de autenticación y progreso deben hacerse con `fetch(url, { credentials: 'include' })`
para que el navegador envíe y reciba la cookie de sesión.

## Contenedor

```powershell
docker build -f server/Dockerfile -t senasv-api .
docker run --rm -p 8787:8787 -e PARTICIPANT_SALT='secreto-estable' -e ALLOWED_ORIGINS='https://pendragon503.github.io' -v senasv-data:/app/data senasv-api
```

Para producción se necesita un proveedor que ofrezca HTTPS y un volumen persistente
montado en `/app/data`. GitHub Pages no ejecuta procesos de backend.

## Endpoints

### Contribuciones de entrenamiento (sin cambios)

- `GET /api/v1/health`
- `GET /api/v1/metrics/summary`
- `POST /api/v1/contributions/batch`

Datos almacenados: hash anónimo del participante, etiqueta, 126 landmarks
normalizados, fecha de captura/recepción, versión de consentimiento y de app.
No recibe fotografías, video, audio, nombres, rostro ni ubicación.

### Autenticación

Cuentas simples por correo/contraseña. La contraseña se guarda con `scrypt`
(sal aleatoria por usuario); la sesión es un token opaco de 256 bits guardado
como cookie `HttpOnly` — solo su hash SHA-256 vive en la base de datos.

- `POST /api/v1/auth/register` `{ email, password }` → crea la cuenta, abre sesión.
- `POST /api/v1/auth/login` `{ email, password }` → abre sesión.
- `POST /api/v1/auth/logout` → cierra la sesión actual.
- `GET /api/v1/auth/me` → usuario autenticado o `401`.

Todas responden fijando/limpiando la cookie `senasv_session`
(`HttpOnly; SameSite=None; Secure` en producción).

### Ruta de aprendizaje global

La ruta es una secuencia única y fija de lecciones (alfabeto → números →
saludos → preguntas → necesidades → universidad, ver `server/catalog.mjs`,
espejo de `src/catalog.ts`). Una lección se desbloquea solo cuando la anterior
queda `completed` para ese usuario.

- `GET /api/v1/learning-path` → estructura completa con el estado de cada
  lección (`locked` / `available` / `in-progress` / `completed`). Sin sesión,
  se devuelve la ruta con solo la primera lección disponible (vista pública).
- `GET /api/v1/learning-path/progress/summary` *(requiere sesión)* → lecciones
  completadas, porcentaje, precisión promedio y lección actual.
- `POST /api/v1/learning-path/progress` *(requiere sesión **y** autorización
  de métricas, ver abajo)* `{ lessonId, accuracy, completed, capturedAt? }` →
  registra el intento, actualiza el progreso y desbloquea la siguiente lección
  cuando `completed: true`. `409` si la lección aún está bloqueada.

### Autorización de captación de métricas (cookie)

Guardar progreso es una captación de datos de uso adicional a la del
entrenamiento, así que requiere su propio consentimiento explícito, informado
al backend mediante una cookie —el mismo patrón que ya usa el frontend para el
consentimiento de entrenamiento (`senasv_training_consent`)—:

- Cookie: `senasv_metrics_consent`
- El frontend debe fijarla igual que hace hoy con `CONSENT_COOKIE` en `src/main.ts`,
  p. ej. `document.cookie = 'senasv_metrics_consent=accepted; Max-Age=31536000; Path=/; SameSite=Lax'`
  tras mostrar su propio aviso ("¿autorizas guardar tu progreso de aprendizaje?").
- Si la cookie no está presente o vale algo distinto de `accepted`,
  `POST /api/v1/learning-path/progress` responde `403` con
  `{ error, cookie: 'senasv_metrics_consent', expectedValue: 'accepted' }`
  para que la UI pueda mostrar el aviso de consentimiento en el momento.
- Leer la ruta (`GET /api/v1/learning-path`) no requiere esta cookie, solo
  guardar progreso la requiere.

## Esquema de base de datos (nuevo)

- `users(id, email, password_hash, created_at)`
- `sessions(token_hash, user_id, created_at, expires_at, user_agent)` — las
  sesiones expiradas se purgan cada hora.
- `user_progress(user_id, lesson_id, status, attempts, best_accuracy, last_attempt_at, completed_at)`

La tabla `contributions` no cambió.
