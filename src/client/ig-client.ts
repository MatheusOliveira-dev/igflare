import { PrivateClient } from '../core/http/private-client';
import type { PrivateClientOptions } from '../core/http/private-client';
import type { HttpTransport } from '../core/transport/http-transport';
import type { SessionStore, SessionData } from '../core/session/session';
import type { PrivateResponseJson } from '../core/http/response';
import type { Page } from '../core/pagination';
import { caaLogin } from '../endpoints/auth/caa-login';
import type { CaaLoginCredentials } from '../endpoints/auth/caa-login';
import { getCurrentUser } from '../endpoints/user/current-user';
import { getUserInfo, getUserInfoByUsername } from '../endpoints/user/user-info';
import {
  followUser,
  unfollowUser,
  getFriendshipStatus,
  getFollowers,
  getFollowing,
  paginateFollowers,
  paginateFollowing,
} from '../endpoints/friendship/friendship';
import type { FollowListOptions } from '../endpoints/friendship/friendship';
import { getUserFeed, paginateUserFeed } from '../endpoints/feed/feed';
import type { FeedOptions } from '../endpoints/feed/feed';
import type { User } from '../schemas/user';
import type { FriendshipStatus } from '../schemas/friendship';
import type { Media } from '../schemas/media';

/** The logged-in account itself. */
export interface AccountApi {
  /** The current account's own profile; also the simplest check that auth is accepted. */
  me(): Promise<Record<string, unknown>>;
}

/** Reads about any user. */
export interface UserApi {
  info(pk: string): Promise<User>;
  infoByUsername(username: string): Promise<User>;
}

/** The follow graph: relationship actions and the follower/following lists. */
export interface FriendshipApi {
  follow(pk: string): Promise<FriendshipStatus>;
  unfollow(pk: string): Promise<FriendshipStatus>;
  status(pk: string): Promise<FriendshipStatus>;
  followers(pk: string, options?: FollowListOptions): Promise<Page<User>>;
  following(pk: string, options?: FollowListOptions): Promise<Page<User>>;
  paginateFollowers(pk: string): AsyncGenerator<User>;
  paginateFollowing(pk: string): AsyncGenerator<User>;
}

/** Media feeds. */
export interface FeedApi {
  user(pk: string, options?: FeedOptions): Promise<Page<Media>>;
  paginateUser(pk: string): AsyncGenerator<Media>;
}

/**
 * The ergonomic entry point. Wraps the low-level engine and groups the endpoints
 * by domain (`ig.user.*`, `ig.friendship.*`). Persistence is pluggable: pass any
 * `SessionStore` (memory, file, or a provider adapter) as `store`.
 *
 * The class name is provisional; the public brand is settled before publishing.
 */
export class IgClient {
  readonly #client: PrivateClient;
  readonly account: AccountApi;
  readonly user: UserApi;
  readonly friendship: FriendshipApi;
  readonly feed: FeedApi;

  constructor(options: PrivateClientOptions = {}) {
    this.#client = new PrivateClient(options);
    this.account = this.#buildAccountApi();
    this.user = this.#buildUserApi();
    this.friendship = this.#buildFriendshipApi();
    this.feed = this.#buildFeedApi();
  }

  /** Builds a client from a saved session in the given store. */
  static async fromStore(
    store: SessionStore,
    options: { readonly transport?: HttpTransport } = {},
  ): Promise<IgClient> {
    const client = await PrivateClient.fromStore(store, options);
    return new IgClient({ session: client.session, store, ...options });
  }

  /** Logs in with username and password through the CAA/Bloks flow. */
  login(credentials: CaaLoginCredentials): Promise<PrivateResponseJson> {
    return caaLogin(this.#client, credentials);
  }

  /** The current session (device, auth, location). */
  get session(): SessionData {
    return this.#client.session;
  }

  /** The underlying engine, for requests the facade does not yet wrap. */
  get client(): PrivateClient {
    return this.#client;
  }

  #buildAccountApi(): AccountApi {
    const client = this.#client;
    return {
      me: () => getCurrentUser(client),
    };
  }

  #buildUserApi(): UserApi {
    const client = this.#client;
    return {
      info: (pk) => getUserInfo(client, pk),
      infoByUsername: (username) => getUserInfoByUsername(client, username),
    };
  }

  #buildFriendshipApi(): FriendshipApi {
    const client = this.#client;
    return {
      follow: (pk) => followUser(client, pk),
      unfollow: (pk) => unfollowUser(client, pk),
      status: (pk) => getFriendshipStatus(client, pk),
      followers: (pk, options) => getFollowers(client, pk, options),
      following: (pk, options) => getFollowing(client, pk, options),
      paginateFollowers: (pk) => paginateFollowers(client, pk),
      paginateFollowing: (pk) => paginateFollowing(client, pk),
    };
  }

  #buildFeedApi(): FeedApi {
    const client = this.#client;
    return {
      user: (pk, options) => getUserFeed(client, pk, options),
      paginateUser: (pk) => paginateUserFeed(client, pk),
    };
  }
}
