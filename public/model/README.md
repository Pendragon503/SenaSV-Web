# Modelo de reconocimiento

Esta carpeta recibe el modelo publicado que usan todos los dispositivos:

- `model.json` (topología + metadatos SeñaSV en `userDefinedMetadata.senasv`)
- `model.weights.bin` (pesos)

Si la carpeta no contiene un modelo, la aplicación **entrena uno automáticamente en el navegador** a partir de las fotografías de `dataset/imagenes/` y lo guarda en IndexedDB.

## Publicar el modelo entrenado con imágenes

1. Ejecuta `pnpm dev` y abre **Reconocimiento**. El modelo se entrena solo la primera vez (extrae landmarks de cada fotografía, aplica aumento de datos y entrena la red).
2. Revisa en la tarjeta «Modelo de imágenes LESSA» la precisión de validación y si alguna imagen no pudo leerse.
3. Pulsa **Exportar modelo**: el navegador descarga `model.json` y `model.weights.bin`.
4. Copia ambos archivos en esta carpeta y publica el repositorio.

El modelo publicado incluye la versión del dataset (`datasetVersion`). Si después se añaden, quitan o renombran fotografías, la aplicación detecta que el modelo publicado quedó desactualizado y reentrena localmente hasta que se exporte uno nuevo.

## Contrato del modelo

`userDefinedMetadata.senasv` describe cómo usar el modelo:

| Campo | Significado |
| --- | --- |
| `labels` | Etiquetas en el mismo orden que las salidas. |
| `groups` | Grupo de cada etiqueta (`alphabet`, `numbers`). La softmax se calcula solo dentro del grupo activo, porque varias señas comparten configuración (p. ej. V y 2, W y 6, O y 0). |
| `features` | `metric-single-hand-v1`: 63 valores de una mano (21 puntos × 3), con coordenadas llevadas a proporción de píxeles antes de normalizar, de modo que una fotografía cuadrada y una cámara 16:9 producen la misma forma. Origen en la muñeca; escala = tamaño medio de la palma. Ver `src/landmark-features.ts`. |
| `output` | `logits`: la última capa es lineal y la aplicación aplica la softmax enmascarada. |
| `validationAccuracy` | Exactitud sobre variaciones aumentadas no vistas. Es optimista: no sustituye la evaluación con personas signantes reales. |

Contrato anterior, aún compatible: un `model.json` sin metadatos más `labels.json`, con 126 valores de entrada (`normalizeHands`, dos manos) y salida softmax.

## Vocabulario objetivo de 50 palabras

La interfaz permite capturar y reconocer de forma personal 50 palabras funcionales distribuidas en saludos, preguntas, necesidades, familia, educación y emergencias. Cada clase debe reunir muestras de varias personas y ser validada lingüísticamente antes de incorporarse al modelo general.

Meta mínima recomendada para el primer entrenamiento colectivo:

- 5 personas signantes independientes;
- 30 secuencias por palabra y participante;
- 1,500 muestras por participante y 7,500 muestras totales;
- separación de entrenamiento, validación y prueba por participante;
- evaluación con macro-F1 y matriz de confusión para las 50 clases.

Las palabras dinámicas requieren ventanas temporales; una sola postura de landmarks no representa por completo su movimiento. El clasificador personal actual sirve para validar el flujo de captura, pero el modelo colectivo deberá utilizar secuencias de landmarks.
