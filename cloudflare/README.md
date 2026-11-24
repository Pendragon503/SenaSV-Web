# Backend colectivo Cloudflare D1

Backend público de SeñaSV para almacenar contribuciones anónimas de entrenamiento. Utiliza Cloudflare Workers y D1 en el nivel gratuito.

## Datos almacenados

- identificador único de la muestra;
- hash HMAC del participante anónimo;
- etiqueta de letra o número;
- vector normalizado de 126 características;
- fechas de captura y recepción;
- versiones de aplicación y consentimiento.

No recibe imágenes, video, audio, nombre, rostro ni ubicación.

## Preparación local

```powershell
Copy-Item cloudflare/.dev.vars.example cloudflare/.dev.vars
pnpm cf:migrate:local
pnpm cf:dev
```

## Creación y despliegue

1. Iniciar sesión: `pnpm exec wrangler login`.
2. Crear la base: `pnpm exec wrangler d1 create senasv-learning`.
3. Copiar el `database_id` obtenido en `cloudflare/wrangler.jsonc`.
4. Crear el secreto HMAC: `pnpm exec wrangler secret put PARTICIPANT_SALT --config cloudflare/wrangler.jsonc`.
5. Aplicar migraciones: `pnpm cf:migrate:remote`.
6. Publicar: `pnpm cf:deploy`.
7. Configurar la URL generada como secreto `VITE_API_URL` del workflow de GitHub Pages.

## Endpoints

- `GET /api/v1/health`
- `POST /api/v1/contributions/batch`
- `DELETE /api/v1/contributions/participant`
- `GET /api/v1/metrics/summary`

Las muestras usan un UUID para evitar duplicados cuando el navegador reintenta un lote.
