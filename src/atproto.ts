import { AtpAgent, BlobRef, RichText } from "@atproto/api";
import { decode as decodeEntities } from "html-entities";

const USER_AGENT = "rss-to-atproto-bot/1.0";
const MAX_IMAGE_SIZE = 976_560; // ~976KB, Bluesky limit
const OG_FETCH_TIMEOUT_MS = 8_000;
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

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

type OgProperty = "og:title" | "og:description" | "og:image";

function isOgProperty(value: string): value is OgProperty {
  return value === "og:title" || value === "og:description" || value === "og:image";
}

function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return text ?? "";
  try {
    return decodeEntities(text);
  } catch {
    return text;
  }
}

async function withTimeout<T>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function toAbsoluteUrl(rawUrl: string | undefined, baseUrl: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeMimeType(value: string | null | undefined): string | null {
  if (!value) return null;
  const mimeType = value.split(";")[0]?.trim().toLowerCase();
  return mimeType || null;
}

async function fetchOgMeta(url: string): Promise<OgMeta> {
  const og: Partial<Record<OgProperty, string>> = {};
  let pageUrl = url;

  try {
    await withTimeout(OG_FETCH_TIMEOUT_MS, async (signal) => {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal,
      });

      if (!res.ok) {
        console.warn(`Failed to fetch page for OG metadata (${res.status}): ${url}`);
        return;
      }

      pageUrl = res.url || url;

      const rewritten = new HTMLRewriter()
        .on("meta", {
          element(element: any): void {
            const propertyOrName =
              element.getAttribute("property") ?? element.getAttribute("name");
            const content = element.getAttribute("content");

            if (!propertyOrName || !content) return;

            const normalizedProperty = propertyOrName.trim().toLowerCase();
            if (!isOgProperty(normalizedProperty) || og[normalizedProperty]) return;

            const normalizedContent = decodeHtmlEntities(content.trim());
            if (!normalizedContent) return;
            og[normalizedProperty] = normalizedContent;
          },
        })
        .transform(res);

      await rewritten.arrayBuffer();
    });
  } catch (error) {
    if (isAbortError(error)) {
      console.warn(`OG metadata fetch timed out: ${url}`);
    } else {
      console.warn(`Failed to parse OG metadata from ${url}:`, error);
    }
  }

  return {
    title: og["og:title"] || "",
    description: og["og:description"] || "",
    imageUrl: toAbsoluteUrl(og["og:image"], pageUrl),
  };
}

async function uploadImage(
  agent: AtpAgent,
  imageUrl: string,
): Promise<BlobRef | null> {
  try {
    const image = await withTimeout(IMAGE_FETCH_TIMEOUT_MS, async (signal) => {
      const res = await fetch(imageUrl, {
        redirect: "follow",
        signal,
      });
      if (!res.ok) {
        console.warn(`Failed to fetch image (${res.status}), skipping thumb: ${imageUrl}`);
        return null;
      }

      const headerMimeType = normalizeMimeType(res.headers.get("content-type"));
      if (headerMimeType && !headerMimeType.startsWith("image/")) {
        console.warn(
          `Content type is not image (${headerMimeType}), skipping thumb: ${imageUrl}`,
        );
        return null;
      }

      const declaredLength = parseContentLength(res.headers.get("content-length"));
      if (declaredLength !== null && declaredLength > MAX_IMAGE_SIZE) {
        console.warn(
          `Image too large (${(declaredLength / 1024).toFixed(0)}KB declared), skipping thumb: ${imageUrl}`,
        );
        return null;
      }

      const blob = await res.blob();
      return { blob, headerMimeType };
    });

    if (!image) {
      return null;
    }

    if (image.blob.size > MAX_IMAGE_SIZE) {
      console.warn(
        `Image too large (${(image.blob.size / 1024).toFixed(0)}KB), skipping thumb: ${imageUrl}`,
      );
      return null;
    }

    const blobMimeType = normalizeMimeType(image.blob.type);
    const encoding = blobMimeType || image.headerMimeType || "image/jpeg";

    const uploaded = await agent.uploadBlob(image.blob, {
      encoding,
    });
    return uploaded.data.blob;
  } catch (error) {
    if (isAbortError(error)) {
      console.warn(`Image fetch timed out, skipping thumb: ${imageUrl}`);
      return null;
    }
    console.warn(`Failed to upload image ${imageUrl}:`, error);
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
