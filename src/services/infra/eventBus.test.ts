import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBus, createEvent, isBaseEventPayload } from './eventBus';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('delivers an event to its typed listener', () => {
    const listener = vi.fn();
    bus.on('app.started', listener);

    bus.emit(createEvent('app.started', { version: '0.1.0' }));

    expect(listener).toHaveBeenCalledOnce();
    const [event] = listener.mock.calls[0]!;
    expect(event.type).toBe('app.started');
    expect(event.payload.version).toBe('0.1.0');
    expect(event.payload.domain).toBe('app');
  });

  it('does not deliver events to listeners of a different type', () => {
    const listener = vi.fn();
    bus.on('app.theme_changed', listener);

    bus.emit(createEvent('app.started', { version: '0.1.0' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = vi.fn();
    const off = bus.on('app.started', listener);
    off();

    bus.emit(createEvent('app.started', { version: '0.1.0' }));

    expect(listener).not.toHaveBeenCalled();
    expect(bus.listenerCount('app.started')).toBe(0);
  });

  it('supports one-shot listeners', () => {
    const listener = vi.fn();
    bus.once('app.started', listener);

    bus.emit(createEvent('app.started', { version: '0.1.0' }));
    bus.emit(createEvent('app.started', { version: '0.1.0' }));

    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects a malformed payload at emit time', () => {
    expect(() =>
      bus.emit({ type: 'app.started', payload: { version: 'x' } } as never)
    ).toThrowError(/malformed/i);
  });

  it('clear() removes listeners without leaking', () => {
    bus.on('app.started', vi.fn());
    bus.on('app.theme_changed', vi.fn());
    expect(bus.listenerCount()).toBe(2);

    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('isBaseEventPayload', () => {
  it('accepts a well-formed envelope', () => {
    expect(
      isBaseEventPayload({ eventId: '1', timestamp: 'now', domain: 'app' })
    ).toBe(true);
  });

  it('rejects objects missing required fields', () => {
    expect(isBaseEventPayload({ domain: 'app' })).toBe(false);
    expect(isBaseEventPayload(null)).toBe(false);
  });
});

describe('createEvent', () => {
  it('derives the domain from the event type and stamps the envelope', () => {
    const event = createEvent('project.completed', {});
    expect(event.payload.domain).toBe('project');
    expect(event.payload.eventId).toBeTruthy();
    expect(event.payload.timestamp).toBeTruthy();
  });
});
