# Dataset privado para 50 palabras LESSA

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
