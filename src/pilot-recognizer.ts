import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Prediction } from './types';

const TIP = [8, 12, 16, 20];
const PIP = [6, 10, 14, 18];

export class PilotRecognizer {
  private history: string[] = [];
  private lastStable = '';

  predict(hands: NormalizedLandmark[][]): Prediction | null {
    const started = performance.now();
    if (hands.length !== 1 || hands[0].length !== 21) {
      this.history = [];
      return null;
    }

    const landmarks = hands[0];
    const fingers = TIP.map((tip, index) => landmarks[tip].y < landmarks[PIP[index]].y - 0.025);
    const palmSize = distance(landmarks[0], landmarks[9]) || 0.1;
    const thumbOpen = distance(landmarks[4], landmarks[5]) > palmSize * 0.78;
    const thumbIndexTouch = distance(landmarks[4], landmarks[8]) < palmSize * 0.42;
    const extendedCount = fingers.filter(Boolean).length;

    let label = '';
    if (thumbIndexTouch && extendedCount <= 1) label = '0';
    else if (!thumbOpen && matches(fingers, [true, false, false, false])) label = '1';
    else if (!thumbOpen && matches(fingers, [true, true, false, false])) label = '2';
    else if (thumbOpen && matches(fingers, [true, true, false, false])) label = '3';
    else if (!thumbOpen && matches(fingers, [true, true, true, true])) label = '4';

    this.history.push(label || '?');
    if (this.history.length > 12) this.history.shift();
    const votes = label ? this.history.filter((value) => value === label).length : 0;
    const confidence = votes / 12;
    const stable = label !== '' && this.history.length === 12 && confidence >= 0.75;
    if (stable) this.lastStable = label;

    return {
      label: stable ? label : label ? `Analizando ${label}…` : 'Ajusta la mano',
      confidence,
      accepted: stable,
      inferenceMs: performance.now() - started,
      kind: 'rule-based-pilot',
    };
  }

  reset(): void {
    this.history = [];
    this.lastStable = '';
  }

  get stableLabel(): string {
    return this.lastStable;
  }
}

function matches(actual: boolean[], expected: boolean[]): boolean {
  return actual.every((value, index) => value === expected[index]);
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
