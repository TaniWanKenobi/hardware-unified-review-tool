import { useEffect, useState } from 'react';
import type { EasyEdaFileData } from '../store/useStore';
import { fetchFileContent } from '../utils/github';
import {
  analyzeEasyEdaJson,
  inspectEasyEdaArchive,
  tryParseJsonContent,
  type EasyEdaArchiveInspection,
  type EasyEdaDocumentKind,
  type EasyEdaJsonInspection,
} from '../utils/easyeda';

type EasyEdaReadResult =
  | {
      mode: 'json';
      sourceLabel: string;
      inspection: EasyEdaJsonInspection;
      preview: string;
      truncated: boolean;
    }
  | {
      mode: 'archive';
      archiveFormat: 'EPRO' | 'ZIP';
      inspection: EasyEdaArchiveInspection;
    };

type EasyEdaViewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: EasyEdaReadResult };

const JSON_PREVIEW_LIMIT = 18000;
const ARCHIVE_ENTRY_PREVIEW_LIMIT = 140;

export default function EasyEdaViewer({ file }: { file: EasyEdaFileData }) {
  const [state, setState] = useState<EasyEdaViewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    setState({ status: 'loading' });

    const readFile = async () => {
      try {
        const content = await fetchFileContent(file.url, undefined, controller.signal);
        if (cancelled) return;

        const parsedJson = tryParseJsonContent(content);
        const archiveFormat = file.type === 'easyeda_epro' ? 'EPRO' : 'ZIP';

        if (file.type === 'easyeda_json') {
          if (!parsedJson) {
            throw new Error('File extension is .json but content is not valid JSON.');
          }
          setState({
            status: 'ready',
            result: buildJsonResult(parsedJson.value, file.name, 'JSON', parsedJson.text),
          });
          return;
        }

        // Some .epro files are plain JSON rather than ZIP archives.
        if (parsedJson) {
          setState({
            status: 'ready',
            result: buildJsonResult(
              parsedJson.value,
              file.name,
              archiveFormat,
              parsedJson.text
            ),
          });
          return;
        }

        const archiveInspection = await inspectEasyEdaArchive(content);
        if (cancelled) return;

        setState({
          status: 'ready',
          result: {
            mode: 'archive',
            archiveFormat,
            inspection: archiveInspection,
          },
        });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to read EasyEDA file',
        });
      }
    };

    void readFile();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [file.name, file.type, file.url]);

  if (state.status === 'loading') {
    return (
      <div className="easyeda-viewer-loading">
        <div className="spinner"></div>
        <p>Reading EasyEDA file...</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="easyeda-viewer-error">
        <div className="error-icon">!</div>
        <p>{state.message}</p>
      </div>
    );
  }

  const result = state.result;
  if (result.mode === 'json') {
    return (
      <div className="easyeda-viewer">
        <div className="easyeda-summary">
          <h3>{file.name}</h3>
          <p>
            Source: <strong>{result.sourceLabel}</strong> | Detected document:{' '}
            <strong>{formatDocumentKind(result.inspection.documentKind)}</strong>
          </p>
          <p>
            EasyEDA signature:{' '}
            <strong>{result.inspection.isEasyEda ? 'Likely' : 'Not detected'}</strong>
          </p>
          {result.inspection.topLevelKeys.length > 0 && (
            <p className="easyeda-muted">
              Top-level keys: {result.inspection.topLevelKeys.slice(0, 18).join(', ')}
            </p>
          )}
        </div>
        <pre className="easyeda-json-preview">{result.preview}</pre>
        {result.truncated && (
          <p className="easyeda-muted">
            JSON preview truncated to {JSON_PREVIEW_LIMIT.toLocaleString()} characters.
          </p>
        )}
      </div>
    );
  }

  const entries = result.inspection.entries;
  const detectedDocs = entries.filter((entry) => entry.isEasyEdaJson);
  const displayedEntries = entries.slice(0, ARCHIVE_ENTRY_PREVIEW_LIMIT);

  return (
    <div className="easyeda-viewer">
      <div className="easyeda-summary">
        <h3>{file.name}</h3>
        <p>
          Source: <strong>{result.archiveFormat}</strong> archive | Entries:{' '}
          <strong>{entries.length}</strong>
        </p>
        <p>
          Detected EasyEDA JSON docs: <strong>{detectedDocs.length}</strong>
        </p>
        {result.inspection.skippedJsonEntries > 0 && (
          <p className="easyeda-muted">
            Skipped JSON inspection for {result.inspection.skippedJsonEntries} archive entries
            (size/compression limits).
          </p>
        )}
        {result.inspection.unsupportedEntries > 0 && (
          <p className="easyeda-muted">
            {result.inspection.unsupportedEntries} entries use unsupported compression.
          </p>
        )}
      </div>

      <div className="easyeda-entry-list">
        {displayedEntries.map((entry, index) => (
          <div className="easyeda-entry-row" key={`${entry.name}-${index}`}>
            <span className="easyeda-entry-name">{entry.name}</span>
            <span className="easyeda-entry-kind">
              {entry.easyEdaDocumentKind
                ? formatDocumentKind(entry.easyEdaDocumentKind)
                : entry.isEasyEdaJson
                  ? 'JSON'
                  : 'File'}
            </span>
            <span className="easyeda-entry-size">{formatBytes(entry.size)}</span>
          </div>
        ))}
      </div>

      {entries.length > displayedEntries.length && (
        <p className="easyeda-muted">
          Showing first {ARCHIVE_ENTRY_PREVIEW_LIMIT} of {entries.length} entries.
        </p>
      )}
    </div>
  );
}

function buildJsonResult(
  value: unknown,
  filename: string,
  sourceLabel: string,
  sourceText?: string
): EasyEdaReadResult {
  const inspection = analyzeEasyEdaJson(value, filename);
  const previewSource = sourceText ?? JSON.stringify(value, null, 2);
  const truncated = previewSource.length > JSON_PREVIEW_LIMIT;
  const preview = truncated
    ? `${previewSource.slice(0, JSON_PREVIEW_LIMIT)}\n...`
    : previewSource;

  return {
    mode: 'json',
    sourceLabel,
    inspection,
    preview,
    truncated,
  };
}

function formatDocumentKind(kind: EasyEdaDocumentKind): string {
  switch (kind) {
    case 'schematic':
      return 'Schematic';
    case 'pcb':
      return 'PCB';
    case 'library':
      return 'Library';
    case 'project':
      return 'Project';
    default:
      return 'Unknown';
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

