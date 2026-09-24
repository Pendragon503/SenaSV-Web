import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Prediction } from './types';

const FINGERS = [
  { mcp: 5, pip: 6, tip: 8 },
  { mcp: 9, pip: 10, tip: 12 },
  { mcp: 13, pip: 14, tip: 16 },
  { mcp: 17, pip: 18, tip: 20 },
];

export const DEFAULT_ALPHABET_LABELS = ['A', 'B', 'D', 'F', 'G', 'H', 'I', 'L', 'U', 'V', 'W', 'Y'];

export class AlphabetRecognizer {
  private history: string[] = [];

  predict(hands: NormalizedLandmark[][]): Prediction | null {
    const started = performance.now();
    if (hands.length !== 1 || hands[0].length !== 21) {
      this.history = [];
      return null;
    }

    const hand = hands[0];
    const palm = distance(hand[0], hand[9]) || 0.1;
    const straight = FINGERS.map(({ mcp, pip, tip }) =>
      distance(hand[mcp], hand[tip]) > distance(hand[mcp], hand[pip]) * 1.55
    );
    const thumbOpen = distance(hand[4], hand[5]) > palm * 0.78;
    const pinch = distance(hand[4], hand[8]) < palm * 0.42;
    const indexMiddleGap = distance(hand[8], hand[12]) / palm;
    const horizontal = Math.abs(hand[9].x - hand[0].x) > Math.abs(hand[9].y - hand[0].y) * 0.85;

    let label = '';
    if (matches(straight, [false, false, false, false]) && thumbOpen && !pinch) label = 'A';
    else if (matches(straight, [true, true, true, true]) && !thumbOpen) label = 'B';
    else if (matches(straight, [true, false, false, false]) && pinch) label = 'D';
    else if (matches(straight, [false, true, true, true]) && pinch) label = 'F';
    else if (matches(straight, [true, false, false, false]) && thumbOpen && horizontal) label = 'G';
    else if (matches(straight, [true, true, false, false]) && !thumbOpen && horizontal) label = 'H';
    else if (matches(straight, [false, false, false, true]) && !thumbOpen) label = 'I';
    else if (matches(straight, [true, false, false, false]) && thumbOpen && !horizontal) label = 'L';
    else if (matches(straight, [true, true, false, false]) && !thumbOpen && !horizontal && indexMiddleGap < 0.62) label = 'U';
    else if (matches(straight, [true, true, false, false]) && !thumbOpen && !horizontal && indexMiddleGap >= 0.62) label = 'V';
    else if (matches(straight, [true, true, true, false]) && !thumbOpen) label = 'W';
    else if (matches(straight, [false, false, false, true]) && thumbOpen) label = 'Y';

    this.history.push(label || '?');
    if (this.history.length > 12) this.history.shift();
    const votes = label ? this.history.filter((value) => value === label).length : 0;
    const confidence = votes / 12;
    const accepted = label !== '' && this.history.length === 12 && confidence >= 0.75;

    return {
      label: accepted ? label : label ? `Analizando ${label}…` : 'Ajusta la configuración',
      confidence,
      accepted,
      inferenceMs: performance.now() - started,
      kind: 'rule-based-pilot',
    };
  }

  reset(): void {
    this.history = [];
  }
}

function matches(actual: boolean[], expected: boolean[]): boolean {
  return actual.every((value, index) => value === expected[index]);
}

function distance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
