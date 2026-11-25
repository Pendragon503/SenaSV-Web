import type * as tf from '@tensorflow/tfjs';

/**
 * - `legacy-two-hands-v1`: 126 valores de `normalizeHands` (contrato original de public/model).
 * - `metric-single-hand-v1`: 63 valores de `metricHandFeatures`, corrigiendo la relación de aspecto.
 */
export type FeatureFormat = 'legacy-two-hands-v1' | 'metric-single-hand-v1';

export interface SenaModelMetadata {
  schema: 'senasv-model-v1';
  labels: string[];
  /** Grupo de cada etiqueta; la softmax se calcula solo dentro del grupo activo. */
  groups: Record<string, string>;
  features: FeatureFormat;
  /** `logits` si la última capa es lineal; `probabilities` si ya aplica softmax. */
  output: 'logits' | 'probabilities';
  datasetVersion?: string;
  trainedAt?: string;
  referenceImages?: number;
  skippedImages?: string[];
  augmentedSamplesPerLabel?: number;
  epochs?: number;
  validationAccuracy?: number;
}

const STORAGE_KEY = 'senasv-image-model-metadata-v1';

export function attachMetadata(model: tf.LayersModel, metadata: SenaModelMetadata): void {
  model.setUserDefinedMetadata({ senasv: metadata });
}

export function readEmbeddedMetadata(model: tf.LayersModel): SenaModelMetadata | null {
  const embedded = model.getUserDefinedMetadata() as { senasv?: unknown } | undefined;
  return isMetadata(embedded?.senasv) ? embedded.senasv : null;
}

export function storeLocalMetadata(metadata: SenaModelMetadata): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // Almacenamiento no disponible (modo privado o cuota llena); el modelo sigue siendo útil en la sesión.
  }
}

export function readLocalMetadata(): SenaModelMetadata | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return isMetadata(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isMetadata(value: unknown): value is SenaModelMetadata {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SenaModelMetadata>;
  return candidate.schema === 'senasv-model-v1'
    && Array.isArray(candidate.labels)
    && candidate.labels.every((label) => typeof label === 'string')
    && (candidate.features === 'legacy-two-hands-v1' || candidate.features === 'metric-single-hand-v1')
    && (candidate.output === 'logits' || candidate.output === 'probabilities')
    && typeof candidate.groups === 'object' && candidate.groups !== null;
}
