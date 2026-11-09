import { describe, it, expect } from 'vitest';
import { buildBloksPayload, caaDeviceNetworkInfo } from './payload';

describe('buildBloksPayload', () => {
  it('encodes params and client context as compact JSON', () => {
    const payload = buildBloksPayload(
      { a: 1, b: [2, 3] },
      { uuid: 'UUID-1', bloksVersioningId: 'VID' },
    );
    expect(payload).toEqual({
      params: '{"a":1,"b":[2,3]}',
      _uuid: 'UUID-1',
      bk_client_context: '{"bloks_version":"VID","styles_id":"instagram"}',
      bloks_versioning_id: 'VID',
    });
  });
});

describe('caaDeviceNetworkInfo', () => {
  it('describes a single-SIM device on wifi', () => {
    const info = caaDeviceNetworkInfo();
    expect(info).toMatchObject({ sim_count: 1, is_wifi: 1, is_airplane_mode: 0 });
    expect(info['default_subscription_info']).toMatchObject({ sim_operator: '310260' });
  });
});
