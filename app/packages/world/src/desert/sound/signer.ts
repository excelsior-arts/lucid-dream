/** A song that is not the code's to ship is fetched by address, and the
 * address does not live for ever: a signer hands out a short-lived one on
 * request. Where a trip keeps its signer is the trip's (Burning Man's is in
 * its music-cdn.json); this is only the asking. A path that is already an
 * address, or nothing, is left as it is. */
export async function signedMusic(signer: string, path: string): Promise<string> {
  if (!path || /^[a-z][\w+.-]*:/i.test(path)) return path;
  const response = await fetch(signer, {headers: {accept: 'application/json'}});
  if (!response.ok) throw new Error(`music signer ${response.status}`);
  const payload = (await response.json()) as {url?: string};
  if (!payload.url) throw new Error('music signer: no url');
  return payload.url;
}
