# SeñaSV Web

Primer prototipo PWA del proyecto ARC115 para reconocimiento local de señas aisladas de Lengua de Señas Salvadoreña.

## Funcionalidad incluida

- interfaz responsive basada en los wireframes del informe;
- cámara mediante `getUserMedia`;
- MediaPipe Hand Landmarker con hasta dos manos y 21 puntos por mano;
- visualización, normalización y vector de 126 características;
- integración TensorFlow.js con un modelo técnico determinista mientras se entrena el modelo real;
- reconocimiento piloto audible de los números 0–4 mediante reglas geométricas y estabilización temporal;
- reconocimiento geométrico predeterminado para A, B, D, F, G, H, I, L, U, V, W y Y;
- entrenamiento personal en el navegador para A–Z, Ñ y números 0–100, almacenando únicamente landmarks en el dispositivo;
- consentimiento informado recordado mediante cookie antes de guardar muestras: etiqueta y coordenadas normalizadas de 21 puntos, sin fotografías, video, audio ni identidad;
- referencias visuales predeterminadas del abecedario, CH, LL, RR y números documentados en el Módulo I LESSA, con atribución a MINEDUCYT;
- umbral de confianza y síntesis de voz habilitados únicamente para un modelo entrenado;
- métricas visibles de FPS, latencia, backend y manos detectadas;
- manifiesto, service worker y caché PWA.
- catálogo trazable de clases piloto y fuentes institucionales;
- política de derechos, consentimiento y separación por signante.

## Ejecutar

```powershell
pnpm install
pnpm dev
```

Abre la URL HTTPS o localhost mostrada por Vite. El acceso a cámara requiere un contexto seguro, excepto en localhost.

## Compilar

```powershell
pnpm build
pnpm preview
```

## Modelo piloto

Consulta `public/model/README.md`. No deben presentarse etiquetas como reconocimiento LESSA hasta validar las clases, capturar el dataset y entrenar un modelo real.

La investigación de fuentes y las reglas de uso de datos se documentan en `docs/FUENTES_Y_DATOS.md`.

## Sitio público

La rama `main` se compila y publica automáticamente con GitHub Actions en:

https://pendragon503.github.io/SenaSV-Web/
