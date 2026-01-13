import { Transcript, TranscriptSegment } from "../../domain/types";

export function parseSrt(srt: string, language: string): Transcript {
  const blocks = srt.split(/\r?\n\r?\n/).filter(Boolean);
  const segments: TranscriptSegment[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      continue;
    }
    const timeLine = lines[1].includes("-->") ? lines[1] : lines[0];
    const textLines = lines[1].includes("-->") ? lines.slice(2) : lines.slice(1);
    const [startRaw, endRaw] = timeLine.split("-->").map((s) => s.trim());
    if (!startRaw || !endRaw) {
      continue;
    }
    segments.push({
      start: parseTime(startRaw),
      end: parseTime(endRaw),
      text: textLines.join(" ")
    });
  }
  return { language, segments };
}

export function toSrt(transcript: Transcript): string {
  return transcript.segments
    .map((segment, index) => {
      const start = formatTime(segment.start);
      const end = formatTime(segment.end);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
}

export function sliceTranscript(transcript: Transcript, start: number, end: number): Transcript {
  const segments = transcript.segments
    .filter((segment) => segment.end >= start && segment.start <= end)
    .map((segment) => ({
      ...segment,
      start: Math.max(0, segment.start - start),
      end: Math.max(0, segment.end - start)
    }));
  return { language: transcript.language, segments };
}

function parseTime(value: string) {
  const [time, msRaw] = value.split(/,|\./);
  const parts = time.split(":").map((part) => Number(part));
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  const ms = Number(msRaw ?? 0);
  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

function formatTime(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds - Math.floor(seconds)) * 1000);
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(ms, 3)}`;
}

function pad(value: number, size = 2) {
  return value.toString().padStart(size, "0");
}
