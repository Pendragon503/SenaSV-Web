import * as tf from '@tensorflow/tfjs';
import { extractReferenceLandmarks, type ExtractedReference } from './image-landmarks';
import { augmentHand, createRandom, mirrorHand } from './landmark-augment';
import { SINGLE_HAND_FEATURES } from './landmark-features';
import { attachMetadata, storeLocalMetadata, type SenaModelMetadata } from './model-metadata';
import { compareLabels, type ReferenceGroup, type ReferenceImage } from './reference-dataset';

/** Copia local del modelo entrenado con las fotografías de referencia. */
export const LOCAL_MODEL_URL = 'indexeddb://senasv-lessa-imagenes';

const TRAIN_SAMPLES_PER_LABEL = 240;
const VALIDATION_SAMPLES_PER_LABEL = 40;
const EPOCHS = 30;
const BATCH_SIZE = 128;
const LEARNING_RATE = 0.003;
const LABEL_SMOOTHING = 0.08;
const SEED = 20261124;
const GROUP_ORDER: ReferenceGroup[] = ['alphabet', 'numbers'];

export interface TrainingProgress {
  stage: 'landmarks' | 'training' | 'saving';
  done: number;
  total: number;
  detail: string;
}

export interface ImageTrainingResult {
  model: tf.LayersModel;
  metadata: SenaModelMetadata;
  failed: ReferenceImage[];
  savedLocally: boolean;
}

interface Dataset {
  features: Float32Array;
  targets: Float32Array;
  labelIndex: Int32Array;
  count: number;
}

/**
 * Entrena el modelo base a partir de las fotografías de `dataset/imagenes`:
 * 1. MediaPipe extrae 21 landmarks por fotografía (el mismo detector que usa la cámara).
 * 2. Cada fotografía se multiplica con aumento de datos sobre los landmarks.
 * 3. Una red densa aprende las configuraciones; la softmax se calcula por grupo
 *    (letras o números) porque varias señas comparten configuración, p. ej. V y 2.
 * 4. El resultado se guarda en IndexedDB y puede exportarse a `public/model/`.
 */
export async function trainFromReferenceImages(
  images: ReferenceImage[],
  datasetVersion: string,
  onProgress?: (progress: TrainingProgress) => void,
): Promise<ImageTrainingResult> {
  if (!images.length) throw new Error('No hay imágenes de referencia en dataset/imagenes.');
  await tf.ready();

  const extraction = await extractReferenceLandmarks(images, (done, total, image) =>
    onProgress?.({ stage: 'landmarks', done, total, detail: image.label }));
  const labels = sortedLabels(extraction.samples);
  if (labels.length < 2) {
    throw new Error('No se detectaron manos suficientes en las imágenes de referencia para entrenar.');
  }
  const groups = Object.fromEntries(extraction.samples.map(({ image }) => [image.label, image.group]));

  const train = buildDataset(extraction.samples, labels, groups, TRAIN_SAMPLES_PER_LABEL, createRandom(SEED), true);
  const validation = buildDataset(extraction.samples, labels, groups, VALIDATION_SAMPLES_PER_LABEL, createRandom(SEED + 1), false);

  const model = createModel(labels.length);
  model.compile({ optimizer: tf.train.adam(LEARNING_RATE), loss: groupSoftmaxCrossEntropy });

  const xs = tf.tensor2d(train.features, [train.count, SINGLE_HAND_FEATURES]);
  const ys = tf.tensor2d(train.targets, [train.count, labels.length]);
  const xv = tf.tensor2d(validation.features, [validation.count, SINGLE_HAND_FEATURES]);
  const yv = tf.tensor2d(validation.targets, [validation.count, labels.length]);
  let validationAccuracy = 0;
  try {
    await model.fit(xs, ys, {
      epochs: EPOCHS,
      batchSize: BATCH_SIZE,
      shuffle: true,
      validationData: [xv, yv],
      callbacks: {
        onEpochEnd: (epoch, logs) => onProgress?.({
          stage: 'training',
          done: epoch + 1,
          total: EPOCHS,
          detail: `pérdida ${formatLoss(logs?.loss)} · validación ${formatLoss(logs?.val_loss)}`,
        }),
      },
    });
    validationAccuracy = await groupAccuracy(model, xv, validation.labelIndex, labels, groups);
  } finally {
    tf.dispose([xs, ys, xv, yv]);
  }

  const metadata: SenaModelMetadata = {
    schema: 'senasv-model-v1',
    labels,
    groups,
    features: 'metric-single-hand-v1',
    output: 'logits',
    datasetVersion,
    trainedAt: new Date().toISOString(),
    referenceImages: extraction.samples.length,
    skippedImages: extraction.failed.map((image) => image.path),
    augmentedSamplesPerLabel: TRAIN_SAMPLES_PER_LABEL,
    epochs: EPOCHS,
    validationAccuracy,
  };
  attachMetadata(model, metadata);

  onProgress?.({ stage: 'saving', done: 1, total: 1, detail: 'Guardando en este dispositivo' });
  let savedLocally = false;
  try {
    await model.save(LOCAL_MODEL_URL);
    storeLocalMetadata(metadata);
    savedLocally = true;
  } catch (error) {
    console.warn('No se pudo guardar el modelo en IndexedDB; se usará solo durante esta sesión.', error);
  }

  return { model, metadata, failed: extraction.failed, savedLocally };
}

function createModel(classes: number): tf.Sequential {
  return tf.sequential({
    layers: [
      tf.layers.dense({ inputShape: [SINGLE_HAND_FEATURES], units: 128, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.2 }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dropout({ rate: 0.1 }),
      tf.layers.dense({ units: classes, activation: 'linear' }),
    ],
  });
}

/**
 * Entropía cruzada con softmax restringida al grupo de la etiqueta verdadera.
 * Las etiquetas objetivo solo tienen valores > 0 dentro de su grupo, así que el grupo se deduce de ellas.
 */
function groupSoftmaxCrossEntropy(yTrue: tf.Tensor, yPred: tf.Tensor): tf.Tensor {
  const outsideGroup = tf.sub(1, tf.cast(tf.greater(yTrue, 0), 'float32'));
  const maskedLogits = tf.add(yPred, tf.mul(outsideGroup, -1e4));
  return tf.losses.softmaxCrossEntropy(yTrue, maskedLogits);
}

function buildDataset(
  samples: ExtractedReference[],
  labels: string[],
  groups: Record<string, string>,
  perLabel: number,
  random: () => number,
  includeOriginals: boolean,
): Dataset {
  const count = labels.length * perLabel;
  const features = new Float32Array(count * SINGLE_HAND_FEATURES);
  const targets = new Float32Array(count * labels.length);
  const labelIndex = new Int32Array(count);
  let row = 0;

  for (const [index, label] of labels.entries()) {
    const sources = samples.filter(({ image }) => image.label === label).map(({ features: base }) => base);
    const target = smoothedTarget(index, labels, groups);
    for (let k = 0; k < perLabel; k += 1) {
      const base = sources[k % sources.length];
      const vector = includeOriginals && k < sources.length
        ? base
        : includeOriginals && k < sources.length * 2
          ? mirrorHand(base)
          : augmentHand(base, random);
      features.set(vector, row * SINGLE_HAND_FEATURES);
      targets.set(target, row * labels.length);
      labelIndex[row] = index;
      row += 1;
    }
  }
  return { features, targets, labelIndex, count };
}

/** One-hot suavizado únicamente dentro del grupo (letras o números). */
function smoothedTarget(index: number, labels: string[], groups: Record<string, string>): Float32Array {
  const target = new Float32Array(labels.length);
  const group = groups[labels[index]];
  const members = labels.map((label, i) => groups[label] === group ? i : -1).filter((i) => i >= 0);
  const share = members.length > 1 ? LABEL_SMOOTHING / members.length : 0;
  for (const member of members) target[member] = share;
  target[index] += members.length > 1 ? 1 - LABEL_SMOOTHING : 1;
  return target;
}

async function groupAccuracy(
  model: tf.LayersModel,
  inputs: tf.Tensor2D,
  labelIndex: Int32Array,
  labels: string[],
  groups: Record<string, string>,
): Promise<number> {
  const output = model.predict(inputs) as tf.Tensor;
  const logits = await output.data();
  output.dispose();
  let correct = 0;
  for (let row = 0; row < labelIndex.length; row += 1) {
    const truth = labelIndex[row];
    const group = groups[labels[truth]];
    let best = -1;
    let bestValue = -Infinity;
    for (let i = 0; i < labels.length; i += 1) {
      if (groups[labels[i]] !== group) continue;
      const value = logits[row * labels.length + i];
      if (value > bestValue) {
        best = i;
        bestValue = value;
      }
    }
    if (best === truth) correct += 1;
  }
  return labelIndex.length ? correct / labelIndex.length : 0;
}

function sortedLabels(samples: ExtractedReference[]): string[] {
  const unique = new Map<string, ReferenceGroup>();
  for (const { image } of samples) unique.set(image.label, image.group);
  return [...unique.entries()]
    .sort(([a, groupA], [b, groupB]) => GROUP_ORDER.indexOf(groupA) - GROUP_ORDER.indexOf(groupB) || compareLabels(a, b))
    .map(([label]) => label);
}

function formatLoss(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}
