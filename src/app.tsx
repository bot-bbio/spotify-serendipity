import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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

/** Dataset-derived bounds for the inline param controls. */
interface ParamEnv {
  years: number[];
  dateMin?: string;
  dateMax?: string;
}

const ENTITIES: { value: Entity; label: string }[] = [
  { value: 'artist', label: 'an artist' },
  { value: 'album', label: 'an album' },
  { value: 'track', label: 'a song' },
];

// One PRNG for the whole session: re-seeding per click (the old `rng(Date.now())`)
// made two clicks in the same millisecond replay the identical pick.
const surpriseRand = rng(Date.now());

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
  const [resultNonce, setResultNonce] = useState(0);
  const [noMatch, setNoMatch] = useState(false);

  const spotify = useSpotify();
  const enrichment = useEnrichment(spotify.status === 'connected', result?.kind, resultUri);

  const descriptors = useMemo(() => descriptorsFor(entity), [entity]);
  const groups = useMemo(() => groupBy(descriptors), [descriptors]);
  const active = REGISTRY_BY_ID.get(criterionId);
  const activeGroup = active?.group;
  const groupItems = groups.find(([g]) => g === activeGroup)?.[1] ?? descriptors;

  const paramEnv = useMemo<ParamEnv>(() => {
    if (!engine) return { years: [] };
    const range = engine.dateRange();
    return { years: engine.yearsAvailable(), dateMin: range?.min, dateMax: range?.max };
  }, [engine]);

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

  function clearOutcome() {
    setResult(null);
    setResultUri(undefined);
    setNoMatch(false);
  }

  function chooseEntity(next: Entity) {
    setEntity(next);
    const ds = descriptorsFor(next);
    if (!ds.some((d) => d.id === criterionId)) {
      setCriterionId(ds[0].id);
      setParam(defaultParam(ds[0], paramEnv));
    }
    clearOutcome();
  }

  function chooseCriterion(id: string) {
    setCriterionId(id);
    const d = REGISTRY_BY_ID.get(id);
    if (d) setParam(defaultParam(d, paramEnv));
    clearOutcome();
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
    // Re-drawing the pick already on screen reads as "the button did nothing",
    // so exclude it whenever the pool offers an alternative.
    const pool =
      result && candidates.length > 1
        ? candidates.filter((c) => !(c.kind === result.kind && c.id === result.id))
        : candidates;
    const pick = weightedPick(pool, (c) => Math.max(1, c.count), surpriseRand);
    setResult(pick ?? null);
    setResultUri(pick ? engine.representativeUri(pick) : undefined);
    setNoMatch(!pick);
    setResultNonce((n) => n + 1);
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
    // Without this, a worker that fails to even start (e.g. a bundling or
    // load-time error) would leave the UI stuck at "Importing…" forever.
    worker.onerror = () => {
      setError('The import crashed unexpectedly — please try again.');
      setStatus('empty');
      worker.terminate();
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
    clearOutcome();
    setStatus('empty');
  }

  return (
    <main class="app">
      <header>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">
            <IconDice />
          </span>
          <h1>Serendipity</h1>
        </div>
        <p class="tagline">Rediscover your own listening history.</p>
      </header>

      {status === 'loading' && <p class="muted">Loading…</p>}

      {(status === 'empty' || status === 'importing') && (
        <section class="onboard">
          <p>
            Import your Spotify <strong>Extended Streaming History</strong> (the{' '}
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
              onChange={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                importFiles(input.files);
                // Reset so choosing the same file again (e.g. after a failed
                // import) still fires a change event.
                input.value = '';
              }}
            />
          </label>
          <button class="ghost" onClick={loadDemo} disabled={status === 'importing'}>
            …or explore with demo data
          </button>
          {status === 'importing' && (
            <div class="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div class="progress-fill" style={{ width: `${progress}%` }} />
              <span class="progress-label">Importing… {progress}%</span>
            </div>
          )}
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
                  aria-pressed={d.id === criterionId ? 'true' : 'false'}
                  onClick={() => chooseCriterion(d.id)}
                >
                  {phraseLabel(d)}
                </button>
              ))}
            </div>

            <MadlibSentence
              entity={entity}
              descriptor={active}
              param={param}
              onParam={setParam}
              env={paramEnv}
            />
          </section>

          <button class="surprise" onClick={surprise}>
            <IconDice /> Surprise me
          </button>

          <SpotifyConnect s={spotify} />
          {spotify.error && <p class="error">{spotify.error}</p>}

          {result && (
            <ResultCard
              key={resultNonce}
              c={result}
              playUri={resultUri}
              enrichment={enrichment}
              canPlayHere={spotify.status === 'connected'}
              premiumRequired={spotify.premiumRequired}
              onPlayHere={spotify.play}
            />
          )}
          {noMatch && !result && (
            <p class="muted no-match">No match for that one — try another phrase.</p>
          )}

          {spotify.current && (
            <>
              <div class="pb-spacer" />
              <PlayerBar
                state={spotify.current}
                position={spotify.position}
                volume={spotify.volume}
                onToggle={spotify.toggle}
                onSeek={spotify.seek}
                onVolume={spotify.setVolume}
                onToggleMute={spotify.toggleMute}
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
  env,
}: {
  descriptor: QueryDescriptor | undefined;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
  env: ParamEnv;
}) {
  if (!descriptor || descriptor.param === 'none') return null;
  if (descriptor.param === 'date') {
    return (
      <Pill>
        <input
          type="date"
          value={String(value ?? env.dateMax ?? '')}
          min={env.dateMin}
          max={env.dateMax}
          onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        />
      </Pill>
    );
  }
  if (descriptor.param === 'year') {
    // Only the years the dataset actually spans, newest first — a free-text
    // number field invited out-of-range years that always dead-ended in no-match.
    const years =
      env.years.length > 0 ? [...env.years].reverse() : [new Date().getUTCFullYear()];
    return (
      <Pill>
        <select
          value={String(value ?? years[0])}
          onChange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          {years.map((y) => (
            <option value={String(y)}>{y}</option>
          ))}
        </select>
      </Pill>
    );
  }
  if (descriptor.param === 'choice') {
    return (
      <Pill>
        <select
          value={String(value ?? descriptor.choices?.[0]?.value ?? '')}
          onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
        >
          {descriptor.choices?.map((c) => (
            <option value={c.value}>{c.label}</option>
          ))}
        </select>
      </Pill>
    );
  }
  // duration
  return (
    <Pill>
      <select value={Number(value ?? 365)} onChange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}>
        <option value={30}>a month</option>
        <option value={91}>three months</option>
        <option value={182}>six months</option>
        <option value={365}>a year</option>
        <option value={730}>two years</option>
      </select>
    </Pill>
  );
}

/**
 * The assembled query as a live mad-lib sentence. For criteria with an inline
 * blank ({date}/{year}/{duration}/choice tokens like {weekday}) the param control
 * is rendered in place, so the sentence both reads naturally and is where the
 * blank is edited.
 */
function MadlibSentence({
  entity,
  descriptor,
  param,
  onParam,
  env,
}: {
  entity: Entity;
  descriptor: QueryDescriptor | undefined;
  param: string | number | undefined;
  onParam: (v: string | number) => void;
  env: ParamEnv;
}) {
  if (!descriptor) return null;
  const lead = `Show me ${entityLabel(entity)} `;
  const blank = descriptor.phrase.match(/\{[a-z-]+\}/i)?.[0];
  if (descriptor.param === 'none' || !blank) {
    return (
      <p class="sentence">
        {lead}
        {descriptor.phrase}.
      </p>
    );
  }
  const [before, after] = descriptor.phrase.split(blank);
  return (
    <p class="sentence">
      {lead}
      {before}
      <ParamControl descriptor={descriptor} value={param} onChange={onParam} env={env} />
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
  const ref = useRef<HTMLElement>(null);
  // Keyed by the surprise nonce, the card remounts per pick; make sure the fresh
  // result is actually visible (on small screens it can land below the fold).
  useEffect(() => {
    ref.current?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, []);
  return (
    <article class="card" ref={ref}>
      <div class="card-body">
        {enrichment?.imageUrl && <img class="art" src={enrichment.imageUrl} alt="" />}
        <div class="card-info">
          <div class="kind">{c.kind}</div>
          <h2>{c.label}</h2>
          {c.kind !== 'artist' && <p class="by">{c.artist}</p>}
          {enrichment && enrichment.genres.length > 0 && (
            <p class="genres">{enrichment.genres.slice(0, 3).join(' · ')}</p>
          )}
        </div>
      </div>
      <div class="stats">
        <div class="stat">
          <span class="stat-value">{c.count.toLocaleString()}</span>
          <span class="stat-label">plays</span>
        </div>
        <div class="stat">
          <span class="stat-value">{hours(c.totalMs)}</span>
          <span class="stat-label">listened</span>
        </div>
        <div class="stat">
          <span class="stat-value">{relTime(c.last)}</span>
          <span class="stat-label">last heard</span>
        </div>
      </div>
      <div class="card-actions">
        {canPlayHere && playUri && (
          <button class="play-here" onClick={() => onPlayHere(playUri)}>
            <IconPlay /> Play here
          </button>
        )}
        {url && (
          <a class="play" href={url} target="_blank" rel="noreferrer">
            <IconExternal /> Open in Spotify
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
        <span class="connected">Spotify connected</span>
        <button class="link" onClick={s.logout}>
          disconnect
        </button>
      </p>
    );
  }
  return (
    <button class="connect" onClick={s.login}>
      <IconHeadphones /> Connect Spotify to play here
    </button>
  );
}

/**
 * Fixed bottom transport for the in-browser (Web Playback SDK) player: artwork,
 * track/artist, a play/pause toggle, a seek scrubber with elapsed/total time,
 * and local volume (slider + mute).
 */
function PlayerBar({
  state,
  position,
  volume,
  onToggle,
  onSeek,
  onVolume,
  onToggleMute,
}: {
  state: Spotify.PlaybackState;
  position: number;
  volume: number;
  onToggle: () => void;
  onSeek: (positionMs: number) => void;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
}) {
  const track = state.track_window.current_track;
  const art = track.album.images.at(-1)?.url;
  const duration = state.duration || track.duration_ms || 0;
  const pos = Math.min(position, duration);
  const muted = volume === 0;
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
            class="pb-range pb-seek"
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
      <div class="pb-vol">
        <button class="pb-mute" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <IconVolumeMuted /> : <IconVolume />}
        </button>
        <input
          class="pb-range pb-volume"
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          aria-label="Volume"
          onInput={(e) => onVolume(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        />
      </div>
      <button class="pb-toggle" onClick={onToggle} aria-label={state.paused ? 'Play' : 'Pause'}>
        {state.paused ? <IconPlay /> : <IconPause />}
      </button>
    </div>
  );
}

// ---- icons ------------------------------------------------------------------
// Inline, currentColor SVGs — no icon font, no external requests (CSP: 'self').

function IconDice() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4.5" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="8.6" cy="8.6" r="1.5" fill="currentColor" />
      <circle cx="15.4" cy="8.6" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="8.6" cy="15.4" r="1.5" fill="currentColor" />
      <circle cx="15.4" cy="15.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l11-6.86a1.04 1.04 0 0 0 0-1.76l-11-6.86A1.04 1.04 0 0 0 8 5.14z" fill="currentColor" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M14 4h6v6h-2V7.41l-8.29 8.3-1.42-1.42 8.3-8.29H14V4z" fill="currentColor" />
      <path d="M5 6h6v2H7v9h9v-4h2v6H5V6z" fill="currentColor" />
    </svg>
  );
}

function IconVolume() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h3.6L13 19.5v-15L7.6 9H4z" fill="currentColor" />
      <path
        d="M16 8.6a4.5 4.5 0 0 1 0 6.8M18.2 6.2a7.6 7.6 0 0 1 0 11.6"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function IconVolumeMuted() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h3.6L13 19.5v-15L7.6 9H4z" fill="currentColor" />
      <path
        d="m16 9.5 5 5m0-5-5 5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function IconHeadphones() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z"
        fill="currentColor"
      />
    </svg>
  );
}

// ---- small helpers --------------------------------------------------------

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function defaultParam(d: QueryDescriptor, env: ParamEnv): string | number | undefined {
  switch (d.param) {
    case 'date':
      // Default to the last day covered by the export — "today" is almost never
      // in a historical export and dead-ended in an instant no-match.
      return env.dateMax ?? new Date().toISOString().slice(0, 10);
    case 'year':
      return env.years.at(-1) ?? new Date().getUTCFullYear();
    case 'duration':
      return 365;
    case 'choice':
      return d.choices?.[0]?.value;
    default:
      return undefined;
  }
}

function entityLabel(entity: Entity): string {
  return ENTITIES.find((o) => o.value === entity)?.label ?? entity;
}

/** Pill label: the phrase with any inline blank collapsed to an ellipsis. */
function phraseLabel(d: QueryDescriptor): string {
  return d.phrase.replace(/\{[a-z-]+\}/gi, '…');
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
