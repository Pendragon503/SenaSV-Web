import * as tf from '@tensorflow/tfjs';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { LOCAL_MODEL_URL } from './image-trainer';
import { metricHandFeatures } from './landmark-features';
import { readEmbeddedMetadata, readLocalMetadata, type SenaModelMetadata } from './model-metadata';
import { normalizeHands } from './normalize';
import type { Prediction } from './types';

const PUBLIC_MODEL_URL = `${import.meta.env.BASE_URL}model/model.json`;
const PUBLIC_LABELS_URL = `${import.meta.env.BASE_URL}model/labels.json`;
/** Fotogramas promediados antes de aceptar una predicción. */
const SMOOTHING_WINDOW = 8;
const MIN_STABLE_FRAMES = 5;

export type ModelSource = 'publicado' | 'local';

interface LoadedModel {
  model: tf.LayersModel;
  metadata: SenaModelMetadata;
}

export class SignClassifier {
  private model: tf.LayersModel | null = null;
  private meta: SenaModelMetadata | null = null;
  private modelSource: ModelSource | null = null;
  private initialization: Promise<void> | null = null;
  private history: number[][] = [];
  private historyKey = '';

  /**
   * Carga, en orden: el modelo publicado en `public/model/` (si corresponde al dataset actual)
   * y el modelo entrenado previamente en este dispositivo. Es idempotente.
   */
  initialize(datasetVersion: string): Promise<void> {
    this.initialization ??= this.load(datasetVersion).catch((error: unknown) => {
      this.initialization = null;
      throw error;
    });
    return this.initialization;
  }

  get backend(): string {
    return tf.getBackend() || 'desconocido';
  }

  get isTrained(): boolean {
    return this.model !== null && this.meta !== null;
  }

  get source(): ModelSource | null {
    return this.modelSource;
  }

  get metadata(): SenaModelMetadata | null {
    return this.meta;
  }

  useModel(model: tf.LayersModel, metadata: SenaModelMetadata, source: ModelSource): void {
    if (this.model && this.model !== model) this.model.dispose();
    this.model = model;
    this.meta = metadata;
    this.modelSource = source;
    this.resetSmoothing();
  }

  /** Etiquetas del modelo que pertenecen al conjunto solicitado. */
  coveredLabels(allowed: Set<string>): string[] {
    return this.meta?.labels.filter((label) => allowed.has(label)) ?? [];
  }

  covers(allowed: Set<string>): boolean {
    return this.coveredLabels(allowed).length > 0;
  }

  predictHands(
    hands: NormalizedLandmark[][],
    width: number,
    height: number,
    allowed: Set<string>,
    threshold = 0.7,
  ): Prediction | null {
    if (!this.model || !this.meta) return null;
    const features = this.meta.features === 'metric-single-hand-v1'
      ? metricHandFeatures(hands, width, height)
      : normalizeHands(hands);
    if (!features) return null;

    const started = performance.now();
    const raw = tf.tidy(() => {
      const output = this.model!.predict(tf.tensor2d([features], [1, features.length])) as tf.Tensor;
      return Array.from(output.dataSync());
    });
    const distribution = maskedDistribution(raw, this.meta, allowed);
    if (!distribution) return null;

    const key = this.meta.labels.filter((label) => allowed.has(label)).join('|');
    if (key !== this.historyKey) {
      this.history = [];
      this.historyKey = key;
    }
    this.history.push(distribution);
    if (this.history.length > SMOOTHING_WINDOW) this.history.shift();

    const averaged = distribution.map((_, index) =>
      this.history.reduce((sum, frame) => sum + frame[index], 0) / this.history.length);
    const bestIndex = averaged.indexOf(Math.max(...averaged));
    const confidence = averaged[bestIndex] ?? 0;
    return {
      label: this.meta.labels[bestIndex] ?? 'DESCONOCIDA',
      confidence,
      accepted: this.history.length >= MIN_STABLE_FRAMES && confidence >= threshold,
      inferenceMs: performance.now() - started,
      kind: 'trained-model',
    };
  }

  resetSmoothing(): void {
    this.history = [];
  }

  /** Descarga `model.json` y `model.weights.bin` para copiarlos en `public/model/`. */
  async exportModel(): Promise<void> {
    if (!this.model) throw new Error('Aún no hay un modelo entrenado para exportar.');
    await this.model.save('downloads://model');
  }

  private async load(datasetVersion: string): Promise<void> {
    await tf.ready();
    const published = await loadPublishedModel(datasetVersion).catch((error: unknown) => {
      console.info('No se usó un modelo publicado.', error);
      return null;
    });
    if (published) {
      this.useModel(published.model, published.metadata, 'publicado');
      return;
    }
    const local = await loadLocalModel(datasetVersion).catch((error: unknown) => {
      console.info('No se usó un modelo local.', error);
      return null;
    });
    if (local) this.useModel(local.model, local.metadata, 'local');
  }
}

async function loadPublishedModel(datasetVersion: string): Promise<LoadedModel | null> {
  const probe = await fetch(PUBLIC_MODEL_URL, { method: 'HEAD', cache: 'no-cache' });
  const contentType = probe.headers.get('content-type') ?? '';
  if (!probe.ok || contentType.includes('text/html')) return null;

  const model = await tf.loadLayersModel(PUBLIC_MODEL_URL);
  let metadata = readEmbeddedMetadata(model);
  if (!metadata) {
    // Contrato anterior: labels.json + 126 características de dos manos + softmax.
    const response = await fetch(PUBLIC_LABELS_URL);
    const labels = response.ok ? await response.json() as unknown : null;
    if (!Array.isArray(labels)) {
      model.dispose();
      return null;
    }
    metadata = {
      schema: 'senasv-model-v1',
      labels: labels.map(String),
      groups: {},
      features: 'legacy-two-hands-v1',
      output: 'probabilities',
    };
  }
  if (metadata.datasetVersion && metadata.datasetVersion !== datasetVersion) {
    console.info(`El modelo publicado corresponde a ${metadata.datasetVersion}; el dataset actual es ${datasetVersion}. Se reentrenará localmente.`);
    model.dispose();
    return null;
  }
  return validated({ model, metadata });
}

async function loadLocalModel(datasetVersion: string): Promise<LoadedModel | null> {
  const stored = await tf.io.listModels();
  if (!(LOCAL_MODEL_URL in stored)) return null;
  const model = await tf.loadLayersModel(LOCAL_MODEL_URL);
  const metadata = readEmbeddedMetadata(model) ?? readLocalMetadata();
  if (!metadata || metadata.datasetVersion !== datasetVersion) {
    model.dispose();
    return null;
  }
  return validated({ model, metadata });
}

function validated(loaded: LoadedModel): LoadedModel | null {
  const outputUnits = loaded.model.outputs[0]?.shape.at(-1);
  if (outputUnits !== loaded.metadata.labels.length) {
    console.warn(`El modelo produce ${outputUnits} salidas pero declara ${loaded.metadata.labels.length} etiquetas.`);
    loaded.model.dispose();
    return null;
  }
  return loaded;
}

/**
 * Restringe la salida a las etiquetas permitidas (p. ej. solo letras) y la convierte en probabilidades.
 * Devuelve un vector del tamaño completo con ceros fuera del conjunto, o null si no hay etiquetas permitidas.
 */
function maskedDistribution(raw: number[], metadata: SenaModelMetadata, allowed: Set<string>): number[] | null {
  const indices = metadata.labels.map((label, index) => allowed.has(label) ? index : -1).filter((index) => index >= 0);
  if (!indices.length) return null;
  const distribution = new Array<number>(raw.length).fill(0);
  if (metadata.output === 'logits') {
    const max = Math.max(...indices.map((index) => raw[index]));
    let total = 0;
    for (const index of indices) {
      distribution[index] = Math.exp(raw[index] - max);
      total += distribution[index];
    }
    for (const index of indices) distribution[index] /= total;
  } else {
    const total = indices.reduce((sum, index) => sum + Math.max(raw[index], 0), 0) || 1;
    for (const index of indices) distribution[index] = Math.max(raw[index], 0) / total;
  }
  return distribution;
}
