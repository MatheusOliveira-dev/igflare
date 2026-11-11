import { IgError } from '../../errors/ig-error';

/** What an upload needs to know about an MP4: duration and frame size. */
export interface VideoMeta {
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
}

function u32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) {
    throw new IgError('Malformed MP4: unexpected end of data');
  }
  return (
    (bytes[at] ?? 0) * 2 ** 24 +
    (bytes[at + 1] ?? 0) * 2 ** 16 +
    (bytes[at + 2] ?? 0) * 2 ** 8 +
    (bytes[at + 3] ?? 0)
  );
}

function boxType(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

/** Calls `visit(type, contentStart, boxEnd)` for each box in [start, end). */
function eachBox(
  bytes: Uint8Array,
  start: number,
  end: number,
  visit: (type: string, contentStart: number, boxEnd: number) => void,
): void {
  let index = start;
  while (index + 8 <= end) {
    const size = u32(bytes, index);
    // size 1 means a 64-bit size follows the type, and the content starts 8 bytes later.
    const header = size === 1 ? 16 : 8;
    const total = size === 1 ? u32(bytes, index + 8) * 2 ** 32 + u32(bytes, index + 12) : size;
    const boxEnd = size === 0 ? end : index + total;
    if (boxEnd <= index + header - 1 || boxEnd > end) {
      break;
    }
    visit(boxType(bytes, index + 4), index + header, boxEnd);
    index = boxEnd;
  }
}

/** Reads timescale + duration from an `mvhd` box into milliseconds. */
function mvhdDurationMs(bytes: Uint8Array, start: number): number {
  const version = bytes[start] ?? 0;
  // version 0: creation(4) mod(4) timescale(4) duration(4). Version 1 uses 8-byte times.
  const timescaleAt = version === 1 ? start + 4 + 16 : start + 4 + 8;
  const timescale = u32(bytes, timescaleAt);
  const duration = version === 1 ? u32(bytes, timescaleAt + 8) : u32(bytes, timescaleAt + 4);
  return timescale > 0 ? Math.round((duration / timescale) * 1000) : 0;
}

/**
 * Reads the track's display dimensions from the tail of its `tkhd` box. A phone clip
 * recorded in portrait is often stored as a landscape track with a 90 or 270 degree
 * matrix, so the sides are swapped when the matrix turns the picture.
 */
function tkhdSize(bytes: Uint8Array, boxEnd: number): { width: number; height: number } {
  // The 16.16 values can reach 2^31 and above, which a bit shift would turn negative.
  const width = Math.floor(u32(bytes, boxEnd - 8) / 65536);
  const height = Math.floor(u32(bytes, boxEnd - 4) / 65536);
  // The matrix is nine 32-bit values just before width and height: a, b, u, c, d, ...
  const a = u32(bytes, boxEnd - 44);
  const b = u32(bytes, boxEnd - 40);
  const c = u32(bytes, boxEnd - 32);
  const d = u32(bytes, boxEnd - 28);
  const turned = a === 0 && d === 0 && b !== 0 && c !== 0;
  return turned ? { width: height, height: width } : { width, height };
}

/**
 * Reads a video's duration and pixel dimensions from an MP4's `moov` metadata,
 * without decoding the stream. Best-effort and dependency-free. Throws when the
 * boxes are not found so the caller can supply the values instead.
 */
export function parseMp4Meta(bytes: Uint8Array): VideoMeta {
  let durationMs = 0;
  let width = 0;
  let height = 0;

  eachBox(bytes, 0, bytes.length, (type, start, end) => {
    if (type !== 'moov') {
      return;
    }
    eachBox(bytes, start, end, (moovType, moovStart, moovEnd) => {
      if (moovType === 'mvhd') {
        durationMs = mvhdDurationMs(bytes, moovStart);
      } else if (moovType === 'trak') {
        eachBox(bytes, moovStart, moovEnd, (trakType, _trakStart, trakEnd) => {
          if (trakType === 'tkhd') {
            const size = tkhdSize(bytes, trakEnd);
            // The video track reports non-zero dimensions. Audio tracks report 0.
            if (size.width > 0 && size.height > 0) {
              width = size.width;
              height = size.height;
            }
          }
        });
      }
    });
  });

  if (durationMs <= 0 || width <= 0 || height <= 0) {
    throw new IgError('Could not read MP4 metadata (duration/dimensions)');
  }
  return { durationMs, width, height };
}
