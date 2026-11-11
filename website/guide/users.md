# Profiles and the follow graph

## The account

```ts
const me = await ig.account.me();
await ig.account.setBiography('Building things.');
await ig.account.setName('Display Name'); // Instagram allows a couple of changes per 14 days
await ig.account.setPicture(jpegBytes);
await ig.account.removePicture();

await ig.account.links(); // the links on the profile
await ig.account.setLink('https://example.com', 'My site');
await ig.account.removeLinks(['17900000000000001']);

await ig.account.activity(); // likes, comments and new followers, without marking them seen
```

## Other people

```ts
const user = await ig.user.infoByUsername('instagram');
const same = await ig.user.info(String(user.pk));

await ig.search.users('nasa');
await ig.search.hashtags('travel');
await ig.search.places('Lisbon');
await ig.hashtag.info('travel'); // name and post count
await ig.location.info(locationId);
await ig.location.nearby(38.7223, -9.1393);
```

## Following

```ts
const status = await ig.friendship.follow(pk); // a request, for a private account
status.following; // or status.outgoing_request

await ig.friendship.unfollow(pk);
await ig.friendship.status(pk);

await ig.friendship.followers(pk);
await ig.friendship.following(pk);
```

Follow requests to the account:

```ts
const requests = await ig.friendship.pending();
await ig.friendship.approve(requests.items[0].pk);
await ig.friendship.deny(otherPk);
await ig.friendship.removeFollower(pk);
```

## Block, mute and close friends

```ts
await ig.friendship.block(pk);
await ig.friendship.unblock(pk);

await ig.friendship.mute(pk); // posts and stories
await ig.friendship.mute(pk, { stories: true }); // stories only
await ig.friendship.unmute(pk);

await ig.friendship.addCloseFriend(pk);
await ig.friendship.removeCloseFriend(pk);
```
