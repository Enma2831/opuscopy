import { StreamingHighlightDetectorPort } from "../../interfaces/ports";
import { HighlightSegment, Transcript } from "../../domain/types";
import { detectFromTranscript, nonMaxSuppression } from "../../application/highlightScoring";

export class TranscriptHighlightDetector implements StreamingHighlightDetectorPort {
  async detectStream(options: {
    url: string;
    transcript?: Transcript | null;
    clipCount: number;
    durationPreset: "short" | "normal" | "long";
  }): Promise<HighlightSegment[]> {
    if (!options.transcript) {
      return [];
    }

    const ranked = detectFromTranscript(options.transcript, {
      clipCount: options.clipCount,
      durationPreset: options.durationPreset
    });
    const reduced = nonMaxSuppression(ranked, 0.25);
    return reduced.slice(0, Math.max(1, options.clipCount));
  }
}
