/** Schedule in the calling window or worker and cancel in that same context.
 * Timer handles stay private: Windows/workers return numbers, while Node test hosts return objects. */
export function after(callback: () => void, milliseconds: number): () => void {
  const host = typeof window === "undefined" ? self : window;
  const handle = host.setTimeout(callback, milliseconds);
  return () => host.clearTimeout(handle);
}
