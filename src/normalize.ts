import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const WRIST = 0;
const MIDDLE_MCP = 9;

/**
 * Convierte una mano en 63 valores invariantes a traslación y escala.
 * La muñeca se usa como origen y la distancia muñeca-MCP medio como escala.
 */
export function normalizeHand(landmarks: NormalizedLandmark[]): number[] {
  if (landmarks.length !== 21) {
    throw new Error(`Se esperaban 21 landmarks y se recibieron ${landmarks.length}.`);
  }

  const origin = landmarks[WRIST];
  const scalePoint = landmarks[MIDDLE_MCP];
  const scale = Math.hypot(
    scalePoint.x - origin.x,
    scalePoint.y - origin.y,
    scalePoint.z - origin.z,
  ) || 1;

  return landmarks.flatMap((point) => [
    (point.x - origin.x) / scale,
    (point.y - origin.y) / scale,
    (point.z - origin.z) / scale,
  ]);
}

export function normalizeHands(hands: NormalizedLandmark[][]): number[] {
  const first = hands[0] ? normalizeHand(hands[0]) : new Array(63).fill(0);
  const second = hands[1] ? normalizeHand(hands[1]) : new Array(63).fill(0);
  return [...first, ...second];
}
