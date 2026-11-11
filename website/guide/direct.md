# Direct messages

## Where a message goes

Every send takes a target: an existing thread, or the people to write to.

```ts
await ig.direct.sendText('Hi', { threadId });
await ig.direct.sendText('Hi', { userIds: ['10000000001'] }); // opens or reuses the thread
```

The result says where the message landed, with its `thread_id` and `item_id`.

## Sending

```ts
await ig.direct.sendText('See you at 8', target);
await ig.direct.sendLink('Look at this https://example.com', target); // shown with a preview
await ig.direct.sendPhoto(await readFile('photo.jpg'), { threadId }); // needs a thread
await ig.direct.sendVideo(await readFile('clip.mp4'), target);
await ig.direct.sendVoice(await readFile('voice.m4a'), target); // shown as a voice message

await ig.direct.shareMedia(postId, target);
await ig.direct.shareProfile(pk, target);
await ig.direct.shareStory(storyId, target);

await ig.direct.react(threadId, itemId); // a heart
await ig.direct.react(threadId, itemId, { emoji: '😂' });
await ig.direct.deleteMessage(threadId, itemId); // own message, for everyone
```

## Reading

```ts
const inbox = await ig.direct.inbox();
const messages = await ig.direct.thread(inbox.items[0].thread_id);
await ig.direct.markSeen(threadId, itemId);

await ig.direct.findThread(['10000000001']); // the thread with exactly these people
await ig.direct.searchRecipients('ana'); // people the account can message
```

## Requests

Messages from accounts the user does not follow land in requests:

```ts
await ig.direct.pending();
await ig.direct.approve(threadId); // move to the inbox
await ig.direct.hide(threadId); // decline
await ig.direct.spam(); // the hidden requests
```

## Groups

```ts
const threadId = await ig.direct.createGroup(['10000000001', '10000000002'], 'Weekend');
await ig.direct.setTitle(threadId, 'Weekend trip');
await ig.direct.addUsers(threadId, ['10000000003']);
await ig.direct.mute(threadId);
await ig.direct.unmute(threadId);
```

Realtime delivery (receiving messages as they arrive) is not covered. New messages show up
in the inbox.
