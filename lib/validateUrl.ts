export function isYoutubeUrl(input: string) {
  try {
    const url = new URL(input);
    const host = url.hostname.replace("www.", "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}
