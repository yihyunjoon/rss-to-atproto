import type { Env, FeedState } from "./types";
import { fetchFeed } from "./rss";
import { login, createPost } from "./atproto";

const KV_KEY_STATE = "feed_state";
const MAX_STORED_GUIDS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getState(kv: KVNamespace): Promise<FeedState> {
  const raw = await kv.get(KV_KEY_STATE);
  if (!raw) {
    return { postedGuids: [] };
  }
  return JSON.parse(raw) as FeedState;
}

async function saveState(kv: KVNamespace, state: FeedState): Promise<void> {
  state.postedGuids = state.postedGuids.slice(-MAX_STORED_GUIDS);
  await kv.put(KV_KEY_STATE, JSON.stringify(state));
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await run(env);
  },
} satisfies ExportedHandler<Env>;

async function run(env: Env): Promise<void> {
  console.log("Starting RSS check...");

  const state = await getState(env.FEED_STATE);
  console.log(`Stored guids: ${state.postedGuids.length}`);

  // RSS 피드 가져오기
  let items;
  try {
    items = await fetchFeed(env.RSS_FEED_URL);
  } catch (e) {
    console.error("RSS fetch failed:", e);
    return;
  }
  console.log(`Feed items: ${items.length}`);

  if (items.length === 0) {
    await saveState(env.FEED_STATE, state);
    return;
  }

  // 새 항목 필터링 (이미 본 guid 제외)
  const seenSet = new Set(state.postedGuids);
  const newItems = items.filter((item) => !seenSet.has(item.guid));
  console.log(`New items: ${newItems.length}`);

  if (newItems.length === 0) {
    await saveState(env.FEED_STATE, state);
    return;
  }

  // 최신 것부터 최대 N개 선택
  const maxPosts = parseInt(env.MAX_POSTS_PER_RUN || "3", 10);
  const toPost = newItems.slice(0, maxPosts);

  // Bluesky 로그인 및 포스팅
  let agent;
  try {
    agent = await login(env.ATPROTO_SERVICE, env.BSKY_IDENTIFIER, env.BSKY_PASSWORD);
    console.log("ATProto login OK");
  } catch (e) {
    console.error("Bluesky login failed:", e);
    return;
  }

  // 오래된 것부터 포스팅 (타임라인에서 최신이 위로 오도록)
  for (let i = toPost.length - 1; i >= 0; i--) {
    const item = toPost[i];

    const freshState = await getState(env.FEED_STATE);
    if (freshState.postedGuids.includes(item.guid)) {
      console.log(`Already posted by another run, skipping: ${item.title}`);
      state.postedGuids = freshState.postedGuids;
      continue;
    }

    try {
      await createPost(agent, item.title, item.link);
      state.postedGuids.push(item.guid);
      await saveState(env.FEED_STATE, state);
      console.log(`Posted: ${item.title}`);
    } catch (e) {
      console.error(`Failed to post "${item.title}":`, e);
    }

    if (i > 0) {
      await sleep(1000);
    }
  }

  // 현재 피드의 모든 항목을 seen 처리 (이전 항목 backfill 방지)
  for (const item of items) {
    if (!seenSet.has(item.guid) && !state.postedGuids.includes(item.guid)) {
      state.postedGuids.push(item.guid);
    }
  }
  await saveState(env.FEED_STATE, state);

  console.log("Done");
}
