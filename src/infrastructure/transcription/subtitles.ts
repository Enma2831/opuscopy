import { SubtitlePort } from "../../interfaces/ports";
import { Transcript } from "../../domain/types";
import { sliceTranscript, toSrt } from "./srt";

export class SubtitleService implements SubtitlePort {
  toSrt(transcript: Transcript) {
    return toSrt(transcript);
  }

  sliceTranscript(transcript: Transcript, start: number, end: number): Transcript {
    return sliceTranscript(transcript, start, end);
  }
}
