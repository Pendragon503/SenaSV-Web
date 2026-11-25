import { featuresToPoints, normalizePoints, type Point3 } from './landmark-features';

/**
 * Aumento de datos sobre landmarks normalizados.
 *
 * Con pocas fotografías por clase, el modelo aprende de variaciones sintéticas plausibles:
 * giros de muñeca, inclinación respecto a la cámara, apertura de dedos, proporciones de mano,
 * ruido del detector y mano izquierda/derecha (espejo).
 */

const FINGER_CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export interface AugmentationLimits {
  rollDegrees: number;
  pitchDegrees: number;
  yawDegrees: number;
  fingerSpreadDegrees: number;
  scaleXY: number;
  scaleZ: number;
  jitterXY: number;
  jitterZ: number;
  mirrorProbability: number;
}

export const DEFAULT_AUGMENTATION: AugmentationLimits = {
  rollDegrees: 22,
  pitchDegrees: 18,
  yawDegrees: 25,
  fingerSpreadDegrees: 7,
  scaleXY: 0.1,
  scaleZ: 0.3,
  jitterXY: 0.03,
  jitterZ: 0.06,
  mirrorProbability: 0.5,
};

/** Generador determinista (mulberry32) para que el entrenamiento sea reproducible. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function augmentHand(
  features: number[],
  random: () => number,
  limits: AugmentationLimits = DEFAULT_AUGMENTATION,
): number[] {
  let points = featuresToPoints(features);

  // Apertura de cada dedo alrededor de su articulación base (plano de la imagen).
  for (const chain of FINGER_CHAINS) {
    const angle = radians(uniform(random, limits.fingerSpreadDegrees));
    const [bx, by] = points[chain[0]];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const index of chain.slice(1)) {
      const [x, y, z] = points[index];
      const dx = x - bx;
      const dy = y - by;
      points[index] = [bx + dx * cos - dy * sin, by + dx * sin + dy * cos, z];
    }
  }

  // Proporciones de la mano y profundidad estimada.
  const sx = 1 + uniform(random, limits.scaleXY);
  const sy = 1 + uniform(random, limits.scaleXY);
  const sz = 1 + uniform(random, limits.scaleZ);
  points = points.map(([x, y, z]) => [x * sx, y * sy, z * sz]);

  // Rotación 3D alrededor de la muñeca: roll (plano), pitch (inclinación) y yaw (giro).
  const rotation = rotationMatrix(
    radians(uniform(random, limits.rollDegrees)),
    radians(uniform(random, limits.pitchDegrees)),
    radians(uniform(random, limits.yawDegrees)),
  );
  points = points.map((point) => multiply(rotation, point));

  // Ruido del detector.
  points = points.map(([x, y, z], index) => index === 0
    ? [x, y, z]
    : [
      x + gaussian(random) * limits.jitterXY,
      y + gaussian(random) * limits.jitterXY,
      z + gaussian(random) * limits.jitterZ,
    ]);

  // Mano contraria o cámara espejada.
  if (random() < limits.mirrorProbability) points = points.map(([x, y, z]) => [-x, y, z]);

  return normalizePoints(points);
}

export function mirrorHand(features: number[]): number[] {
  return normalizePoints(featuresToPoints(features).map(([x, y, z]) => [-x, y, z]));
}

function uniform(random: () => number, magnitude: number): number {
  return (random() * 2 - 1) * magnitude;
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

type Matrix3 = [Point3, Point3, Point3];

function rotationMatrix(roll: number, pitch: number, yaw: number): Matrix3 {
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  const rz: Matrix3 = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const rx: Matrix3 = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const ry: Matrix3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  return compose(rz, compose(ry, rx));
}

function compose(a: Matrix3, b: Matrix3): Matrix3 {
  const result: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      result[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
    }
  }
  return result;
}

function multiply(matrix: Matrix3, [x, y, z]: Point3): Point3 {
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
    matrix[2][0] * x + matrix[2][1] * y + matrix[2][2] * z,
  ];
}
