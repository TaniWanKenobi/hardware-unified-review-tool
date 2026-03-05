const STORAGE_KEY = 'hurt-load-metrics-v1';
const MB = 1024 * 1024;
const EWMA_ALPHA = 0.3;

type ProcessingProfile = 'server-step' | 'client-step' | 'model-generic';

interface LoadMetricsData {
  downloadBps: number;
  processingSecPerMb: Record<ProcessingProfile, number>;
}

const DEFAULT_METRICS: LoadMetricsData = {
  downloadBps: 8 * MB,
  processingSecPerMb: {
    'server-step': 1.8,
    'client-step': 5.0,
    'model-generic': 0.9,
  },
};

let cachedMetrics: LoadMetricsData | null = null;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function ewma(previous: number, next: number): number {
  return previous * (1 - EWMA_ALPHA) + next * EWMA_ALPHA;
}

function cloneDefaults(): LoadMetricsData {
  return {
    downloadBps: DEFAULT_METRICS.downloadBps,
    processingSecPerMb: { ...DEFAULT_METRICS.processingSecPerMb },
  };
}

function loadMetrics(): LoadMetricsData {
  if (cachedMetrics) return cachedMetrics;
  const defaults = cloneDefaults();

  if (!canUseStorage()) {
    cachedMetrics = defaults;
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cachedMetrics = defaults;
      return defaults;
    }

    const parsed = JSON.parse(raw) as Partial<LoadMetricsData>;
    cachedMetrics = {
      downloadBps:
        typeof parsed.downloadBps === 'number' && Number.isFinite(parsed.downloadBps)
          ? Math.max(parsed.downloadBps, 64 * 1024)
          : defaults.downloadBps,
      processingSecPerMb: {
        'server-step':
          typeof parsed.processingSecPerMb?.['server-step'] === 'number'
            ? Math.max(parsed.processingSecPerMb['server-step'], 0.05)
            : defaults.processingSecPerMb['server-step'],
        'client-step':
          typeof parsed.processingSecPerMb?.['client-step'] === 'number'
            ? Math.max(parsed.processingSecPerMb['client-step'], 0.05)
            : defaults.processingSecPerMb['client-step'],
        'model-generic':
          typeof parsed.processingSecPerMb?.['model-generic'] === 'number'
            ? Math.max(parsed.processingSecPerMb['model-generic'], 0.05)
            : defaults.processingSecPerMb['model-generic'],
      },
    };
    return cachedMetrics;
  } catch {
    cachedMetrics = defaults;
    return defaults;
  }
}

function persistMetrics(data: LoadMetricsData): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage failures (quota/private mode).
  }
}

export function estimateDownloadSeconds(bytesRemaining: number): number | null {
  if (!Number.isFinite(bytesRemaining) || bytesRemaining <= 0) return 0;
  const metrics = loadMetrics();
  if (metrics.downloadBps <= 0) return null;
  return bytesRemaining / metrics.downloadBps;
}

export function updateDownloadRate(bytesLoaded: number, elapsedSeconds: number): void {
  if (!Number.isFinite(bytesLoaded) || !Number.isFinite(elapsedSeconds)) return;
  if (bytesLoaded < 256 * 1024 || elapsedSeconds < 0.25) return;

  const sampleBps = bytesLoaded / elapsedSeconds;
  if (!Number.isFinite(sampleBps) || sampleBps <= 0) return;

  const metrics = loadMetrics();
  metrics.downloadBps = Math.max(64 * 1024, ewma(metrics.downloadBps, sampleBps));
  persistMetrics(metrics);
}

export function estimateProcessingSeconds(
  profile: ProcessingProfile,
  fileSizeBytes: number
): number | null {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) return null;
  const metrics = loadMetrics();
  const perMb = metrics.processingSecPerMb[profile] ?? DEFAULT_METRICS.processingSecPerMb[profile];
  return perMb * (fileSizeBytes / MB);
}

export function updateProcessingEstimate(
  profile: ProcessingProfile,
  fileSizeBytes: number,
  elapsedSeconds: number
): void {
  if (!Number.isFinite(fileSizeBytes) || !Number.isFinite(elapsedSeconds)) return;
  if (fileSizeBytes <= 0 || elapsedSeconds <= 0.2) return;

  const sampleSecPerMb = elapsedSeconds / (fileSizeBytes / MB);
  if (!Number.isFinite(sampleSecPerMb) || sampleSecPerMb <= 0) return;

  const metrics = loadMetrics();
  const previous = metrics.processingSecPerMb[profile] ?? DEFAULT_METRICS.processingSecPerMb[profile];
  metrics.processingSecPerMb[profile] = Math.max(0.05, ewma(previous, sampleSecPerMb));
  persistMetrics(metrics);
}

