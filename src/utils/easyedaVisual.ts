import type { EasyEdaDocumentKind } from './easyeda';

type TextAnchor = 'start' | 'middle' | 'end';

interface Point {
  x: number;
  y: number;
}

interface BasePrimitive {
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  opacity: number;
}

export type EasyEdaVisualPrimitive =
  | (BasePrimitive & {
      kind: 'polyline';
      points: Point[];
      closed: boolean;
    })
  | (BasePrimitive & {
      kind: 'path';
      path: string;
    })
  | (BasePrimitive & {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
    })
  | (BasePrimitive & {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx: number;
      ry: number;
      rotation: number;
    })
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      size: number;
      rotation: number;
      fill: string;
      opacity: number;
      anchor: TextAnchor;
    };

export interface EasyEdaVisualBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface EasyEdaVisualDocument {
  title: string;
  documentKind: EasyEdaDocumentKind;
  primitives: EasyEdaVisualPrimitive[];
  bounds: EasyEdaVisualBounds;
  shapeCount: number;
  unknownShapePrefixes: string[];
}

const BACKGROUND_COLOR = '#131218';
const DEFAULT_PCB_STROKE = '#8fd0ff';
const DEFAULT_SCHEMATIC_STROKE = '#8fe2c4';
const DEFAULT_FILL_OPACITY = 0.25;

const PCB_LAYER_COLORS: Record<string, string> = {
  '1': '#ff9f1c',
  '2': '#2ec4b6',
  '3': '#f8f9fa',
  '4': '#ced4da',
  '5': '#f77f00',
  '6': '#4cc9f0',
  '7': '#ff595e',
  '8': '#8ecae6',
  '10': '#84f26a',
  '11': '#ffd166',
  '12': '#bdb2ff',
  '13': '#f4a261',
  '14': '#a8dadc',
  '15': '#90be6d',
  '19': '#e9ecef',
};

export function buildEasyEdaVisualDocument(
  source: unknown,
  filename: string,
  kindHint: EasyEdaDocumentKind
): EasyEdaVisualDocument | null {
  const root = resolvePrimaryDocument(source);
  if (!root) {
    return null;
  }

  const rawShapes = root.shape;
  if (!Array.isArray(rawShapes) || rawShapes.length === 0) {
    return null;
  }

  const shapeLines = rawShapes
    .filter((entry): entry is string => typeof entry === 'string')
    .flatMap(splitShapeLines);
  if (shapeLines.length === 0) {
    return null;
  }

  const unknownPrefixes = new Set<string>();
  const primitives: EasyEdaVisualPrimitive[] = [];

  for (const line of shapeLines) {
    const parsed = parseShapeLine(line, kindHint, unknownPrefixes);
    if (parsed.length > 0) {
      primitives.push(...parsed);
    }
  }

  if (primitives.length === 0) {
    return null;
  }

  const bounds = computeBounds(primitives);
  if (!bounds) {
    return null;
  }

  return {
    title: filename,
    documentKind: kindHint,
    primitives,
    bounds,
    shapeCount: shapeLines.length,
    unknownShapePrefixes: Array.from(unknownPrefixes).sort(),
  };
}

function resolvePrimaryDocument(source: unknown): Record<string, unknown> | null {
  const record = asRecord(source);
  if (!record) {
    return null;
  }
  if (Array.isArray(record.shape)) {
    return record;
  }

  const schematics = Array.isArray(record.schematics) ? record.schematics : [];
  for (const schematic of schematics) {
    const nested = asRecord(schematic);
    if (nested && Array.isArray(nested.shape)) {
      return nested;
    }
  }

  return null;
}

function splitShapeLines(rawShape: string): string[] {
  return rawShape
    .replace(/#@\$/g, '\n')
    .replace(/@\$/g, '\n')
    .split(/\r?\n/)
    .map((part) => part.trim().replace(/^#+/, '').trim())
    .filter((part) => part.length > 0);
}

function parseShapeLine(
  line: string,
  kindHint: EasyEdaDocumentKind,
  unknownPrefixes: Set<string>
): EasyEdaVisualPrimitive[] {
  const parts = line.split('~');
  const head = parts[0] ?? '';
  const tokens = head.split('_');
  const prefix = (tokens[0] ?? '').trim().toUpperCase();
  if (!prefix) {
    return [];
  }

  const defaultStroke = kindHint === 'schematic' ? DEFAULT_SCHEMATIC_STROKE : DEFAULT_PCB_STROKE;

  switch (prefix) {
    case 'TRACK': {
      const points = parsePoints(tokens[4] ?? '');
      if (points.length < 2) return [];
      const layer = tokens[2] ?? '';
      return [
        {
          kind: 'polyline',
          points,
          closed: false,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(tokens[1], 1.2),
          fill: null,
          opacity: 1,
        },
      ];
    }
    case 'CIRCLE': {
      const r = Math.abs(number(tokens[3], 0));
      if (r <= 0) return [];
      const layer = tokens[5] ?? '';
      return [
        {
          kind: 'circle',
          cx: number(tokens[1], 0),
          cy: number(tokens[2], 0),
          r,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(tokens[4], 1),
          fill: null,
          opacity: 1,
        },
      ];
    }
    case 'RECT': {
      const normalized = normalizeRect(
        number(tokens[1], 0),
        number(tokens[2], 0),
        number(tokens[3], 0),
        number(tokens[4], 0)
      );
      if (normalized.width <= 0 || normalized.height <= 0) {
        return [];
      }
      const layer = tokens[5] ?? '';
      const styleValues = splitWhitespace(parts[1]);
      return [
        {
          kind: 'rect',
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          rx: 0,
          ry: 0,
          rotation: 0,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(styleValues[0], 0.8),
          fill: normalizeColor(styleValues[1] ?? parts[2], null),
          opacity: 1,
        },
      ];
    }
    case 'ARC': {
      const layer = tokens[2] ?? '';
      const path = tokens.slice(4).join('_').trim();
      if (!path) return [];
      return [
        {
          kind: 'path',
          path,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(tokens[1], 1),
          fill: null,
          opacity: 1,
        },
      ];
    }
    case 'SOLIDREGION':
    case 'COPPERAREA': {
      const layer = tokens[1] ?? tokens[2] ?? '';
      const path = prefix === 'SOLIDREGION' ? tokens.slice(3).join('_') : tokens.slice(4).join('_');
      if (!path.trim()) return [];
      const color = layerColor(layer, defaultStroke);
      return [
        {
          kind: 'path',
          path: path.trim(),
          stroke: color,
          strokeWidth: 0.4,
          fill: color,
          opacity: DEFAULT_FILL_OPACITY,
        },
      ];
    }
    case 'SVGNODE': {
      const payload = parseSvgNodePayload(parts[1]);
      if (!payload?.pathData) return [];
      const color = layerColor(payload.layerId, defaultStroke);
      return [
        {
          kind: 'path',
          path: payload.pathData,
          stroke: color,
          strokeWidth: 0.5,
          fill: color,
          opacity: DEFAULT_FILL_OPACITY,
        },
      ];
    }
    case 'TEXT': {
      const displayToken = (parts[1] ?? '').toLowerCase();
      if (displayToken.includes('none')) return [];
      const layer = tokens[6] ?? '';
      const text = decodeEasyEdaText(tokens[8] ?? '');
      if (!text) return [];
      return [
        {
          kind: 'text',
          x: number(tokens[2], 0),
          y: number(tokens[3], 0),
          text,
          size: positiveNumber(tokens[7], 8),
          rotation: number(tokens[5], 0),
          fill: layerColor(layer, defaultStroke),
          opacity: 0.95,
          anchor: 'start',
        },
      ];
    }
    case 'VIA': {
      const x = number(tokens[1], 0);
      const y = number(tokens[2], 0);
      const diameter = Math.abs(number(tokens[3], 0));
      if (diameter <= 0) return [];
      const drillRadius = Math.abs(number(tokens[5], 0));
      const outer = diameter / 2;
      const inner = drillRadius > 0 ? Math.min(outer * 0.9, drillRadius) : 0;
      const layerColorValue = layerColor('1', defaultStroke);
      const output: EasyEdaVisualPrimitive[] = [
        {
          kind: 'circle',
          cx: x,
          cy: y,
          r: outer,
          stroke: layerColorValue,
          strokeWidth: 0.6,
          fill: layerColorValue,
          opacity: 0.85,
        },
      ];
      if (inner > 0) {
        output.push({
          kind: 'circle',
          cx: x,
          cy: y,
          r: inner,
          stroke: '#2f2b3b',
          strokeWidth: 0.4,
          fill: BACKGROUND_COLOR,
          opacity: 1,
        });
      }
      return output;
    }
    case 'HOLE': {
      const radius = Math.abs(number(tokens[3], 0));
      if (radius <= 0) return [];
      return [
        {
          kind: 'circle',
          cx: number(tokens[1], 0),
          cy: number(tokens[2], 0),
          r: radius,
          stroke: '#cbd5e1',
          strokeWidth: 0.6,
          fill: BACKGROUND_COLOR,
          opacity: 1,
        },
      ];
    }
    case 'PAD': {
      return parsePad(tokens, defaultStroke);
    }
    case 'W':
    case 'PL':
    case 'PG': {
      const points = parsePoints(tokens[1] ?? '');
      if (points.length < 2) return [];
      return [
        {
          kind: 'polyline',
          points,
          closed: prefix === 'PG',
          stroke: normalizeColor(tokens[2], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(tokens[3], 1),
          fill: prefix === 'PG' ? normalizeColor(tokens[5], null) : null,
          opacity: 1,
        },
      ];
    }
    case 'PT':
    case 'A': {
      const path = tokens[1] ?? '';
      if (!path.trim()) return [];
      return [
        {
          kind: 'path',
          path,
          stroke: normalizeColor(tokens[2], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(tokens[3], 1),
          fill: normalizeColor(tokens[5], null),
          opacity: 1,
        },
      ];
    }
    case 'R': {
      const normalized = normalizeRect(
        number(tokens[1], 0),
        number(tokens[2], 0),
        number(tokens[5], 0),
        number(tokens[6], 0)
      );
      if (normalized.width <= 0 || normalized.height <= 0) return [];
      return [
        {
          kind: 'rect',
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          rx: Math.abs(number(tokens[3], 0)),
          ry: Math.abs(number(tokens[4], 0)),
          rotation: 0,
          stroke: normalizeColor(tokens[7], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(tokens[8], 1),
          fill: normalizeColor(tokens[10], null),
          opacity: 1,
        },
      ];
    }
    case 'E': {
      const cx = number(tokens[1], 0);
      const cy = number(tokens[2], 0);
      const rx = Math.abs(number(tokens[3], 0));
      const ry = Math.abs(number(tokens[4], rx));
      if (rx <= 0 || ry <= 0) return [];
      return [
        {
          kind: 'rect',
          x: cx - rx,
          y: cy - ry,
          width: rx * 2,
          height: ry * 2,
          rx,
          ry,
          rotation: 0,
          stroke: normalizeColor(tokens[5], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(tokens[6], 1),
          fill: normalizeColor(tokens[8], null),
          opacity: 1,
        },
      ];
    }
    case 'T':
    case 'N': {
      const text = decodeEasyEdaText(prefix === 'N' ? tokens[4] ?? '' : tokens[8] ?? '');
      if (!text) return [];
      return [
        {
          kind: 'text',
          x: number(tokens[1] ?? tokens[2], 0),
          y: number(tokens[2] ?? tokens[3], 0),
          text,
          size: positiveNumber(prefix === 'N' ? parts[1] : tokens[7], 7),
          rotation: number(tokens[3] ?? tokens[4], 0),
          fill: normalizeColor(tokens[5], defaultStroke) ?? defaultStroke,
          opacity: 0.95,
          anchor: prefix === 'N' ? 'middle' : inferTextAnchor(parts[2] ?? 'start'),
        },
      ];
    }
    case 'J': {
      const diameter = positiveNumber(parts[1], 3);
      return [
        {
          kind: 'circle',
          cx: number(tokens[1], 0),
          cy: number(tokens[2], 0),
          r: diameter / 2,
          stroke: defaultStroke,
          strokeWidth: 0.6,
          fill: defaultStroke,
          opacity: 1,
        },
      ];
    }
    case 'O': {
      const x = number(tokens[1], 0);
      const y = number(tokens[2], 0);
      const size = 3;
      return [
        {
          kind: 'polyline',
          points: [
            { x: x - size, y: y - size },
            { x: x + size, y: y + size },
          ],
          closed: false,
          stroke: defaultStroke,
          strokeWidth: 0.9,
          fill: null,
          opacity: 1,
        },
        {
          kind: 'polyline',
          points: [
            { x: x + size, y: y - size },
            { x: x - size, y: y + size },
          ],
          closed: false,
          stroke: defaultStroke,
          strokeWidth: 0.9,
          fill: null,
          opacity: 1,
        },
      ];
    }
    default: {
      if (
        prefix !== 'LIB' &&
        prefix !== 'F' &&
        prefix !== 'P' &&
        prefix !== 'PIN' &&
        prefix !== 'DIMENSION' &&
        prefix !== 'I' &&
        prefix !== 'PIMAGE'
      ) {
        unknownPrefixes.add(prefix);
      }
      return [];
    }
  }
}

function parsePad(tokens: string[], fallbackStroke: string): EasyEdaVisualPrimitive[] {
  const shape = (tokens[1] ?? '').toUpperCase();
  const x = number(tokens[2], 0);
  const y = number(tokens[3], 0);
  const width = Math.abs(number(tokens[4], 0));
  const height = Math.abs(number(tokens[5], width));
  if (width <= 0 || height <= 0) {
    return [];
  }

  const layer = tokens[6] ?? '';
  const color = layerColor(layer, fallbackStroke);
  const rotation = number(tokens[10], 0);
  const padPrimitives: EasyEdaVisualPrimitive[] = [];

  if (shape === 'POLYGON') {
    const polygonPoints = parsePoints(tokens[9] ?? '');
    if (polygonPoints.length >= 3) {
      padPrimitives.push({
        kind: 'polyline',
        points: polygonPoints,
        closed: true,
        stroke: color,
        strokeWidth: 0.5,
        fill: color,
        opacity: 0.85,
      });
    }
  }

  if (padPrimitives.length === 0) {
    const normalized = normalizeRect(x - width / 2, y - height / 2, width, height);
    const rx = shape === 'RECT' ? 0 : normalized.width / 2;
    const ry = shape === 'RECT' ? 0 : normalized.height / 2;
    padPrimitives.push({
      kind: 'rect',
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      rx,
      ry,
      rotation,
      stroke: color,
      strokeWidth: 0.5,
      fill: color,
      opacity: 0.85,
    });
  }

  const holeDiameter = Math.abs(number(tokens[8], 0));
  if (holeDiameter > 0) {
    padPrimitives.push({
      kind: 'circle',
      cx: x,
      cy: y,
      r: holeDiameter / 2,
      stroke: '#2f2b3b',
      strokeWidth: 0.4,
      fill: BACKGROUND_COLOR,
      opacity: 1,
    });
  }

  return padPrimitives;
}

function parseSvgNodePayload(payload: string | undefined): { layerId: string; pathData: string } | null {
  if (!payload) {
    return null;
  }

  try {
    const value = JSON.parse(payload) as unknown;
    const record = asRecord(value);
    const attrs = asRecord(record?.attrs);
    const pathData = typeof attrs?.d === 'string' ? attrs.d : '';
    const layerId = typeof record?.layerid === 'string' ? record.layerid : '';
    if (!pathData) {
      return null;
    }
    return { layerId, pathData };
  } catch {
    return null;
  }
}

function computeBounds(primitives: EasyEdaVisualPrimitive[]): EasyEdaVisualBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const includePoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'polyline':
        for (const point of primitive.points) {
          includePoint(point.x, point.y);
        }
        break;
      case 'path': {
        const pathPoints = parsePoints(primitive.path);
        for (const point of pathPoints) {
          includePoint(point.x, point.y);
        }
        break;
      }
      case 'circle':
        includePoint(primitive.cx - primitive.r, primitive.cy - primitive.r);
        includePoint(primitive.cx + primitive.r, primitive.cy + primitive.r);
        break;
      case 'rect':
        includePoint(primitive.x, primitive.y);
        includePoint(primitive.x + primitive.width, primitive.y + primitive.height);
        break;
      case 'text': {
        includePoint(primitive.x, primitive.y);
        const widthEstimate = primitive.size * Math.max(1, primitive.text.length) * 0.58;
        includePoint(primitive.x + widthEstimate, primitive.y + primitive.size);
        break;
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  const padding = 10;
  const paddedMinX = minX - padding;
  const paddedMinY = minY - padding;
  const paddedMaxX = maxX + padding;
  const paddedMaxY = maxY + padding;
  const width = Math.max(1, paddedMaxX - paddedMinX);
  const height = Math.max(1, paddedMaxY - paddedMinY);

  return {
    minX: paddedMinX,
    minY: paddedMinY,
    maxX: paddedMaxX,
    maxY: paddedMaxY,
    width,
    height,
  };
}

function parsePoints(value: string): Point[] {
  const values = extractNumbers(value);
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] });
  }
  return points;
}

function extractNumbers(value: string): number[] {
  const matches = value.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
}

function normalizeRect(x: number, y: number, width: number, height: number) {
  const normalizedX = width >= 0 ? x : x + width;
  const normalizedY = height >= 0 ? y : y + height;
  return {
    x: normalizedX,
    y: normalizedY,
    width: Math.abs(width),
    height: Math.abs(height),
  };
}

function layerColor(layerId: string, fallback: string): string {
  if (!layerId) return fallback;
  return PCB_LAYER_COLORS[layerId] ?? fallback;
}

function inferTextAnchor(rawValue: string): TextAnchor {
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'middle' || normalized === 'center') return 'middle';
  if (normalized === 'end' || normalized === 'right') return 'end';
  return 'start';
}

function splitWhitespace(value: string | undefined): string[] {
  return (value ?? '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function decodeEasyEdaText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeColor(value: string | undefined, fallback: string | null): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  if (trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'null') return null;
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  if (/^(rgba?|hsla?)\(/i.test(trimmed)) return trimmed;
  return fallback;
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = number(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
