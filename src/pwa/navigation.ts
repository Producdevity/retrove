const LIBRARY_DOCUMENT = "/index.html";
const PLAYER_DOCUMENT = "/player.html";
export function shellDocument(pathname: string): string {
  if (pathname === "/" || pathname === "/index") return LIBRARY_DOCUMENT;
  if (pathname === "/player" || pathname === "/player/") return PLAYER_DOCUMENT;
  return pathname;
}
export function navigationResponse(response: Response): Response {
  if (!response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
