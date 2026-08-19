// ════════════════════════════════════════════════════════════════════════════
//  releaseApi.ts: reads the latest release from the GitHub Releases API.
//
//  The release body is the notes and published_at is the date, so nothing has to
//  be plumbed through a publish step. The endpoint is public, so no token is sent
//  and none should be added: a leaked token is worse than an anonymous rate limit.
// ════════════════════════════════════════════════════════════════════════════
import { config } from './config';
import { logger } from './logger';

/** The shape announce.ts consumes. Kept identical to the old manifest so the
 *  announcement/downloads rendering did not have to change. */
export interface VersionManifest {
  latest: string;
  url?: string;
  sha256?: string;
  kind?: string;
  notes?: string;
  publishedAt?: string;
}

export interface ApiResult<T> { ok: boolean; status: number; data: T | null; error?: string }

interface GitHubAsset { name?: string; browser_download_url?: string }
interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GitHubAsset[];
}

/** `v1.4.10` → `1.4.10`. The updater and the bot both compare bare semver. */
function stripV(tag: string): string {
  return tag.replace(/^v/i, '').trim();
}

/** Pick the installer from the release assets, preferring the .exe. */
function pickDownloadUrl(assets: GitHubAsset[] | undefined): string | undefined {
  if (!assets || assets.length === 0) return undefined;
  const exe = assets.find((a) => (a.name || '').toLowerCase().endsWith('.exe'));
  return (exe ?? assets[0]).browser_download_url;
}

/**
 * Latest published (non-draft, non-prerelease) release.
 *
 * Note: `/releases/latest` already excludes drafts and prereleases, which is
 * what we want. A prerelease must never trigger a public announcement.
 */
export async function getLatestRelease(): Promise<ApiResult<VersionManifest>> {
  const url = `https://api.github.com/repos/${config.githubRepo}/releases/latest`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ssim-discord-bot',
      },
    });

    if (res.status === 404) {
      // No published release yet, or the repo is still private. Both are normal
      // states during the migration, so this is not an error worth alerting on.
      return { ok: false, status: 404, data: null, error: 'no published release (or repo not public yet)' };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}` };
    }

    const rel = (await res.json()) as GitHubRelease;
    const tag = (rel.tag_name || '').trim();
    if (!tag) return { ok: false, status: res.status, data: null, error: 'release has no tag_name' };

    return {
      ok: true,
      status: res.status,
      data: {
        latest: stripV(tag),
        url: pickDownloadUrl(rel.assets),
        notes: rel.body || undefined,
        publishedAt: rel.published_at || undefined,
      },
    };
  } catch (err) {
    logger.error('GitHub release lookup failed', { err: (err as Error).message });
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  }
}
