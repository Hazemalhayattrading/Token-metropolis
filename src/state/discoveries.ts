/**
 * Discoveries (brief §5.3 item 9): forty small hidden details around the island
 * and inside the HQ interiors, and a per-visitor tracker of the ones found.
 *
 * Pure and DOM-free. The tracker persists to localStorage (or any injected
 * storage) with every access wrapped in try/catch: private windows, blocked
 * storage or a full quota never break it — progress then simply lasts for the
 * session. Stored data is validated on read: unknown ids and corrupt values are
 * dropped, never trusted.
 *
 * Titles and hints live in COPY.discoveries.items[id]. The details are
 * decorative easter eggs; none of them carries or implies data.
 */

export type DiscoveryWhere = 'city' | 'offices' | 'hall' | 'power' | 'lab';

export interface Discovery {
  readonly id: string;
  readonly where: DiscoveryWhere;
  /** HQ (platform) id when the detail lives in one HQ only; interior details without it appear in every HQ. */
  readonly platform?: string;
}

export const DISCOVERY_WHERES: readonly DiscoveryWhere[] = [
  'city',
  'offices',
  'hall',
  'power',
  'lab',
];

const d = (id: string, where: DiscoveryWhere, platform?: string): Discovery =>
  Object.freeze(platform === undefined ? { id, where } : { id, where, platform });

/**
 * The forty details, grouped by where they are. Ids are stable (they are the storage format):
 * never rename one; retire it and add a new id instead.
 */
export const DISCOVERIES: readonly Discovery[] = Object.freeze([
  // Around the island: shore, sea, sky and the central plaza.
  d('lighthouse', 'city'),
  d('fishing-boat', 'city'),
  d('fox', 'city'),
  d('telescope', 'city'),
  d('bench', 'city'),
  d('jogger', 'city'),
  d('delivery-drone', 'city'),
  d('paper-plane', 'city'),
  d('street-musician', 'city'),
  d('vending-machine', 'city'),
  d('radio-dish', 'city'),
  d('rooftop-garden', 'city'),
  d('campfire', 'city'),
  d('pier-angler', 'city'),
  d('hot-air-balloon', 'city'),
  d('message-bottle', 'city'),
  // Offices.
  d('night-shift', 'offices'),
  d('coffee-machine', 'offices'),
  d('office-dog', 'offices', 'cursor'),
  d('birthday-cake', 'offices', 'claude'),
  d('aquarium', 'offices', 'qwen'),
  d('pizza-night', 'offices', 'meta-ai'),
  // Server halls.
  d('server-cat', 'hall', 'deepseek'),
  d('sticky-note', 'hall', 'chatgpt'),
  d('cable-spaghetti', 'hall', 'kimi'),
  d('mop-bucket', 'hall'),
  d('hall-bicycle', 'hall', 'copilot'),
  d('heart-leds', 'hall', 'characterai'),
  // Power & cooling.
  d('night-inspector', 'power'),
  d('birds-on-wire', 'power', 'chatgpt'),
  d('owl', 'power', 'yuanbao'),
  d('grazing-sheep', 'power', 'gemini'),
  d('rubber-duck', 'power', 'doubao'),
  d('lost-balloon', 'power', 'grok'),
  // Model labs.
  d('lab-plant', 'lab'),
  d('paper-crane', 'lab', 'github-copilot'),
  d('snow-globe', 'lab', 'perplexity'),
  d('lava-lamp', 'lab', 'doubao'),
  d('robot-vacuum', 'lab', 'meta-ai'),
  d('hourglass', 'lab', 'claude'),
]);

const BY_ID: ReadonlyMap<string, Discovery> = new Map(DISCOVERIES.map((x) => [x.id, x]));

export function discoveryById(id: string): Discovery | undefined {
  return BY_ID.get(id);
}

/**
 * The details a view shows for one HQ: the view's shared details plus the ones tied to that HQ.
 * For 'city', every city detail.
 */
export function discoveriesIn(where: DiscoveryWhere, platform?: string): Discovery[] {
  return DISCOVERIES.filter(
    (x) => x.where === where && (x.platform === undefined || x.platform === platform),
  );
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export const DISCOVERY_STORAGE_KEY = 'token-metropolis:discoveries:v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Tracker {
  has(id: string): boolean;
  /** Record a find; true only the first time a known id is marked. */
  mark(id: string): boolean;
  readonly count: number;
  readonly total: number;
  /** Forget every find (and the stored copy). */
  reset(): void;
  /** Called after every new find and every reset. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

/**
 * Known ids from a stored value. Accepts `{ "v": 1, "found": [...] }` (what the tracker writes)
 * or a bare array; anything else — corrupt JSON, other shapes, unknown or duplicate ids — is
 * ignored. The result follows DISCOVERIES order.
 */
export function parseFound(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 100_000) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  const list: unknown =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as { found?: unknown }).found
      : value;
  if (!Array.isArray(list)) return [];
  const ids = new Set(list.filter((x): x is string => typeof x === 'string'));
  return DISCOVERIES.filter((x) => ids.has(x.id)).map((x) => x.id);
}

/** What the tracker stores. */
export function serializeFound(ids: Iterable<string>): string {
  const set = new Set(ids);
  return JSON.stringify({ v: 1, found: DISCOVERIES.filter((x) => set.has(x.id)).map((x) => x.id) });
}

function defaultStorage(): Store | null {
  try {
    // Reading `localStorage` itself throws where storage is blocked (e.g. some privacy settings).
    const s = (globalThis as { localStorage?: Store }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

export function createTracker(opts: { storage?: Store | null; key?: string } = {}): Tracker {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const key = opts.key ?? DISCOVERY_STORAGE_KEY;
  const listeners = new Set<() => void>();

  const read = (): string[] => {
    if (!storage) return [];
    try {
      return parseFound(storage.getItem(key));
    } catch {
      return [];
    }
  };
  const found = new Set<string>(read());

  const write = () => {
    if (!storage) return;
    try {
      if (found.size === 0) storage.removeItem(key);
      else storage.setItem(key, serializeFound(found));
    } catch {
      // Quota or blocked storage: keep the progress in memory for this session.
    }
  };

  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  };

  return {
    has: (id) => found.has(id),
    mark(id) {
      if (!BY_ID.has(id) || found.has(id)) return false;
      // Keep finds made meanwhile in another tab (same storage) rather than overwrite them.
      for (const other of read()) found.add(other);
      found.add(id);
      write();
      notify();
      return true;
    },
    get count() {
      return found.size;
    },
    get total() {
      return DISCOVERIES.length;
    },
    reset() {
      found.clear();
      write();
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
