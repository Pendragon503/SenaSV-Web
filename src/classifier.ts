import * as tf from '@tensorflow/tfjs';
import type { Prediction } from './types';

const MODEL_URL = '/model/model.json';
const DEMO_LABELS = ['MUESTRA A', 'MUESTRA B', 'MUESTRA C'];

export class SignClassifier {
  private model: tf.LayersModel | null = null;
  private labels = DEMO_LABELS;
  private trainedModelLoaded = false;

  async initialize(): Promise<void> {
    await tf.ready();

    try {
      const response = await fetch(MODEL_URL, { method: 'HEAD' });
      if (!response.ok) throw new Error('No hay modelo entrenado publicado.');
      this.model = await tf.loadLayersModel(MODEL_URL);
      const labelsResponse = await fetch('/model/labels.json');
      if (labelsResponse.ok) this.labels = await labelsResponse.json() as string[];
      this.trainedModelLoaded = true;
    } catch {
      this.model = this.createDeterministicIntegrationModel();
    }
  }

  get backend(): string {
    return tf.getBackend() || 'desconocido';
  }

  get isTrained(): boolean {
    return this.trainedModelLoaded;
  }

  predict(features: number[], threshold = 0.72): Prediction {
    if (!this.model) throw new Error('El clasificador aún no está inicializado.');

    const started = performance.now();
    const output = tf.tidy(() => {
      const input = tf.tensor2d([features], [1, features.length]);
      const prediction = this.model!.predict(input) as tf.Tensor;
      return Array.from(prediction.dataSync());
    });

    const bestIndex = output.indexOf(Math.max(...output));
    const confidence = output[bestIndex] ?? 0;
    return {
      label: this.labels[bestIndex] ?? 'DESCONOCIDA',
      confidence,
      accepted: this.trainedModelLoaded && confidence >= threshold,
      inferenceMs: performance.now() - started,
      kind: this.trainedModelLoaded ? 'trained-model' : 'integration-demo',
    };
  }

  private createDeterministicIntegrationModel(): tf.LayersModel {
    const model = tf.sequential({
      layers: [tf.layers.dense({ inputShape: [126], units: DEMO_LABELS.length, activation: 'softmax', useBias: true })],
    });

    const kernelValues = new Float32Array(126 * DEMO_LABELS.length);
    for (let i = 0; i < kernelValues.length; i += 1) {
      kernelValues[i] = Math.sin(i * 0.37) * 0.08;
    }
    const kernel = tf.tensor2d(kernelValues, [126, DEMO_LABELS.length]);
    const bias = tf.tensor1d([0.04, -0.02, 0.01]);
    model.setWeights([kernel, bias]);
    kernel.dispose();
    bias.dispose();
    return model;
  }
}
