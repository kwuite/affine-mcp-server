/** Abort if AFFINE_BASE_URL points to a non-local host. */
export function assertLocal(baseUrl) {
  const host = new URL(baseUrl).hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocal) {
    throw new Error(
      `E2E tests require a local AFFiNE instance. ` +
      `AFFINE_BASE_URL="${baseUrl}" points to a remote host — aborting to prevent accidental data loss.`
    );
  }
}
