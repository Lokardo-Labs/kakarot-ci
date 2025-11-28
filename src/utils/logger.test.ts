import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initLogger, info, debug, warn, error, success, progress } from './logger.js';

describe('logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.KAKAROT_DEBUG;
    delete process.env.KAKAROT_OUTPUT;
    initLogger({ debug: false });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initLogger', () => {
    it('should enable debug mode from config', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      initLogger({ debug: true });
      debug('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should enable debug mode from environment variable', () => {
      process.env.KAKAROT_DEBUG = 'true';
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      // @ts-expect-error - testing env var override
      initLogger({});
      debug('test message');
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('should disable debug mode by default', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      initLogger({ debug: false });
      debug('test message');
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('logging functions', () => {
    it('should log info messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      initLogger({ debug: false });
      info('test message');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci] test message');
      spy.mockRestore();
    });

    it('should log debug messages when enabled', () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      initLogger({ debug: true });
      debug('test message');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci:debug] test message');
      spy.mockRestore();
    });

    it('should log warnings', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      initLogger({ debug: false });
      warn('test warning');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci] ⚠ test warning');
      spy.mockRestore();
    });

    it('should log errors', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      initLogger({ debug: false });
      error('test error');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci] ✗ test error');
      spy.mockRestore();
    });

    it('should log success messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      initLogger({ debug: false });
      success('test success');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci] ✓ test success');
      spy.mockRestore();
    });

    it('should log progress messages', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      initLogger({ debug: false });
      progress(1, 5, 'processing');
      expect(spy).toHaveBeenCalledWith('[kakarot-ci] Step 1/5: processing');
      spy.mockRestore();
    });

    it('should use JSON format when KAKAROT_OUTPUT=json', () => {
      process.env.KAKAROT_OUTPUT = 'json';
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      initLogger({ debug: false });
      info('test message');
      const call = spy.mock.calls[0][0] as string;
      const parsed = JSON.parse(call);
      expect(parsed).toMatchObject({ level: 'info', message: 'test message' });
      spy.mockRestore();
    });
  });
});

