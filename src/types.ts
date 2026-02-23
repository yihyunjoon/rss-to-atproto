export interface Env {
  FEED_STATE: KVNamespace;
  RSS_FEED_URL: string;
  MAX_POSTS_PER_RUN: string;
  ATPROTO_SERVICE: string;
  BSKY_IDENTIFIER: string;
  BSKY_PASSWORD: string;
}

export interface FeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
}

export interface FeedState {
  postedGuids: string[];
}
