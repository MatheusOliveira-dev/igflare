import { describe, it, expect } from 'vitest';
import { parseJpegSize } from './jpeg';
import { IgError } from '../../errors/ig-error';

/** A minimal JPEG marker stream: SOI, an APP0 segment to skip, then SOF0. */
function jpeg(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0, length 4 (skipped)
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // component count + rest (unread)
  ]);
}

describe('parseJpegSize', () => {
  it('reads width and height from the SOF marker past other segments', () => {
    expect(parseJpegSize(jpeg(400, 300))).toEqual({ width: 400, height: 300 });
    expect(parseJpegSize(jpeg(1080, 1350))).toEqual({ width: 1080, height: 1350 });
  });

  it('rejects a non-JPEG buffer', () => {
    expect(() => parseJpegSize(new Uint8Array([0x00, 0x01, 0x02]))).toThrow(IgError);
  });

  it('throws when there is no start-of-frame marker', () => {
    expect(() => parseJpegSize(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(IgError);
  });
});
