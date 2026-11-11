import { describe, it, expect } from 'vitest';
import {
  getHashtagInfo,
  getLocationInfo,
  searchHashtags,
  searchNearby,
  searchPlaces,
  searchUsers,
} from './search';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

describe('search', () => {
  it('searches users and parses the ranked list', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      users: [{ pk: 1, username: 'alice' }],
    });

    const users = await searchUsers(client, 'ali');

    expect(transport.requests[0]?.url).toContain('/api/v1/users/search/?q=ali');
    expect(users[0]?.username).toBe('alice');
  });

  it('searches hashtags from the results array', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      results: [{ id: 17841563459123456, name: 'sunset', media_count: 42 }],
    });

    const tags = await searchHashtags(client, 'sun');

    expect(transport.requests[0]?.url).toContain('/api/v1/tags/search/?q=sun');
    expect(tags[0]?.name).toBe('sunset');
    expect(tags[0]?.media_count).toBe(42);
  });

  it('searches places and unwraps the location of each item', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [
        { location: { pk: 7, name: 'Central Park', city: 'New York' } },
        { something_else: true },
      ],
    });

    const places = await searchPlaces(client, 'central');

    expect(transport.requests[0]?.url).toContain('/api/v1/fbsearch/places/?query=central');
    expect(places).toHaveLength(1);
    expect(places[0]?.name).toBe('Central Park');
  });

  it('throws a typed schema error when a result has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', users: [{ pk: 1, username: 42 }] });
    await expect(searchUsers(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when the users array is missing', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(searchUsers(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getHashtagInfo', () => {
  const INFO = { status: 'ok', id: '17843000000000001', name: 'gremio', media_count: 1234 };

  it('reads the hashtag page', async () => {
    const { client, transport } = clientReturning(INFO);

    const info = await getHashtagInfo(client, 'gremio');

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/tags/gremio/info/');
    expect(transport.requests[0]?.method).toBe('GET');
    expect(info.name).toBe('gremio');
    expect(info.media_count).toBe(1234);
    expect(info.id).toBe('17843000000000001');
  });

  it('accepts a leading # and encodes a name with accents', async () => {
    const { client, transport } = clientReturning({ ...INFO, name: 'grêmio' });
    await getHashtagInfo(client, '  #grêmio ');
    expect(transport.requests[0]?.url).toContain('/api/v1/tags/gr%C3%AAmio/info/');
  });

  it('refuses an empty tag or one that could change the path, before any request', async () => {
    const { client, transport } = clientReturning(INFO);
    for (const bad of ['', '#', 'new year', 'a/../b', 'a?b', 'a#b']) {
      await expect(getHashtagInfo(client, bad)).rejects.toBeInstanceOf(IgError);
    }
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the answer has no name', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(getHashtagInfo(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getLocationInfo', () => {
  const PAGE = {
    status: 'ok',
    location_id: '4000000000000000001',
    name: 'Fake Place',
    category: 'Stadium',
    lat: -30.1,
    lng: -51.2,
    location_city: 'Fake City',
    media_count: 77,
  };

  it('reads the location page', async () => {
    const { client, transport } = clientReturning(PAGE);

    const info = await getLocationInfo(client, '4000000000000000001');

    expect(transport.requests[0]?.url).toContain(
      '/api/v1/locations/4000000000000000001/location_info/',
    );
    expect(info.name).toBe('Fake Place');
    expect(info.location_id).toBe('4000000000000000001');
    expect(info.media_count).toBe(77);
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientReturning(PAGE);
    await expect(getLocationInfo(client, '1/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws for an id the server answers with an empty page', async () => {
    const { client } = clientReturning({ status: 'ok', location_id: '5', name: '' });
    await expect(getLocationInfo(client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when the answer has no location id', async () => {
    const { client } = clientReturning({ status: 'ok', name: 'x' });
    await expect(getLocationInfo(client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('searchNearby', () => {
  it('lists the places near a coordinate, with the id every other call calls pk', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      venues: [
        { external_id: 10000000001, name: 'A', address: 'x', lat: -30.5, lng: -51.5 },
        { external_id: 5, name: 'B' },
      ],
    });

    const places = await searchNearby(client, -30.03, -51.21);

    const url = transport.requests[0]?.url ?? '';
    expect(url).toContain('/api/v1/location_search/');
    expect(url).toContain('latitude=-30.03');
    expect(url).toContain('longitude=-51.21');
    expect(places.map((place) => place.name)).toEqual(['A', 'B']);
    expect(places[0]?.pk).toBe('10000000001');
    expect(places[0]?.lat).toBeCloseTo(-30.5);
    // A venue with no coordinates of its own gets the ones searched.
    expect(places[1]?.pk).toBe('5');
    expect(places[1]?.lat).toBeCloseTo(-30.03);
    expect(places[1]?.lng).toBeCloseTo(-51.21);
  });

  it('is empty when there are no venues', async () => {
    const { client } = clientReturning({ status: 'ok' });
    expect(await searchNearby(client, 0, 0)).toEqual([]);
  });

  it('refuses coordinates out of range, before any request', async () => {
    const { client, transport } = clientReturning({ status: 'ok', venues: [] });
    await expect(searchNearby(client, 91, 0)).rejects.toBeInstanceOf(IgError);
    await expect(searchNearby(client, 0, -181)).rejects.toBeInstanceOf(IgError);
    await expect(searchNearby(client, Number.NaN, 0)).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
