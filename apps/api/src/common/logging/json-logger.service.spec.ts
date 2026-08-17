import { JsonLogger } from './json-logger.service';

/**
 * Argument shapes below mirror @nestjs/common's `Logger` class exactly (read
 * from logger.service.js, not guessed): a bound-context instance appends its
 * context as the trailing optionalParam on every call, and for `error` it
 * inserts an `undefined` placeholder before the context when no stack was
 * given. JsonLogger must handle exactly what Logger actually sends.
 */
describe('JsonLogger', () => {
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  beforeEach(() => {
    stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  function lastLine(spy: jest.SpyInstance): Record<string, unknown> {
    const call = spy.mock.calls[spy.mock.calls.length - 1];
    return JSON.parse(String(call[0]).trim());
  }

  it('emits a parseable JSON line with level, context and message to stdout', () => {
    new JsonLogger().log('started up', 'Widget');

    expect(stderr).not.toHaveBeenCalled();
    const entry = lastLine(stdout);
    expect(entry).toMatchObject({ level: 'log', context: 'Widget', message: 'started up' });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('routes error level to stderr with no stack when Logger sent the undefined placeholder', () => {
    new JsonLogger().error('boom', undefined, 'Widget');

    expect(stdout).not.toHaveBeenCalled();
    const entry = lastLine(stderr);
    expect(entry).toMatchObject({ level: 'error', context: 'Widget', message: 'boom' });
    expect(entry.stack).toBeUndefined();
  });

  it('carries a real stack trace separately from the message', () => {
    new JsonLogger().error('boom', 'Error: boom\n    at x', 'Widget');

    const entry = lastLine(stderr);
    expect(entry.message).toBe('boom');
    expect(entry.stack).toContain('at x');
  });

  it('extracts message and stack from an Error passed directly, matching openai-http.ts usage', () => {
    new JsonLogger().error(new Error('upstream timed out'), undefined, 'OpenAiHttp');

    const entry = lastLine(stderr);
    expect(entry.message).toBe('upstream timed out');
    expect(entry.stack).toContain('Error: upstream timed out');
  });

  it('serializes a non-string message instead of printing "[object Object]"', () => {
    new JsonLogger().log({ event: 'RAG:REFUSED', similarity: 0.1 });

    const entry = lastLine(stdout);
    expect(entry.message).toBe(JSON.stringify({ event: 'RAG:REFUSED', similarity: 0.1 }));
    expect(entry.context).toBeUndefined();
  });
});
