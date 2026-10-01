/**
 * EventBus foundation - Artupski ReSite
 * Source of truth: docs/architecture/EVENT-SYSTEM.md.
 *
 * Phase 1 establishes the type-safe pub/sub infrastructure and the event
 * taxonomy. The feature domains (scanner, technology, blueprint, clone,
 * project, ...) are declared here as the contract future engines will emit
 * against - they are intentionally NOT implemented in this phase.
 */

export type EventDomain =
  | 'scanner'
  | 'technology'
  | 'asset'
  | 'responsive'
  | 'auth'
  | 'blueprint'
  | 'clone'
  | 'project'
  | 'app';

/** Canonical event keys, following the `<domain>.<action_or_state>` taxonomy. */
export type AppEventType =
  | 'app.started'
  | 'app.theme_changed'
  | 'scanner.started'
  | 'scanner.browser_started'
  | 'scanner.navigation_started'
  | 'scanner.page_loaded'
  | 'scanner.page_discovered'
  | 'scanner.completed'
  | 'scanner.failed'
  | 'technology.scan_started'
  | 'technology.detected'
  | 'technology.scan_completed'
  | 'asset.download_started'
  | 'asset.downloaded'
  | 'responsive.viewport_captured'
  | 'auth.required'
  | 'auth.completed'
  | 'auth.failed'
  | 'blueprint.started'
  | 'blueprint.generated'
  | 'blueprint.validation_failed'
  | 'blueprint.completed'
  | 'clone.started'
  | 'clone.file_generated'
  | 'clone.completed'
  | 'project.started'
  | 'project.file_generated'
  | 'project.completed';

/** Base envelope carried by every event (EVENT-SYSTEM.md section 3). */
export interface BaseEventPayload {
  eventId: string;
  timestamp: string;
  domain: EventDomain;
  projectId?: string;
}

export interface AppStartedPayload extends BaseEventPayload {
  domain: 'app';
  version: string;
}

export interface ThemeChangedPayload extends BaseEventPayload {
  domain: 'app';
  theme: string;
  resolved: 'light' | 'dark';
}

/** Payload map: ties each event key to a concrete, structured payload. */
export interface AppEventPayloadMap {
  'app.started': AppStartedPayload;
  'app.theme_changed': ThemeChangedPayload;
  // Future feature domains are reserved in the taxonomy but carry no payload
  // contract until their engines exist (see docs/product/PLAN.md Phase 2+).
  [key: string]: BaseEventPayload;
}

export type AppEvent<T extends AppEventType = AppEventType> = {
  type: T;
  payload: AppEventPayloadMap[T];
};

export type EventListener<T extends AppEventType = AppEventType> = (event: AppEvent<T>) => void;

/** Minimal runtime validation for payloads crossing IPC boundaries. */
export function isBaseEventPayload(value: unknown): value is BaseEventPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.domain === 'string'
  );
}

function createEventId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Build a well-formed event, filling the required envelope fields. */
export function createEvent<T extends AppEventType>(
  type: T,
  payload: Omit<AppEventPayloadMap[T], keyof BaseEventPayload> & Partial<BaseEventPayload>
): AppEvent<T> {
  const domain = type.split('.')[0] as EventDomain;
  return {
    type,
    payload: {
      eventId: createEventId(),
      timestamp: new Date().toISOString(),
      domain,
      ...payload,
    } as AppEventPayloadMap[T],
  };
}

/**
 * Type-safe publish/subscribe bus.
 *
 * Subscribe handlers are keyed by event type so consumers cannot accidentally
 * receive unrelated events. `emit` rejects payloads that lack the base
 * envelope, keeping the bus from degrading into an untyped string dump.
 */
export class EventBus {
  private readonly listeners = new Map<AppEventType, Set<EventListener>>();

  on<T extends AppEventType>(type: T, listener: EventListener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as EventListener);
    return () => this.off(type, listener);
  }

  once<T extends AppEventType>(type: T, listener: EventListener<T>): () => void {
    const unsubscribe = this.on(type, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  off<T extends AppEventType>(type: T, listener: EventListener<T>): void {
    const set = this.listeners.get(type);
    if (!set) {
      return;
    }
    set.delete(listener as EventListener);
    if (set.size === 0) {
      this.listeners.delete(type);
    }
  }

  emit<T extends AppEventType>(event: AppEvent<T>): void {
    if (!isBaseEventPayload(event.payload)) {
      throw new Error(`Refusing to emit malformed event "${event.type}" payload.`);
    }
    const set = this.listeners.get(event.type);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      listener(event);
    }
  }

  listenerCount(type?: AppEventType): number {
    if (type) {
      return this.listeners.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }

  /** Remove listeners; pass a type to clear only that channel. */
  clear(type?: AppEventType): void {
    if (type) {
      this.listeners.delete(type);
    } else {
      this.listeners.clear();
    }
  }
}

/** Shared application event bus. */
export const eventBus = new EventBus();
