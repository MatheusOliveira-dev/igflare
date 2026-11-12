# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). Before 1.0, a minor version can change
the API.

## 0.1.0 - 2026-11-12

First release. The client presents itself as Instagram for Android, build 454.0.0.54.77.

- Login through the app's current flow, with second factor and email challenge, saved
  sessions and optional re-login when a session expires.
- Profiles, search, hashtag and place pages, follow graph and requests, mute, block and
  close friends.
- Feeds: timeline, user, hashtag, place, reels and Explore, each with a page call and an
  iterator.
- Posts: details, likes, comments and replies, saving and collections, editing and tags,
  archive, pin and delete.
- Publishing: photo, video, carousel, reel and story. Highlights, notes, biography, name,
  profile links and profile picture.
- Direct messages: inbox, requests, threads, text, links, photos, videos, voice, shared
  posts, profiles and stories, reactions and group management.
- Insights for professional accounts: account overview, audience, content list, post and
  reel.
- Typed results validated at runtime, typed errors, exact 64-bit ids, retries with backoff,
  a proxy option and pluggable transport and session storage.
