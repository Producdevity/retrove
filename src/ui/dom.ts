export function element<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor))
    throw new Error(`Missing or invalid interface element: ${id}`);
  return found;
}
export function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
export function action(
  operation: () => Promise<void>,
  failure: (error: unknown) => void,
): () => void {
  return () => {
    void operation().catch(failure);
  };
}
