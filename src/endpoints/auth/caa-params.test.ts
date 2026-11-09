import { describe, it, expect } from 'vitest';
import {
  buildProcessClientDataParams,
  buildOauthTokenFetchParams,
  buildSendLoginParams,
} from './caa-params';
import { createDeviceState } from '../../core/transport/device';

const device = createDeviceState({
  uuid: '11111111-1111-4111-8111-111111111111',
  phoneId: '22222222-2222-4222-8222-222222222222',
  androidDeviceId: 'android-f749eebdc6474685',
});

// The param maps are ported verbatim from a real capture. These snapshots pin the
// exact shape so an accidental field drift during a refactor fails the build; the
// live login test covers that the captured values are still the ones the server
// accepts.
describe('CAA param builders', () => {
  it('builds the process_client_data params', () => {
    expect(buildProcessClientDataParams(device, 'wf-1')).toMatchSnapshot();
  });

  it('builds the oauth token fetch params', () => {
    expect(
      buildOauthTokenFetchParams(device, {
        username: 'u',
        aac: 'AAC1',
        waterfallId: 'wf-1',
        now: 1_700_000_000_000,
      }),
    ).toMatchSnapshot();
  });

  it('builds the send_login params with the text-input suffixes', () => {
    const params = buildSendLoginParams(
      device,
      {
        contactPoint: 'u',
        encryptedPassword: '#PWD:enc',
        nonAscii: false,
        aac: 'AAC1',
        waterfallId: 'wf-1',
        challengeNonce: 'NONCE1',
        mid: 'MID123',
        now: 1_700_000_000_000,
      },
      'abcdig',
    );
    const serverParams = params['server_params'] as Record<string, unknown>;
    expect(serverParams['username_text_input_id']).toBe('abcdig:81');
    expect(serverParams['password_text_input_id']).toBe('abcdig:82');
    expect(params).toMatchSnapshot();
  });
});
