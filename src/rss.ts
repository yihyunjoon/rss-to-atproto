import { XMLParser } from "fast-xml-parser";
import type { FeedItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);

  const channel = parsed?.rss?.channel;
  if (!channel) {
    throw new Error("Invalid RSS feed: missing rss > channel");
  }

  const rawItems = channel.item;
  if (!rawItems) {
    console.log("Feed has no items");
    return [];
  }

  const items: unknown[] = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.map((item: any) => ({
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    guid: String(item.guid?.["#text"] ?? item.guid ?? item.link ?? ""),
    pubDate: String(item.pubDate ?? ""),
  }));
}
