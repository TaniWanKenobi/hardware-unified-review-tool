import type { HardwareFile, ModelFileData, KiCadFileData } from '../store/useStore';

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';
const MODEL_EXTENSIONS = ['.stl', '.step', '.stp', '.obj', '.gltf', '.glb', '.ply', '.3mf'];
const KICAD_EXTENSIONS = ['.kicad_sch', '.kicad_pcb', '.kicad_prj', '.kicad_wks'];
const SUPPORTED_EXTENSIONS = [...MODEL_EXTENSIONS, ...KICAD_EXTENSIONS];

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
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const files: HardwareFile[] = [];
  const resolverMap = new Map<string, string>();

  if (!data.tree) {
    throw new Error('Unexpected API response');
  }

  for (const item of data.tree) {
    if (item.type !== 'blob') continue;

    // If a sub-path was specified, only include files under it
    if (path && !item.path.startsWith(path)) continue;

    const rawUrl = `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${item.path}`;
    const name = item.path.split('/').pop()!;

    resolverMap.set(item.path, rawUrl);
    resolverMap.set(name, rawUrl);

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

export async function fetchFileContent(
  url: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const response = await fetch(url);
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

      return streamResponse(await fetch(downloadUrl), size, onProgress);
    }

    // Not an LFS pointer – convert the already-read text back to an ArrayBuffer
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
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer as ArrayBuffer;
}

function getFileExtension(filename: string): string | null {
  const match = filename.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : null;
}

export function isGithubUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'github.com' || urlObj.hostname === 'www.github.com';
  } catch {
    return false;
  }
}
