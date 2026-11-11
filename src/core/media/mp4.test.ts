import { describe, it, expect } from 'vitest';
import { parseMp4Meta } from './mp4';
import { IgError } from '../../errors/ig-error';

import { box, concat, sampleMp4 } from './__fixtures__/mp4';

describe('parseMp4Meta', () => {
  it('reads duration and dimensions from moov metadata', () => {
    expect(parseMp4Meta(sampleMp4())).toEqual({ durationMs: 5000, width: 640, height: 480 });
  });

  it('swaps the sides when the track matrix turns the picture by 90 degrees', () => {
    const rotated = sampleMp4({ a: 0, b: 0x10000, c: 0xffff0000, d: 0 });
    expect(parseMp4Meta(rotated)).toEqual({ durationMs: 5000, width: 480, height: 640 });
  });

  it('keeps the sides for an identity matrix', () => {
    const upright = sampleMp4({ a: 0x10000, b: 0, c: 0, d: 0x10000 });
    expect(parseMp4Meta(upright)).toEqual({ durationMs: 5000, width: 640, height: 480 });
  });

  it('reads a dimension of 32768 or more without it turning negative', () => {
    const wide = sampleMp4();
    // width field of the only tkhd: find it by the known 640 << 16 value.
    const view = new DataView(wide.buffer);
    for (let i = 0; i + 4 <= wide.length; i += 1) {
      if (view.getUint32(i) === 640 << 16) {
        view.setUint32(i, 40000 * 65536);
      }
    }
    expect(parseMp4Meta(wide).width).toBe(40000);
  });

  it('walks a box that uses a 64-bit size', () => {
    const normal = sampleMp4();
    // Re-wrap the moov box with the 16-byte header form (size 1 + 64-bit size).
    const ftyp = normal.slice(0, 16);
    const moov = normal.slice(16);
    const wrapped = new Uint8Array(16 + (moov.length - 8));
    const view = new DataView(wrapped.buffer);
    view.setUint32(0, 1);
    wrapped.set(moov.slice(4, 8), 4);
    view.setUint32(8, 0);
    view.setUint32(12, wrapped.length);
    wrapped.set(moov.slice(8), 16);
    expect(parseMp4Meta(concat([ftyp, wrapped]))).toEqual({
      durationMs: 5000,
      width: 640,
      height: 480,
    });
  });

  it('throws when there is no moov box', () => {
    expect(() => parseMp4Meta(box('ftyp', new Uint8Array(8)))).toThrow(IgError);
  });
});
