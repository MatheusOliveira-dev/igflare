import { IgError } from '../../errors/ig-error';

/** The pixel size of an image. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Start-of-frame markers carry the dimensions; these three are not SOF. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw new IgError('Malformed JPEG: unexpected end of data');
  }
  return value;
}

/**
 * Reads a JPEG's pixel dimensions from its start-of-frame marker. Pure and
 * dependency-free: it walks the segment markers without decoding the image.
 */
export function parseJpegSize(bytes: Uint8Array): ImageSize {
  if (bytes.length < 2 || byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) {
    throw new IgError('Not a JPEG: missing the SOI marker');
  }
  let index = 2;
  while (index + 1 < bytes.length) {
    if (byteAt(bytes, index) !== 0xff) {
      index += 1;
      continue;
    }
    let marker = byteAt(bytes, index + 1);
    index += 2;
    // Padding fill bytes (0xFF) can precede the marker code.
    while (marker === 0xff && index < bytes.length) {
      marker = byteAt(bytes, index);
      index += 1;
    }
    // Standalone markers (SOI/EOI/RSTn) carry no length segment.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    const length = (byteAt(bytes, index) << 8) | byteAt(bytes, index + 1);
    if (isStartOfFrame(marker)) {
      const height = (byteAt(bytes, index + 3) << 8) | byteAt(bytes, index + 4);
      const width = (byteAt(bytes, index + 5) << 8) | byteAt(bytes, index + 6);
      return { width, height };
    }
    index += length;
  }
  throw new IgError('Malformed JPEG: no start-of-frame marker found');
}
