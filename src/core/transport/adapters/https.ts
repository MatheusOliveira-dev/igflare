import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import type { Readable } from 'node:stream';
import { IgError } from '../../../errors/ig-error';
import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

function decompress(res: IncomingMessage): Readable {
  switch (res.headers['content-encoding']) {
    case 'gzip':
      return res.pipe(createGunzip());
    case 'deflate':
      return res.pipe(createInflate());
    case 'br':
      return res.pipe(createBrotliDecompress());
    default:
      return res;
  }
}

function flattenHeaders(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

/**
 * The default transport, over Node's http/https. Unlike global fetch it does not
 * inject browser `sec-fetch-*` headers, which the private API rejects. Sends
 * exactly the headers it is given and decompresses gzip/deflate/br responses.
 */
export class HttpsTransport implements HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const url = new URL(req.url);
      const send = url.protocol === 'http:' ? httpRequest : httpsRequest;

      const clientRequest = send(
        {
          method: req.method,
          hostname: url.hostname,
          port: url.port === '' ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          headers: req.headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          const stream = decompress(res);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: flattenHeaders(res),
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          stream.on('error', (error: Error) => {
            reject(
              new IgError(`Failed to read response: ${req.method} ${req.url}`, { cause: error }),
            );
          });
        },
      );

      clientRequest.on('error', (error: Error) => {
        reject(new IgError(`HTTP request failed: ${req.method} ${req.url}`, { cause: error }));
      });

      if (req.body !== undefined) {
        clientRequest.write(req.body);
      }
      clientRequest.end();
    });
  }
}
