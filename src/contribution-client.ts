const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const QUEUE_KEY = 'senasv-contribution-queue-v1';
const PARTICIPANT_KEY = 'senasv-anonymous-participant-v1';
const CONSENT_VERSION = '2026-09-24';
const APP_VERSION = '0.1.0';

interface QueuedSample {
  label: string;
  features: number[];
  capturedAt: string;
}

export interface SyncResult {
  sent: number;
  pending: number;
  configured: boolean;
}

export function queueContribution(label: string, features: number[]): number {
  const queue = readQueue();
  queue.push({ label, features, capturedAt: new Date().toISOString() });
  const trimmed = queue.slice(-500);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  return trimmed.length;
}

export async function flushContributions(): Promise<SyncResult> {
  const queue = readQueue();
  if (!API_URL || queue.length === 0) return { sent: 0, pending: queue.length, configured: Boolean(API_URL) };
  const batch = queue.slice(0, 40);
  const response = await fetch(`${API_URL}/api/v1/contributions/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId: anonymousParticipantId(),
      consentVersion: CONSENT_VERSION,
      appVersion: APP_VERSION,
      samples: batch,
    }),
  });
  if (!response.ok) throw new Error(`El servidor rechazó el lote (${response.status}).`);
  const remaining = queue.slice(batch.length);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { sent: batch.length, pending: remaining.length, configured: true };
}

export function clearContributionQueue(): void {
  localStorage.removeItem(QUEUE_KEY);
  localStorage.removeItem(PARTICIPANT_KEY);
}

function readQueue(): QueuedSample[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as QueuedSample[] : [];
  } catch {
    return [];
  }
}

function anonymousParticipantId(): string {
  const existing = localStorage.getItem(PARTICIPANT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(PARTICIPANT_KEY, id);
  return id;
}
