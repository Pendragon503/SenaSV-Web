import './styles.css';
import { HandTracker } from './hand-tracker';
import { SignClassifier } from './classifier';
import { drawHands } from './draw';
import { normalizeHands } from './normalize';
import { pilotClasses, signCatalog, sources, wordLabels } from './catalog';
import { PilotRecognizer } from './pilot-recognizer';
import { PersonalClassifier } from './personal-classifier';
import { AlphabetRecognizer, DEFAULT_ALPHABET_LABELS } from './alphabet-recognizer';
import { clearContributionQueue, flushContributions, queueContribution, revokeCollectiveContributions } from './contribution-client';
import { getReference, phraseLabels } from './reference-catalog';
import { compareLabels, REFERENCE_DATASET_VERSION, REFERENCE_IMAGES, referenceLabels } from './reference-dataset';
import { trainFromReferenceImages, type TrainingProgress } from './image-trainer';
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
type RecognitionMode = 'alphabet' | 'numbers' | 'words';
let recognitionMode: RecognitionMode = 'alphabet';

type TrainingConsent = 'accepted' | 'declined' | 'unset';
const CONSENT_COOKIE = 'senasv_training_consent';

const alphabetLabels = ['A', 'B', 'C', 'CH', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL', 'M', 'N', 'Ñ', 'O', 'P', 'Q', 'R', 'RR', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const numberLabels = Array.from({ length: 101 }, (_, index) => String(index));
const trainingLabels = [...alphabetLabels, ...numberLabels, ...wordLabels, ...phraseLabels];
const numberScopeGroups = ['0–9', '10–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70–79', '80–89', '90–99', '100'];
const imageAlphabetLabels = referenceLabels('alphabet');
const imageNumberLabels = referenceLabels('numbers');
const baseAlphabetLabels = sortLabels([...DEFAULT_ALPHABET_LABELS, ...imageAlphabetLabels]);
const baseRuleNumbers = ['0', '1', '2', '3', '4'];
const baseNumberLabels = sortLabels([...baseRuleNumbers, ...imageNumberLabels]);

interface ImageModelState {
  phase: 'idle' | 'training' | 'error';
  progress: number;
  message: string;
}
let imageModelState: ImageModelState = { phase: 'idle', progress: 0, message: '' };
let imageTraining: Promise<void> | null = null;
let imageModelLoaded = false;

function shell(content: string): string {
  const consent = readTrainingConsent();
  return `<div class="app-shell">
    <header class="topbar">
      <button class="brand" data-view="inicio" aria-label="Ir al inicio"><img src="${import.meta.env.BASE_URL}icon.svg" alt=""><span><strong>SeñaSV</strong><small>Plataforma de investigación aplicada</small></span></button>
      <nav class="nav" aria-label="Navegación principal">
        ${navButton('inicio', 'Inicio')}${navButton('entrenamiento', 'Entrenamiento')}${navButton('reconocimiento', 'Reconocimiento')}${navButton('diccionario', 'Catálogo')}${navButton('informacion', 'Institucional')}
      </nav>
    </header>
    <main class="main">${content}</main>
    <footer class="footer"><div class="footer-brand"><strong>SeñaSV</strong><span>Proyecto académico ARC115 · LESSA sujeta a validación especializada</span></div><details class="footer-privacy"><summary>Privacidad, cookies y datos de entrenamiento</summary><div><p><strong>Coordenadas, no imágenes.</strong> Al entrenar se guardan la etiqueta, 126 coordenadas normalizadas, fecha técnica y versiones de la aplicación y del consentimiento. Nunca guardamos fotografías, video, audio, rostro, nombre ni ubicación.</p><p>Una cookie conserva tu decisión durante 12 meses. Las muestras se almacenan localmente y se envían a la matriz colectiva únicamente cuando el servidor seguro está disponible.</p>${consent === 'accepted' ? '<button class="footer-link" data-revoke-consent>Retirar autorización y eliminar mis contribuciones</button>' : '<span>Estado: autorización no concedida.</span>'}</div></details></footer>
    ${consent === 'unset' ? consentBanner() : ''}
  </div>`;
}

function consentBanner(): string {
  return `<section class="consent-banner" role="dialog" aria-labelledby="consent-title" aria-describedby="consent-description">
    <div class="consent-icon" aria-hidden="true">✓</div><div class="consent-copy"><h2 id="consent-title">Privacidad y colaboración</h2>
    <p id="consent-description">Para entrenar, guardamos coordenadas anónimas de la mano. Nunca fotografías, video, audio, rostro, nombre ni ubicación.</p>
    <details><summary>Consultar datos y condiciones</summary><p>Al aceptar, autorizas guardar localmente y aportar a la matriz colectiva la etiqueta seleccionada, 126 coordenadas normalizadas de landmarks, fecha técnica y versión de la aplicación. El envío solo ocurre cuando el backend seguro está configurado. La cookie recuerda tu elección durante 12 meses.</p></details></div>
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
    <div class="hero-copy"><div class="hero-badge"><span></span>Prototipo académico ARC115</div><p class="eyebrow">Tecnología inclusiva · Investigación aplicada</p><h1>Reconocimiento responsable de LESSA</h1>
    <p class="lead">Plataforma para reconocer, documentar y entrenar configuraciones de la Lengua de Señas Salvadoreña mediante procesamiento local y colaboración consentida.</p>
    <div class="actions"><button class="button primary" data-view="reconocimiento">Iniciar reconocimiento</button><button class="button" data-view="entrenamiento">Contribuir al entrenamiento</button></div>
    <div class="trust-row"><span>Procesamiento local</span><span>Consentimiento informado</span><span>Fuentes institucionales</span></div></div>
    <div class="hero-card" aria-hidden="true"><div class="hero-card-head"><span>SEÑASV · PLATAFORMA 0.1</span><span class="operational-dot">Operativo</span></div><div class="hero-mark"><small>LENGUA DE SEÑAS SALVADOREÑA</small><strong>SV</strong></div><div class="hero-stats"><div><strong>${pilotClasses.length}</strong><span>clases piloto</span></div><div><strong>50</strong><span>palabras objetivo</span></div><div><strong>21</strong><span>puntos por mano</span></div></div></div>
  </section>
  <section class="home-modules" aria-labelledby="modules-title"><div class="module-heading"><p class="eyebrow">Módulos de trabajo</p><h2 id="modules-title">Una ruta clara para participar</h2></div>
    <article><span>01</span><div><h3>Reconocer</h3><p>Activa la cámara y consulta letras, números o palabras previamente entrenadas.</p></div><button data-view="reconocimiento" aria-label="Abrir reconocimiento">→</button></article>
    <article><span>02</span><div><h3>Entrenar</h3><p>Captura muestras normalizadas y contribuye al aprendizaje colectivo.</p></div><button data-view="entrenamiento" aria-label="Abrir entrenamiento">→</button></article>
    <article><span>03</span><div><h3>Explorar</h3><p>Revisa el catálogo, las fuentes y el estado de validación de cada clase.</p></div><button data-view="diccionario" aria-label="Abrir catálogo">→</button></article>
  </section>
  <section class="scope-overview" aria-labelledby="scope-title">
    <div class="scope-heading"><p class="eyebrow">Alcance de identificación</p><h2 id="scope-title">Clases contempladas por el proyecto</h2><p>Usa el catálogo para practicar y capturar muestras. En Reconocimiento puedes consultar qué clases están activas en tu dispositivo.</p></div>
    <article class="scope-card"><div class="scope-card-title"><div><small>Conjunto 01</small><h3>Alfabeto LESSA</h3></div><strong>${alphabetLabels.length} etiquetas</strong></div><div class="label-grid">${alphabetLabels.map((label) => `<span class="${baseAlphabetLabels.includes(label) ? 'available' : ''}">${label}</span>`).join('')}</div><p><i></i> ${baseAlphabetLabels.length} letras en el piloto de reglas y fotografías. Las demás requieren muestras personales.</p></article>
    <article class="scope-card"><div class="scope-card-title"><div><small>Conjunto 02</small><h3>Numeración</h3></div><strong>0–100</strong></div><div class="number-range-grid">${numberScopeGroups.map((range) => `<span>${range}</span>`).join('')}</div><p><i></i> Piloto de reglas y fotografías: ${describeNumberRange(baseNumberLabels)}. El entrenamiento admite valores individuales desde 0 hasta 100.</p></article>
    <article class="scope-card word-scope"><div class="scope-card-title"><div><small>Conjunto 03</small><h3>Vocabulario funcional</h3></div><strong>50 palabras objetivo</strong></div><div class="word-categories"><span>Saludos · 10</span><span>Preguntas · 8</span><span>Necesidades · 12</span><span>Personas · 8</span><span>Educación · 8</span><span>Emergencias · 4</span></div><details class="word-details"><summary>Consultar las 50 palabras</summary><div class="word-grid">${wordLabels.map((label) => `<span>${label}</span>`).join('')}</div></details><p><i></i> Disponibles para captura y aprendizaje personal/colectivo; requieren muestras reales y validación competente en LESSA.</p></article>
  </section>`;
}

function recognitionView(): string {
  return `<section class="section-heading"><p class="eyebrow">Módulo operativo · Versión 0.1</p><h1>Reconocimiento en tiempo real</h1><p>La captura y el procesamiento visual se realizan localmente. Los resultados corresponden a un prototipo académico y requieren validación especializada antes de cualquier aplicación institucional.</p></section>
  <div class="recognition-layout">
    <section class="panel" aria-label="Cámara">
      <div class="camera-stage"><video id="camera" playsinline muted></video><canvas id="overlay"></canvas><div class="camera-placeholder" id="camera-placeholder"><strong>Cámara detenida</strong>Pulsa iniciar y concede permiso para comenzar.</div></div>
      <div class="camera-controls"><button class="button primary" id="camera-toggle">Iniciar cámara</button><span class="status" id="runtime-status" data-state="idle"><span class="status-dot"></span><span id="status-text">Listo para iniciar</span></span></div>
    </section>
    <aside class="panel results" aria-live="polite">
      <div class="recognition-mode"><label for="recognition-mode">Qué deseas reconocer</label><select id="recognition-mode">${([['alphabet', 'Abecedario'], ['numbers', 'Números'], ['words', 'Palabras']] as const).map(([value, text]) => `<option value="${value}" ${recognitionMode === value ? 'selected' : ''}>${text}</option>`).join('')}</select><p id="ready-labels">${readyLabelsText()}</p></div>
      <div class="prediction"><small>Resultado</small><strong id="prediction-label">Sin predicción</strong><div class="confidence-track"><div class="confidence-fill" id="confidence-fill"></div></div><p id="confidence-text">Confianza: —</p></div>
      <p class="notice" id="model-notice">Cargando detector y clasificador…</p>
      <section class="model-card" aria-label="Modelo entrenado con imágenes">
        <div class="model-card-head"><small>Modelo de imágenes LESSA</small><span class="model-badge" id="image-model-badge">—</span></div>
        <p id="image-model-status">Comprobando modelo…</p>
        <div class="training-progress"><div id="image-model-progress"></div></div>
        <div class="model-actions"><button class="button" id="retrain-model-button" type="button" disabled>Entrenar con imágenes</button><button class="button" id="export-model-button" type="button" disabled>Exportar modelo</button></div>
        <div class="model-actions" id="model-export-files" hidden><button class="button" id="download-model-json" type="button">Descargar modelo</button><button class="button" id="download-model-weights" type="button">Descargar pesos</button></div>
      </section>
      <button class="button" id="speak-button">Escuchar resultado</button>
      <div class="metrics"><div class="metric"><span>FPS</span><strong id="metric-fps">—</strong></div><div class="metric"><span>Detección</span><strong id="metric-detection">—</strong></div><div class="metric"><span>Backend TF</span><strong id="metric-backend">—</strong></div><div class="metric"><span>Manos</span><strong id="metric-hands">0</strong></div></div>
    </aside>
  </div>`;
}

function trainingView(): string {
  const initialReference = getReference(trainingLabels[0]);
  return `<section class="section-heading training-heading"><p class="eyebrow">Gestión de datos · Participación voluntaria</p><h1>Entrenamiento supervisado</h1><p>Selecciona una clase, prepara la seña y registra 12 muestras. En este módulo no se ejecuta reconocimiento ni síntesis de voz.</p></section>
  <nav class="training-workflow" aria-label="Etapas del entrenamiento"><div><strong>01</strong><span>Selecciona</span><small>Letra, número o palabra</small></div><div><strong>02</strong><span>Prepara</span><small>Mano centrada y visible</small></div><div><strong>03</strong><span>Captura</span><small>12 muestras variadas</small></div></nav>
  <div class="training-layout">
    <section class="panel" aria-label="Cámara de entrenamiento">
      <div class="camera-stage"><video id="camera" playsinline muted></video><canvas id="overlay"></canvas><div class="camera-placeholder" id="camera-placeholder"><strong>Cámara detenida</strong>Inicia la cámara para capturar muestras.</div></div>
      <div class="camera-controls"><button class="button primary" id="camera-toggle">Iniciar cámara</button><span class="status" id="runtime-status" data-state="idle"><span class="status-dot"></span><span id="status-text">Listo para iniciar</span></span></div><p class="camera-guidance">Coloca una sola mano completa dentro del encuadre. Cambia ligeramente la distancia y el ángulo entre rondas.</p>
    </section>
    <aside class="panel training-panel">
      <section class="training-step"><p class="step-label">Etapa 01 · Seleccionar</p><h2>Clase de entrenamiento</h2><label for="training-label">Letra, número, palabra o frase</label><select id="training-label"><optgroup label="Abecedario">${alphabetLabels.map((label) => `<option value="${label}">${label}</option>`).join('')}</optgroup><optgroup label="Números 0–100">${numberLabels.map((label) => `<option value="${label}">${label}</option>`).join('')}</optgroup><optgroup label="50 palabras objetivo">${wordLabels.map((label) => `<option value="${label}">${label}</option>`).join('')}</optgroup><optgroup label="Frases visuales de LESSA Virtual">${phraseLabels.map((label) => `<option value="${label}">${label}</option>`).join('')}</optgroup></select>
      <details class="reference-details" open><summary>Referencia visual de la seña</summary><figure class="training-reference" id="training-reference"><button class="reference-zoom" id="reference-zoom" type="button" aria-label="Ampliar imagen de referencia">⌕ <span>Ampliar</span></button><img id="training-reference-image" src="${initialReference.image}" alt="Página de referencia para ${initialReference.label}"><div class="word-reference-placeholder" id="word-reference-placeholder" hidden><small>Ficha visual de validación</small><strong id="word-reference-label">${initialReference.label}</strong><div><span>Configuración</span><span>Orientación</span><span>Ubicación</span><span>Movimiento</span></div><p>Imagen LESSA validada pendiente</p></div><figcaption><strong id="training-reference-title">Referencia para ${initialReference.label}</strong><span id="training-reference-note">${initialReference.note}</span><small id="training-reference-source">${initialReference.source} · página ${initialReference.page}</small></figcaption></figure></details></section>
      <section class="training-step capture-step"><p class="step-label">Etapas 02–03 · Preparar y capturar</p><h2>Registro de muestras</h2><p class="capture-reminder">Mano completa, vertical y centrada. Mantén la seña estable durante la captura.</p><div class="training-progress"><div id="training-progress-fill"></div></div><p class="training-status" id="training-status">${personalClassifier.trainedLabels()} clases listas · ${personalClassifier.totalSamples()} muestras locales</p><div class="training-actions"><button class="button primary" id="capture-button" disabled>Capturar 12 muestras</button><button class="button" id="clear-class-button">Borrar esta clase</button></div></section>
      <div class="training-stats"><div><strong id="trained-class-count">${personalClassifier.trainedLabels()}</strong><span>clases listas</span></div><div><strong id="sample-count">${personalClassifier.totalSamples()}</strong><span>muestras</span></div><div><strong id="training-hands">0</strong><span>manos visibles</span></div></div>
      <button class="button full" data-view="reconocimiento">Aplicar lo aprendido</button>
    </aside>
  </div><dialog class="reference-dialog" id="reference-dialog" aria-labelledby="reference-dialog-title"><div class="reference-dialog-head"><div><small>Referencia de aprendizaje</small><strong id="reference-dialog-title">Referencia para ${initialReference.label}</strong></div><button id="reference-dialog-close" type="button" aria-label="Cerrar referencia ampliada">×</button></div><div class="reference-dialog-canvas"><img id="reference-dialog-image" src="${initialReference.image}" alt="Referencia ampliada para ${initialReference.label}"><iframe id="reference-dialog-video" hidden title="Demostración audiovisual de LESSA" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe><div class="word-reference-placeholder dialog-placeholder" id="dialog-word-placeholder" hidden><small>Ficha visual de validación</small><strong id="dialog-word-label">${initialReference.label}</strong><div><span>Configuración</span><span>Orientación</span><span>Ubicación</span><span>Movimiento</span></div><p>Imagen LESSA validada pendiente</p></div></div><p id="reference-dialog-note">${initialReference.note}</p></dialog>`;
}

function dictionaryView(): string {
  return `<section class="section-heading"><p class="eyebrow">Gobernanza y trazabilidad</p><h1>Catálogo de reconocimiento</h1><p>Inventario documentado de clases, fuentes y estado de validación. La referencia bibliográfica no autoriza la incorporación de material audiovisual al conjunto de entrenamiento.</p></section>
  <div class="catalog-summary"><div><strong>${pilotClasses.length}</strong><span>clases del piloto</span></div><div><strong>${signCatalog.length}</strong><span>clases documentadas</span></div><div><strong>${sources.length}</strong><span>fuentes institucionales</span></div></div>
  <div class="class-table" role="table" aria-label="Catálogo de clases">
    <div class="class-row class-header" role="row"><span>Clase</span><span>Categoría</span><span>Estado</span><span>Validación</span></div>
    ${signCatalog.map((item) => `<div class="class-row" role="row"><strong>${item.label}</strong><span>${item.category}</span><span class="tag ${item.status}">${item.status === 'piloto' ? 'Piloto 0.1' : 'Planificada'}</span><span>${item.validation === 'presencia-verificada' ? 'Término localizado' : 'Revisión pendiente'}</span></div>`).join('')}
  </div>
  <section class="sources"><h2>Fuentes y condiciones de uso</h2>${sources.map((source) => `<article><div><h3>${source.title}</h3><p>${source.institution}</p></div><p>${source.usage}</p><p class="rights">${source.rights}</p><a href="${source.url}" target="_blank" rel="noreferrer">Consultar fuente oficial</a></article>`).join('')}</section>`;
}

function infoView(): string {
  return `<section class="section-heading"><p class="eyebrow">Marco institucional</p><h1>Información del proyecto</h1><p>Arquitectura multiplataforma orientada a investigación académica, accesibilidad, privacidad y medición verificable del desempeño.</p></section>
  <div class="info-grid"><article><h2>Flujo técnico</h2><ol><li>Permiso y captura de cámara.</li><li>Detección de hasta dos manos.</li><li>Normalización de landmarks.</li><li>Inferencia TensorFlow.js.</li><li>Etiqueta, confianza y voz opcional.</li></ol></article><article><h2>Privacidad</h2><p>Los fotogramas se procesan dentro del navegador. El prototipo no incluye carga de imágenes o video a servidores.</p></article><article><h2>Gobernanza de datos</h2><p>Solo se incorporarán grabaciones con consentimiento, código anónimo de signante y finalidad académica documentada. Las referencias en línea no se copiarán al dataset sin licencia o permiso expreso.</p></article><article><h2>Criterio lingüístico</h2><p>Cada clase debe contrastarse con recursos oficiales de LESSA y validarse con una persona competente. Las variantes se documentarán; no se asumirá equivalencia con ASL.</p></article><article><h2>Alcance inicial</h2><p>Un modelo TensorFlow.js aprende de las fotografías de <code>dataset/imagenes</code> (${REFERENCE_IMAGES.length} imágenes: ${imageAlphabetLabels.join(', ')}${imageNumberLabels.length ? ` y ${describeNumberRange(imageNumberLabels)}` : ''}) mediante landmarks y aumento de datos. Las reglas geométricas cubren A, B, D, F, G, H, I, L, U, V, W, Y y 0–4 mientras el modelo se prepara. Las demás clases requieren muestras propias; las señas dinámicas usarán ventanas temporales.</p></article><article><h2>Métricas ARC115</h2><p>Macro-F1 por signante, matriz de confusión, FPS, latencia p50/p95, backend, tamaño del modelo, memoria y compatibilidad por dispositivo.</p></article><article><h2>Pruebas de segunda entrega</h2><p>Se verificará compatibilidad en Chrome, Edge, Firefox, Safari y Chrome Android; permisos y estabilidad de cámara; instalación PWA; persistencia local; API, validaciones y recuperación ante fallos del backend.</p></article><article><h2>Calidad documental</h2><p>Las figuras se entregarán en formato vectorial o con un ancho mínimo de 1600 px, texto legible, numeración, título, fuente y referencia explícita dentro del documento.</p></article></div>`;
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
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Eliminando contribuciones…';
      try {
        await revokeCollectiveContributions();
        personalClassifier.clearAll();
        clearContributionQueue();
        writeTrainingConsent('declined');
        if (stream) stopCamera();
        render(currentView);
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Reintentar retiro de autorización';
        const status = document.querySelector<HTMLElement>('#training-status');
        if (status) status.textContent = readableError(error);
      }
    });
  });
}

async function bindRecognition(): Promise<void> {
  const button = required<HTMLButtonElement>('camera-toggle');
  const readyAlphabet = personalClassifier.readyLabels(new Set(alphabetLabels));
  const readyNumbers = personalClassifier.readyLabels(new Set(numberLabels));
  const readyWords = personalClassifier.readyLabels(new Set([...wordLabels, ...phraseLabels]));
  required<HTMLButtonElement>('speak-button').addEventListener('click', speakResult);
  required<HTMLSelectElement>('recognition-mode').addEventListener('change', changeRecognitionMode);
  required<HTMLButtonElement>('retrain-model-button').addEventListener('click', () => void trainImageModel());
  required<HTMLButtonElement>('export-model-button').addEventListener('click', () => void exportImageModel());
  button.addEventListener('click', () => stream ? stopCamera() : void startCamera());
  renderImageModelPanel();
  setStatus('Cargando detector de manos…', 'idle');
  button.disabled = true;
  const modelLoad = loadImageModel();
  try {
    await tracker.initialize();
    if (!button.isConnected) return;
    button.disabled = false;
    setStatus('Detector listo', 'ready');
  } catch (error) {
    if (button.isConnected) setStatus(readableError(error), 'error');
  }
  await modelLoad;
  if (!button.isConnected) return;
  const personalSummary = `Entrenamiento personal: ${readyAlphabet.length} letras, ${readyNumbers.length} números y ${readyWords.length} palabras o frases.`;
  required<HTMLElement>('model-notice').textContent = `Reglas activas para ${DEFAULT_ALPHABET_LABELS.join(', ')} y números 0–4. ${personalSummary}`;
  required<HTMLElement>('metric-backend').textContent = classifier.backend;
  required<HTMLElement>('ready-labels').textContent = readyLabelsText();
  renderImageModelPanel();
}

async function loadImageModel(): Promise<void> {
  try {
    await classifier.initialize(REFERENCE_DATASET_VERSION);
  } catch (error) {
    imageModelState = { phase: 'error', progress: 0, message: `No se pudo cargar el modelo de imágenes: ${readableError(error)}` };
  } finally {
    imageModelLoaded = true;
  }
}

/** Entrena un modelo local con las fotografías de referencia. */
function trainImageModel(): Promise<void> {
  if (imageTraining) return imageTraining;
  required<HTMLElement>('model-export-files').hidden = true;
  if (!REFERENCE_IMAGES.length) {
    imageModelState = { phase: 'error', progress: 0, message: 'No hay imágenes en dataset/imagenes para entrenar.' };
    renderImageModelPanel();
    return Promise.resolve();
  }
  imageTraining = (async () => {
    imageModelState = { phase: 'training', progress: 0, message: 'Preparando detector para fotografías…' };
    renderImageModelPanel();
    try {
      const result = await trainFromReferenceImages(REFERENCE_IMAGES, REFERENCE_DATASET_VERSION, (progress) => {
        imageModelState = { phase: 'training', ...describeTrainingProgress(progress) };
        renderImageModelPanel();
      });
      classifier.useModel(result.model, result.metadata, 'local');
      const skipped = result.failed.length
        ? ` No se detectó la mano en: ${result.failed.map((image) => `${image.label} (${image.path})`).join(', ')}.`
        : '';
      const storage = result.savedLocally ? '' : ' No se pudo guardar en este navegador. El modelo estará disponible durante esta sesión.';
      imageModelState = { phase: 'idle', progress: 1, message: `${skipped}${storage}`.trim() };
    } catch (error) {
      imageModelState = { phase: 'error', progress: 0, message: `No se pudo entrenar con las imágenes: ${readableError(error)}` };
    } finally {
      imageTraining = null;
      renderImageModelPanel();
      if (currentView === 'reconocimiento') {
        required<HTMLElement>('ready-labels').textContent = readyLabelsText();
      }
    }
  })();
  return imageTraining;
}

async function exportImageModel(): Promise<void> {
  const downloads = required<HTMLElement>('model-export-files');
  const jsonButton = required<HTMLButtonElement>('download-model-json');
  const weightsButton = required<HTMLButtonElement>('download-model-weights');
  try {
    const files = await classifier.exportModel();
    if (!downloads.isConnected || imageTraining) return;
    jsonButton.onclick = () => downloadModelFile(files.json, 'model.json');
    weightsButton.onclick = () => downloadModelFile(files.weights, 'model.weights.bin');
    downloads.hidden = false;
    imageModelState = { ...imageModelState, phase: 'idle', message: 'Descarga ambos archivos y colócalos en public/model/ para publicar el modelo.' };
  } catch (error) {
    imageModelState = { ...imageModelState, phase: 'error', message: readableError(error) };
  }
  renderImageModelPanel();
}

function downloadModelFile(content: Blob, name: string): void {
  const href = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function describeTrainingProgress(progress: TrainingProgress): Pick<ImageModelState, 'progress' | 'message'> {
  if (progress.stage === 'landmarks') {
    return {
      progress: (progress.done / progress.total) * 0.35,
      message: `Extrayendo landmarks de las fotografías: ${progress.done}/${progress.total} (${progress.detail})`,
    };
  }
  if (progress.stage === 'training') {
    return {
      progress: 0.35 + (progress.done / progress.total) * 0.6,
      message: `Entrenando red neuronal: época ${progress.done}/${progress.total} · ${progress.detail}`,
    };
  }
  return { progress: 0.98, message: `${progress.detail}…` };
}

function renderImageModelPanel(): void {
  const status = document.querySelector<HTMLElement>('#image-model-status');
  if (!status) return;
  const badge = document.querySelector<HTMLElement>('#image-model-badge');
  const progress = document.querySelector<HTMLElement>('#image-model-progress');
  const retrain = document.querySelector<HTMLButtonElement>('#retrain-model-button');
  const exportButton = document.querySelector<HTMLButtonElement>('#export-model-button');
  const metadata = classifier.metadata;
  const training = imageModelState.phase === 'training';

  let summary: string;
  if (training) {
    summary = imageModelState.message;
  } else if (metadata) {
    const accuracy = typeof metadata.validationAccuracy === 'number'
      ? ` · validación sintética ${(metadata.validationAccuracy * 100).toFixed(1)} % sobre variaciones de las mismas fotos`
      : '';
    const origin = classifier.source === 'publicado'
      ? 'Modelo publicado en public/model'
      : `Entrenado en este dispositivo con ${metadata.referenceImages ?? REFERENCE_IMAGES.length} fotografías`;
    summary = `${origin} · ${metadata.labels.length} clases (${metadata.labels.join(', ')})${accuracy}. ${imageModelState.message}`.trim();
  } else {
    summary = imageModelState.message || `${REFERENCE_IMAGES.length} fotografías disponibles para entrenamiento experimental en este dispositivo.`;
  }

  status.textContent = summary;
  if (badge) {
    badge.textContent = training ? 'Entrenando' : metadata ? (classifier.source === 'publicado' ? 'Publicado' : 'Local') : imageModelState.phase === 'error' ? 'Error' : 'Pendiente';
    badge.dataset.state = training ? 'training' : metadata ? 'ready' : imageModelState.phase;
  }
  if (progress) progress.style.width = `${Math.round((training ? imageModelState.progress : metadata ? 1 : 0) * 100)}%`;
  if (retrain) {
    retrain.disabled = !imageModelLoaded || training;
    retrain.textContent = training ? 'Entrenando…' : metadata ? 'Reentrenar con imágenes' : 'Entrenar con imágenes';
  }
  if (exportButton) exportButton.disabled = training || !metadata;
}

function readyLabelsText(): string {
  const allowed = new Set(labelsForRecognitionMode());
  const personal = personalClassifier.readyLabels(allowed);
  const model = classifier.coveredLabels(allowed);
  if (recognitionMode === 'alphabet') {
    return `Abecedario listo: ${sortLabels([...DEFAULT_ALPHABET_LABELS, ...model, ...personal]).join(', ')}`;
  }
  if (recognitionMode === 'numbers') {
    const ready = sortLabels([...baseRuleNumbers, ...model, ...personal]);
    return `Números listos: ${describeNumberRange(ready)}`;
  }
  const ready = sortLabels([...model, ...personal]);
  return `Palabras y frases listas: ${ready.length ? `${ready.length} · ${ready.join(', ')}` : '0 · entrena una clase antes de reconocerla'}`;
}

function sortLabels(labels: string[]): string[] {
  return [...new Set(labels)].sort(compareLabels);
}

function describeNumberRange(labels: string[]): string {
  const values = labels.map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  if (!values.length) return '—';
  const contiguous = values.every((value, index) => index === 0 || value === values[index - 1] + 1);
  return contiguous && values.length > 2 ? `${values[0]}–${values[values.length - 1]}` : values.join(', ');
}

async function bindTraining(): Promise<void> {
  const button = required<HTMLButtonElement>('camera-toggle');
  required<HTMLButtonElement>('capture-button').addEventListener('click', beginCapture);
  required<HTMLButtonElement>('clear-class-button').addEventListener('click', clearSelectedClass);
  required<HTMLSelectElement>('training-label').addEventListener('change', updateTrainingReference);
  const referenceDialog = required<HTMLDialogElement>('reference-dialog');
  required<HTMLButtonElement>('reference-zoom').addEventListener('click', () => {
    const reference = getReference(required<HTMLSelectElement>('training-label').value);
    const video = required<HTMLIFrameElement>('reference-dialog-video');
    if (reference.videoUrl) video.src = reference.videoUrl;
    referenceDialog.showModal();
  });
  const closeReference = () => {
    required<HTMLIFrameElement>('reference-dialog-video').src = '';
    referenceDialog.close();
  };
  required<HTMLButtonElement>('reference-dialog-close').addEventListener('click', closeReference);
  referenceDialog.addEventListener('click', (event) => {
    if (event.target === referenceDialog) closeReference();
  });
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
  const dialogImage = required<HTMLImageElement>('reference-dialog-image');
  const dialogVideo = required<HTMLIFrameElement>('reference-dialog-video');
  const wordPlaceholder = required<HTMLElement>('word-reference-placeholder');
  const dialogPlaceholder = required<HTMLElement>('dialog-word-placeholder');
  image.hidden = !reference.image;
  dialogImage.hidden = !reference.image || Boolean(reference.videoUrl);
  dialogVideo.hidden = !reference.videoUrl;
  dialogVideo.src = '';
  wordPlaceholder.hidden = Boolean(reference.image);
  dialogPlaceholder.hidden = Boolean(reference.image) || Boolean(reference.videoUrl);
  const zoomButton = required<HTMLButtonElement>('reference-zoom');
  zoomButton.querySelector('span')!.textContent = reference.videoUrl ? 'Ver video' : 'Ampliar';
  zoomButton.setAttribute('aria-label', reference.videoUrl ? `Ver demostración en video de ${label}` : `Ampliar imagen de referencia para ${label}`);
  required<HTMLElement>('word-reference-label').textContent = label;
  required<HTMLElement>('dialog-word-label').textContent = label;
  if (reference.image) {
    image.src = reference.image;
    image.alt = `Página de referencia para ${label}`;
    dialogImage.src = reference.image;
    dialogImage.alt = `Referencia ampliada para ${label}`;
  }
  required<HTMLElement>('training-reference-title').textContent = `Referencia para ${label}`;
  required<HTMLElement>('reference-dialog-title').textContent = `Referencia para ${label}`;
  required<HTMLElement>('training-reference-note').textContent = reference.note;
  required<HTMLElement>('reference-dialog-note').textContent = reference.note;
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
  classifier.resetSmoothing();
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
      const allowedLabels = new Set(labelsForRecognitionMode());
      const personal = personalClassifier.predict(normalizeHands(result.landmarks), allowedLabels);
      const rule = recognitionMode === 'numbers'
        ? pilotRecognizer.predict(result.landmarks)
        : recognitionMode === 'alphabet' ? alphabetRecognizer.predict(result.landmarks) : null;
      if (personal?.accepted || (rule && rule.confidence > 0)) {
        classifier.resetSmoothing();
        prediction = personal?.accepted ? personal : rule;
      } else {
        const model = classifier.covers(allowedLabels)
          ? classifier.predictHands(result.landmarks, video.videoWidth, video.videoHeight, allowedLabels)
          : null;
        prediction = model ?? personal ?? rule;
      }
    } else {
      classifier.resetSmoothing();
      pilotRecognizer.reset();
      alphabetRecognizer.reset();
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
    const allowed = new Set(labelsForRecognitionMode());
    const hasReadyClasses = recognitionMode !== 'words' || classifier.covers(allowed) || personalClassifier.readyLabels(allowed).length > 0;
    label.textContent = metrics.hands === 0
      ? 'Coloca una mano en cámara'
      : hasReadyClasses ? 'Seña no reconocida' : 'Primero entrena una clase';
    confidenceText.textContent = 'Confianza: —';
    confidenceFill.style.width = '0%';
  } else {
    label.textContent = prediction.accepted ? prediction.label : 'Seña no reconocida';
    if (prediction.kind === 'rule-based-pilot' && !prediction.accepted) label.textContent = prediction.label;
    if (prediction.kind === 'trained-model' && !prediction.accepted && prediction.confidence >= 0.45) label.textContent = `Analizando ${prediction.label}…`;
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
  recognitionMode = required<HTMLSelectElement>('recognition-mode').value as RecognitionMode;
  pilotRecognizer.reset();
  alphabetRecognizer.reset();
  classifier.resetSmoothing();
  lastSpokenLabel = '';
  required<HTMLElement>('ready-labels').textContent = readyLabelsText();
  required<HTMLElement>('prediction-label').textContent = 'Sin predicción';
  required<HTMLElement>('confidence-text').textContent = 'Confianza: —';
  required<HTMLElement>('confidence-fill').style.width = '0%';
}

function labelsForRecognitionMode(): string[] {
  if (recognitionMode === 'alphabet') return alphabetLabels;
  if (recognitionMode === 'numbers') return numberLabels;
  return [...wordLabels, ...phraseLabels];
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
