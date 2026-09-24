# Backend de aprendizaje SeñaSV

API anónima para almacenar matrices normalizadas aportadas voluntariamente durante el entrenamiento.

## Ejecutar

Requiere Node.js 22.5 o posterior.

```powershell
$env:PARTICIPANT_SALT='cambia-este-secreto'
$env:ALLOWED_ORIGINS='http://localhost:4173,https://pendragon503.github.io'
pnpm backend
```

Variables opcionales:

- `PORT`: puerto HTTP, predeterminado `8787`.
- `DATABASE_PATH`: archivo SQLite, predeterminado `data/senasv.sqlite`.
- `PARTICIPANT_SALT`: secreto estable usado para convertir el identificador anónimo en un hash HMAC.
- `ALLOWED_ORIGINS`: lista de orígenes permitidos separados por coma.

El frontend utiliza `VITE_API_URL`. Ejemplo: `VITE_API_URL=https://api.example.com pnpm build`.

## Contenedor

```powershell
docker build -f server/Dockerfile -t senasv-api .
docker run --rm -p 8787:8787 -e PARTICIPANT_SALT='secreto-estable' -e ALLOWED_ORIGINS='https://pendragon503.github.io' -v senasv-data:/app/data senasv-api
```

Para producción se necesita un proveedor que ofrezca HTTPS y un volumen persistente montado en `/app/data`. GitHub Pages no ejecuta procesos de backend.

## Datos almacenados

- hash anónimo del participante;
- etiqueta seleccionada;
- 126 valores normalizados de landmarks;
- fecha de captura y recepción;
- versión del consentimiento y de la aplicación.

No recibe fotografías, video, audio, nombres, rostro ni ubicación.
