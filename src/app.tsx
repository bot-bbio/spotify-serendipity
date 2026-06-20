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
import { type Enrichment, useEnrichment } from './ui/useEnrichment.js';
import { hours, mmss, relTime, spotifyUrl } from './ui/format.js';
import { type SpotifyHook, useSpotify } from './ui/useSpotify.js';
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

  const spotify = useSpotify();
  const enrichment = useEnrichment(spotify.status === 'connected', result?.kind, resultUri);

  const descriptors = useMemo(() => descriptorsFor(entity), [entity]);
  const groups = useMemo(() => groupBy(descriptors), [descriptors]);
  const active = REGISTRY_BY_ID.get(criterionId);
  const activeGroup = active?.group;
  const groupItems = groups.find(([g]) => g === activeGroup)?.[1] ?? descriptors;

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

  /** Selecting a group jumps to its first criterion (the group is just a filter). */
  function chooseGroup(g: string) {
    const items = groups.find(([name]) => name === g)?.[1];
    if (items && items.length > 0) chooseCriterion(items[0].id);
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
            <div class="lead-row">
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
            </div>

            <div class="field-label">Group</div>
            <div class="segmented" role="tablist">
              {groups.map(([g]) => (
                <button
                  type="button"
                  class="seg"
                  role="tab"
                  aria-selected={g === activeGroup ? 'true' : 'false'}
                  onClick={() => chooseGroup(g)}
                >
                  {g}
                </button>
              ))}
            </div>

            <div class="field-label">Criterion</div>
            <div class="chips">
              {groupItems.map((d) => (
                <button
                  type="button"
                  class="chip"
                  aria-selected={d.id === criterionId ? 'true' : 'false'}
                  onClick={() => chooseCriterion(d.id)}
                >
                  {phraseLabel(d)}
                </button>
              ))}
            </div>

            <MadlibSentence entity={entity} descriptor={active} param={param} onParam={setParam} />
          </section>

          <button class="surprise" onClick={surprise}>
            🎲 Surprise me
          </button>

          <SpotifyConnect s={spotify} />
          {spotify.error && <p class="error">{spotify.error}</p>}

          {result && (
            <ResultCard
              c={result}
              playUri={resultUri}
              enrichment={enrichment}
              canPlayHere={spotify.status === 'connected'}
              premiumRequired={spotify.premiumRequired}
              onPlayHere={spotify.play}
            />
          )}
          {noMatch && !result && <p class="muted">No match for that one — try another phrase.</p>}

          {spotify.current && (
            <>
              <div class="pb-spacer" />
              <PlayerBar
                state={spotify.current}
                position={spotify.position}
                onToggle={spotify.toggle}
                onSeek={spotify.seek}
              />
            </>
          )}

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

/**
 * The assembled query as a live mad-lib sentence. For criteria with an inline
 * blank ({date}/{year}/{duration}) the param control is rendered in place, so the
 * sentence both reads naturally and is where the blank is edited.
 */
function MadlibSentence({
  entity,
  descriptor,
  param,
  onParam,
}: {
  entity: Entity;
  descriptor: QueryDescriptor | undefined;
  param: string | number | undefined;
  onParam: (v: string | number) => void;
}) {
  if (!descriptor) return null;
  const lead = `Show me ${entityLabel(entity)} `;
  if (descriptor.param === 'none') {
    return (
      <p class="sentence">
        {lead}
        {descriptor.phrase}.
      </p>
    );
  }
  const [before, after] = descriptor.phrase.split(`{${descriptor.param}}`);
  return (
    <p class="sentence">
      {lead}
      {before}
      <ParamControl descriptor={descriptor} value={param} onChange={onParam} />
      {after}.
    </p>
  );
}

function ResultCard({
  c,
  playUri,
  enrichment,
  canPlayHere,
  premiumRequired,
  onPlayHere,
}: {
  c: Candidate;
  playUri?: string;
  enrichment: Enrichment | null;
  canPlayHere: boolean;
  premiumRequired: boolean;
  onPlayHere: (uri: string) => void;
}) {
  const url = spotifyUrl(playUri);
  return (
    <article class="card">
      {enrichment?.imageUrl && <img class="art" src={enrichment.imageUrl} alt="" />}
      <div class="kind">{c.kind}</div>
      <h2>{c.label}</h2>
      {c.kind !== 'artist' && <p class="by">{c.artist}</p>}
      {enrichment && enrichment.genres.length > 0 && (
        <p class="genres">{enrichment.genres.slice(0, 3).join(' · ')}</p>
      )}
      <p class="stats">
        {c.count.toLocaleString()} plays · {hours(c.totalMs)} · last heard {relTime(c.last)}
      </p>
      <div class="card-actions">
        {canPlayHere && playUri && (
          <button class="play-here" onClick={() => onPlayHere(playUri)}>
            ▶ Play here
          </button>
        )}
        {url && (
          <a class="play" href={url} target="_blank" rel="noreferrer">
            ▶ Open in Spotify
          </a>
        )}
      </div>
      {premiumRequired && (
        <p class="premium-note">In-browser playback needs Spotify Premium.</p>
      )}
    </article>
  );
}

/** Connect / disconnect affordance for in-browser playback (Web Playback SDK). */
function SpotifyConnect({ s }: { s: SpotifyHook }) {
  if (!s.configured) {
    return (
      <p class="muted small">
        Add a Spotify Client ID in <code>.env</code> to play full tracks in the browser.
      </p>
    );
  }
  if (s.status === 'connected') {
    return (
      <p class="spotify-status">
        <span class="connected">● Spotify connected</span>
        <button class="link" onClick={s.logout}>
          disconnect
        </button>
      </p>
    );
  }
  return (
    <button class="connect" onClick={s.login}>
      🎧 Connect Spotify to play here
    </button>
  );
}

/**
 * Fixed bottom transport for the in-browser (Web Playback SDK) player: artwork,
 * track/artist, a play/pause toggle, and a seek scrubber with elapsed/total time.
 */
function PlayerBar({
  state,
  position,
  onToggle,
  onSeek,
}: {
  state: Spotify.PlaybackState;
  position: number;
  onToggle: () => void;
  onSeek: (positionMs: number) => void;
}) {
  const track = state.track_window.current_track;
  const art = track.album.images.at(-1)?.url;
  const duration = state.duration || track.duration_ms || 0;
  const pos = Math.min(position, duration);
  return (
    <div class="playerbar">
      {art && <img class="pb-art" src={art} alt="" />}
      <div class="pb-main">
        <div class="pb-meta">
          <div class="pb-title">{track.name}</div>
          <div class="pb-artist">{track.artists.map((a) => a.name).join(', ')}</div>
        </div>
        <div class="pb-scrub">
          <span class="pb-time">{mmss(pos)}</span>
          <input
            class="pb-seek"
            type="range"
            min={0}
            max={duration || 1}
            value={pos}
            aria-label="Seek"
            onInput={(e) => onSeek(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="pb-time">{mmss(duration)}</span>
        </div>
      </div>
      <button class="pb-toggle" onClick={onToggle} aria-label={state.paused ? 'Play' : 'Pause'}>
        {state.paused ? '▶' : '⏸'}
      </button>
    </div>
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

function entityLabel(entity: Entity): string {
  return ENTITIES.find((o) => o.value === entity)?.label ?? entity;
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
