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
import { resolveCaaTwoFactor } from '../endpoints/auth/caa-two-factor';
import type { TwoFactorSource } from '../endpoints/auth/caa-two-factor';
import type { CaaTwoFactorRequiredError, LoginRequiredError } from '../errors/api-errors';
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
  approveRequest,
  denyRequest,
  blockUser,
  unblockUser,
  getPendingRequests,
  paginatePendingRequests,
  muteUser,
  unmuteUser,
} from '../endpoints/friendship/friendship';
import type { FollowListOptions, MuteOptions } from '../endpoints/friendship/friendship';
import {
  getUserFeed,
  paginateUserFeed,
  getTimelineFeed,
  paginateTimeline,
  getHashtagFeed,
  paginateHashtagFeed,
  getLocationFeed,
  paginateLocationFeed,
} from '../endpoints/feed/feed';
import type { FeedOptions } from '../endpoints/feed/feed';
import {
  getMediaInfo,
  likeMedia,
  unlikeMedia,
  commentMedia,
  deleteComment,
  deleteMedia,
  getComments,
  paginateComments,
  getLikers,
  saveMedia,
  unsaveMedia,
  getSavedPosts,
  paginateSavedPosts,
} from '../endpoints/media/media';
import { setBiography } from '../endpoints/account/account';
import type { CommentListOptions } from '../endpoints/media/media';
import { searchUsers, searchHashtags, searchPlaces } from '../endpoints/search/search';
import { uploadPhoto, uploadVideo, uploadStoryPhoto } from '../endpoints/upload/upload';
import type { PhotoUploadOptions, VideoUploadOptions } from '../endpoints/upload/upload';
import { getReelsTray, getUserStories } from '../endpoints/story/story';
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
import type { Hashtag } from '../schemas/hashtag';
import type { Location } from '../schemas/location';
import type { Reel } from '../schemas/reel';

/** The logged-in account itself. */
export interface AccountApi {
  /** The current account's own profile; also the simplest check that auth is accepted. */
  me(): Promise<Record<string, unknown>>;
  /** Sets the account's biography, returning the updated profile. */
  setBiography(text: string): Promise<User>;
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
  pending(options?: FollowListOptions): Promise<Page<User>>;
  paginatePending(): AsyncGenerator<User>;
  approve(pk: string): Promise<FriendshipStatus>;
  deny(pk: string): Promise<FriendshipStatus>;
  block(pk: string): Promise<FriendshipStatus>;
  unblock(pk: string): Promise<FriendshipStatus>;
  mute(pk: string, options?: MuteOptions): Promise<void>;
  unmute(pk: string, options?: MuteOptions): Promise<void>;
}

/** Media feeds. */
export interface FeedApi {
  user(pk: string, options?: FeedOptions): Promise<Page<Media>>;
  paginateUser(pk: string): AsyncGenerator<Media>;
  timeline(options?: FeedOptions): Promise<Page<Media>>;
  paginateTimeline(): AsyncGenerator<Media>;
  hashtag(tag: string, options?: FeedOptions): Promise<Page<Media>>;
  paginateHashtag(tag: string): AsyncGenerator<Media>;
  location(locationId: string, options?: FeedOptions): Promise<Page<Media>>;
  paginateLocation(locationId: string): AsyncGenerator<Media>;
}

/** Discovery search across users, hashtags and places. */
export interface SearchApi {
  users(query: string): Promise<User[]>;
  hashtags(query: string): Promise<Hashtag[]>;
  places(query: string): Promise<Location[]>;
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
  delete(mediaId: string, mediaType?: 'PHOTO' | 'VIDEO' | 'CAROUSEL' | 'STORY'): Promise<void>;
  comments(mediaId: string, options?: CommentListOptions): Promise<Page<Comment>>;
  paginateComments(mediaId: string): AsyncGenerator<Comment>;
  likers(mediaId: string): Promise<User[]>;
  save(mediaId: string): Promise<void>;
  unsave(mediaId: string): Promise<void>;
  saved(options?: CommentListOptions): Promise<Page<Media>>;
  paginateSaved(): AsyncGenerator<Media>;
}

/** Publishing media. */
export interface UploadApi {
  photo(jpeg: Uint8Array, options?: PhotoUploadOptions): Promise<Media>;
  video(mp4: Uint8Array, coverJpeg: Uint8Array, options?: VideoUploadOptions): Promise<Media>;
  story(jpeg: Uint8Array): Promise<Media>;
}

/** Stories. */
export interface StoryApi {
  tray(): Promise<Reel[]>;
  user(pk: string): Promise<Media[]>;
}

/** What `login` takes: the account credentials and, optionally, the second-factor source. */
export type IgFlareLogin = CaaLoginCredentials & { readonly twoFactor?: TwoFactorSource };

/** Construction options for {@link IgFlare}. */
export interface IgFlareOptions extends PrivateClientOptions {
  /**
   * Retry policy. By default the transport is wrapped in a `RetryTransport` with
   * conservative backoff; pass tuning here, or `false` to disable retries (e.g.
   * when supplying a transport that already retries).
   */
  readonly retry?: false | RetryOptions;
  /**
   * Re-authenticate automatically when the session expires: the credentials (and
   * second-factor source) of the last `login()` are kept in this process's memory
   * and replayed, then the rejected request is repeated once. Ignored when
   * `onSessionExpired` is set, which takes precedence and keeps credentials out of
   * the SDK. Has no effect for a session loaded from a store without a `login()`.
   */
  readonly autoRelogin?: boolean;
}

/**
 * The ergonomic entry point. Wraps the low-level engine and groups the endpoints
 * by domain (`ig.user.*`, `ig.friendship.*`, `ig.feed.*`, `ig.media.*`).
 * Persistence is pluggable: pass any `SessionStore` (memory, file, or a provider
 * adapter) as `store`. The transport retries transient failures by default.
 *
 * The class name is provisional; the public brand is settled before publishing.
 */
export class IgFlare {
  readonly #client: PrivateClient;
  readonly #rememberLogin: boolean;
  #lastLogin: IgFlareLogin | undefined;
  readonly account: AccountApi;
  readonly user: UserApi;
  readonly friendship: FriendshipApi;
  readonly feed: FeedApi;
  readonly media: MediaApi;
  readonly direct: DirectApi;
  readonly upload: UploadApi;
  readonly search: SearchApi;
  readonly story: StoryApi;

  constructor(options: IgFlareOptions = {}) {
    const { retry, autoRelogin, ...clientOptions } = options;
    const base = clientOptions.transport ?? new HttpsTransport();
    const transport = retry === false ? base : new RetryTransport(base, retry);
    this.#rememberLogin = autoRelogin === true && clientOptions.onSessionExpired === undefined;
    this.#client = new PrivateClient({
      ...clientOptions,
      transport,
      ...(this.#rememberLogin
        ? { onSessionExpired: (error: LoginRequiredError) => this.#relogin(error) }
        : {}),
    });
    this.account = this.#buildAccountApi();
    this.user = this.#buildUserApi();
    this.friendship = this.#buildFriendshipApi();
    this.feed = this.#buildFeedApi();
    this.media = this.#buildMediaApi();
    this.direct = this.#buildDirectApi();
    this.upload = this.#buildUploadApi();
    this.search = this.#buildSearchApi();
    this.story = this.#buildStoryApi();
  }

  /** Builds a client from a saved session in the given store. */
  static async fromStore(
    store: SessionStore,
    options: Omit<IgFlareOptions, 'store' | 'session'> = {},
  ): Promise<IgFlare> {
    const client = await PrivateClient.fromStore(
      store,
      options.transport !== undefined ? { transport: options.transport } : {},
    );
    return new IgFlare({ session: client.session, store, ...options });
  }

  /**
   * Logs in with username and password through the CAA/Bloks flow. If the account
   * asks for a second factor, pass `twoFactor` (a code, a TOTP secret, or a function
   * that provides one) and the login resolves it; without it a
   * `CaaTwoFactorRequiredError` is thrown, to finish with `resolveTwoFactor`.
   */
  login(credentials: IgFlareLogin): Promise<PrivateResponseJson> {
    if (this.#rememberLogin) {
      this.#lastLogin = credentials;
    }
    const { twoFactor, ...account } = credentials;
    return caaLogin(this.#client, account, twoFactor !== undefined ? { twoFactor } : {});
  }

  /** Replays the last login after a session expiry, or rethrows when there is none. */
  async #relogin(error: LoginRequiredError): Promise<void> {
    const last = this.#lastLogin;
    if (last === undefined) {
      throw error;
    }
    await this.login(last);
  }

  /** Finishes a login that stopped at the two-factor step by submitting the code. */
  resolveTwoFactor(error: CaaTwoFactorRequiredError, code: string): Promise<PrivateResponseJson> {
    return resolveCaaTwoFactor(this.#client, error, code);
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
      setBiography: (text) => setBiography(client, text),
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
      pending: (options) => getPendingRequests(client, options),
      paginatePending: () => paginatePendingRequests(client),
      approve: (pk) => approveRequest(client, pk),
      deny: (pk) => denyRequest(client, pk),
      block: (pk) => blockUser(client, pk),
      unblock: (pk) => unblockUser(client, pk),
      mute: (pk, options) => muteUser(client, pk, options),
      unmute: (pk, options) => unmuteUser(client, pk, options),
    };
  }

  #buildFeedApi(): FeedApi {
    const client = this.#client;
    return {
      user: (pk, options) => getUserFeed(client, pk, options),
      paginateUser: (pk) => paginateUserFeed(client, pk),
      timeline: (options) => getTimelineFeed(client, options),
      paginateTimeline: () => paginateTimeline(client),
      hashtag: (tag, options) => getHashtagFeed(client, tag, options),
      paginateHashtag: (tag) => paginateHashtagFeed(client, tag),
      location: (locationId, options) => getLocationFeed(client, locationId, options),
      paginateLocation: (locationId) => paginateLocationFeed(client, locationId),
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
      delete: (mediaId, mediaType) => deleteMedia(client, mediaId, mediaType),
      comments: (mediaId, options) => getComments(client, mediaId, options),
      paginateComments: (mediaId) => paginateComments(client, mediaId),
      likers: (mediaId) => getLikers(client, mediaId),
      save: (mediaId) => saveMedia(client, mediaId),
      unsave: (mediaId) => unsaveMedia(client, mediaId),
      saved: (options) => getSavedPosts(client, options),
      paginateSaved: () => paginateSavedPosts(client),
    };
  }

  #buildUploadApi(): UploadApi {
    const client = this.#client;
    return {
      photo: (jpeg, options) => uploadPhoto(client, jpeg, options),
      video: (mp4, coverJpeg, options) => uploadVideo(client, mp4, coverJpeg, options),
      story: (jpeg) => uploadStoryPhoto(client, jpeg),
    };
  }

  #buildStoryApi(): StoryApi {
    const client = this.#client;
    return {
      tray: () => getReelsTray(client),
      user: (pk) => getUserStories(client, pk),
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

  #buildSearchApi(): SearchApi {
    const client = this.#client;
    return {
      users: (query) => searchUsers(client, query),
      hashtags: (query) => searchHashtags(client, query),
      places: (query) => searchPlaces(client, query),
    };
  }
}
