import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  addToQueue,
  getTopArtists,
  isInsufficientScope,
  type TopTimeRange,
} from './api/spotify.js';
import { build } from './core/pipeline.js';
import { rng, weightedPick } from './core/random.js';
import {
  descriptorsFor,
  DURATION_CHOICES,
  ENTITY_LABELS,
  type QueryDescriptor,
  REGISTRY_BY_ID,
} from './core/registry.js';
import { type Candidate, Engine } from './core/serendipity.js';
import { buildIndex } from './core/statsIndex.js';
import { computeThenVsNow, type ThenVsNowItem, type ThenVsNowResult } from './core/thenVsNow.js';
import { clearDataset, loadDataset, saveDataset } from './db/store.js';
import { makeSynthetic } from './fixtures/synthetic.js';
import type { Entity } from './types/playevent.js';
import { CapsuleError, type CapsuleResult, createTimeCapsule } from './ui/capsule.js';
import { type Enrichment, useEnrichment } from './ui/useEnrichment.js';
import { hours, mmss, relTime, spotifyUrl } from './ui/format.js';
import { type SavedState, useSaved } from './ui/useSaved.js';
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

const ENTITIES: { value: Entity; label: string }[] = (
  ['artist', 'album', 'track'] as Entity[]
).map((value) => ({ value, label: ENTITY_LABELS[value] }));

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

          {spotify.status === 'connected' && active && (
            <CapsulePanel
              engine={engine}
              descriptor={active}
              entity={entity}
              param={param}
              onReconnect={spotify.login}
            />
          )}

          <SpotifyConnect s={spotify} />
          {spotify.error && <p class="error">{spotify.error}</p>}

          {result && (
            <ResultCard
              key={resultNonce}
              c={result}
              playUri={resultUri}
              enrichment={enrichment}
              canPlayHere={spotify.status === 'connected'}
              canQueue={spotify.status === 'connected' && spotify.current !== null}
              premiumRequired={spotify.premiumRequired}
              onPlayHere={spotify.play}
              onReconnect={spotify.login}
            />
          )}
          {noMatch && !result && (
            <p class="muted no-match">No match for that one — try another phrase.</p>
          )}

          {spotify.status === 'connected' && (
            <ThenVsNowSection engine={engine} onReconnect={spotify.login} />
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

/** Offered when a feature 403s because the session predates its scope. */
function ReconnectHint({ feature, onReconnect }: { feature: string; onReconnect: () => void }) {
  return (
    <p class="reconnect">
      Spotify needs a fresh permission for {feature}.{' '}
      <button class="link" onClick={onReconnect}>
        Reconnect
      </button>
    </p>
  );
}

type CapsuleStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; result: CapsuleResult }
  | { kind: 'error'; message: string; scope: boolean };

/**
 * Time Capsules: one click turns the assembled phrase into a real private
 * playlist (sampled tracks + generated cover) on the user's account.
 */
function CapsulePanel({
  engine,
  descriptor,
  entity,
  param,
  onReconnect,
}: {
  engine: Engine;
  descriptor: QueryDescriptor;
  entity: Entity;
  param: string | number | undefined;
  onReconnect: () => void;
}) {
  const [state, setState] = useState<CapsuleStatus>({ kind: 'idle' });

  // A new phrase is a new capsule — drop any previous outcome.
  useEffect(() => {
    setState({ kind: 'idle' });
  }, [descriptor.id, entity, param]);

  async function save() {
    setState({ kind: 'working' });
    try {
      const result = await createTimeCapsule({
        engine,
        descriptor,
        entity,
        param,
        rand: surpriseRand,
      });
      setState({ kind: 'done', result });
    } catch (e) {
      setState({
        kind: 'error',
        message:
          e instanceof CapsuleError || e instanceof Error
            ? e.message
            : 'Could not create the playlist.',
        scope: isInsufficientScope(e),
      });
    }
  }

  if (state.kind === 'done') {
    return (
      <p class="capsule-done">
        <span>
          Saved <strong>{state.result.trackCount} tracks</strong> to your Spotify —{' '}
        </span>
        <a class="capsule-link" href={state.result.url} target="_blank" rel="noreferrer">
          open the playlist <IconExternal />
        </a>
      </p>
    );
  }
  return (
    <>
      <button class="capsule" onClick={() => void save()} disabled={state.kind === 'working'}>
        <IconPlaylistAdd />
        {state.kind === 'working' ? 'Creating your playlist…' : 'Save this phrase as a playlist'}
      </button>
      {state.kind === 'error' &&
        (state.scope ? (
          <ReconnectHint feature="creating playlists" onReconnect={onReconnect} />
        ) : (
          <p class="error">{state.message}</p>
        ))}
    </>
  );
}

const TVN_RANGES: { value: TopTimeRange; label: string }[] = [
  { value: 'short_term', label: '4 weeks' },
  { value: 'medium_term', label: '6 months' },
  { value: 'long_term', label: '~1 year' },
];

/**
 * Then vs Now: the user's live top artists (Web API) joined against their
 * export-era heavyweights (local index). Fetches lazily on first expand so an
 * under-scoped session sees a reconnect offer only when it asks for the panel.
 */
function ThenVsNowSection({ engine, onReconnect }: { engine: Engine; onReconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<TopTimeRange>('medium_term');
  const [results, setResults] = useState<ReadonlyMap<TopTimeRange, ThenVsNowResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeBlocked, setScopeBlocked] = useState(false);

  useEffect(() => {
    if (!open || results.has(range) || scopeBlocked) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTopArtists(range)
      .then((live) => {
        if (cancelled) return;
        const exportTop = engine
          .topArtists(75)
          .map((c) => ({ name: c.label, plays: c.qualified }));
        const result = computeThenVsNow(
          exportTop,
          engine.allArtistNames(),
          live.map((a) => ({
            name: a.name,
            imageUrl: a.images[1]?.url ?? a.images[0]?.url,
            url: a.external_urls.spotify,
          })),
        );
        setResults((prev) => new Map(prev).set(range, result));
      })
      .catch((e) => {
        if (cancelled) return;
        if (isInsufficientScope(e)) setScopeBlocked(true);
        else setError('Could not load your live top artists — try again in a moment.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, range, results, scopeBlocked, engine]);

  const result = results.get(range);
  return (
    <section class="tvn">
      <button class="tvn-toggle" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen(!open)}>
        <IconCompare /> Then vs Now
        <span class="tvn-sub">your export era against your live rotation</span>
      </button>
      {open && (
        <div class="tvn-body">
          <div class="segmented tvn-ranges" role="tablist">
            {TVN_RANGES.map((r) => (
              <button
                type="button"
                class="seg"
                role="tab"
                aria-selected={r.value === range ? 'true' : 'false'}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          {scopeBlocked && <ReconnectHint feature="your live top artists" onReconnect={onReconnect} />}
          {error && <p class="error">{error}</p>}
          {loading && <p class="muted tvn-loading">Comparing eras…</p>}
          {result && !loading && (
            <>
              <TvnGroup
                title="Still on repeat"
                hint="big in your export, big right now"
                items={result.still}
                empty="No overlap — your rotation has completely turned over."
              />
              <TvnGroup
                title="New era"
                hint="in your rotation now, never once in your export"
                items={result.newEra}
                empty="No brand-new names — everything you play now, past-you knew."
              />
              <TvnGroup
                title="Lost classics"
                hint="export heavyweights gone from your rotation"
                items={result.lost}
                empty="Nothing lost — your old favorites are all still around."
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function TvnGroup({
  title,
  hint,
  items,
  empty,
}: {
  title: string;
  hint: string;
  items: ThenVsNowItem[];
  empty: string;
}) {
  return (
    <div class="tvn-group">
      <div class="tvn-head">
        <h3>{title}</h3>
        <span class="tvn-hint">{hint}</span>
      </div>
      {items.length === 0 ? (
        <p class="muted tvn-empty">{empty}</p>
      ) : (
        <ul class="tvn-list">
          {items.map((a) => (
            <li>
              <TvnArtist a={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TvnArtist({ a }: { a: ThenVsNowItem }) {
  const body = (
    <>
      {a.imageUrl ? (
        <img class="tvn-avatar" src={a.imageUrl} alt="" loading="lazy" />
      ) : (
        <span class="tvn-avatar tvn-initial" aria-hidden="true">
          {a.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span class="tvn-name">{a.name}</span>
      {a.playsThen !== undefined && (
        <span class="tvn-plays">{a.playsThen.toLocaleString()} plays then</span>
      )}
    </>
  );
  return a.url ? (
    <a class="tvn-artist" href={a.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <span class="tvn-artist">{body}</span>
  );
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
      <select value={String(value ?? 365)} onChange={(e) => onChange(Number((e.currentTarget as HTMLSelectElement).value))}>
        {DURATION_CHOICES.map((c) => (
          <option value={c.value}>{c.label}</option>
        ))}
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
  canQueue,
  premiumRequired,
  onPlayHere,
  onReconnect,
}: {
  c: Candidate;
  playUri?: string;
  enrichment: Enrichment | null;
  canPlayHere: boolean;
  canQueue: boolean;
  premiumRequired: boolean;
  onPlayHere: (uri: string) => void;
  onReconnect: () => void;
}) {
  const url = spotifyUrl(playUri);
  const savedState = useSaved(canPlayHere, playUri);
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
        {canQueue && playUri && <QueueButton uri={playUri} />}
        <HeartButton s={savedState} />
      </div>
      {savedState.scopeBlocked && (
        <ReconnectHint feature="saving tracks" onReconnect={onReconnect} />
      )}
      {premiumRequired && (
        <p class="premium-note">In-browser playback needs Spotify Premium.</p>
      )}
    </article>
  );
}

/** ♥ toggle for the pick's (representative) track, shown once its state is known. */
function HeartButton({ s }: { s: SavedState }) {
  if (s.saved === null) return null;
  return (
    <button
      class={`heart${s.saved ? ' on' : ''}`}
      aria-pressed={s.saved ? 'true' : 'false'}
      aria-label={s.saved ? 'Remove from your library' : 'Save to your library'}
      title={s.saved ? 'In your library — click to remove' : 'Save this track to your library'}
      onClick={() => void s.toggle()}
    >
      <IconHeart filled={s.saved} />
    </button>
  );
}

/** Queue the pick after the current track (needs an active device = player bar showing). */
function QueueButton({ uri }: { uri: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  async function queue() {
    setState('busy');
    try {
      await addToQueue(uri);
      setState('done');
    } catch {
      setState('error');
    }
    timer.current = setTimeout(() => setState('idle'), 2200);
  }

  return (
    <button
      class="queue"
      onClick={() => void queue()}
      disabled={state === 'busy'}
      aria-label="Add to the playback queue"
    >
      {state === 'done' ? '✓ Queued' : state === 'error' ? "Couldn't queue" : (
        <>
          <IconQueue /> Queue
        </>
      )}
    </button>
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

function IconHeart({ filled }: { filled: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M12 20.3 4.9 13a4.8 4.8 0 0 1 0-6.8 4.7 4.7 0 0 1 6.7 0l.4.4.4-.4a4.7 4.7 0 0 1 6.7 0 4.8 4.8 0 0 1 0 6.8L12 20.3z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function IconQueue() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M4 6h12M4 11h12M4 16h7"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M18 13v6m-3-3h6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  );
}

function IconPlaylistAdd() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M4 6h12M4 11h12M4 16h6"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <circle cx="17.5" cy="16.5" r="1.6" fill="currentColor" />
      <path d="M19 8.5v6.5" stroke="currentColor" stroke-width="1.8" fill="none" />
      <path d="M19 8.5c1 .3 2 .3 3-.4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" />
    </svg>
  );
}

function IconCompare() {
  return (
    <svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path
        d="M8 7h11m0 0-3-3m3 3-3 3M16 17H5m0 0 3-3m-3 3 3 3"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
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
  return ENTITY_LABELS[entity] ?? entity;
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
