import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export function drawHands(canvas: HTMLCanvasElement, video: HTMLVideoElement, hands: NormalizedLandmark[][]): void {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.lineWidth = Math.max(3, width / 240);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  hands.forEach((landmarks, handIndex) => {
    context.strokeStyle = handIndex === 0 ? '#46d9ff' : '#ffd166';
    context.fillStyle = handIndex === 0 ? '#e4faff' : '#fff2c2';

    CONNECTIONS.forEach(([from, to]) => {
      const a = landmarks[from];
      const b = landmarks[to];
      context.beginPath();
      context.moveTo(a.x * width, a.y * height);
      context.lineTo(b.x * width, b.y * height);
      context.stroke();
    });

    landmarks.forEach((point) => {
      context.beginPath();
      context.arc(point.x * width, point.y * height, Math.max(4, width / 180), 0, Math.PI * 2);
      context.fill();
    });
  });
}
