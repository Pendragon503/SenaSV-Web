import './styles.css';
import { HandTracker } from './hand-tracker';
import { SignClassifier } from './classifier';
import { drawHands } from './draw';
import { normalizeHands } from './normalize';
import { pilotClasses, signCatalog, sources } from './catalog';
import { PilotRecognizer } from './pilot-recognizer';
import { PersonalClassifier } from './personal-classifier';
import { AlphabetRecognizer, DEFAULT_ALPHABET_LABELS } from './alphabet-recognizer';
import { clearContributionQueue, flushContributions, queueContribution } from './contribution-client';
import { getReference } from './reference-catalog';
import type { Prediction, RuntimeMetrics, ViewName } from './types';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
      console.warn('No se pudo registrar el service worker.', error);
    });
  });
}

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('No se encontró el contenedor principal.');
const app: HTMLDivElement = appRoot;

const tracker = new HandTracker();
const classifier = new SignClassifier();
const pilotRecognizer = new PilotRecognizer();
const personalClassifier = new PersonalClassifier();
const alphabetRecognizer = new AlphabetRecognizer();
let stream: MediaStream | null = null;
let animationFrame = 0;
let previousTimestamp = 0;
let frameSamples: number[] = [];
let currentView: ViewName = 'inicio';
let lastSpokenLabel = '';
let lastSpokenAt = 0;
let captureLabel = '';
let captureRemaining = 0;
let lastCaptureAt = 0;
let recognitionMode: 'alphabet' | 'numbers' = 'alphabet';

type TrainingConsent = 'accepted' | 'declined' | 'unset';
const CONSENT_COOKIE = 'senasv_training_consent';

const alphabetLabels = ['A', 'B', 'C', 'CH', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL', 'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'RR', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const numberLabels = Array.from({ length: 101 }, (_, index) => String(index));
const trainingLabels = [...alphabetLabels, ...numberLabels];

function shell(content: string): string {
  const consent = readTrainingConsent();
  return `<div class="app-shell">
    <header class="topbar">
      <button class="brand" data-view="inicio" aria-label="Ir al inicio"><img src="${import.meta.env.BASE_URL}icon.svg" alt=""><span>SeñaSV Web</span></button>
      <nav class="nav" aria-label="Navegación principal">
        ${navButton('inicio', 'Inicio')}${navButton('entrenamiento', 'Entrenar')}${navButton('reconocimiento', 'Reconocer')}${navButton('diccionario', 'Diccionario')}${navButton('informacion', 'Proyecto')}
      </nav>
    </header>
    <main class="main">${content}</main>
    <footer class="footer">Prototipo académico ARC115 · Procesamiento local · LESSA pendiente de validación experta</footer>
    ${consent === 'unset' ? consentBanner() : ''}
  </div>`;
}

function consentBanner(): string {
  return `<section class="consent-banner" role="dialog" aria-labelledby="consent-title" aria-describedby="consent-description">
    <div><p class="eyebrow">Privacidad y colaboración</p><h2 id="consent-title">Autorización para datos de entrenamiento</h2>
    <p id="consent-description">Al aceptar y usar la función Entrenar, autorizas guardar localmente y aportar a la matriz colectiva la etiqueta seleccionada, 126 coordenadas normalizadas de landmarks, fecha técnica y versión de la aplicación. No capturamos fotografías, video, audio, rostro, nombre ni ubicación. El envío solo ocurre cuando el backend seguro está configurado.</p>
    <small>La cookie solo recuerda tu elección durante 12 meses. Puedes rechazarla y seguir usando el reconocimiento base.</small></div>
    <div class="consent-actions"><button class="button primary" data-consent-choice="accepted">Aceptar y colaborar</button><button class="button" data-consent-choice="declined">Rechazar</button></div>
  </section>`;
}

function navButton(view: ViewName, label: string): string {
  return `<button data-view="${view}" ${currentView === view ? 'aria-current="page"' : ''}>${label}</button>`;
}

function render(view: ViewName): void {
  if (isCameraView(currentView) && view !== currentView) stopCamera();
  currentView = view;
  const views: Record<ViewName, () => string> = {
    inicio: homeView,
    entrenamiento: trainingView,
    reconocimiento: recognitionView,
    diccionario: dictionaryView,
    informacion: infoView,
  };
  app.innerHTML = shell(views[view]());
  bindNavigation();
  bindConsentControls();
  if (view === 'reconocimiento') bindRecognition();
  if (view === 'entrenamiento') bindTraining();
}

function homeView(): string {
  return `<section class="hero">
    <div><p class="eyebrow">Investigación aplicada ARC115</p><h1>Reconocimiento local de LESSA</h1>
    <p class="lead">Prototipo académico trazable: detecta manos, normaliza 21 puntos de referencia e integra TensorFlow.js. Las clases se documentan con fuentes salvadoreñas y el video permanece en el dispositivo.</p>
    <div class="actions"><button class="button primary" data-view="entrenamiento">Entrenar señas</button><button class="button" data-view="reconocimiento">Aplicar lo aprendido</button></div></div>
    <div class="hero-card" aria-hidden="true"><span class="pill one">${pilotClasses.length} clases piloto</span><div class="hero-symbol">🤟</div><span class="pill two">PWA · inferencia local</span></div>
  </section>`;
}

function recognitionView(): string {
  const readyAlphabet = personalClassifier.readyLabels(new Set(alphabetLabels));
  const availableAlphabet = [...new Set([...DEFAULT_ALPHABET_LABELS, ...readyAlphabet])];
  return `<section class="section-heading"><p class="eyebrow">Prototipo 0.1</p><h1>Reconocimiento en vivo</h1><p>La cámara y MediaPipe operan localmente. El resultado solo se considera una seña real cuando se cargue un modelo entrenado y validado con datos de LESSA.</p></section>
  <div class="recognition-layout">
    <section class="panel" aria-label="Cámara">
      <div class="camera-stage"><video id="camera" playsinline muted></video><canvas id="overlay"></canvas><div class="camera-placeholder" id="camera-placeholder"><strong>Cámara detenida</strong>Pulsa iniciar y concede permiso para comenzar.</div></div>
      <div class="camera-controls"><button class="button primary" id="camera-toggle">Iniciar cámara</button><span class="status" id="runtime-status" data-state="idle"><span class="status-dot"></span><span id="status-text">Listo para iniciar</span></span></div>
    </section>
    <aside class="panel results" aria-live="polite">
      <div class="recognition-mode"><label for="recognition-mode">Qué deseas reconocer</label><select id="recognition-mode"><option value="alphabet">Abecedario</option><option value="numbers">Números</option></select><p id="ready-labels">Abecedario listo: ${availableAlphabet.join(', ')}</p></div>
      <div class="prediction"><small>Resultado</small><strong id="prediction-label">Sin predicción</strong><div class="confidence-track"><div class="confidence-fill" id="confidence-fill"></div></div><p id="confidence-text">Confianza: —</p></div>
      <p class="notice" id="model-notice">Cargando detector y clasificador…</p>
      <button class="button" id="speak-button">Escuchar resultado</button>
      <div class="metrics"><div class="metric"><span>FPS</span><strong id="metric-fps">—</strong></div><div class="metric"><span>Detección</span><strong id="metric-detection">—</strong></div><div class="metric"><span>Backend TF</span><strong id="metric-backend">—</strong></div><div class="metric"><span>Manos</span><strong id="metric-hands">0</strong></div></div>
    </aside>
  </div>`;
}

function trainingView(): string {
  const initialReference = getReference(trainingLabels[0]);
  const consent = readTrainingConsent();
  const consentMessage = consent === 'accepted'
    ? 'Autorización activa: las muestras se guardarán localmente y se enviarán a la matriz colectiva cuando el servidor esté disponible.'
    : consent === 'declined'
      ? 'No autorizaste guardar muestras. Puedes cambiar esta decisión para colaborar con el entrenamiento.'
      : 'Antes de capturar debes aceptar la autorización de datos de entrenamiento.';
  return `<section class="section-heading"><p class="eyebrow">Dataset personal</p><h1>Entrenar una seña</h1><p>Esta pantalla únicamente captura landmarks etiquetados. No intenta reconocer ni reproduce voz mientras estás grabando.</p></section>
  <div class="training-layout">
    <section class="panel" aria-label="Cámara de entrenamiento">
      <div class="camera-stage"><video id="camera" playsinline muted></video><canvas id="overlay"></canvas><div class="camera-placeholder" id="camera-placeholder"><strong>Cámara detenida</strong>Inicia la cámara para capturar muestras.</div></div>
      <div class="camera-controls"><button class="button primary" id="camera-toggle">Iniciar cámara</button><span class="status" id="runtime-status" data-state="idle"><span class="status-dot"></span><span id="status-text">Listo para iniciar</span></span></div>
    </section>
    <aside class="panel training-panel">
      <div class="training-consent" data-state="${consent}"><strong>Datos que se guardarán</strong><p>${consentMessage}</p><ul><li>Etiqueta de la letra o número.</li><li>126 valores X, Y y Z normalizados de 21 puntos por espacio de mano.</li><li>Fecha técnica y versiones del consentimiento y de la aplicación.</li><li>Identificador aleatorio convertido en hash por el servidor.</li><li>Hasta 40 muestras locales por etiqueta.</li></ul><p><strong>No se guardan:</strong> imágenes, video, audio, rostro, nombre ni ubicación.</p>${consent !== 'accepted' ? '<button class="button full" data-consent-choice="accepted">Aceptar y habilitar entrenamiento</button>' : '<button class="consent-link" data-revoke-consent>Retirar autorización y borrar datos pendientes de este dispositivo</button>'}</div>
      <p class="step-label">Paso 1</p><h2>Selecciona la clase</h2>
      <label for="training-label">Letra o número</label><select id="training-label">${trainingLabels.map((label) => `<option value="${label}">${label}</option>`).join('')}</select>
      <figure class="training-reference" id="training-reference"><img id="training-reference-image" src="${initialReference.image}" alt="Página de referencia para ${initialReference.label}"><figcaption><strong id="training-reference-title">Referencia para ${initialReference.label}</strong><span id="training-reference-note">${initialReference.note}</span><small id="training-reference-source">${initialReference.source} · página ${initialReference.page}</small></figcaption></figure>
      <p class="step-label">Paso 2</p><h2>Coloca la mano</h2><p>Mantén una sola mano completa, vertical y centrada. Cambia ligeramente distancia y ángulo entre rondas.</p>
      <p class="step-label">Paso 3</p><h2>Captura muestras</h2>
      <button class="button primary full" id="capture-button" disabled>Capturar 12 muestras</button>
      <button class="button full" id="clear-class-button">Borrar muestras de esta clase</button>
      <div class="training-progress"><div id="training-progress-fill"></div></div>
      <p id="training-status">${personalClassifier.trainedLabels()} clases listas · ${personalClassifier.totalSamples()} muestras locales</p>
      <div class="training-stats"><div><strong id="trained-class-count">${personalClassifier.trainedLabels()}</strong><span>clases listas</span></div><div><strong id="sample-count">${personalClassifier.totalSamples()}</strong><span>muestras</span></div><div><strong id="training-hands">0</strong><span>manos visibles</span></div></div>
      <button class="button full" data-view="reconocimiento">Aplicar lo aprendido</button>
    </aside>
  </div>`;
}

function dictionaryView(): string {
  return `<section class="section-heading"><p class="eyebrow">Catálogo trazable</p><h1>Clases de reconocimiento</h1><p>La presencia de una palabra en una fuente no autoriza a copiar sus videos. El modelo se entrenará con grabaciones propias consentidas, después de validar la realización de cada seña.</p></section>
  <div class="catalog-summary"><div><strong>${pilotClasses.length}</strong><span>clases del piloto</span></div><div><strong>${signCatalog.length}</strong><span>clases documentadas</span></div><div><strong>${sources.length}</strong><span>fuentes institucionales</span></div></div>
  <div class="class-table" role="table" aria-label="Catálogo de clases">
    <div class="class-row class-header" role="row"><span>Clase</span><span>Categoría</span><span>Estado</span><span>Validación</span></div>
    ${signCatalog.map((item) => `<div class="class-row" role="row"><strong>${item.label}</strong><span>${item.category}</span><span class="tag ${item.status}">${item.status === 'piloto' ? 'Piloto 0.1' : 'Planificada'}</span><span>${item.validation === 'presencia-verificada' ? 'Término localizado' : 'Revisión pendiente'}</span></div>`).join('')}
  </div>
  <section class="sources"><h2>Fuentes y condiciones de uso</h2>${sources.map((source) => `<article><div><h3>${source.title}</h3><p>${source.institution}</p></div><p>${source.usage}</p><p class="rights">${source.rights}</p><a href="${source.url}" target="_blank" rel="noreferrer">Consultar fuente oficial</a></article>`).join('')}</section>`;
}

function infoView(): string {
  return `<section class="section-heading"><p class="eyebrow">SeñaSV Web</p><h1>Acerca del proyecto</h1><p>Una sola base de código para Android, iOS, Raspberry Pi y computadoras, con énfasis en privacidad, bajo costo y medición de desempeño.</p></section>
  <div class="info-grid"><article><h2>Flujo técnico</h2><ol><li>Permiso y captura de cámara.</li><li>Detección de hasta dos manos.</li><li>Normalización de landmarks.</li><li>Inferencia TensorFlow.js.</li><li>Etiqueta, confianza y voz opcional.</li></ol></article><article><h2>Privacidad</h2><p>Los fotogramas se procesan dentro del navegador. El prototipo no incluye carga de imágenes o video a servidores.</p></article><article><h2>Gobernanza de datos</h2><p>Solo se incorporarán grabaciones con consentimiento, código anónimo de signante y finalidad académica documentada. Las referencias en línea no se copiarán al dataset sin licencia o permiso expreso.</p></article><article><h2>Criterio lingüístico</h2><p>Cada clase debe contrastarse con recursos oficiales de LESSA y validarse con una persona competente. Las variantes se documentarán; no se asumirá equivalencia con ASL.</p></article><article><h2>Alcance inicial</h2><p>El piloto reconoce por reglas A, B, D, F, G, H, I, L, U, V, W, Y y 0-4. Las demás clases requieren muestras propias; las señas dinámicas usarán ventanas temporales.</p></article><article><h2>Métricas ARC115</h2><p>Macro-F1 por signante, matriz de confusión, FPS, latencia p50/p95, backend, tamaño del modelo, memoria y compatibilidad por dispositivo.</p></article></div>`;
}

function bindNavigation(): void {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((element) => {
    element.addEventListener('click', () => render(element.dataset.view as ViewName));
  });
}

function bindConsentControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-consent-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = button.dataset.consentChoice as Exclude<TrainingConsent, 'unset'>;
      writeTrainingConsent(choice);
      if (stream) stopCamera();
      render(currentView);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-revoke-consent]').forEach((button) => {
    button.addEventListener('click', () => {
      personalClassifier.clearAll();
      clearContributionQueue();
      writeTrainingConsent('declined');
      if (stream) stopCamera();
      render(currentView);
    });
  });
}

async function bindRecognition(): Promise<void> {
  const button = required<HTMLButtonElement>('camera-toggle');
  const readyAlphabet = personalClassifier.readyLabels(new Set(alphabetLabels));
  const readyNumbers = personalClassifier.readyLabels(new Set(numberLabels));
  required<HTMLButtonElement>('speak-button').addEventListener('click', speakResult);
  required<HTMLSelectElement>('recognition-mode').addEventListener('change', changeRecognitionMode);
  button.addEventListener('click', () => stream ? stopCamera() : void startCamera());
  setStatus('Cargando MediaPipe y TensorFlow.js…', 'idle');
  try {
    await Promise.all([tracker.initialize(), classifier.initialize()]);
    if (currentView !== 'reconocimiento') return;
    required<HTMLElement>('model-notice').textContent = classifier.isTrained
      ? 'Modelo entrenado cargado. Se aplicará el umbral de confianza configurado.'
      : `Reconocimiento base activo para ${DEFAULT_ALPHABET_LABELS.join(', ')} y números 0–4. Letras personales listas: ${readyAlphabet.length}. Números personales listos: ${readyNumbers.length}.`;
    required<HTMLElement>('metric-backend').textContent = classifier.backend;
    setStatus('Detector listo', 'ready');
  } catch (error) {
    setStatus(readableError(error), 'error');
    button.disabled = true;
  }
}

async function bindTraining(): Promise<void> {
  const button = required<HTMLButtonElement>('camera-toggle');
  required<HTMLButtonElement>('capture-button').addEventListener('click', beginCapture);
  required<HTMLButtonElement>('clear-class-button').addEventListener('click', clearSelectedClass);
  required<HTMLSelectElement>('training-label').addEventListener('change', updateTrainingReference);
  button.addEventListener('click', () => stream ? stopCamera() : void startCamera());
  setStatus('Cargando detector de manos…', 'idle');
  try {
    await tracker.initialize();
    if (currentView !== 'entrenamiento') return;
    setStatus('Detector listo para capturar', 'ready');
  } catch (error) {
    setStatus(readableError(error), 'error');
    button.disabled = true;
  }
}

function updateTrainingReference(): void {
  const label = required<HTMLSelectElement>('training-label').value;
  const reference = getReference(label);
  const image = required<HTMLImageElement>('training-reference-image');
  image.hidden = !reference.image;
  if (reference.image) {
    image.src = reference.image;
    image.alt = `Página de referencia para ${label}`;
  }
  required<HTMLElement>('training-reference-title').textContent = `Referencia para ${label}`;
  required<HTMLElement>('training-reference-note').textContent = reference.note;
  required<HTMLElement>('training-reference-source').textContent = reference.page
    ? `${reference.source} · página ${reference.page}`
    : reference.source;
}

async function startCamera(): Promise<void> {
  const video = required<HTMLVideoElement>('camera');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
    video.srcObject = stream;
    await video.play();
    required<HTMLElement>('camera-placeholder').hidden = true;
    required<HTMLButtonElement>('camera-toggle').textContent = 'Detener cámara';
    const captureButton = document.querySelector<HTMLButtonElement>('#capture-button');
    if (captureButton) captureButton.disabled = readTrainingConsent() !== 'accepted';
    setStatus('Reconociendo manos', 'ready');
    previousTimestamp = performance.now();
    animationFrame = requestAnimationFrame(processFrame);
  } catch (error) {
    setStatus(`No se pudo abrir la cámara: ${readableError(error)}`, 'error');
  }
}

function stopCamera(): void {
  cancelAnimationFrame(animationFrame);
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  frameSamples = [];
  pilotRecognizer.reset();
  alphabetRecognizer.reset();
  lastSpokenLabel = '';
  captureRemaining = 0;
  const video = document.querySelector<HTMLVideoElement>('#camera');
  if (video) video.srcObject = null;
  const button = document.querySelector<HTMLButtonElement>('#camera-toggle');
  if (button) button.textContent = 'Iniciar cámara';
  const captureButton = document.querySelector<HTMLButtonElement>('#capture-button');
  if (captureButton) captureButton.disabled = true;
  const placeholder = document.querySelector<HTMLElement>('#camera-placeholder');
  if (placeholder) placeholder.hidden = false;
  if (isCameraView(currentView)) setStatus('Cámara detenida', 'idle');
}

function processFrame(timestamp: number): void {
  if (!stream || !isCameraView(currentView)) return;
  const video = required<HTMLVideoElement>('camera');
  const canvas = required<HTMLCanvasElement>('overlay');
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(processFrame);
    return;
  }

  const detectionStart = performance.now();
  const result = tracker.detect(video, timestamp);
  const detectionMs = performance.now() - detectionStart;
  drawHands(canvas, video, result.landmarks);

  const elapsed = timestamp - previousTimestamp;
  previousTimestamp = timestamp;
  frameSamples.push(elapsed);
  if (frameSamples.length > 30) frameSamples.shift();
  const fps = frameSamples.length > 1 ? 1000 / (frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length) : 0;

  const metrics = { frames: frameSamples.length, fps, detectionMs, backend: classifier.backend, hands: result.landmarks.length };
  if (currentView === 'entrenamiento') {
    if (result.landmarks.length > 0) captureTrainingSample(normalizeHands(result.landmarks), timestamp);
    updateTrainingMetrics(metrics);
  } else {
    let prediction: Prediction | null = null;
    if (result.landmarks.length > 0) {
      const features = normalizeHands(result.landmarks);
      const allowedLabels = new Set(recognitionMode === 'alphabet' ? alphabetLabels : numberLabels);
      prediction = classifier.isTrained
        ? classifier.predict(features)
        : personalClassifier.predict(features, allowedLabels)
          ?? (recognitionMode === 'numbers'
            ? pilotRecognizer.predict(result.landmarks)
            : alphabetRecognizer.predict(result.landmarks));
    }
    updateRecognition(prediction, metrics);
  }
  animationFrame = requestAnimationFrame(processFrame);
}

function updateRecognition(prediction: Prediction | null, metrics: RuntimeMetrics): void {
  const label = required<HTMLElement>('prediction-label');
  const confidenceText = required<HTMLElement>('confidence-text');
  const confidenceFill = required<HTMLElement>('confidence-fill');

  if (!prediction) {
    const allowed = new Set(recognitionMode === 'alphabet' ? alphabetLabels : numberLabels);
    const hasReadyClasses = personalClassifier.readyLabels(allowed).length > 0;
    label.textContent = metrics.hands === 0
      ? 'Coloca una mano en cámara'
      : hasReadyClasses ? 'Seña no reconocida' : 'Primero entrena una clase';
    confidenceText.textContent = 'Confianza: —';
    confidenceFill.style.width = '0%';
  } else if (prediction.kind === 'integration-demo') {
    label.textContent = prediction.label;
    confidenceText.textContent = `Salida técnica: ${(prediction.confidence * 100).toFixed(1)} %`;
    confidenceFill.style.width = `${prediction.confidence * 100}%`;
  } else {
    label.textContent = prediction.accepted ? prediction.label : 'Seña no reconocida';
    if (prediction.kind === 'rule-based-pilot' && !prediction.accepted) label.textContent = prediction.label;
    confidenceText.textContent = `${prediction.kind === 'rule-based-pilot' ? 'Estabilidad' : 'Confianza'}: ${(prediction.confidence * 100).toFixed(1)} % · inferencia ${prediction.inferenceMs.toFixed(1)} ms`;
    confidenceFill.style.width = `${prediction.confidence * 100}%`;
    if (prediction.accepted) speakAutomatically(prediction.label);
  }

  required<HTMLElement>('metric-fps').textContent = metrics.fps ? metrics.fps.toFixed(1) : '—';
  required<HTMLElement>('metric-detection').textContent = `${metrics.detectionMs.toFixed(1)} ms`;
  required<HTMLElement>('metric-backend').textContent = metrics.backend;
  required<HTMLElement>('metric-hands').textContent = String(metrics.hands);
}

function speakResult(): void {
  const text = required<HTMLElement>('prediction-label').textContent?.trim();
  if (!text || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-SV';
  window.speechSynthesis.speak(utterance);
}

function speakAutomatically(label: string): void {
  const now = performance.now();
  if (label === lastSpokenLabel && now - lastSpokenAt < 2500) return;
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(label);
  utterance.lang = 'es-SV';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
  lastSpokenLabel = label;
  lastSpokenAt = now;
}

function changeRecognitionMode(): void {
  recognitionMode = required<HTMLSelectElement>('recognition-mode').value as 'alphabet' | 'numbers';
  pilotRecognizer.reset();
  alphabetRecognizer.reset();
  lastSpokenLabel = '';
  const allowed = new Set(recognitionMode === 'alphabet' ? alphabetLabels : numberLabels);
  const ready = personalClassifier.readyLabels(allowed);
  required<HTMLElement>('ready-labels').textContent = recognitionMode === 'alphabet'
    ? `Abecedario listo: ${[...new Set([...DEFAULT_ALPHABET_LABELS, ...ready])].join(', ')}`
    : `Números listos: ${ready.length ? ready.join(', ') : '0–4 disponibles por reglas'}`;
  required<HTMLElement>('prediction-label').textContent = 'Sin predicción';
  required<HTMLElement>('confidence-text').textContent = 'Confianza: —';
  required<HTMLElement>('confidence-fill').style.width = '0%';
}

function beginCapture(): void {
  if (readTrainingConsent() !== 'accepted') {
    setStatus('Debes aceptar la autorización antes de guardar muestras.', 'error');
    return;
  }
  if (!stream) {
    setStatus('Inicia la cámara antes de capturar muestras.', 'error');
    return;
  }
  captureLabel = required<HTMLSelectElement>('training-label').value;
  captureRemaining = 12;
  lastCaptureAt = 0;
  required<HTMLButtonElement>('capture-button').disabled = true;
  required<HTMLElement>('training-status').textContent = `Preparando captura de ${captureLabel}. Mantén la seña estable…`;
  required<HTMLElement>('training-progress-fill').style.width = '0%';
}

function captureTrainingSample(features: number[], timestamp: number): void {
  if (captureRemaining <= 0 || timestamp - lastCaptureAt < 120) return;
  const count = personalClassifier.add(captureLabel, features);
  queueContribution(captureLabel, features);
  captureRemaining -= 1;
  lastCaptureAt = timestamp;
  const status = required<HTMLElement>('training-status');
  required<HTMLElement>('training-progress-fill').style.width = `${((12 - captureRemaining) / 12) * 100}%`;
  status.textContent = captureRemaining > 0
    ? `Capturando ${captureLabel}: faltan ${captureRemaining} muestras…`
    : `${captureLabel} lista con ${count} muestras. Clases entrenadas: ${personalClassifier.trainedLabels()}.`;
  if (captureRemaining === 0) {
    required<HTMLButtonElement>('capture-button').disabled = false;
    setStatus(`Clase ${captureLabel} guardada localmente`, 'ready');
    refreshTrainingStats();
    void syncCollectiveMatrix(status, captureLabel, count);
  }
}

async function syncCollectiveMatrix(status: HTMLElement, label: string, localCount: number): Promise<void> {
  try {
    const result = await flushContributions();
    status.textContent = result.configured
      ? `${label} lista con ${localCount} muestras locales. ${result.sent} aportadas a la matriz colectiva; ${result.pending} pendientes.`
      : `${label} lista con ${localCount} muestras locales. ${result.pending} pendientes hasta configurar el backend colectivo.`;
  } catch (error) {
    status.textContent = `${label} quedó guardada localmente. Envío colectivo pendiente: ${readableError(error)}`;
  }
}

function clearSelectedClass(): void {
  const label = required<HTMLSelectElement>('training-label').value;
  personalClassifier.clear(label);
  required<HTMLElement>('training-status').textContent = `${label} eliminada. ${personalClassifier.trainedLabels()} clases listas · ${personalClassifier.totalSamples()} muestras locales.`;
  required<HTMLElement>('training-progress-fill').style.width = '0%';
  refreshTrainingStats();
}

function updateTrainingMetrics(metrics: RuntimeMetrics): void {
  const hands = document.querySelector<HTMLElement>('#training-hands');
  if (hands) hands.textContent = String(metrics.hands);
}

function refreshTrainingStats(): void {
  const classes = document.querySelector<HTMLElement>('#trained-class-count');
  const samples = document.querySelector<HTMLElement>('#sample-count');
  if (classes) classes.textContent = String(personalClassifier.trainedLabels());
  if (samples) samples.textContent = String(personalClassifier.totalSamples());
}

function isCameraView(view: ViewName): boolean {
  return view === 'reconocimiento' || view === 'entrenamiento';
}

function setStatus(text: string, state: 'idle' | 'ready' | 'error'): void {
  const status = document.querySelector<HTMLElement>('#runtime-status');
  const label = document.querySelector<HTMLElement>('#status-text');
  if (status) status.dataset.state = state;
  if (label) label.textContent = text;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`No se encontró el elemento #${id}.`);
  return element as T;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTrainingConsent(): TrainingConsent {
  const value = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${CONSENT_COOKIE}=`))
    ?.split('=')[1];
  return value === 'accepted' || value === 'declined' ? value : 'unset';
}

function writeTrainingConsent(value: Exclude<TrainingConsent, 'unset'>): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=31536000; Path=/; SameSite=Lax${secure}`;
}

render('inicio');
