'use client';
/**
 * Browser-side OCR pipeline. Ported from the prototype.
 *
 * Every failure mode handled here was found the hard way against real cards and
 * real phones -- docs/SCANNER.md has the full account. The short version:
 *
 *  - The worker downloads several MB on first use, so it is warmed at page load
 *    and the UI says "first scan only". Without that, the first scan looks like
 *    a hang.
 *  - A single crop is not enough. Cards vary in framing across 25+ years of
 *    layouts, so multiple crop fractions, an inverted-polarity retry for dark
 *    and holo cards, and a full-frame fallback each rescued reads that one
 *    attempt missed.
 *  - Every async step needs a hard timeout. The original pipeline could hang
 *    forever with no message, which was the single most trust-destroying bug
 *    in the project: it looked broken rather than slow.
 */
import { otsuThreshold, percentileRange, toGray } from './image';

let workerPromise: Promise<any> | null = null;
let ocrEngineReady = false;
let ocrFailure: string | null = null;

export function isOcrReady(): boolean { return ocrEngineReady; }
/** The real reason OCR is unavailable, for showing the user (rule 4). */
export function ocrFailureReason(): string | null { return ocrFailure; }

/**
 * Tesseract fetches its worker script, WASM core and language data at runtime.
 * Pinned to exact versions here so a CDN-side release cannot silently change
 * recognition behaviour underneath us -- the scanner's accuracy is the product.
 *
 * KNOWN RISK, not yet fixed: this makes the core product function depend on a
 * third-party CDN being reachable. Blocked networks, strict corporate proxies
 * and CDN outages all break scanning. Self-hosting is the fix and costs roughly
 * 15 MB of engine plus language data in the repo; it is a deliberate
 * pre-launch task rather than something to slip in unmeasured.
 * Tracked in docs/ROADMAP.md Phase 4.
 */
const TESS_VERSION = '5.1.1';
const TESS_CDN = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist`;
const TESS_CORE_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1';
const TESS_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0';

/** Race a promise against a hard limit, turning a silent hang into a real error. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    Promise.resolve(p).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function getWorker(): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) =>
        createWorker('eng', undefined, {
          workerPath: `${TESS_CDN}/worker.min.js`,
          corePath: TESS_CORE_CDN,
          langPath: TESS_LANG_CDN,
        }),
      )
      .then(async (worker: any) => {
        // Restricting the character set stops Tesseract hallucinating symbols
        // on foil and textured backgrounds, which otherwise pollute matching.
        // PSM 7 = "a single line of text": the cropped name strip IS one line,
        // and saying so beats letting it guess a page layout.
        await worker.setParameters({
          tessedit_char_whitelist:
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 &'-.",
          tessedit_pageseg_mode: '7',
        });
        ocrEngineReady = true;
        return worker;
      })
      .catch((e) => {
        // Surface the REAL reason. "Recognition unavailable" with no cause is
        // exactly what made this app undebuggable in the field (rule 4).
        ocrFailure = e instanceof Error ? e.message : String(e);
        console.warn('OCR engine failed to initialise:', e);
        workerPromise = null;
        return null;
      });
  }
  return workerPromise;
}

/**
 * Warm the engine at page load so the first scan does not look like a hang.
 * The worker downloads several MB on first use.
 *
 * Failures are swallowed deliberately: this is speculative work, and a
 * warm-up failure must never surface as an error the user did not ask for.
 * The reason is recorded and shown only if they actually try to scan.
 */
export function warmUpOcr(): void {
  void getWorker().catch(() => {});
}

/**
 * Crop a horizontal strip and binarise it for OCR.
 * grayscale -> percentile contrast clip -> Otsu binarisation.
 * `invert` flips which side becomes ink: light text on a dark background
 * (common on foil prints) binarises backwards otherwise and reads as noise.
 */
export function cropStrip(
  dataUrl: string, fraction: number, invert = false, fromBottom = false,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const h = Math.max(1, Math.round(img.height * fraction));
      const srcY = fromBottom ? Math.max(0, img.height - h) : 0;
      // Small print benefits a lot from extra pixels.
      const scale = img.width < 700 ? 3 : 2;
      const c = document.createElement('canvas');
      c.width = img.width * scale;
      c.height = h * scale;
      const ctx = c.getContext('2d');
      if (!ctx) { resolve(dataUrl); return; }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, srcY, img.width, h, 0, 0, c.width, c.height);

      try {
        const imgData = ctx.getImageData(0, 0, c.width, c.height);
        const d = imgData.data;
        const n = d.length / 4;
        const gray = new Uint8ClampedArray(n);
        const hist = new Array(256).fill(0);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const g = toGray(d[i], d[i + 1], d[i + 2]);
          gray[p] = g; hist[g]++;
        }
        const { lo, hi } = percentileRange(hist, n, 0.02);
        const range = Math.max(1, hi - lo);
        const stretched = new Uint8ClampedArray(n);
        const sHist = new Array(256).fill(0);
        for (let p = 0; p < n; p++) {
          const s = Math.round(((gray[p] - lo) / range) * 255);
          stretched[p] = s; sHist[s]++;
        }
        const thresh = otsuThreshold(sHist, n);
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          let bw = stretched[p] >= thresh ? 255 : 0;
          if (invert) bw = 255 - bw;
          d[i] = d[i + 1] = d[i + 2] = bw;
        }
        ctx.putImageData(imgData, 0, 0);
      } catch (e) {
        // Canvas taint or similar. Preprocessing is an optimisation, not a
        // requirement -- fall through with the unprocessed crop.
        console.warn('OCR preprocessing skipped:', e);
      }
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/** An 8x8 average hash: a cheap fingerprint tolerant of resizing/compression. */
export function computeImageHash(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = 8; c.height = 8;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, 8, 8);
        // Throws on a tainted canvas (cross-origin card art). That is a benign
        // failure and must surface as "signal unavailable", never as a
        // mismatch -- see docs/SCANNER.md.
        const d = ctx.getImageData(0, 0, 8, 8).data;
        const px: number[] = [];
        for (let i = 0; i < d.length; i += 4) px.push(toGray(d[i], d[i + 1], d[i + 2]));
        const avg = px.reduce((a, b) => a + b, 0) / px.length;
        resolve(px.map((p) => (p >= avg ? '1' : '0')).join(''));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface OcrRead { text: string; strategy: string }

/**
 * Read the card's name strip.
 * Two crop fractions, then an inverted-polarity pass, then the full uncropped
 * frame as a last resort -- a real hedge against the guided crop itself being
 * misaligned, not just a retry of the same region.
 */
export async function readCardName(
  cardPhoto: string, fullFrame?: string | null,
): Promise<OcrRead | null> {
  const worker = await withTimeout(getWorker(), 25_000, 'Loading the recognition engine')
    .catch((e) => { console.warn(e); return null; });
  if (!worker) return null;

  const attempts: Array<{ src: string; fraction: number; invert: boolean; label: string }> = [
    { src: cardPhoto, fraction: 0.24, invert: false, label: 'crop-24' },
    { src: cardPhoto, fraction: 0.36, invert: false, label: 'crop-36' },
    { src: cardPhoto, fraction: 0.24, invert: true, label: 'crop-24-inverted' },
    { src: cardPhoto, fraction: 0.36, invert: true, label: 'crop-36-inverted' },
  ];
  if (fullFrame) {
    attempts.push({ src: fullFrame, fraction: 0.30, invert: false, label: 'full-frame' });
  }

  let longest: OcrRead | null = null;
  for (const a of attempts) {
    try {
      const strip = await withTimeout(
        cropStrip(a.src, a.fraction, a.invert), 8_000, 'Preparing the photo for scanning',
      );
      const res = (await withTimeout(
        worker.recognize(strip) as Promise<{ data?: { text?: string } }>,
        15_000, 'Reading text from the card',
      ));
      const data = res?.data;
      const text = (data?.text || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 3) {
        if (!longest || text.length > longest.text.length) {
          longest = { text, strategy: a.label };
        }
        // A decent read on an early, cheap attempt is good enough.
        if (text.length >= 6 && !a.invert) return longest;
      }
    } catch (e) {
      console.warn(`OCR attempt ${a.label} failed:`, e);
    }
  }
  return longest;
}

/** Read the printed collector number from the bottom strip. */
export async function readCardNumber(cardPhoto: string): Promise<string | null> {
  const worker = await getWorker();
  if (!worker) return null;
  try {
    const strip = await withTimeout(
      cropStrip(cardPhoto, 0.14, false, true), 8_000, 'Preparing the photo for scanning',
    );
    const res = (await withTimeout(
      worker.recognize(strip) as Promise<{ data?: { text?: string } }>,
      15_000, 'Reading the card number',
    ));
    const data = res?.data;
    return (data?.text || '').trim() || null;
  } catch (e) {
    console.warn('Card-number OCR failed:', e);
    return null;
  }
}
