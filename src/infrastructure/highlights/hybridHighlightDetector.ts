import { HighlightDetectorPort } from "../../interfaces/ports";
import { HighlightSegment, Transcript } from "../../domain/types";
import { EnergySample, durationRange, nonMaxSuppression, rankSegments, trimSilence } from "../../application/highlightScoring";
import { analyzeAudioEnergy } from "./audioEnergy";

export class HybridHighlightDetector implements HighlightDetectorPort {
  async detect(options: {
    inputPath: string;
    transcript?: Transcript | null;
    clipCount: number;
    durationPreset: "short" | "normal" | "long";
  }): Promise<HighlightSegment[]> {
    const { min, max } = durationRange(options.durationPreset);
    let energy: EnergySample[] = [];
    try {
      energy = await analyzeAudioEnergy(options.inputPath);
    } catch {
      energy = [];
    }

    const transcriptCandidates = options.transcript
      ? buildTranscriptCandidates(options.transcript, min, max)
      : [];
    const energyCandidates = energy.length ? buildEnergyCandidates(energy, min, max) : [];

    const merged = [...transcriptCandidates, ...energyCandidates];
    if (!merged.length) {
      return [];
    }

    const ranked = rankSegments(merged, options.transcript ?? null, energy);
    const trimmed = ranked.map((segment) => trimSilence(segment, energy));
    const filtered = trimmed.filter((segment) => segment.end - segment.start >= min && segment.end - segment.start <= max);
    const reduced = nonMaxSuppression(filtered, 0.25);

    return reduced.slice(0, Math.max(1, options.clipCount));
  }
}

function buildTranscriptCandidates(transcript: Transcript, min: number, max: number) {
  const candidates: HighlightSegment[] = [];
  const segments = transcript.segments;
  if (!segments.length) {
    return candidates;
  }
  let cursor = 0;
  while (cursor < segments.length) {
    const start = segments[cursor].start;
    let end = start;
    let idx = cursor;
    while (idx < segments.length && end - start < max) {
      end = segments[idx].end;
      if (end - start >= min) {
        candidates.push({ start, end, score: 0, reason: "" });
      }
      idx += 1;
    }
    cursor += 1;
  }
  return candidates;
}

function buildEnergyCandidates(energy: EnergySample[], min: number, max: number) {
  const threshold = 0.35;
  const segments: { start: number; end: number }[] = [];
  let activeStart: number | null = null;

  for (const sample of energy) {
    if (sample.value >= threshold && activeStart === null) {
      activeStart = sample.t;
    }
    if (sample.value < threshold && activeStart !== null) {
      segments.push({ start: activeStart, end: sample.t });
      activeStart = null;
    }
  }
  if (activeStart !== null) {
    segments.push({ start: activeStart, end: energy[energy.length - 1].t });
  }

  const candidates: HighlightSegment[] = [];
  for (const segment of segments) {
    const length = segment.end - segment.start;
    if (length < min) {
      continue;
    }
    if (length <= max) {
      candidates.push({ start: segment.start, end: segment.end, score: 0, reason: "" });
      continue;
    }
    let cursor = segment.start;
    while (cursor + max <= segment.end) {
      candidates.push({ start: cursor, end: cursor + max, score: 0, reason: "" });
      cursor += min;
    }
  }
  return candidates;
}
