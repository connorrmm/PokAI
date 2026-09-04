'use client';
/**
 * Record a scan, and a correction when the user overrules the scanner.
 *
 * Fire-and-forget by design. A scan that identified a card correctly must not
 * fail because history could not be written -- the user got their answer, and
 * bookkeeping is our problem, not theirs.
 */
import type { Session } from '@supabase/supabase-js';
import type { ApiCard } from './scanner/types';
import type { CardRead } from './scanner/vision-types';

export interface ScanLogInput {
  read: CardRead | null;
  confidence: number | null;
  autoAccepted: boolean;
  candidateCount: number | null;
  /** The card settled on, or null while unresolved. */
  card: ApiCard | null;
  /** What the scanner led with, when the user chose differently. */
  predicted: ApiCard | null;
  errorDetail?: string | null;
}

export async function logScan(session: Session | null, input: ScanLogInput): Promise<number | null> {
  const token = session?.access_token;
  if (!token) return null;  // Signed out: nothing to attach a scan to.
  try {
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        read: input.read
          ? { name: input.read.name, number: input.read.number, notes: input.read.notes }
          : null,
        confidence: input.confidence,
        autoAccepted: input.autoAccepted,
        candidateCount: input.candidateCount,
        cardId: input.card ? Number(input.card.id) : null,
        cardName: input.card?.name ?? null,
        cardSetName: input.card?.setName ?? null,
        cardNumber: input.card?.number ?? null,
        predictedCardId: input.predicted ? Number(input.predicted.id) : null,
        predictedCardName: input.predicted?.name ?? null,
        errorDetail: input.errorDetail ?? null,
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      // Silence here hid a 100% failure rate: every scan log was rejected by a
      // foreign key and nothing said so, because only thrown network errors
      // were logged. A discarded error response is an invisible outage.
      console.warn(
        'Could not record scan history:',
        json?.error?.message ?? `HTTP ${res.status}`,
      );
      return null;
    }
    return typeof json?.id === 'number' ? json.id : null;
  } catch (e) {
    console.warn('Could not record scan history:', e);
    return null;
  }
}
