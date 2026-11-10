import { PrivateClient } from '../core/http/private-client';
import type { PrivateClientOptions } from '../core/http/private-client';
import { HttpsTransport } from '../core/transport/adapters/https';
import { RetryTransport } from '../core/transport/adapters/retry';
import type { RetryOptions } from '../core/transport/adapters/retry';
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
import {
  getUserFeed,
  paginateUserFeed,
  getTimelineFeed,
  paginateTimeline,
} from '../endpoints/feed/feed';
import type { FeedOptions } from '../endpoints/feed/feed';
import {
  getMediaInfo,
  likeMedia,
  unlikeMedia,
  commentMedia,
  deleteComment,
} from '../endpoints/media/media';
import {
  getInbox,
  paginateInbox,
  getThread,
  paginateThread,
  sendText,
} from '../endpoints/direct/direct';
import type { CursorOptions, SendTarget } from '../endpoints/direct/direct';
import type { User } from '../schemas/user';
import type { FriendshipStatus } from '../schemas/friendship';
import type { Media } from '../schemas/media';
import type { Comment } from '../schemas/comment';
import type { Thread, DirectMessage, DirectSendResult } from '../schemas/direct';

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
  timeline(options?: FeedOptions): Promise<Page<Media>>;
  paginateTimeline(): AsyncGenerator<Media>;
}

/** Direct messages: the inbox, a thread's messages, and sending. */
export interface DirectApi {
  inbox(options?: CursorOptions): Promise<Page<Thread>>;
  paginateInbox(): AsyncGenerator<Thread>;
  thread(threadId: string, options?: CursorOptions): Promise<Page<DirectMessage>>;
  paginateThread(threadId: string): AsyncGenerator<DirectMessage>;
  sendText(text: string, target: SendTarget): Promise<DirectSendResult>;
}

/** Single media reads and actions. */
export interface MediaApi {
  info(mediaId: string): Promise<Media>;
  like(mediaId: string): Promise<void>;
  unlike(mediaId: string): Promise<void>;
  comment(mediaId: string, text: string): Promise<Comment>;
  deleteComment(mediaId: string, commentId: string): Promise<void>;
}

/** Construction options for {@link IgClient}. */
export interface IgClientOptions extends PrivateClientOptions {
  /**
   * Retry policy. By default the transport is wrapped in a `RetryTransport` with
   * conservative backoff; pass tuning here, or `false` to disable retries (e.g.
   * when supplying a transport that already retries).
   */
  readonly retry?: false | RetryOptions;
}

/**
 * The ergonomic entry point. Wraps the low-level engine and groups the endpoints
 * by domain (`ig.user.*`, `ig.friendship.*`, `ig.feed.*`, `ig.media.*`).
 * Persistence is pluggable: pass any `SessionStore` (memory, file, or a provider
 * adapter) as `store`. The transport retries transient failures by default.
 *
 * The class name is provisional; the public brand is settled before publishing.
 */
export class IgClient {
  readonly #client: PrivateClient;
  readonly account: AccountApi;
  readonly user: UserApi;
  readonly friendship: FriendshipApi;
  readonly feed: FeedApi;
  readonly media: MediaApi;
  readonly direct: DirectApi;

  constructor(options: IgClientOptions = {}) {
    const { retry, ...clientOptions } = options;
    const base = clientOptions.transport ?? new HttpsTransport();
    const transport = retry === false ? base : new RetryTransport(base, retry);
    this.#client = new PrivateClient({ ...clientOptions, transport });
    this.account = this.#buildAccountApi();
    this.user = this.#buildUserApi();
    this.friendship = this.#buildFriendshipApi();
    this.feed = this.#buildFeedApi();
    this.media = this.#buildMediaApi();
    this.direct = this.#buildDirectApi();
  }

  /** Builds a client from a saved session in the given store. */
  static async fromStore(
    store: SessionStore,
    options: Omit<IgClientOptions, 'store' | 'session'> = {},
  ): Promise<IgClient> {
    const client = await PrivateClient.fromStore(
      store,
      options.transport !== undefined ? { transport: options.transport } : {},
    );
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
      timeline: (options) => getTimelineFeed(client, options),
      paginateTimeline: () => paginateTimeline(client),
    };
  }

  #buildMediaApi(): MediaApi {
    const client = this.#client;
    return {
      info: (mediaId) => getMediaInfo(client, mediaId),
      like: (mediaId) => likeMedia(client, mediaId),
      unlike: (mediaId) => unlikeMedia(client, mediaId),
      comment: (mediaId, text) => commentMedia(client, mediaId, text),
      deleteComment: (mediaId, commentId) => deleteComment(client, mediaId, commentId),
    };
  }

  #buildDirectApi(): DirectApi {
    const client = this.#client;
    return {
      inbox: (options) => getInbox(client, options),
      paginateInbox: () => paginateInbox(client),
      thread: (threadId, options) => getThread(client, threadId, options),
      paginateThread: (threadId) => paginateThread(client, threadId),
      sendText: (text, target) => sendText(client, text, target),
    };
  }
}
