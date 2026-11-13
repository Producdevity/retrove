const OBJECT_URL_RELEASE_DELAY = 1000;
export function download(blob: Blob, filename: string): void {
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_RELEASE_DELAY);
}
