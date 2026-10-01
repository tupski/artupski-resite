import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from './logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards structured entries to registered sinks', () => {
    const logger = new Logger('test');
    const sink = vi.fn();
    logger.addSink(sink);

    logger.info('hello', { key: 'value' });

    expect(sink).toHaveBeenCalledOnce();
    const [entry] = sink.mock.calls[0]!;
    expect(entry.level).toBe('INFO');
    expect(entry.scope).toBe('test');
    expect(entry.message).toBe('hello');
    expect(entry.metadata).toEqual({ key: 'value' });
  });

  it('respects the configured level threshold', () => {
    const logger = new Logger('test', 'WARN');
    const sink = vi.fn();
    logger.addSink(sink);

    logger.debug('hidden');
    logger.info('hidden');
    logger.warn('shown');

    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]![0].level).toBe('WARN');
  });

  it('normalizes a thrown error into a structured error on the entry', () => {
    const logger = new Logger('test');
    const sink = vi.fn();
    logger.addSink(sink);

    logger.error('failed', new Error('kaboom'));

    const [entry] = sink.mock.calls[0]!;
    expect(entry.level).toBe('ERROR');
    expect(entry.error?.message).toBe('kaboom');
  });

  it('removes a sink when its unsubscribe handle is called', () => {
    const logger = new Logger('test');
    const sink = vi.fn();
    const off = logger.addSink(sink);
    off();

    logger.info('after removal');
    expect(sink).not.toHaveBeenCalled();
  });

  it('child loggers inherit sinks but carry a distinct scope', () => {
    const parent = new Logger('parent');
    const sink = vi.fn();
    parent.addSink(sink);

    const child = parent.child('child');
    child.info('from child');

    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]![0].scope).toBe('child');
  });
});
