import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type ViewName = 'inicio' | 'entrenamiento' | 'reconocimiento' | 'diccionario' | 'informacion';

export interface HandFrame {
  landmarks: NormalizedLandmark[][];
  handedness: string[];
  timestampMs: number;
}

export interface Prediction {
  label: string;
  confidence: number;
  accepted: boolean;
  inferenceMs: number;
  kind: 'integration-demo' | 'rule-based-pilot' | 'personal-model' | 'trained-model';
}

export interface RuntimeMetrics {
  frames: number;
  fps: number;
  detectionMs: number;
  backend: string;
  hands: number;
}
