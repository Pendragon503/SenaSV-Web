# Modelo de reconocimiento

Esta carpeta recibirá el modelo entrenado del conjunto piloto:

- `model.json`
- uno o más archivos `.bin` con los pesos
- `labels.json`, un arreglo JSON en el mismo orden que las salidas del modelo

El modelo debe aceptar 126 valores: 21 puntos × 3 coordenadas × 2 manos. Si solo se detecta una mano, la segunda mitad se completa con ceros.

Mientras estos archivos no existan, la aplicación usa una capa densa determinista únicamente para comprobar la integración de TensorFlow.js. Sus etiquetas `MUESTRA A`, `MUESTRA B` y `MUESTRA C` no representan señas de LESSA.
