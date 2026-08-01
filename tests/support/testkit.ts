import { afterEach, beforeEach, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

export { afterEach, beforeEach, describe, it, test };

type MockFunction = ((...args: unknown[]) => unknown) & { mock: { calls: unknown[][] } };

type Asymmetric = { __keystoneMatcher: 'objectContaining' | 'arrayContaining' | 'any'; value: unknown };

function isAsymmetric(value: unknown): value is Asymmetric { return Boolean(value && typeof value === 'object' && '__keystoneMatcher' in value); }
function containsAsymmetric(value: unknown): boolean { if (isAsymmetric(value)) return true; if (Array.isArray(value)) return value.some(containsAsymmetric); if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsAsymmetric); return false; }

function deepSubset(actual: unknown, expected: unknown): boolean {
  if (isAsymmetric(expected)) {
    if (expected.__keystoneMatcher === 'objectContaining') return deepSubset(actual, expected.value);
    if (expected.__keystoneMatcher === 'arrayContaining') return Array.isArray(actual) && Array.isArray(expected.value) && expected.value.every(item => actual.some(candidate => deepSubset(candidate, item)));
    if (expected.__keystoneMatcher === 'any') { const ctor = expected.value as Function; return ctor === String ? typeof actual === 'string' : ctor === Number ? typeof actual === 'number' : ctor === Boolean ? typeof actual === 'boolean' : typeof ctor === 'function' && actual instanceof (ctor as new (...args: never[]) => unknown); }
  }
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((value, index) => deepSubset((actual as unknown[])[index], value));
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => deepSubset((actual as Record<string, unknown>)[key], value));
}

function matcher(actual: unknown, negate = false) {
  const check = (condition: boolean, message: string): void => {
    if (negate ? condition : !condition) throw new assert.AssertionError({ message, actual });
  };
  const api = {
    get not() { return matcher(actual, !negate); },
    toBe(expected: unknown) { check(Object.is(actual, expected), `Expected ${String(actual)} ${negate ? 'not ' : ''}to be ${String(expected)}`); },
    toEqual(expected: unknown) { let ok = containsAsymmetric(expected) ? deepSubset(actual, expected) : true; if (!containsAsymmetric(expected)) try { assert.deepStrictEqual(actual, expected); } catch { ok = false; } check(ok, `Expected values ${negate ? 'not ' : ''}to be deeply equal`); },
    toMatchObject(expected: unknown) { check(deepSubset(actual, expected), `Expected value ${negate ? 'not ' : ''}to match object`); },
    toContain(expected: unknown) { check(typeof actual === 'string' ? actual.includes(String(expected)) : Array.isArray(actual) ? actual.includes(expected) : false, `Expected value ${negate ? 'not ' : ''}to contain ${String(expected)}`); },
    toContainEqual(expected: unknown) { check(Array.isArray(actual) && actual.some(value => containsAsymmetric(expected) ? deepSubset(value, expected) : (() => { try { assert.deepStrictEqual(value, expected); return true; } catch { return false; } })()), `Expected array ${negate ? 'not ' : ''}to contain equal value`); },
    toHaveLength(expected: number) { check(actual != null && typeof (actual as { length?: unknown }).length === 'number' && (actual as { length: number }).length === expected, `Expected length ${expected}`); },
    toBeDefined() { check(actual !== undefined, 'Expected value to be defined'); },
    toBeUndefined() { check(actual === undefined, 'Expected value to be undefined'); },
    toBeNull() { check(actual === null, 'Expected value to be null'); },
    toBeTruthy() { check(Boolean(actual), 'Expected value to be truthy'); },
    toBeGreaterThan(expected: number) { check(typeof actual === 'number' && actual > expected, `Expected ${String(actual)} to be greater than ${expected}`); },
    toBeGreaterThanOrEqual(expected: number) { check(typeof actual === 'number' && actual >= expected, `Expected ${String(actual)} to be greater than or equal to ${expected}`); },
    toBeCloseTo(expected: number, digits = 2) { const tolerance = 10 ** -digits / 2; check(typeof actual === 'number' && Math.abs(actual - expected) < tolerance, `Expected ${String(actual)} to be close to ${expected}`); },
    toBeInstanceOf(expected: Function) { check(typeof expected === 'function' && actual instanceof (expected as new (...args: never[]) => unknown), `Expected value to be instance of ${expected.name}`); },
    toMatch(expected: RegExp | string) { check(typeof actual === 'string' && (expected instanceof RegExp ? expected.test(actual) : actual.includes(expected)), `Expected ${String(actual)} to match ${String(expected)}`); },
    toHaveBeenCalledOnce() { check(typeof actual === 'function' && Array.isArray((actual as MockFunction).mock?.calls) && (actual as MockFunction).mock.calls.length === 1, 'Expected mock to be called once'); },
    toThrow(expected?: RegExp | string) {
      let threw = false; let error: unknown;
      try { (actual as () => unknown)(); } catch (value) { threw = true; error = value; }
      const message = error instanceof Error ? error.message : String(error ?? '');
      const matches = expected === undefined || (expected instanceof RegExp ? expected.test(message) : message.includes(expected));
      check(threw && matches, `Expected function to throw${expected ? ` ${String(expected)}` : ''}`);
    },
  };
  return api;
}

function promiseMatcher(actual: Promise<unknown>, mode: 'resolves' | 'rejects') {
  const create = (name: string, args: unknown[] = []) => async (): Promise<void> => {
    let value: unknown; let rejected = false;
    try { value = await actual; } catch (error) { rejected = true; value = error; }
    if (mode === 'resolves' && rejected) throw value;
    if (mode === 'rejects' && !rejected) throw new Error('Expected promise to reject.');
    const target = name === 'toMatch' && mode === 'rejects' && value instanceof Error ? value.message : value;
    const match = matcher(target) as Record<string, (...args: unknown[]) => void>;
    match[name](...args);
  };
  return {
    toThrow: (expected?: RegExp | string) => create('toMatch', [expected])(),
    toEqual: (expected: unknown) => create('toEqual', [expected])(),
    toBe: (expected: unknown) => create('toBe', [expected])(),
    toBeUndefined: () => create('toBeUndefined')(),
    toMatchObject: (expected: unknown) => create('toMatchObject', [expected])(),
    toBeInstanceOf: (expected: Function) => create('toBeInstanceOf', [expected])(),
  };
}

export function expect(actual: unknown) {
  const base = matcher(actual) as ReturnType<typeof matcher> & { resolves?: unknown; rejects?: unknown };
  if (actual && typeof (actual as PromiseLike<unknown>).then === 'function') {
    base.resolves = promiseMatcher(actual as Promise<unknown>, 'resolves');
    base.rejects = promiseMatcher(actual as Promise<unknown>, 'rejects');
  }
  return base as ReturnType<typeof matcher> & { resolves: ReturnType<typeof promiseMatcher>; rejects: ReturnType<typeof promiseMatcher> };
}

export const vi = {
  fn<T extends (...args: any[]) => any>(implementation?: T): T & { mock: { calls: Parameters<T>[] } } {
    const calls: Parameters<T>[] = [];
    const mock = ((...args: Parameters<T>) => { calls.push(args); return implementation?.(...args); }) as T & { mock: { calls: Parameters<T>[] } };
    mock.mock = { calls };
    return mock;
  },
};

expect.objectContaining = (value: unknown): Asymmetric => ({ __keystoneMatcher: 'objectContaining', value });
expect.arrayContaining = (value: unknown[]): Asymmetric => ({ __keystoneMatcher: 'arrayContaining', value });
expect.any = (value: Function): Asymmetric => ({ __keystoneMatcher: 'any', value });
