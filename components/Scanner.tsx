'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { identifyCard } from '@/lib/scanner/identify';
import { identifyWithVision } from '@/lib/scanner/identify-vision';
import type { CardRead } from '@/lib/scanner/vision-types';
import { warmUpOcr } from '@/lib/scanner/ocr-client';
import type { ApiCard, IdentifyResult, ScanDiagnostics } from '@/lib/scanner/types';

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
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** A degraded-but-working state is NOT an error. Showing "Something went
   *  wrong" in red for a fallback made a working scan look broken. */
  const [notice, setNotice] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<IdentifyResult | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [vision, setVision] = useState<CardRead | null>(null);

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

  /**
   * Map the on-screen guide rectangle to native video pixels, accounting for
   * object-fit: cover scaling.
   *
   * This is why scanning works at all. OCR crops the top ~24% of the image
   * looking for the card's name. If we hand it the whole camera frame, that
   * top 24% is ceiling and wall, not the card -- so it reads nothing no matter
   * how good the photo is. Cropping to the guide first is what puts the name
   * where the reader expects it.
   */
  function getGuideVideoRect(): { x: number; y: number; w: number; h: number } | null {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide || !video.videoWidth || !video.videoHeight) return null;

    const videoBox = video.getBoundingClientRect();
    const guideBox = guide.getBoundingClientRect();
    if (videoBox.width === 0 || videoBox.height === 0) return null;

    const coverScale = Math.max(videoBox.width / video.videoWidth, videoBox.height / video.videoHeight);
    const renderedW = video.videoWidth * coverScale;
    const renderedH = video.videoHeight * coverScale;
    const cropOffsetX = (renderedW - videoBox.width) / 2;
    const cropOffsetY = (renderedH - videoBox.height) / 2;

    // Pad outward before mapping. Real-world alignment is never pixel-perfect,
    // and a tight crop that clips the TOP edge cuts the name off before OCR
    // ever sees it -- the one failure that cannot be recovered from.
    const PAD = 0.22;
    const padX = guideBox.width * PAD, padY = guideBox.height * PAD;
    const guideDisplayX = (guideBox.left - videoBox.left) - padX;
    const guideDisplayY = (guideBox.top - videoBox.top) - padY;
    const guideW = guideBox.width + padX * 2, guideH = guideBox.height + padY * 2;

    const srcX = Math.max(0, (guideDisplayX + cropOffsetX) / coverScale);
    const srcY = Math.max(0, (guideDisplayY + cropOffsetY) / coverScale);
    const srcW = Math.min(video.videoWidth - srcX, guideW / coverScale);
    const srcH = Math.min(video.videoHeight - srcY, guideH / coverScale);
    if (srcW < 20 || srcH < 20) return null;
    return { x: srcX, y: srcY, w: srcW, h: srcH };
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    // The full frame, kept as a safety net: if the guided crop itself was
    // misaligned, OCR retries against this.
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    fullCanvas.getContext('2d')?.drawImage(video, 0, 0);
    const full = fullCanvas.toDataURL('image/jpeg', 0.92);

    // The guided crop: just the card, background removed.
    let cardPhoto = full;
    try {
      const r = getGuideVideoRect();
      if (r) {
        const c = document.createElement('canvas');
        c.width = r.w; c.height = r.h;
        c.getContext('2d')?.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
        cardPhoto = c.toDataURL('image/jpeg', 0.92);
      }
    } catch (e) {
      console.warn('Guided crop failed, using full frame:', e);
    }

    stopCamera();
    await run(cardPhoto, full);
  }

  /**
   * Shared path for a camera capture and an uploaded photo.
   *
   * Vision first, OCR as fallback. Real user photos are blurry, glared and
   * tilted; a vision model reads them the way a person does, where letter-shape
   * OCR simply has nothing to match. OCR is kept as a safety net for when the
   * vision service is unreachable -- degraded recognition beats none.
   */
  async function run(cardPhoto: string, fullFrame?: string | null) {
    setPhoto(cardPhoto);
    setVision(null);
    setNotice(null);
    setError(null);
    setPhase('working');
    setStatus('Reading card…');

    try {
      const { result, vision: v } = await identifyWithVision(cardPhoto);
      setVision(v);
      setOutcome(result);
      setPhase('result');
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Vision identification unavailable, falling back to OCR:', msg);
      setStatus('Vision unavailable — trying on-device reading…');
      try {
        const result = await identifyCard({ cardPhoto, fullFrame: fullFrame ?? cardPhoto });
        setOutcome(result);
        setPhase('result');
        // Surface why the better path was skipped, rather than silently
        // serving worse results and letting it look like poor accuracy.
        // A NOTICE, not an error: the scan ran, just with the weaker reader.
        setNotice(
          msg.includes('ANTHROPIC_API_KEY')
            // The validation messages in lib/vision.ts are already written for
            // a human, so pass them through rather than burying them.
            ? `Scanned with the older on-device reader, which struggles with real photos. ${msg}`
            : `Scanned with the older on-device reader because the vision service was unavailable: ${msg}`,
        );
        return;
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : String(e2));
        setPhase('result');
      }
    }
  }

  /**
   * Upload an existing photo instead of using the camera.
   *
   * Deliberately not a convenience feature. It makes a scan REPEATABLE: the
   * same image can be run against the same build twice, and against the next
   * build after a change. With the camera alone every test is a different
   * photo, so an improvement and a lucky shot look identical.
   */
  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => { void run(String(reader.result)); };
    reader.onerror = () => setError(`Could not read that file: ${reader.error?.message ?? 'unknown error'}`);
    reader.readAsDataURL(file);
  }

  function reset() {
    setOutcome(null); setPhoto(null); setError(null); setNotice(null);
    setVision(null); setPhase('idle');
  }

  return (
    <div>
      {notice && (
        <div style={{
          background: 'rgba(255,194,77,0.10)', border: '1px solid rgba(255,194,77,0.35)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.5,
        }}>
          <strong style={{ color: '#FFC24D' }}>Reduced accuracy</strong>
          <div style={{ marginTop: 6, opacity: 0.9 }}>{notice}</div>
        </div>
      )}

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
        <div>
          <button onClick={startCamera} style={btn}>Scan a card</button>
          <label style={{ ...ghost, display: 'block', textAlign: 'center' }}>
            Or upload a photo
            <input type="file" accept="image/*" onChange={onUpload} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {phase === 'camera' && (
        <div>
          <div style={{ position: 'relative' }}>
            <video ref={videoRef} playsInline muted style={{
              width: '100%', borderRadius: 12, background: '#000',
              aspectRatio: '3/4', objectFit: 'cover', display: 'block',
            }} />
            {/* The card guide. Not decoration -- the capture is cropped to it,
                which is what lets OCR find the name. */}
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            }}>
              <div ref={guideRef} style={{
                width: '62%', aspectRatio: '63/88',
                border: '3px solid rgba(57,169,255,0.9)', borderRadius: 12,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
              }} />
            </div>
            <div style={{
              position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center',
              fontSize: 13, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.8)', pointerEvents: 'none',
            }}>
              Fill the frame with the card
            </div>
          </div>
          <button onClick={capture} style={{ ...btn, marginTop: 12 }}>Capture</button>
          <button onClick={() => { stopCamera(); setPhase('idle'); }} style={ghost}>Cancel</button>
        </div>
      )}

      {phase === 'working' && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>{status}</div>
      )}

      {phase === 'result' && outcome && (
        <ResultView outcome={outcome} photo={photo} vision={vision} onRetake={reset} />
      )}
    </div>
  );
}

function ResultView({ outcome, photo, vision, onRetake }: {
  outcome: IdentifyResult; photo: string | null; vision: CardRead | null; onRetake: () => void;
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
        <Diagnostics d={outcome.diagnostics} vision={vision} />
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
      default: {
        // A missing server key is a setup problem, not a scanning problem.
        // Saying so plainly saves whoever is testing from chasing the camera
        // or the photo when the real fault is one unset config value.
        if (detail && detail.includes('TCGAPI_KEY')) {
          return 'The card database is not configured on the server yet, so this scan could not look anything up. '
            + 'Set TCGAPI_KEY in the hosting environment variables and redeploy. '
            + 'Nothing is wrong with your photo or the camera.';
        }
        return 'Something went wrong while scanning — not just a low-confidence read.';
      }
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
      <Diagnostics d={outcome.diagnostics} vision={vision} />
    </div>
  );
}

/**
 * What the scanner actually saw.
 *
 * Every failure this project has hit was diagnosed by guesswork, because a
 * failed scan reported only that it failed. "OCR read nothing", "OCR read
 * FIREBREATHER instead of Charizard" and "read it correctly but 6 prints tied"
 * are three different bugs with three different fixes, and they look identical
 * from the outside.
 */
function Diagnostics({ d, vision }: { d?: ScanDiagnostics; vision?: CardRead | null }) {
  if (!d) return null;
  const rows: Array<[string, string]> = [
    ...(vision ? ([
      ['Read by', d.ocrStrategy?.startsWith('vision') ? 'AI vision model' : 'On-device OCR'],
      ['How legible the card was', vision.legibility],
      ['Model certainty of the name', `${vision.confidence}%`],
      ['Set read', vision.set_name ?? '(not readable)'],
      ['Rarity read', vision.rarity ?? '(not readable)'],
      ...(vision.alternate_names.length
        ? ([['Other possible names', vision.alternate_names.join(', ')]] as Array<[string, string]>) : []),
      ...(vision.notes ? ([['Model notes', vision.notes]] as Array<[string, string]>) : []),
    ] as Array<[string, string]>) : []),
    ['Name read from the card', d.ocrText ? `"${d.ocrText}"` : '(nothing readable)'],
    ...(vision ? [] : ([['Which crop worked', d.ocrStrategy ?? '(none succeeded)']] as Array<[string, string]>)),
    ['Card number read', d.numberText ? `"${d.numberText.replace(/\s+/g, ' ').trim()}"` : '(not read)'],
    ['Cards found in database', String(d.candidatesFound)],
    ['Best match', d.topName ? `${d.topName} (name score ${d.topScore})` : '(none)'],
    ['Score needed to auto-accept', d.autoAcceptFloor != null ? String(d.autoAcceptFloor) : '—'],
    ['Time taken', `${(d.elapsedMs / 1000).toFixed(1)}s`],
  ];
  return (
    <details style={{ marginTop: 16, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
        What the scanner saw
      </summary>
      <div style={{
        marginTop: 8, padding: 12, background: 'var(--panel)',
        border: '1px solid var(--border)', borderRadius: 8,
      }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
            <span style={{ color: 'var(--muted)', flex: '0 0 46%' }}>{k}</span>
            <span style={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>{v}</span>
          </div>
        ))}
      </div>
    </details>
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
