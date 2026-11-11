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
  removeFollower,
  addCloseFriend,
  removeCloseFriend,
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
import {
  getActivity,
  getBioLinks,
  removeBioLinks,
  setBioLink,
  setBiography,
  setName,
} from '../endpoints/account/account';
import type { BioLink } from '../schemas/bio-link';
import type { Activity } from '../schemas/activity';
import type { Collection } from '../schemas/collection';
import {
  createCollection,
  deleteCollection,
  getCollectionMedias,
  getLikedMedias,
  listCollections,
  paginateCollectionMedias,
  paginateLikedMedias,
} from '../endpoints/collection/collection';
import type { CommentListOptions, CommentOptions, SaveOptions } from '../endpoints/media/media';
import {
  likeComment,
  unlikeComment,
  pinComment,
  unpinComment,
  deleteComments,
  getCommentReplies,
  paginateCommentReplies,
} from '../endpoints/media/comment';
import type { ReplyListOptions } from '../endpoints/media/comment';
import {
  editMedia,
  archiveMedia,
  unarchiveMedia,
  pinMedia,
  unpinMedia,
} from '../endpoints/media/media-manage';
import type { EditMediaOptions } from '../endpoints/media/media-manage';
import { searchUsers, searchHashtags, searchPlaces } from '../endpoints/search/search';
import {
  uploadAlbum,
  uploadPhoto,
  uploadVideo,
  uploadStoryPhoto,
} from '../endpoints/upload/upload';
import type {
  AlbumItem,
  AlbumUploadOptions,
  PhotoUploadOptions,
  VideoUploadOptions,
} from '../endpoints/upload/upload';
import { getReelsTray, getUserStories, markStoriesSeen } from '../endpoints/story/story';
import {
  getInbox,
  paginateInbox,
  getPendingInbox,
  paginatePendingInbox,
  getSpamInbox,
  paginateSpamInbox,
  getThread,
  paginateThread,
  sendText,
} from '../endpoints/direct/direct';
import type { CursorOptions, SendTarget } from '../endpoints/direct/direct';
import {
  approveThread,
  hideThread,
  setThreadTitle,
  addThreadUsers,
  muteThread,
  unmuteThread,
  deleteMessage,
  markMessageSeen,
  createGroupThread,
  findThreadByParticipants,
  searchRecipients,
} from '../endpoints/direct/direct-manage';
import type { HideThreadOptions, RecipientSearchMode } from '../endpoints/direct/direct-manage';
import {
  sendLink,
  reactToMessage,
  shareMedia,
  shareProfile,
  shareStory,
  sendPhoto,
} from '../endpoints/direct/direct-send';
import { sendVideo, sendVoice } from '../endpoints/direct/direct-attachments';
import type { VoiceOptions } from '../endpoints/direct/direct-attachments';
import type { ReactionOptions, ShareMediaOptions } from '../endpoints/direct/direct-send';
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
  /** Changes the display name (Instagram limits this to a couple of changes per 14 days). */
  setName(name: string): Promise<User>;
  /** The links listed on the profile. */
  links(): Promise<BioLink[]>;
  /** Sets the profile link, returning the list as the profile now holds it. */
  setLink(url: string, title?: string): Promise<BioLink[]>;
  /** Removes profile links by `link_id`, returning the list that remains. */
  removeLinks(linkIds: string[]): Promise<BioLink[]>;
  /** The activity feed (likes, comments, new followers), first page. Marks nothing as seen. */
  activity(): Promise<Activity>;
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
  removeFollower(pk: string): Promise<FriendshipStatus>;
  addCloseFriend(pk: string): Promise<FriendshipStatus>;
  removeCloseFriend(pk: string): Promise<FriendshipStatus>;
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
  pending(options?: CursorOptions): Promise<Page<Thread>>;
  paginatePending(): AsyncGenerator<Thread>;
  spam(options?: CursorOptions): Promise<Page<Thread>>;
  paginateSpam(): AsyncGenerator<Thread>;
  approve(threadId: string): Promise<void>;
  hide(threadId: string, options?: HideThreadOptions): Promise<void>;
  setTitle(threadId: string, title: string): Promise<void>;
  addUsers(threadId: string, userIds: readonly string[]): Promise<void>;
  mute(threadId: string): Promise<void>;
  unmute(threadId: string): Promise<void>;
  deleteMessage(threadId: string, itemId: string): Promise<void>;
  markSeen(threadId: string, itemId: string): Promise<void>;
  createGroup(userIds: readonly string[], title?: string): Promise<string>;
  findThread(userIds: readonly string[]): Promise<Thread | undefined>;
  searchRecipients(query: string, mode?: RecipientSearchMode): Promise<User[]>;
  sendLink(text: string, target: SendTarget): Promise<DirectSendResult>;
  react(threadId: string, itemId: string, options?: ReactionOptions): Promise<void>;
  shareMedia(
    mediaId: string,
    target: SendTarget,
    options?: ShareMediaOptions,
  ): Promise<DirectSendResult>;
  shareProfile(userId: string, target: SendTarget): Promise<DirectSendResult>;
  sendPhoto(jpeg: Uint8Array, target: SendTarget): Promise<DirectSendResult>;
  /** Sends an MP4 video (H.264 + AAC) into a thread or the thread with the given users. */
  sendVideo(mp4: Uint8Array, target: SendTarget): Promise<DirectSendResult>;
  /** Sends a voice message: an AAC clip in an MP4 container (`.m4a`). */
  sendVoice(m4a: Uint8Array, target: SendTarget, options?: VoiceOptions): Promise<DirectSendResult>;
  /** Shares a story, by its full id (`pk_ownerPk`), into a thread or to users. */
  shareStory(storyId: string, target: SendTarget): Promise<DirectSendResult>;
}

/** Single media reads and actions. */
export interface MediaApi {
  info(mediaId: string): Promise<Media>;
  like(mediaId: string): Promise<void>;
  unlike(mediaId: string): Promise<void>;
  comment(mediaId: string, text: string, options?: CommentOptions): Promise<Comment>;
  deleteComment(mediaId: string, commentId: string): Promise<void>;
  delete(mediaId: string, mediaType?: 'PHOTO' | 'VIDEO' | 'CAROUSEL' | 'STORY'): Promise<void>;
  comments(mediaId: string, options?: CommentListOptions): Promise<Page<Comment>>;
  paginateComments(mediaId: string): AsyncGenerator<Comment>;
  likers(mediaId: string): Promise<User[]>;
  /** Saves a post, to the general saved list or to one collection. */
  save(mediaId: string, options?: SaveOptions): Promise<void>;
  unsave(mediaId: string, options?: SaveOptions): Promise<void>;
  saved(options?: CommentListOptions): Promise<Page<Media>>;
  paginateSaved(): AsyncGenerator<Media>;
  likeComment(commentId: string): Promise<void>;
  unlikeComment(commentId: string): Promise<void>;
  pinComment(mediaId: string, commentId: string): Promise<void>;
  unpinComment(mediaId: string, commentId: string): Promise<void>;
  deleteComments(mediaId: string, commentIds: readonly string[]): Promise<void>;
  replies(mediaId: string, commentId: string, options?: ReplyListOptions): Promise<Page<Comment>>;
  paginateReplies(mediaId: string, commentId: string): AsyncGenerator<Comment>;
  edit(mediaId: string, options: EditMediaOptions): Promise<Media>;
  archive(mediaId: string): Promise<void>;
  unarchive(mediaId: string): Promise<void>;
  pin(mediaId: string): Promise<void>;
  unpin(mediaId: string): Promise<void>;
}

/** Publishing media. */
export interface UploadApi {
  photo(jpeg: Uint8Array, options?: PhotoUploadOptions): Promise<Media>;
  video(mp4: Uint8Array, coverJpeg: Uint8Array, options?: VideoUploadOptions): Promise<Media>;
  story(jpeg: Uint8Array): Promise<Media>;
  /** Publishes 2 to 10 photos and videos as one carousel post. */
  album(items: readonly AlbumItem[], options?: AlbumUploadOptions): Promise<Media>;
}

/** The account's saved-posts collections and the posts it has liked. */
export interface CollectionApi {
  /** Every collection, the automatic ones included. */
  list(): Promise<Collection[]>;
  medias(collectionId: string, options?: CursorOptions): Promise<Page<Media>>;
  paginateMedias(collectionId: string): AsyncGenerator<Media>;
  /** The posts the account has liked. */
  liked(options?: CursorOptions): Promise<Page<Media>>;
  paginateLiked(): AsyncGenerator<Media>;
  /** Creates a collection, optionally holding some posts (by pk) from the start. */
  create(name: string, mediaIds?: readonly string[]): Promise<Collection>;
  /** Deletes a collection; the posts in it stay saved. */
  delete(collectionId: string): Promise<void>;
}

/** Stories. */
export interface StoryApi {
  tray(): Promise<Reel[]>;
  user(pk: string): Promise<Media[]>;
  /** Marks stories as seen by their full ids (`pk_userid`). */
  markSeen(storyIds: readonly string[]): Promise<void>;
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
  readonly collection: CollectionApi;

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
    this.collection = this.#buildCollectionApi();
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
  async login(credentials: IgFlareLogin): Promise<PrivateResponseJson> {
    const { twoFactor, ...account } = credentials;
    const result = await caaLogin(
      this.#client,
      account,
      twoFactor !== undefined ? { twoFactor } : {},
    );
    if (this.#rememberLogin) {
      // Kept only once the login worked, so a wrong password is not replayed on every
      // expiry. A literal code is single-use and would be refused on replay, so only a
      // TOTP secret or a provider function is kept as the second-factor source.
      this.#lastLogin = {
        ...account,
        ...(twoFactor !== undefined && !('code' in twoFactor) ? { twoFactor } : {}),
      };
    }
    return result;
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
  resolveTwoFactor(
    error: CaaTwoFactorRequiredError,
    code: string | TwoFactorSource,
  ): Promise<PrivateResponseJson> {
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
      setName: (name) => setName(client, name),
      links: () => getBioLinks(client),
      setLink: (url, title) => setBioLink(client, url, title),
      removeLinks: (ids) => removeBioLinks(client, ids),
      activity: () => getActivity(client),
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
      removeFollower: (pk) => removeFollower(client, pk),
      addCloseFriend: (pk) => addCloseFriend(client, pk),
      removeCloseFriend: (pk) => removeCloseFriend(client, pk),
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
      comment: (mediaId, text, options) => commentMedia(client, mediaId, text, options),
      deleteComment: (mediaId, commentId) => deleteComment(client, mediaId, commentId),
      delete: (mediaId, mediaType) => deleteMedia(client, mediaId, mediaType),
      comments: (mediaId, options) => getComments(client, mediaId, options),
      paginateComments: (mediaId) => paginateComments(client, mediaId),
      likers: (mediaId) => getLikers(client, mediaId),
      save: (mediaId, options) => saveMedia(client, mediaId, options),
      unsave: (mediaId, options) => unsaveMedia(client, mediaId, options),
      saved: (options) => getSavedPosts(client, options),
      paginateSaved: () => paginateSavedPosts(client),
      likeComment: (commentId) => likeComment(client, commentId),
      unlikeComment: (commentId) => unlikeComment(client, commentId),
      pinComment: (mediaId, commentId) => pinComment(client, mediaId, commentId),
      unpinComment: (mediaId, commentId) => unpinComment(client, mediaId, commentId),
      deleteComments: (mediaId, commentIds) => deleteComments(client, mediaId, commentIds),
      replies: (mediaId, commentId, options) =>
        getCommentReplies(client, mediaId, commentId, options),
      paginateReplies: (mediaId, commentId) => paginateCommentReplies(client, mediaId, commentId),
      edit: (mediaId, options) => editMedia(client, mediaId, options),
      archive: (mediaId) => archiveMedia(client, mediaId),
      unarchive: (mediaId) => unarchiveMedia(client, mediaId),
      pin: (mediaId) => pinMedia(client, mediaId),
      unpin: (mediaId) => unpinMedia(client, mediaId),
    };
  }

  #buildUploadApi(): UploadApi {
    const client = this.#client;
    return {
      photo: (jpeg, options) => uploadPhoto(client, jpeg, options),
      video: (mp4, coverJpeg, options) => uploadVideo(client, mp4, coverJpeg, options),
      story: (jpeg) => uploadStoryPhoto(client, jpeg),
      album: (items, options) => uploadAlbum(client, items, options),
    };
  }

  #buildCollectionApi(): CollectionApi {
    const client = this.#client;
    return {
      list: () => listCollections(client),
      medias: (collectionId, options) => getCollectionMedias(client, collectionId, options),
      paginateMedias: (collectionId) => paginateCollectionMedias(client, collectionId),
      liked: (options) => getLikedMedias(client, options),
      paginateLiked: () => paginateLikedMedias(client),
      create: (name, mediaIds) => createCollection(client, name, mediaIds),
      delete: (collectionId) => deleteCollection(client, collectionId),
    };
  }

  #buildStoryApi(): StoryApi {
    const client = this.#client;
    return {
      tray: () => getReelsTray(client),
      user: (pk) => getUserStories(client, pk),
      markSeen: (storyIds) => markStoriesSeen(client, storyIds),
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
      pending: (options) => getPendingInbox(client, options),
      paginatePending: () => paginatePendingInbox(client),
      spam: (options) => getSpamInbox(client, options),
      paginateSpam: () => paginateSpamInbox(client),
      approve: (threadId) => approveThread(client, threadId),
      hide: (threadId, options) => hideThread(client, threadId, options),
      setTitle: (threadId, title) => setThreadTitle(client, threadId, title),
      addUsers: (threadId, userIds) => addThreadUsers(client, threadId, userIds),
      mute: (threadId) => muteThread(client, threadId),
      unmute: (threadId) => unmuteThread(client, threadId),
      deleteMessage: (threadId, itemId) => deleteMessage(client, threadId, itemId),
      markSeen: (threadId, itemId) => markMessageSeen(client, threadId, itemId),
      createGroup: (userIds, title) => createGroupThread(client, userIds, title),
      findThread: (userIds) => findThreadByParticipants(client, userIds),
      searchRecipients: (query, mode) => searchRecipients(client, query, mode),
      sendLink: (text, target) => sendLink(client, text, target),
      react: (threadId, itemId, options) => reactToMessage(client, threadId, itemId, options),
      shareMedia: (mediaId, target, options) => shareMedia(client, mediaId, target, options),
      shareProfile: (userId, target) => shareProfile(client, userId, target),
      sendPhoto: (jpeg, target) => sendPhoto(client, jpeg, target),
      sendVideo: (mp4, target) => sendVideo(client, mp4, target),
      sendVoice: (m4a, target, options) => sendVoice(client, m4a, target, options),
      shareStory: (storyId, target) => shareStory(client, storyId, target),
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
