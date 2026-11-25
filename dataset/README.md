# Datasets de SeñaSV

## Fotografías de referencia (`dataset/imagenes/`)

Fotografías fijas de configuraciones manuales con las que la aplicación entrena su modelo base de abecedario y números. Esta carpeta **sí** se versiona en Git.

```text
dataset/imagenes/
  letras/   A.jpg, B.jpg, … , N-.jpg (Ñ), … , Y.jpg
  numeros/  0.jpg … 9.jpg
```

- El nombre del archivo es la etiqueta. `N-.jpg` (también `NN.jpg` o `ENIE.jpg`) corresponde a la **Ñ**.
- Para más fotografías de la misma clase usa un sufijo con `@`: `A@2.jpg`, `A@persona3.jpg`. Más personas, ángulos e iluminaciones por clase mejoran mucho la precisión: con una sola imagen por clase el modelo depende del aumento de datos.
- J y Z se realizan con movimiento; no se incluyen porque una fotografía no representa su trayectoria.
- Vite descubre los archivos automáticamente (`src/reference-dataset.ts`). Al añadir, quitar o renombrar imágenes cambia la versión del dataset y la aplicación vuelve a entrenar.
- Documenta el origen y la autorización de cada fotografía antes de publicarla, igual que con cualquier otra muestra (ver `docs/FUENTES_Y_DATOS.md`).

Flujo de entrenamiento (en el navegador, `src/image-trainer.ts`): MediaPipe extrae 21 landmarks por fotografía → normalización independiente de la relación de aspecto → 240 variaciones sintéticas por clase (giros 3D, apertura de dedos, proporciones, ruido y mano espejo) → red densa 63-128-64-N → guardado en IndexedDB y exportación opcional a `public/model/`.

## Dataset privado para 50 palabras LESSA

Los videos originales y landmarks de participantes no se almacenan en Git. La carpeta local `dataset/private/` está excluida mediante `.gitignore`.

## Estructura

```text
dataset/private/
  raw/
    P001/
      hola/
        toma-001.mp4
        toma-002.mp4
      gracias/
        toma-001.mp4
  landmarks/
    P001/
      hola/
        toma-001.json
  manifests/
    captures.csv
```

Cada participante utiliza un código anónimo. No deben emplearse nombres, correos o documentos de identidad en rutas o metadatos.

## Meta inicial

- 50 palabras objetivo.
- 5 participantes independientes como mínimo.
- 30 secuencias por palabra y participante.
- 1,500 secuencias por participante.
- 7,500 secuencias totales como meta inicial.
- Separación de entrenamiento, validación y prueba por participante.

## Requisitos de captura

- rostro fuera de cuadro cuando sea posible;
- torso y ambas manos visibles cuando la seña lo requiera;
- 720p o superior, 30 FPS;
- fondo, iluminación, distancia y lateralidad documentados;
- inicio y final de cada seña claramente visibles;
- etiqueta validada por una persona competente en LESSA;
- consentimiento específico para entrenamiento de modelos.

## Uso del canal LESSA Virtual

Los originales autorizados pueden incorporarse como material inicial. Se recomienda conservar una copia maestra fuera del repositorio y trabajar con copias codificadas por participante. Los enlaces de YouTube sirven como referencia pedagógica; los archivos originales ofrecen mejor calidad para extraer movimiento y landmarks.
