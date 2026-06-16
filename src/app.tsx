import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { build } from './core/pipeline.js';
import { rng, weightedPick } from './core/random.js';
import { descriptorsFor, type QueryDescriptor, REGISTRY_BY_ID } from './core/registry.js';
import { type Candidate, Engine } from './core/serendipity.js';
import { buildIndex } from './core/statsIndex.js';
import { clearDataset, loadDataset, saveDataset } from './db/store.js';
import { makeSynthetic } from './fixtures/synthetic.js';
import type { Entity } from './types/playevent.js';
import { hours, relTime, spotifyUrl } from './ui/format.js';
import type { ImportResponse } from './workers/protocol.js';

type Status = 'loading' | 'empty' | 'importing' | 'ready';

interface DataMeta {
  events: number;
  demo: boolean;
}

const ENTITIES: { value: Entity; label: string }[] = [
  { value: 'artist', label: 'an artist' },
  { value: 'album', label: 'an album' },
  { value: 'track', label: 'a song' },
];

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [engine, setEngine] = useState<Engine | null>(null);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [entity, setEntity] = useState<Entity>('artist');
  const [criterionId, setCriterionId] = useState('freq-favorite');
  const [param, setParam] = useState<string | number | undefined>(undefined);

  const [result, setResult] = useState<Candidate | null>(null);
  const [resultUri, setResultUri] = useState<string | undefined>(undefined);
  const [noMatch, setNoMatch] = useState(false);

  const descriptors = useMemo(() => descriptorsFor(entity), [entity]);

  // Restore a previously imported dataset on first load.
  useEffect(() => {
    loadDataset()
      .then((p) => {
        if (!p) return setStatus('empty');
        setEngine(new Engine(p.dataset, buildIndex(p.dataset)));
        setMeta({ events: p.events, demo: false });
        setStatus('ready');
      })
      .catch(() => setStatus('empty'));
  }, []);

  function chooseEntity(next: Entity) {
    setEntity(next);
    const ds = descriptorsFor(next);
    if (!ds.some((d) => d.id === criterionId)) {
      setCriterionId(ds[0].id);
      setParam(defaultParam(ds[0]));
    }
    setResult(null);
  }

  function chooseCriterion(id: string) {
    setCriterionId(id);
    const d = REGISTRY_BY_ID.get(id);
    if (d) setParam(defaultParam(d));
    setResult(null);
  }

  function surprise() {
    if (!engine) return;
    const d = REGISTRY_BY_ID.get(criterionId);
    if (!d) return;
    const candidates = d.run(engine, { entity, param });
    const pick = weightedPick(candidates, (c) => Math.max(1, c.count), rng(Date.now()));
    setResult(pick ?? null);
    setResultUri(pick ? engine.representativeUri(pick) : undefined);
    setNoMatch(!pick);
  }

  function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setProgress(0);
    setStatus('importing');
    const worker = new Worker(new URL('./workers/import.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent<ImportResponse>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        setProgress(Math.round((m.done / m.total) * 100));
      } else if (m.type === 'done') {
        setEngine(new Engine(m.dataset, buildIndex(m.dataset)));
        setMeta({ events: m.events, demo: false });
        setStatus('ready');
        void saveDataset(m.dataset, m.events);
        worker.terminate();
      } else {
        setError(m.message);
        setStatus('empty');
        worker.terminate();
      }
    };
    worker.postMessage({ files: Array.from(files) });
  }

  function loadDemo() {
    const { dataset, index } = build(makeSynthetic());
    setEngine(new Engine(dataset, index));
    setMeta({ events: dataset.columns.n, demo: true });
    setStatus('ready');
  }

  async function reset() {
    await clearDataset();
    setEngine(null);
    setMeta(null);
    setResult(null);
    setStatus('empty');
  }

  return (
    <main class="app">
      <header>
        <h1>🎲 Serendipity</h1>
        <p class="tagline">Rediscover your own listening history.</p>
      </header>

      {status === 'loading' && <p class="muted">Loading…</p>}

      {(status === 'empty' || status === 'importing') && (
        <section class="onboard">
          <p>
            Import your Spotify <strong>Extended Streaming History</strong> (the
            <code>Streaming_History_*.json</code> files from your data export) — everything
            is processed locally on your device.
          </p>
          <label class="filebtn">
            Choose export files
            <input
              type="file"
              accept="application/json,.json"
              multiple
              disabled={status === 'importing'}
              onChange={(e) => importFiles((e.currentTarget as HTMLInputElement).files)}
            />
          </label>
          <button class="ghost" onClick={loadDemo} disabled={status === 'importing'}>
            …or explore with demo data
          </button>
          {status === 'importing' && <p class="muted">Importing… {progress}%</p>}
          {error && <p class="error">Import failed: {error}</p>}
        </section>
      )}

      {status === 'ready' && engine && (
        <>
          <section class="madlib">
            <span class="lead">Show me</span>
            <Pill>
              <select
                value={entity}
                onChange={(e) => chooseEntity((e.currentTarget as HTMLSelectElement).value as Entity)}
              >
                {ENTITIES.map((o) => (
                  <option value={o.value}>{o.label}</option>
                ))}
              </select>
            </Pill>
            <Pill>
              <select value={criterionId} onChange={(e) => chooseCriterion((e.currentTarget as HTMLSelectElement).value)}>
                {groupBy(descriptors).map(([group, items]) => (
                  <optgroup label={group}>
                    {items.map((d) => (
                      <option value={d.id}>{phraseLabel(d)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Pill>
            <ParamControl descriptor={REGISTRY_BY_ID.get(criterionId)} value={param} onChange={setParam} />
          </section>

          <button class="surprise" onClick={surprise}>
            🎲 Surprise me
          </button>

          {result && <ResultCard c={result} playUri={resultUri} />}
          {noMatch && !result && <p class="muted">No match for that one — try another phrase.</p>}

          <footer>
            <span class="muted">
              {meta?.demo ? 'Demo data' : 'Your library'} · {meta?.events.toLocaleString()} plays
            </span>
            <button class="link" onClick={reset}>
              {meta?.demo ? 'exit demo' : 'remove data'}
            </button>
          </footer>
        </>
      )}
    </main>
  );
}

function Pill({ children }: { children: ComponentChildren }) {
  return <span class="pill">{children}</span>;
}

function ParamControl({
  descriptor,
  value,
  onChange,
}: {
  descriptor: QueryDescriptor | undefined;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
}) {
  if (!descriptor || descriptor.param === 'none') return null;
  if (descriptor.param === 'date') {
    return (
      <Pill>
        <input
          type="date"
          value={String(value ?? '')}
          onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        />
      </Pill>
    );
  }
  if (descriptor.param === 'year') {
    return (
      <Pill>
        <input
          type="number"
          min={2008}
          max={new Date().getUTCFullYear()}
          value={Number(value ?? new Date().getUTCFullYear())}
          onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </Pill>
    );
  }
  // duration
  return (
    <Pill>
      <select value={Number(value ?? 365)} onChange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}>
        <option value={30}>a month</option>
        <option value={182}>six months</option>
        <option value={365}>a year</option>
        <option value={730}>two years</option>
      </select>
    </Pill>
  );
}

function ResultCard({ c, playUri }: { c: Candidate; playUri?: string }) {
  const url = spotifyUrl(playUri);
  return (
    <article class="card">
      <div class="kind">{c.kind}</div>
      <h2>{c.label}</h2>
      {c.kind !== 'artist' && <p class="by">{c.artist}</p>}
      <p class="stats">
        {c.count.toLocaleString()} plays · {hours(c.totalMs)} · last heard {relTime(c.last)}
      </p>
      {url && (
        <a class="play" href={url} target="_blank" rel="noreferrer">
          ▶ Open in Spotify
        </a>
      )}
    </article>
  );
}

// ---- small helpers --------------------------------------------------------

function defaultParam(d: QueryDescriptor): string | number | undefined {
  switch (d.param) {
    case 'date':
      return new Date().toISOString().slice(0, 10);
    case 'year':
      return new Date().getUTCFullYear();
    case 'duration':
      return 365;
    default:
      return undefined;
  }
}

/** "I play a lot" → drop the leading "I " for tighter pills where it reads better. */
function phraseLabel(d: QueryDescriptor): string {
  return d.phrase.replace('{date}', '…').replace('{year}', '…').replace('{duration}', '…');
}

function groupBy(items: QueryDescriptor[]): [string, QueryDescriptor[]][] {
  const map = new Map<string, QueryDescriptor[]>();
  for (const d of items) {
    const list = map.get(d.group);
    if (list) list.push(d);
    else map.set(d.group, [d]);
  }
  return [...map.entries()];
}
