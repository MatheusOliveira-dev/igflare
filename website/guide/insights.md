# Insights

Business and creator accounts can read the insights of their own account and posts, the
same figures the app shows in its professional dashboard. A personal account gets an
`IgApiError`.

## The account

```ts
const week = { from: new Date(Date.now() - 7 * 86_400_000), to: new Date() };

const overview = await ig.insights.account(week);
overview.account_views_count?.total?.value; // views
overview.viewers_or_reach?.value; // accounts reached
overview.interactions_count?.total?.value; // likes, comments, shares and saves
overview.profile_visits?.value;
overview.account_views_by_content_type?.entries; // views by post, story, reel and live
```

Leave the range out for the last 30 days. `from` and `to` take a `Date` or Unix seconds.

## The audience

```ts
const audience = await ig.insights.audience(week);
audience.follower_count?.value;
audience.age_demographics?.entries; // percentage by age range, split by gender
audience.top_countries; // and top_cities
audience.active_times?.slots; // when followers are online, by day and hour
```

## Content

The account's posts, reels or stories in the range, ranked by a figure:

```ts
const top = await ig.insights.content({ ...week, type: 'reels', metric: 'likes', count: 5 });
for (const item of top.items) {
  console.log(item.thumbnail.media_id, item.metrics);
}
```

| Option       | Values                                                        |
| ------------ | ------------------------------------------------------------- |
| `type`       | `posts`, `reels`, `stories`, `live_videos`. Leave out for all |
| `metric`     | `views` (default), `viewers`, `follows`, `likes`, `comments`… |
| `sortByDate` | `true` to sort by publication time instead                    |
| `ascending`  | `true` for smallest (or oldest) first                         |
| `count`      | Page size, 10 by default                                      |

`ig.insights.paginateContent(options)` walks every page.

## One post or reel

```ts
const post = await ig.insights.post(mediaId);
post.total_views;
post.viewers_or_reach?.value;
post.views_sources; // where the views came from: feed, profile, Explore...

const reel = await ig.insights.reel(mediaId);
reel.avg_watch_time?.formatted_value;
reel.performance_factors; // skip, share, like, save and comment rates
```

## Reading the figures

Most figures come as a metric: `{ id, label, value, format, formatted_value }`. `value` is
the number, and `formatted_value` is the text the app shows (`"33.3%"`, `"1.2K"`). A figure
that does not apply yet, like the watch time of a reel nobody watched, has a `null` value
and `"--"` as its text.
