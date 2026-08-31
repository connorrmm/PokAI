'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { identifyCard } from '@/lib/scanner/identify';
import { warmUpOcr } from '@/lib/scanner/ocr-client';
import type { ApiCard, IdentifyOutcome } from '@/lib/scanner/types';

type Phase = 'idle' | 'camera' | 'working' | 'result';

/** Format a price honestly, or say plainly that it is unavailable.
 *  Never invent, estimate, or fall back to a stale number (rule 2). */
function priceLabel(c: ApiCard): string {
  return typeof c.marketPrice === 'number' ? `$${c.marketPrice.toFixed(2)}` : 'Value unavailable';
}

/** Show WHEN a price was true, not just what it was. */
function priceAge(c: ApiCard): string | null {
  if (!c.priceUpdatedAt) return null;
  const then = new Date(c.priceUpdatedAt).getTime();
  if (Number.isNaN(then)) return null;
  const hours = Math.round((Date.now() - then) / 3_600_000);
  if (hours < 1) return 'updated just now';
  if (hours < 24) return `updated ${hours}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<IdentifyOutcome | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  // Warm the OCR engine at load: it downloads several MB, and without this the
  // first scan looks like a hang rather than a download.
  useEffect(() => { warmUpOcr(); }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      setPhase('camera');
      // Wait for React to render the <video> before attaching.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (e) {
      // Show the real reason: denied, no camera, or insecure context are very
      // different problems and the user can only act if told which.
      setError(
        e instanceof Error
          ? `Camera unavailable: ${e.message}`
          : 'Camera unavailable for an unknown reason',
      );
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const full = canvas.toDataURL('image/jpeg', 0.92);
    setPhoto(full);
    stopCamera();
    setPhase('working');
    setStatus('Reading card…');

    try {
      const result = await identifyCard({ cardPhoto: full, fullFrame: full });
      setOutcome(result);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('result');
    }
  }

  function reset() {
    setOutcome(null); setPhoto(null); setError(null); setPhase('idle');
  }

  return (
    <div>
      {error && (
        <div style={{
          background: 'rgba(232,72,58,0.12)', border: '1px solid rgba(232,72,58,0.4)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 14,
        }}>
          {/* The real error text, deliberately. Rule 4. */}
          <strong style={{ color: '#E8483A' }}>Something went wrong</strong>
          <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.85, marginTop: 6, wordBreak: 'break-word' }}>
            {error}
          </div>
        </div>
      )}

      {phase === 'idle' && (
        <button onClick={startCamera} style={btn}>Scan a card</button>
      )}

      {phase === 'camera' && (
        <div>
          <video ref={videoRef} playsInline muted style={{
            width: '100%', borderRadius: 12, background: '#000', aspectRatio: '3/4', objectFit: 'cover',
          }} />
          <button onClick={capture} style={{ ...btn, marginTop: 12 }}>Capture</button>
          <button onClick={() => { stopCamera(); setPhase('idle'); }} style={ghost}>Cancel</button>
        </div>
      )}

      {phase === 'working' && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>{status}</div>
      )}

      {phase === 'result' && outcome && (
        <ResultView outcome={outcome} photo={photo} onRetake={reset} />
      )}
    </div>
  );
}

function ResultView({ outcome, photo, onRetake }: {
  outcome: IdentifyOutcome; photo: string | null; onRetake: () => void;
}) {
  if (outcome.ok) {
    const c = outcome.apiCard;
    return (
      <div>
        <div style={{ color: '#2FD9A0', fontSize: 13, marginBottom: 8 }}>
          Identified · {outcome.confidence}% confidence
        </div>
        <CardRow card={c} />
        <button onClick={onRetake} style={{ ...btn, marginTop: 16 }}>Scan another</button>
      </div>
    );
  }

  // Everything below is the never-guess path. It must always offer a way
  // forward: candidates when we have them, and never a bare dead end.
  const candidates = 'candidates' in outcome ? outcome.candidates ?? [] : [];
  const detail = 'errorDetail' in outcome ? outcome.errorDetail : null;
  const confidence = 'confidence' in outcome ? outcome.confidence : null;

  const heading = (() => {
    switch (outcome.reason) {
      case 'ambiguous':
        return `Found ${candidates.length} cards matching “${outcome.text}”${
          confidence != null ? ` (${confidence}% confidence)` : ''
        } — tap the one that matches your photo.`;
      case 'low_confidence':
        return `Not confident about “${outcome.text}”${
          confidence != null ? ` (${confidence}% confidence)` : ''
        } — tap your card below, or retake the photo with better lighting.`;
      case 'no_text':
        return 'Could not read any text on that card. Try again with better lighting, or search manually.';
      case 'no_match':
        return `Read “${outcome.text}” but found no matching card. Try searching manually.`;
      case 'ocr_unavailable':
        return 'Could not load the recognition engine (offline?). Search for the card manually.';
      default:
        return 'Something went wrong while scanning — not just a low-confidence read.';
    }
  })();

  return (
    <div>
      {photo && (
        <img src={photo} alt="Your scan" style={{ width: 120, borderRadius: 8, marginBottom: 12 }} />
      )}
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>{heading}</p>
      {detail && (
        <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.75, marginBottom: 12, wordBreak: 'break-word' }}>
          {detail}
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          {candidates.map((c) => <CardRow key={String(c.id)} card={c} />)}
        </div>
      )}

      <button onClick={onRetake} style={{ ...btn, marginTop: 16 }}>Retake photo</button>
    </div>
  );
}

function CardRow({ card }: { card: ApiCard }) {
  const age = priceAge(card);
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', padding: 10,
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
    }}>
      {card.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" width={44} height={60}
             style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{card.name}</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          {[card.setName, card.number, card.rarity].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{priceLabel(card)}</div>
        {/* Where the number came from and when, per docs/PRODUCT.md transparency. */}
        {age && <div style={{ color: 'var(--muted)', fontSize: 11 }}>{age}</div>}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
  background: 'var(--accent)', color: '#04121F', fontWeight: 700, fontSize: 15, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  width: '100%', padding: '10px 16px', borderRadius: 10, marginTop: 8,
  background: 'transparent', color: 'var(--muted)',
  border: '1px solid var(--border)', fontSize: 14, cursor: 'pointer',
};
