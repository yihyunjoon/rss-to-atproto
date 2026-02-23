import { AtpAgent, BlobRef, RichText } from "@atproto/api";

export async function login(
  service: string,
  identifier: string,
  password: string,
): Promise<AtpAgent> {
  const agent = new AtpAgent({ service });
  await agent.login({ identifier, password });
  return agent;
}

interface OgMeta {
  title: string;
  description: string;
  imageUrl: string | null;
}

async function fetchOgMeta(url: string): Promise<OgMeta> {
  const res = await fetch(url, {
    headers: { "User-Agent": "rss-to-atproto-bot/1.0" },
    redirect: "follow",
  });
  const html = await res.text();

  const get = (property: string): string => {
    const match = html.match(
      new RegExp(
        `<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
    );
    if (match) return match[1];
    // content가 property보다 앞에 오는 경우
    const alt = html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`,
        "i",
      ),
    );
    return alt ? alt[1] : "";
  };

  return {
    title: get("title"),
    description: get("description"),
    imageUrl: get("image") || null,
  };
}

const MAX_IMAGE_SIZE = 976_560; // ~976KB, Bluesky limit

async function uploadImage(
  agent: AtpAgent,
  imageUrl: string,
): Promise<BlobRef | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = await res.arrayBuffer();

    if (buf.byteLength > MAX_IMAGE_SIZE) {
      console.warn(`Image too large (${(buf.byteLength / 1024).toFixed(0)}KB), skipping thumb: ${imageUrl}`);
      return null;
    }

    const uploaded = await agent.uploadBlob(new Uint8Array(buf), {
      encoding: contentType,
    });
    return uploaded.data.blob;
  } catch (e) {
    console.warn(`Failed to upload image ${imageUrl}:`, e);
    return null;
  }
}

export async function createPost(
  agent: AtpAgent,
  title: string,
  url: string,
): Promise<void> {
  const text = title;

  const rt = new RichText({ text });
  await rt.detectFacets(agent);

  const og = await fetchOgMeta(url);
  console.log(`OG meta for ${url}: title=${og.title}, image=${og.imageUrl}`);

  const thumb = og.imageUrl ? await uploadImage(agent, og.imageUrl) : undefined;

  await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed: {
      $type: "app.bsky.embed.external",
      external: {
        uri: url,
        title: og.title || title,
        description: og.description || "",
        ...(thumb ? { thumb } : {}),
      },
    },
  });
}
