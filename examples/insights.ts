// Reads the insights of a professional (business or creator) account.
//
//   npx tsx examples/insights.ts
import { FileSessionStore, IgFlare } from 'igflare';

const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));

// The last 7 days. Leave the range out for the last 30.
const week = { from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() };
const overview = await ig.insights.account(week);
console.log('views', overview.account_views_count?.total?.value);
console.log('reach', overview.viewers_or_reach?.value);
console.log('profile visits', overview.profile_visits?.value);

const audience = await ig.insights.audience(week);
console.log('followers', audience.follower_count?.value);

// The five reels with the most likes in the range, then the insights of the first one.
const top = await ig.insights.content({ ...week, type: 'reels', metric: 'likes', count: 5 });
for (const item of top.items) {
  console.log(item.thumbnail.media_id, item.metrics);
}
const first = top.items[0];
if (first !== undefined) {
  const reel = await ig.insights.reel(first.thumbnail.media_id);
  console.log('average watch time', reel.avg_watch_time?.formatted_value);
}
