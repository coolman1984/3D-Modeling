/** A signed-in browser for tests: keeps the session cookie between calls, like the editor does. */
export function client(base: string) {
  let cookie = '';
  const call = async (path: string, init: RequestInit & { token?: string } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const { token: _token, ...rest } = init;
    const response = await fetch(`${base}${path}`, { ...rest, headers });
    const set = response.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0]!;
      cookie = pair.endsWith('=') ? '' : pair;
    }
    return { status: response.status, body: (await response.json().catch(() => ({}))) as any, setCookie: set };
  };
  return {
    call,
    get cookie() {
      return cookie;
    },
  };
}

export type Client = ReturnType<typeof client>;

export const PASSWORD = 'correct horse battery';
