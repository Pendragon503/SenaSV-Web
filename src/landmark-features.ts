import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** 21 puntos × 3 coordenadas de una sola mano. */
export const SINGLE_HAND_FEATURES = 63;

export type Point3 = [number, number, number];

/**
 * MediaPipe entrega x normalizada por el ancho, y por el alto y z con una escala similar a x.
 * Para que una fotografía cuadrada y una cámara 16:9 produzcan la misma forma de mano,
 * se vuelve a un espacio proporcional en píxeles antes de normalizar.
 */
export function toPixelSpace(hand: NormalizedLandmark[], width: number, height: number): Point3[] {
  return hand.map((point) => [point.x * width, point.y * height, point.z * width]);
}

/**
 * Origen en la muñeca y escala igual al tamaño medio de la palma.
 * Resultado invariante a traslación, tamaño de la mano y relación de aspecto de la cámara.
 */
export function normalizePoints(points: Point3[]): number[] {
  if (points.length !== 21) {
    throw new Error(`Se esperaban 21 landmarks y se recibieron ${points.length}.`);
  }
  const [ox, oy, oz] = points[0];
  const centered: Point3[] = points.map(([x, y, z]) => [x - ox, y - oy, z - oz]);
  const scale = (
    length(centered[5])
    + length(centered[9])
    + length(centered[17])
    + length(subtract(centered[5], centered[17]))
  ) / 4 || 1;
  return centered.flatMap(([x, y, z]) => [x / scale, y / scale, z / scale]);
}

/** Elige la mano con mayor área visible; las señas del modelo de imágenes usan una sola mano. */
export function selectPrimaryHand(hands: NormalizedLandmark[][], width: number, height: number): Point3[] | null {
  let best: Point3[] | null = null;
  let bestArea = -1;
  for (const hand of hands) {
    if (hand.length !== 21) continue;
    const points = toPixelSpace(hand, width, height);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) {
      best = points;
      bestArea = area;
    }
  }
  return best;
}

/** Vector de 63 valores para el modelo entrenado con imágenes (`metric-single-hand-v1`). */
export function metricHandFeatures(hands: NormalizedLandmark[][], width: number, height: number): number[] | null {
  if (!width || !height) return null;
  const points = selectPrimaryHand(hands, width, height);
  return points ? normalizePoints(points) : null;
}

export function featuresToPoints(features: number[]): Point3[] {
  const points: Point3[] = [];
  for (let i = 0; i < 21; i += 1) points.push([features[i * 3], features[i * 3 + 1], features[i * 3 + 2]]);
  return points;
}

function length([x, y, z]: Point3): number {
  return Math.hypot(x, y, z);
}

function subtract(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
