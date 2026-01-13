import { HighlightSegment, Transcript } from "../domain/types";

export interface EnergySample {
  t: number;
  value: number;
}

export interface HighlightOptions {
  clipCount: number;
  durationPreset: "short" | "normal" | "long";
}

export function detectFromTranscript(transcript: Transcript, options: HighlightOptions): HighlightSegment[] {
  const windows = buildWindows(transcript, options);
  return rankSegments(windows, transcript, []);
}

export function rankSegments(
  candidates: HighlightSegment[],
  transcript: Transcript | null,
  energy: EnergySample[]
) {
  const enriched = candidates.map((segment) => {
    const audioScore = energy.length ? averageEnergy(segment, energy) : 0;
    const textScore = transcript ? transcriptScore(segment, transcript) : 0;
    const score = audioScore * 0.55 + textScore * 0.45;
    const reasonParts: string[] = [];
    if (audioScore > 0.55) {
      reasonParts.push("audio peak");
    }
    const keyword = pickKeyword(segment, transcript);
    if (keyword) {
      reasonParts.push(`keyword: ${keyword}`);
    }
    if (!reasonParts.length) {
      reasonParts.push("balanced energy");
    }
    return { ...segment, score, reason: reasonParts.join(" + ") };
  });

  return enriched.sort((a, b) => b.score - a.score);
}

export function nonMaxSuppression(segments: HighlightSegment[], maxOverlap = 0.3) {
  const kept: HighlightSegment[] = [];
  for (const segment of segments) {
    if (kept.every((s) => overlapRatio(s, segment) < maxOverlap)) {
      kept.push(segment);
    }
  }
  return kept;
}

export function trimSilence(segment: HighlightSegment, energy: EnergySample[]) {
  if (!energy.length) {
    return segment;
  }
  const window = energy.filter((sample) => sample.t >= segment.start && sample.t <= segment.end);
  const threshold = 0.2;
  let start = segment.start;
  let end = segment.end;

  for (const sample of window) {
    if (sample.value >= threshold) {
      start = sample.t;
      break;
    }
  }

  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (window[i].value >= threshold) {
      end = window[i].t;
      break;
    }
  }

  if (end - start < 6) {
    return segment;
  }

  return { ...segment, start, end };
}

export function mergeSegments(segments: HighlightSegment[]) {
  if (!segments.length) {
    return [];
  }
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: HighlightSegment[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= last.end + 1) {
      last.end = Math.max(last.end, next.end);
      last.score = Math.max(last.score, next.score);
      last.reason = last.reason || next.reason;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function overlapRatio(a: HighlightSegment, b: HighlightSegment) {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union === 0 ? 0 : overlap / union;
}

function averageEnergy(segment: HighlightSegment, samples: EnergySample[]) {
  const window = samples.filter((s) => s.t >= segment.start && s.t <= segment.end);
  if (!window.length) {
    return 0;
  }
  const sum = window.reduce((acc, sample) => acc + sample.value, 0);
  return sum / window.length;
}

function transcriptScore(segment: HighlightSegment, transcript: Transcript) {
  const window = transcript.segments.filter((s) => s.end >= segment.start && s.start <= segment.end);
  if (!window.length) {
    return 0;
  }
  const text = window.map((s) => s.text).join(" ");
  const words = tokenize(text);
  const density = words.length / Math.max(1, segment.end - segment.start);
  const keywords = keywordHits(words);
  const excitement = excitementScore(text);
  return Math.min(1, density / 3) * 0.5 + Math.min(1, keywords / 6) * 0.3 + Math.min(1, excitement / 3) * 0.2;
}

function pickKeyword(segment: HighlightSegment, transcript: Transcript | null) {
  if (!transcript) {
    return null;
  }
  const window = transcript.segments.filter((s) => s.end >= segment.start && s.start <= segment.end);
  const words = tokenize(window.map((s) => s.text).join(" "));
  const matches = words.filter((word) => KEYWORDS.includes(word));
  return matches[0] ?? null;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function keywordHits(words: string[]) {
  return words.filter((word) => KEYWORDS.includes(word)).length;
}

function excitementScore(text: string) {
  return (text.match(/[!?]/g) ?? []).length;
}

const KEYWORDS = [
  "clave",
  "importante",
  "impacto",
  "secreto",
  "historia",
  "idea",
  "tip",
  "ejemplo",
  "truco",
  "wow",
  "increible",
  "resultado",
  "urgente",
  "ahora"
];

function buildWindows(transcript: Transcript, options: HighlightOptions): HighlightSegment[] {
  const { min, max } = durationRange(options.durationPreset);
  const totalDuration = transcript.segments[transcript.segments.length - 1]?.end ?? 0;
  const windowSize = Math.min(max, Math.max(min, 18));
  const step = Math.max(6, Math.floor(windowSize / 2));
  const windows: HighlightSegment[] = [];
  for (let start = 0; start + windowSize <= totalDuration; start += step) {
    windows.push({ start, end: start + windowSize, score: 0, reason: "" });
  }
  return windows;
}

export function durationRange(preset: "short" | "normal" | "long") {
  if (preset === "short") {
    return { min: 12, max: 22 };
  }
  if (preset === "long") {
    return { min: 30, max: 45 };
  }
  return { min: 18, max: 32 };
}
