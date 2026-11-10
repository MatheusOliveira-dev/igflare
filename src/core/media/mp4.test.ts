import { describe, it, expect } from 'vitest';
import { parseMp4Meta } from './mp4';
import { IgError } from '../../errors/ig-error';

function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(payload, 8);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function sampleMp4(): Uint8Array {
  const mvhd = new Uint8Array(20);
  const mvhdView = new DataView(mvhd.buffer);
  mvhdView.setUint32(12, 1000); // timescale
  mvhdView.setUint32(16, 5000); // duration -> 5000 ms

  const tkhd = new Uint8Array(84);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(76, 640 << 16); // width (16.16 fixed)
  tkhdView.setUint32(80, 480 << 16); // height

  const moov = box('moov', concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]));
  return concat([box('ftyp', new Uint8Array(8)), moov]);
}

describe('parseMp4Meta', () => {
  it('reads duration and dimensions from moov metadata', () => {
    expect(parseMp4Meta(sampleMp4())).toEqual({ durationMs: 5000, width: 640, height: 480 });
  });

  it('throws when there is no moov box', () => {
    expect(() => parseMp4Meta(box('ftyp', new Uint8Array(8)))).toThrow(IgError);
  });
});
