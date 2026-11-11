/**
 * JSON.parse coerces numbers to float64, which silently loses precision on the
 * 64-bit ids Instagram returns (a media pk like `4000000000000000001` comes back
 * as `...943000`). This wraps integer literals that cannot round-trip through a
 * float in quotes before parsing, so those ids arrive as exact strings. It is
 * string-aware: digits inside string values are never touched, and ordinary
 * numbers (floats, timestamps within the safe range) are left as numbers.
 */

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function scanDigits(json: string, start: number): number {
  let index = start;
  while (index < json.length && isDigit(json.charAt(index))) {
    index += 1;
  }
  return index;
}

/** Returns the index just past the JSON number that starts at `start`. */
function scanNumber(json: string, start: number): number {
  let index = json.charAt(start) === '-' ? start + 1 : start;
  index = scanDigits(json, index);
  if (json.charAt(index) === '.') {
    index = scanDigits(json, index + 1);
  }
  if (json.charAt(index) === 'e' || json.charAt(index) === 'E') {
    index += 1;
    if (json.charAt(index) === '+' || json.charAt(index) === '-') {
      index += 1;
    }
    index = scanDigits(json, index);
  }
  return index;
}

/** Whether a number literal is an integer that a float64 cannot represent exactly. */
function isLossyInteger(num: string): boolean {
  if (num.includes('.') || num.includes('e') || num.includes('E')) {
    return false;
  }
  const digits = num.startsWith('-') ? num.length - 1 : num.length;
  return digits >= 16 && Number(num).toString() !== num;
}

function quoteUnsafeInts(json: string): string {
  let out = '';
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < json.length) {
    const ch = json.charAt(index);
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      index += 1;
    } else if (ch === '"') {
      inString = true;
      out += ch;
      index += 1;
    } else if (ch === '-' || isDigit(ch)) {
      const end = scanNumber(json, index);
      const num = json.slice(index, end);
      out += isLossyInteger(num) ? `"${num}"` : num;
      index = end;
    } else {
      out += ch;
      index += 1;
    }
  }
  return out;
}

/** Parses JSON while preserving integers too large for a float as exact strings. */
export function parseLosslessJson(text: string): unknown {
  // A lossy integer has at least 16 digits in a row. Most responses have none, so they
  // skip the character-by-character rewrite.
  if (!/\d{16}/.test(text)) {
    return JSON.parse(text);
  }
  return JSON.parse(quoteUnsafeInts(text));
}
