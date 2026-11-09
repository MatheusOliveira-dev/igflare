import { describe, it, expect } from 'vitest';
import {
  balancedExpression,
  expressionItems,
  collectStrings,
  allText,
  firstJsonString,
  extractContextData,
  extractAac,
} from './parser';

// Golden vectors captured from instagrapi's Bloks parser over crafted inputs.

describe('balancedExpression', () => {
  it('extracts a balanced expression, ignoring parens inside quoted strings', () => {
    expect(balancedExpression('xx(a(b)c"d)e")f)gg', 2)).toBe('(a(b)c"d)e")');
  });

  it('handles a nested expression whole', () => {
    expect(balancedExpression('(f4i (dkc "k") (dkc "v"))', 0)).toBe('(f4i (dkc "k") (dkc "v"))');
  });

  it('returns empty when never balanced', () => {
    expect(balancedExpression('(a(b)', 0)).toBe('');
  });

  it('returns empty when a quoted string is never closed', () => {
    expect(balancedExpression('(a "unterminated', 0)).toBe('');
  });
});

describe('expressionItems', () => {
  it('reads direct operands without flattening nested expressions', () => {
    expect(expressionItems('(f4i (dkc "context_data") (dkc "MYCONTEXT"))')).toEqual([
      'f4i',
      '(dkc "context_data")',
      '(dkc "MYCONTEXT")',
    ]);
  });

  it('keeps quoted strings intact as operands', () => {
    expect(expressionItems('(dkc "context_data")')).toEqual(['dkc', '"context_data"']);
  });

  it('returns empty for a non-expression', () => {
    expect(expressionItems('not an expr')).toEqual([]);
  });

  it('returns empty on a malformed operand', () => {
    expect(expressionItems('( "unterminated )')).toEqual([]); // unterminated string
    expect(expressionItems('((()')).toEqual([]); // nested paren never closes
  });

  it('reads bare atoms alongside quoted and nested operands', () => {
    expect(expressionItems('(f4i "k" (x))')).toEqual(['f4i', '"k"', '(x)']);
  });
});

describe('collectStrings / allText', () => {
  it('gathers every string depth-first across objects and arrays', () => {
    const out: string[] = [];
    collectStrings({ a: 'x', b: [{ c: 'y' }, 'z'], d: 1, e: null }, out);
    expect(out).toEqual(['x', 'y', 'z']);
    expect(allText({ a: 'x', b: ['y'] })).toBe('x\ny');
  });
});

describe('firstJsonString', () => {
  it('decodes the first JSON string literal, honoring escapes', () => {
    expect(firstJsonString('garbage "LISPYAAC" more', 0)).toBe('LISPYAAC');
    expect(firstJsonString('a "DEEP\\"Q" b', 0)).toBe('DEEP"Q');
    expect(firstJsonString('no string here', 0)).toBe('');
    expect(firstJsonString('a "unterminated', 0)).toBe('');
  });
});

describe('extractContextData', () => {
  it('reads the context chained to an exact app id', () => {
    const text =
      'prefix "com.bloks.www.caa.login.save" middle (f4i (dkc "context_data") (dkc "MYCONTEXT")) tail';
    expect(extractContextData({ a: { b: text } }, 'com.bloks.www.caa.login.save')).toBe(
      'MYCONTEXT',
    );
  });

  it('descends into server_params to reach a nested context', () => {
    const nested =
      '"com.bloks.www.x" (f4i (dkc "server_params") (dkc (f4i (dkc "context_data") (dkc "DEEP"))))';
    expect(extractContextData({ v: nested }, 'com.bloks.www.x')).toBe('DEEP');
  });

  it('returns empty when the app id is absent', () => {
    expect(extractContextData({ v: 'nothing here' }, 'com.bloks.www.x')).toBe('');
  });

  it('returns empty when no f4i map follows the app id', () => {
    expect(extractContextData({ v: '"com.bloks.www.x" (dkc "y")' }, 'com.bloks.www.x')).toBe('');
  });

  it('skips a map that belongs to a later app reference', () => {
    const text = '"com.bloks.www.x" "com.bloks.www.y" (f4i (dkc "context_data") (dkc "NOPE"))';
    expect(extractContextData({ v: text }, 'com.bloks.www.x')).toBe('');
  });

  it('returns empty when the context value is an expression, not a literal', () => {
    const text = '"com.bloks.www.x" (f4i (dkc "context_data") (dkc (expr)))';
    expect(extractContextData({ v: text }, 'com.bloks.www.x')).toBe('');
  });
});

describe('extractAac', () => {
  it('reads the account access context from the layout payload', () => {
    const result = {
      layout: {
        bloks_payload: {
          data: [{ data: { key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac', initial: 'AAC_TOKEN_XYZ' } }],
        },
      },
    };
    expect(extractAac(result)).toBe('AAC_TOKEN_XYZ');
  });

  it('falls back to the lispy encoding of the context', () => {
    const result = {
      layout: {
        bloks_payload: {
          data: [
            {
              data: {
                key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac',
                initial: '',
                initial_lispy: 'junk "LISPYAAC" trailing',
              },
            },
          ],
        },
      },
    };
    expect(extractAac(result)).toBe('LISPYAAC');
  });

  it('returns empty when no aac node is present', () => {
    expect(extractAac({ layout: { bloks_payload: { data: [] } } })).toBe('');
    expect(extractAac({})).toBe('');
  });

  it('skips nodes that are not the aac node', () => {
    const result = {
      layout: {
        bloks_payload: {
          data: ['noise', { data: { key: 'OTHER', initial: 'x' } }],
        },
      },
    };
    expect(extractAac(result)).toBe('');
  });
});
