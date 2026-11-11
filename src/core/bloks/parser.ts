import { isRecord } from '../guards';
/**
 * Parsers for the Bloks responses the CAA login flow returns. Bloks payloads
 * carry data as nested, Lisp-like parenthesized expressions embedded in strings,
 * so extracting a value means walking balanced expressions while respecting
 * quoted string literals. These functions are pure: they read a decoded JSON
 * response and return the token asked for, or an empty string when absent.
 */

/** The error context token key the server issues for the account access state. */
const AAC_KEY = 'CAA_ACCOUNT_ACCESS_CONTEXT:aac';

/** Length of the JSON string literal starting at `start` (`value[start]` is `"`), or -1 if unterminated. */
function jsonStringLength(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return index + 1 - start;
    }
  }
  return -1;
}

/** Decodes the first JSON string literal at or after `start`, or '' if none. */
export function firstJsonString(value: string, start: number): string {
  const quoteIndex = value.indexOf('"', start);
  if (quoteIndex < 0) {
    return '';
  }
  const length = jsonStringLength(value, quoteIndex);
  if (length < 0) {
    return '';
  }
  const parsed = JSON.parse(value.slice(quoteIndex, quoteIndex + length)) as unknown;
  return typeof parsed === 'string' ? parsed : '';
}

/** Returns one balanced parenthesized expression from `start`, respecting quoted strings. */
export function balancedExpression(value: string, start: number): string {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      const length = jsonStringLength(value, index);
      if (length < 0) {
        return '';
      }
      index += length - 1;
      continue;
    }
    if (character === '(') {
      depth += 1;
      continue;
    }
    if (character !== ')') {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return value.slice(start, index + 1);
    }
  }
  return '';
}

/** Reads one operand at `index`: a nested expression, a quoted string, or a bare atom. */
function readOperand(value: string, index: number): string | null {
  const character = value[index] ?? '';
  if (character === '(') {
    return balancedExpression(value, index) || null;
  }
  if (character === '"') {
    const length = jsonStringLength(value, index);
    return length < 0 ? null : value.slice(index, index + length);
  }
  const atom = /^[^()\s"]+/.exec(value.slice(index));
  return atom ? atom[0] : null;
}

/** Reads the direct operands of an expression without flattening nested expressions or scalars. */
export function expressionItems(value: string): string[] {
  if (!value.startsWith('(') || !value.endsWith(')')) {
    return [];
  }
  const items: string[] = [];
  let index = 1;
  while (index < value.length - 1) {
    if (/\s/.test(value[index] ?? '')) {
      index += 1;
      continue;
    }
    const item = readOperand(value, index);
    if (item === null) {
      return [];
    }
    items.push(item);
    index += item.length;
  }
  return items;
}

/** Collects every string value in a decoded response, depth-first. */
export function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) {
      collectStrings(child, output);
    }
  } else if (isRecord(value)) {
    for (const child of Object.values(value)) {
      collectStrings(child, output);
    }
  }
}

/** The concatenation of every string in a response, for presence checks. */
export function allText(result: unknown): string {
  const strings: string[] = [];
  collectStrings(result, strings);
  return strings.join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const APP_REFERENCE = /(?<!\w)com\.bloks\.[\w.]+/g;

/** A key/value pair map read from one `(f4i (dkc ...) (dkc ...))` level, or null. */
function readDkcMap(expression: string): { keys: string[]; values: string[] } | null {
  const items = expressionItems(expression);
  if (items.length !== 3 || items[0] !== 'f4i') {
    return null;
  }
  const keys = expressionItems(items[1] ?? '');
  const values = expressionItems(items[2] ?? '');
  if (keys[0] !== 'dkc' || values[0] !== 'dkc' || keys.length !== values.length) {
    return null;
  }
  return { keys, values };
}

type DkcStep =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'descend'; readonly expression: string }
  | { readonly kind: 'none' };

/** Reads a literal string operand (`"..."`), or '' when it is not a literal. */
function literalValue(value: string): string {
  if (!value.startsWith('"')) {
    return '';
  }
  const parsed = JSON.parse(value) as unknown;
  return typeof parsed === 'string' ? parsed : '';
}

/** Scans one map's pairs: `contextKey` wins outright, else the last `server_params` to descend. */
function scanDkcPairs(map: { keys: string[]; values: string[] }, contextKey: string): DkcStep {
  let descend = '';
  for (let position = 1; position < map.keys.length; position += 1) {
    const key = map.keys[position] ?? '';
    if (!key.startsWith('"')) {
      continue;
    }
    const name = JSON.parse(key) as unknown;
    const value = map.values[position] ?? '';
    if (name === contextKey) {
      return { kind: 'value', value: literalValue(value) };
    }
    if (name === 'server_params') {
      descend = value;
    }
  }
  return descend ? { kind: 'descend', expression: descend } : { kind: 'none' };
}

/**
 * Walks the chained `f4i`/`dkc` maps of one expression for `contextKey`. Returns
 * the literal value (possibly empty) once the key is found, or null to keep
 * searching other expressions.
 */
function contextFromExpression(start: string, contextKey: string): string | null {
  let expression = start;
  while (expression) {
    const map = readDkcMap(expression);
    if (!map) {
      return null;
    }
    const step = scanDkcPairs(map, contextKey);
    if (step.kind === 'value') {
      return step.value;
    }
    if (step.kind === 'none') {
      return null;
    }
    expression = step.expression;
  }
  return null;
}

/** Finds the static parameter map chained to `appId` within one string, if any. */
function contextFromText(text: string, appId: string, contextKey: string): string | null {
  const anchor = new RegExp(escapeRegExp(JSON.stringify(appId)), 'g');
  for (const found of text.matchAll(anchor)) {
    const anchorEnd = found.index + found[0].length;
    const mapStart = text.indexOf('(f4i', anchorEnd);
    if (mapStart < 0) {
      continue;
    }
    APP_REFERENCE.lastIndex = anchorEnd;
    const nextApp = APP_REFERENCE.exec(text);
    if (nextApp && nextApp.index < mapStart) {
      continue;
    }
    const resolved = contextFromExpression(balancedExpression(text, mapStart), contextKey);
    if (resolved !== null) {
      return resolved;
    }
  }
  return null;
}

function extractContextValue(result: unknown, appId: string, contextKey: string): string {
  const strings: string[] = [];
  collectStrings(result, strings);
  for (const text of strings) {
    const resolved = contextFromText(text, appId, contextKey);
    if (resolved !== null) {
      return resolved;
    }
  }
  return '';
}

/** Extracts the context token chained to an exact Bloks app id. */
export function extractContextData(result: unknown, appId: string): string {
  return extractContextValue(result, appId, 'context_data');
}

/** Reads the aac token from one `data` node, or '' when it is not an aac node. */
function aacFromNode(node: unknown): string {
  const nodeData = isRecord(node) ? node['data'] : undefined;
  if (!isRecord(nodeData) || nodeData['key'] !== AAC_KEY) {
    return '';
  }
  const initial = nodeData['initial'];
  if (typeof initial === 'string' && initial.trim()) {
    return initial;
  }
  const lispy = nodeData['initial_lispy'];
  if (typeof lispy === 'string' && lispy) {
    return firstJsonString(lispy, 0);
  }
  return '';
}

/** The login bundle a successful CAA/Bloks login embeds in its action payload. */
export interface BloksLoginResponse {
  readonly loginResponse: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly cookies: Record<string, string>;
  readonly rawCookies: string;
}

/** Parses the `name=value` of each Set-Cookie line, ignoring attributes. */
function parseCookies(raw: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const cleaned = raw.replace(/Set-Cookie:\s?/gi, '');
  for (const segment of cleaned.split(/\r?\n/)) {
    const pair = (segment.split(';')[0] ?? '').trim();
    const equals = pair.indexOf('=');
    if (equals <= 0) {
      continue;
    }
    cookies[pair.slice(0, equals).trim()] = pair.slice(equals + 1).trim();
  }
  return cookies;
}

function decodeLoginBundle(value: string): BloksLoginResponse | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw['login_response'] !== 'string') {
    return null;
  }
  try {
    const loginResponse = JSON.parse(raw['login_response']) as Record<string, unknown>;
    const headersText = typeof raw['headers'] === 'string' ? raw['headers'] : '{}';
    const headers = JSON.parse(headersText) as Record<string, string>;
    const rawCookies = typeof raw['cookies'] === 'string' ? raw['cookies'] : '';
    return { loginResponse, headers, cookies: parseCookies(rawCookies), rawCookies };
  } catch {
    return null;
  }
}

/**
 * Extracts the login bundle a CAA/Bloks login response embeds as a JSON string
 * inside `layout.bloks_payload.action`. Returns the decoded response, headers
 * (which carry `IG-Set-Authorization`), and cookies, or null when absent.
 */
export function extractLoginResponse(result: unknown): BloksLoginResponse | null {
  if (!isRecord(result)) {
    return null;
  }
  const layout = result['layout'];
  const payload = isRecord(layout) ? layout['bloks_payload'] : undefined;
  const action = isRecord(payload) ? payload['action'] : undefined;
  if (typeof action !== 'string') {
    return null;
  }
  for (let index = 0; index < action.length; index += 1) {
    if (action[index] !== '"') {
      continue;
    }
    const length = jsonStringLength(action, index);
    if (length < 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(action.slice(index, index + length));
    } catch {
      continue;
    }
    index += length - 1;
    if (typeof value !== 'string' || !value.includes('login_response')) {
      continue;
    }
    const bundle = decodeLoginBundle(value);
    if (bundle) {
      return bundle;
    }
  }
  return null;
}

/** Extracts the server-issued CAA account access context (`aac`). */
export function extractAac(result: unknown): string {
  if (!isRecord(result)) {
    return '';
  }
  const layout = result['layout'];
  const payload = isRecord(layout) ? layout['bloks_payload'] : undefined;
  const data = isRecord(payload) ? payload['data'] : undefined;
  if (!Array.isArray(data)) {
    return '';
  }
  for (const node of data) {
    const value = aacFromNode(node);
    if (value) {
      return value;
    }
  }
  return '';
}
