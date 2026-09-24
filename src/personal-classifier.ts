import type { Prediction } from './types';

interface SampleStore {
  version: 1;
  samples: Record<string, number[][]>;
}

const STORAGE_KEY = 'senasv-personal-landmarks-v1';
const MAX_SAMPLES_PER_LABEL = 40;

export class PersonalClassifier {
  private samples: Record<string, number[][]> = {};

  constructor() {
    this.load();
  }

  add(label: string, features: number[]): number {
    const list = this.samples[label] ?? [];
    list.push(features);
    if (list.length > MAX_SAMPLES_PER_LABEL) list.shift();
    this.samples[label] = list;
    this.save();
    return list.length;
  }

  predict(features: number[], allowedLabels?: Set<string>): Prediction | null {
    const started = performance.now();
    const candidates = Object.entries(this.samples).filter(([label, values]) =>
      values.length >= 8 && (!allowedLabels || allowedLabels.has(label))
    );
    if (!candidates.length) return null;

    const ranked = candidates.map(([label, values]) => {
      const distances = values.map((sample) => euclidean(features, sample)).sort((a, b) => a - b);
      const nearest = distances.slice(0, Math.min(5, distances.length));
      return { label, distance: nearest.reduce((sum, value) => sum + value, 0) / nearest.length };
    }).sort((a, b) => a.distance - b.distance);

    const best = ranked[0];
    const second = ranked[1];
    const separation = second ? Math.max(0, (second.distance - best.distance) / Math.max(second.distance, 0.001)) : 0.5;
    const proximity = Math.max(0, 1 - best.distance / 5.5);
    const confidence = Math.min(0.99, proximity * 0.7 + separation * 0.3);
    return {
      label: best.label,
      confidence,
      accepted: confidence >= 0.62,
      inferenceMs: performance.now() - started,
      kind: 'personal-model',
    };
  }

  count(label: string): number {
    return this.samples[label]?.length ?? 0;
  }

  trainedLabels(): number {
    return Object.values(this.samples).filter((samples) => samples.length >= 8).length;
  }

  readyLabels(allowedLabels?: Set<string>): string[] {
    return Object.entries(this.samples)
      .filter(([label, samples]) => samples.length >= 8 && (!allowedLabels || allowedLabels.has(label)))
      .map(([label]) => label)
      .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  }

  totalSamples(): number {
    return Object.values(this.samples).reduce((sum, samples) => sum + samples.length, 0);
  }

  clear(label: string): void {
    delete this.samples[label];
    this.save();
  }

  clearAll(): void {
    this.samples = {};
    this.save();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SampleStore;
      if (parsed.version === 1 && parsed.samples) this.samples = parsed.samples;
    } catch {
      this.samples = {};
    }
  }

  private save(): void {
    const store: SampleStore = { version: 1, samples: this.samples };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }
}

function euclidean(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / Math.max(length, 1));
}
