'use client';
import { useState } from 'react';
import { downscale } from '@/lib/scanner/identify-vision';

/**
 * Upload one photo, run it through every model option, compare side by side.
 *
 * The model choice is a real money decision - $26.80 per 1,000 scans on the
 * default - and the published estimate for it was wrong by more than double.
 * This makes the decision measurable instead of arguable.
 */
interface Row {
  label: string; model: string; effort: string; ok: boolean;
  name?: string | null; number?: string | null; setName?: string | null; rarity?: string | null;
  legibility?: string; nameConfidence?: number; numberConfidence?: number; setConfidence?: number;
  notes?: string; inputTokens?: number; outputTokens?: number;
  costUsd?: number; costPer1000?: number; elapsedMs?: number; error?: string;
}

/** The known-correct answer, so "did it get it right" is not a judgement call. */
const TRUTH = { name: 'eevee ex', number: '075/131', set: 'prismatic evolutions' };

function grade(r: Row): { mark: string; colour: string; detail: string } {
  if (!r.ok) return { mark: 'error', colour: '#E8483A', detail: r.error ?? '' };
  const name = (r.name ?? '').toLowerCase().includes(TRUTH.name);
  const num = (r.number ?? '').replace(/^0+/, '') === TRUTH.number.replace(/^0+/, '');
  const set = (r.setName ?? '').toLowerCase().includes(TRUTH.set);
  const got = [name && 'name', num && 'number', set && 'set'].filter(Boolean) as string[];
  if (name && num && set) return { mark: 'all correct', colour: '#2FD9A0', detail: '' };
  if (name) return { mark: `${got.length}/3`, colour: '#FFC24D', detail: `got ${got.join(', ') || 'nothing'}` };
  return { mark: 'wrong name', colour: '#E8483A', detail: r.name ?? '(none)' };
}

export default function Compare() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setBusy(true); setRows(null);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(file);
      });
      const small = await downscale(dataUrl);
      const r = await fetch('/api/compare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: small, mediaType: 'image/jpeg' }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error?.message || `Comparison failed (${r.status})`);
      setRows(json.results);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Model comparison</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Runs one photo through every model option and reports what each read, what it
        cost and how long it took. Graded against Eevee ex 075/131, Prismatic Evolutions.
        Costs a few cents per run. <a href="/">Back to the scanner</a>
      </p>

      <label style={{
        display: 'block', textAlign: 'center', padding: '12px 16px', borderRadius: 10,
        background: 'var(--accent)', color: '#04121F', fontWeight: 700, cursor: 'pointer', marginTop: 20,
      }}>
        {busy ? 'Running all models…' : 'Choose a card photo'}
        <input type="file" accept="image/*" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
      </label>

      {err && (
        <div style={{
          marginTop: 16, padding: 12, borderRadius: 10, fontSize: 13,
          background: 'rgba(232,72,58,0.1)', border: '1px solid rgba(232,72,58,0.35)',
        }}>{err}</div>
      )}

      {rows && (
        <div style={{ marginTop: 24, display: 'grid', gap: 12 }}>
          {rows.map((r) => {
            const g = grade(r);
            return (
              <div key={r.label} style={{
                padding: 14, borderRadius: 10, background: 'var(--panel)',
                border: '1px solid var(--border)', fontSize: 13,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <strong>{r.label}</strong>
                  <span style={{ color: g.colour, fontWeight: 600 }}>{g.mark}</span>
                </div>
                {r.ok ? (
                  <>
                    <div style={{ marginTop: 6, color: 'var(--muted)' }}>
                      {r.name ?? '(no name)'} · {r.number ?? '(no number)'} · {r.setName ?? '(no set)'}
                    </div>
                    <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12 }}>
                      ${r.costUsd?.toFixed(4)} per scan · <strong>${r.costPer1000?.toFixed(2)} per 1,000</strong>
                      {' · '}{((r.elapsedMs ?? 0) / 1000).toFixed(1)}s
                      {' · '}{r.inputTokens?.toLocaleString()} in / {r.outputTokens} out
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--muted)' }}>
                      certainty — name {r.nameConfidence}% · number {r.numberConfidence}% · set {r.setConfidence}%
                    </div>
                    {g.detail && <div style={{ marginTop: 4, fontSize: 11, color: g.colour }}>{g.detail}</div>}
                  </>
                ) : (
                  <div style={{ marginTop: 6, color: '#E8483A', fontSize: 12 }}>{r.error}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
