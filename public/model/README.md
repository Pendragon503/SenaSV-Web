# Modelo de reconocimiento

Esta carpeta recibirá el modelo entrenado del conjunto piloto:

- `model.json`
- uno o más archivos `.bin` con los pesos
- `labels.json`, un arreglo JSON en el mismo orden que las salidas del modelo

El modelo debe aceptar 126 valores: 21 puntos × 3 coordenadas × 2 manos. Si solo se detecta una mano, la segunda mitad se completa con ceros.

Mientras estos archivos no existan, la aplicación usa una capa densa determinista únicamente para comprobar la integración de TensorFlow.js. Sus etiquetas `MUESTRA A`, `MUESTRA B` y `MUESTRA C` no representan señas de LESSA.

## Vocabulario objetivo de 50 palabras

La interfaz permite capturar y reconocer de forma personal 50 palabras funcionales distribuidas en saludos, preguntas, necesidades, familia, educación y emergencias. Cada clase debe reunir muestras de varias personas y ser validada lingüísticamente antes de incorporarse al modelo general.

Meta mínima recomendada para el primer entrenamiento colectivo:

- 5 personas signantes independientes;
- 30 secuencias por palabra y participante;
- 1,500 muestras por participante y 7,500 muestras totales;
- separación de entrenamiento, validación y prueba por participante;
- evaluación con macro-F1 y matriz de confusión para las 50 clases.

Las palabras dinámicas requieren ventanas temporales; una sola postura de 126 valores no representa por completo su movimiento. El clasificador personal actual sirve para validar el flujo de captura, pero el modelo colectivo deberá utilizar secuencias de landmarks.
