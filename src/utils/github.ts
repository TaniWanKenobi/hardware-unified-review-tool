import type {
  HardwareFile,
  ModelFileData,
  KiCadFileData,
  EasyEdaFileData,
} from '../store/useStore';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const MODEL_EXTENSIONS = ['.stl', '.step', '.stp', '.obj', '.gltf', '.glb', '.ply', '.3mf'];
const KICAD_EXTENSIONS = ['.kicad_sch', '.kicad_pcb', '.kicad_prj', '.kicad_wks'];
const EASYEDA_EXTENSIONS = ['.json', '.epro', '.zip'];
const SUPPORTED_EXTENSIONS = [...MODEL_EXTENSIONS, ...KICAD_EXTENSIONS, ...EASYEDA_EXTENSIONS];

/**
 * Fetch all files from a GitHub repo using the Git Trees API (single request).
 * Falls back to the Contents API if the tree is truncated.
 */
export async function fetchRepositoryFiles(
  owner: string,
  repo: string,
  branch: string = 'main',
  path: string = ''
): Promise<{ files: HardwareFile[], resolverMap: Map<string, string> }> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, '');
  const resolved = await resolveTreeForBranchAndPath(owner, repo, branch, normalizedPath);
  const data = resolved.data;
  const files: HardwareFile[] = [];
  const resolverMap = new Map<string, string>();

  if (!data.tree) {
    throw new Error('Unexpected API response');
  }

  for (const item of data.tree) {
    if (item.type !== 'blob') continue;

    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${encodeURIComponent(
      resolved.branch
    )}/${item.path}`;
    const name = item.path.split('/').pop()!;

    // Always populate resolver map for all repo blobs so KiCad cross-file references can resolve.
    resolverMap.set(item.path, rawUrl);
    resolverMap.set(name, rawUrl);

    // If a sub-path was specified, only include files under it
    if (resolved.path && !item.path.startsWith(resolved.path)) continue;

    const ext = getFileExtension(name);
    if (ext && SUPPORTED_EXTENSIONS.includes(ext)) {
      if (KICAD_EXTENSIONS.includes(ext)) {
        files.push({
          kind: 'kicad',
          name,
          path: item.path,
          url: rawUrl,
          type: ext.slice(1) as KiCadFileData['type'],
          size: item.size
        });
      } else if (EASYEDA_EXTENSIONS.includes(ext)) {
        files.push({
          kind: 'easyeda',
          name,
          path: item.path,
          url: rawUrl,
          type: mapEasyEdaType(ext),
          size: item.size,
        });
      } else {
        files.push({
          kind: 'model',
          name,
          path: item.path,
          url: rawUrl,
          type: ext.slice(1) as ModelFileData['type'],
          size: item.size
        });
      }
    }
  }

  return { files, resolverMap };
}

async function resolveTreeForBranchAndPath(
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<{ branch: string; path: string; data: any }> {
  const attempts: Array<{ branch: string; path: string }> = [{ branch, path }];

  // Handle branch names containing '/' when URL parsing split them into path.
  if (path) {
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      attempts.push({
        branch: `${branch}/${parts.slice(0, i).join('/')}`,
        path: parts.slice(i).join('/'),
      });
    }
  }

  const defaultBranch = await fetchDefaultBranch(owner, repo);
  if (defaultBranch && !attempts.some((attempt) => attempt.branch === defaultBranch)) {
    attempts.push({ branch: defaultBranch, path });
  }
  if (!attempts.some((attempt) => attempt.branch === 'master')) {
    attempts.push({ branch: 'master', path });
  }
  if (!attempts.some((attempt) => attempt.branch === 'main')) {
    attempts.push({ branch: 'main', path });
  }

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      const data = await fetchGitTree(owner, repo, attempt.branch);
      return { branch: attempt.branch, path: attempt.path, data };
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error('Failed to resolve repository tree');
}

async function fetchGitTree(owner: string, repo: string, branch: string): Promise<any> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(
    branch
  )}?recursive=1`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchDefaultBranch(owner: string, repo: string): Promise<string | null> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`);
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.default_branch === 'string' ? data.default_branch : null;
  } catch {
    return null;
  }
}

export async function fetchFileContent(
  url: string,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);

  // If the response is small, check whether it's a Git LFS pointer
  if (contentLength > 0 && contentLength < 1024) {
    const text = await response.text();

    if (text.startsWith('version https://git-lfs.github.com')) {
      const oidMatch = text.match(/^oid sha256:([0-9a-f]+)$/m);
      const sizeMatch = text.match(/^size (\d+)$/m);
      if (!oidMatch || !sizeMatch) {
        throw new Error('Failed to parse LFS pointer file');
      }

      const oid = oidMatch[1];
      const size = parseInt(sizeMatch[1], 10);

      // Parse owner/repo from the raw URL:
      // https://raw.githubusercontent.com/{owner}/{repo}/{branch}/...
      const rawUrlMatch = url.match(
        /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\//
      );
      if (!rawUrlMatch) {
        throw new Error('Cannot determine owner/repo from raw URL for LFS fetch');
      }
      const [, owner, repo] = rawUrlMatch;

      const batchResponse = await fetch(
        `https://github.com/${owner}/${repo}.git/info/lfs/objects/batch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/vnd.git-lfs+json',
            Accept: 'application/vnd.git-lfs+json',
          },
          signal,
          body: JSON.stringify({
            operation: 'download',
            transfers: ['basic'],
            objects: [{ oid, size }],
          }),
        }
      );

      if (!batchResponse.ok) {
        throw new Error(
          `LFS batch API error: ${batchResponse.status} ${batchResponse.statusText}`
        );
      }

      const batchData = await batchResponse.json();
      const downloadUrl: string | undefined =
        batchData?.objects?.[0]?.actions?.download?.href;
      if (!downloadUrl) {
        throw new Error('LFS batch API did not return a download URL');
      }

      return streamResponse(await fetch(downloadUrl, { signal }), size, onProgress);
    }

    // Not an LFS pointer - convert the already-read text back to an ArrayBuffer
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
  }

  return streamResponse(response, contentLength, onProgress);
}

async function streamResponse(
  response: Response,
  total: number,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  if (!onProgress || !response.body) {
    return response.arrayBuffer();
  }

  const reader = response.body.getReader();
  let loaded = 0;

  // Fast path for known-size payloads: one allocation, no chunk re-copy.
  if (total > 0) {
    let result = new Uint8Array(total);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // Some responses report compressed content-length but stream decompressed bytes.
      // Grow buffer when actual payload exceeds reported size.
      if (loaded + value.byteLength > result.length) {
        const required = loaded + value.byteLength;
        const nextLength = Math.max(result.length * 2, required);
        const grown = new Uint8Array(nextLength);
        grown.set(result, 0);
        result = grown;
      }

      result.set(value, loaded);
      loaded += value.byteLength;
      onProgress(loaded, Math.max(total, loaded));
    }

    if (loaded === total) {
      return result.buffer as ArrayBuffer;
    }

    return result.slice(0, loaded).buffer as ArrayBuffer;
  }

  // Unknown payload size: grow a single buffer instead of storing all chunks,
  // which reduces peak memory for very large files.
  let capacity = 1024 * 1024;
  let result = new Uint8Array(capacity);

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    if (loaded + value.byteLength > capacity) {
      while (loaded + value.byteLength > capacity) {
        capacity *= 2;
      }
      const grown = new Uint8Array(capacity);
      grown.set(result, 0);
      result = grown;
    }

    result.set(value, loaded);
    loaded += value.byteLength;
    onProgress(loaded, loaded);
  }

  return result.slice(0, loaded).buffer as ArrayBuffer;
}

function getFileExtension(filename: string): string | null {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : null;
}

function mapEasyEdaType(ext: string): EasyEdaFileData['type'] {
  switch (ext) {
    case '.json':
      return 'easyeda_json';
    case '.epro':
      return 'easyeda_epro';
    case '.zip':
      return 'easyeda_zip';
    default:
      return 'easyeda_json';
  }
}

export function isGithubUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'github.com' || urlObj.hostname === 'www.github.com';
  } catch {
    return false;
  }
}
