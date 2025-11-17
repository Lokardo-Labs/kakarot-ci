import type { KakarotConfig } from '../types/config.js';

let debugMode = false;
let jsonMode = false;

export function initLogger(config: Pick<KakarotConfig, 'debug'>): void {
  debugMode = config.debug ?? process.env.KAKAROT_DEBUG === 'true';
  jsonMode = process.env.KAKAROT_OUTPUT === 'json';
}


export function info(message: string, ...args: unknown[]): void {
  if (jsonMode) {
    console.log(JSON.stringify({ level: 'info', message, ...args }));
  } else {
    console.log(`[kakarot-ci] ${message}`, ...args);
  }
}

export function debug(message: string, ...args: unknown[]): void {
  if (debugMode) {
    if (jsonMode) {
      console.debug(JSON.stringify({ level: 'debug', message, ...args }));
    } else {
      console.debug(`[kakarot-ci:debug] ${message}`, ...args);
    }
  }
}

export function warn(message: string, ...args: unknown[]): void {
  if (jsonMode) {
    console.warn(JSON.stringify({ level: 'warn', message, ...args }));
  } else {
    console.warn(`[kakarot-ci] ⚠ ${message}`, ...args);
  }
}

export function error(message: string, ...args: unknown[]): void {
  if (jsonMode) {
    console.error(JSON.stringify({ level: 'error', message, ...args }));
  } else {
    console.error(`[kakarot-ci] ✗ ${message}`, ...args);
  }
}

export function success(message: string, ...args: unknown[]): void {
  if (jsonMode) {
    console.log(JSON.stringify({ level: 'success', message, ...args }));
  } else {
    console.log(`[kakarot-ci] ✓ ${message}`, ...args);
  }
}

export function progress(step: number, total: number, message: string, ...args: unknown[]): void {
  if (jsonMode) {
    console.log(JSON.stringify({ level: 'info', step, total, message, ...args }));
  } else {
    console.log(`[kakarot-ci] Step ${step}/${total}: ${message}`, ...args);
  }
}
