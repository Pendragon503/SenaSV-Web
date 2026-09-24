# Fuentes LESSA y política de datos

## Fuentes localizadas

### DEES LESSA

El Diccionario Especializado en Educación Superior de Lengua de Señas Salvadoreña es la referencia principal del catálogo. La Editorial Universitaria de la Universidad de El Salvador indica que contiene casi 600 términos y busca estandarizar LESSA dentro del campus universitario.

El libro y sus materiales declaran todos los derechos reservados. Los enlaces, imágenes y videos se utilizarán para consulta y validación humana. No se descargarán, recortarán ni incorporarán al dataset sin autorización escrita de los titulares.

Fuente: https://editorial.ues.edu.sv/dees-lessa/

### Hablemos LESSA

Programa educativo producido por instituciones públicas salvadoreñas y presentado por integrantes vinculados con la comunidad sorda. Se utilizará como referencia complementaria. No se localizó una licencia abierta que autorice reutilizar las emisiones como dataset de aprendizaje automático.

Fuente: https://www.mined.gob.sv/2020/12/21/clases-de-lengua-de-senas-por-television-una-nueva-forma-de-comunicarnos/

### Recursos Módulo 1 LESSA

El portal educativo LESSA publica materiales descargables sobre configuraciones manuales, gramática, Cultura Sorda, emociones, enfermedades y familia. El documento "Configuraciones manuales LESSA" contiene 11 ilustraciones útiles para revisar apertura, extensión de dedos, curvatura, pinza y orientación de la mano.

Estas ilustraciones funcionan como referencia humana y para diseñar características geométricas. No son un dataset de cámara: no aportan diversidad de signantes, iluminación, profundidad ni movimiento. Por tanto, no deben presentarse como entrenamiento automático ni sustituir la captura consentida y la validación experta.

Fuente: https://sites.google.com/clases.edu.sv/lessa/recursos-m%C3%B3dulo-1

## Clases piloto

El reconocimiento geométrico base se limita a clases principalmente estáticas:

- alfabeto: A, B, D, F, G, H, I, L, U, V, W y Y;
- números: 0, 1, 2, 3 y 4.

Las reglas son provisionales y se estabilizan durante varios fotogramas. Antes de grabar se debe revisar la realización exacta, orientación, lateralidad y posibles variantes con el Módulo I y una persona competente en LESSA.

## Requisitos para el dataset propio

1. Consentimiento informado firmado y revocable.
2. Código anónimo de signante, nunca el nombre en los archivos.
3. Mínimo recomendado inicial: 5 signantes y 30 muestras por clase y signante.
4. Variación controlada de iluminación, fondo, distancia y mano dominante.
5. Separación de entrenamiento, validación y prueba por signante.
6. Revisión manual de etiqueta y calidad antes de extraer landmarks.
7. Videos privados y separados del repositorio de código.
8. Publicación de landmarks o videos únicamente cuando el consentimiento lo autorice expresamente.

## Estado del entrenamiento

No existe todavía un dataset propio autorizado, por lo que no corresponde afirmar que el sistema reconoce todo LESSA. Las reglas actuales comprueban el flujo técnico para configuraciones estáticas. El entrenamiento real comienza después de validar y capturar muestras propias de cada clase.

## Contribución colectiva

El participante debe aceptar una autorización explícita antes de capturar. Cada aporte contiene la etiqueta, 126 valores normalizados de landmarks, fecha técnica, versión de la aplicación y versión del consentimiento. El cliente genera un identificador aleatorio y el servidor lo transforma mediante HMAC antes de almacenarlo.

No se envían fotografías, video, audio, rostro, nombre ni ubicación. Si el backend no está configurado o no responde, las muestras permanecen pendientes en el dispositivo y el usuario recibe ese estado de forma explícita.
