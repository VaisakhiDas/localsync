import type { ApiErrorBody, CommentDto, DocumentDto, MemberDto, UserDto, VersionDto } from '@localsync/shared';

/** The server answered with an error status. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer: offline, server down, DNS... The caller should retry later. */
export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server.');
    this.name = 'NetworkError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin', // the session cookie is HttpOnly: JavaScript never sees it
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // A proxy error page (e.g. "502 Bad Gateway" HTML) means the backend is unreachable, not a bug.
    if (response.status >= 502) throw new NetworkError();
    throw new ApiError(response.status, 'bad_response', 'The server sent an unexpected response.');
  }
  if (!response.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    // The dev proxy answers 500/502/504 with an empty body when the backend is down.
    if (response.status >= 502 && !err.error) throw new NetworkError();
    throw new ApiError(response.status, err.error ?? 'error', err.message ?? 'Something went wrong.', err.fields);
  }
  return data as T;
}

/** Fetches binary data (a frozen Yjs state). */
async function requestBytes(path: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) {
    if (response.status >= 502) throw new NetworkError();
    throw new ApiError(response.status, 'error', response.status === 404 ? 'Not found.' : 'Could not load this version.');
  }
  return new Uint8Array(await response.arrayBuffer());
}

export const api = {
  me: () => request<{ user: UserDto }>('GET', '/api/auth/me'),
  register: (input: { email: string; displayName: string; password: string }) => request<{ user: UserDto }>('POST', '/api/auth/register', input),
  login: (input: { email: string; password: string }) => request<{ user: UserDto }>('POST', '/api/auth/login', input),
  logout: () => request<void>('POST', '/api/auth/logout', {}),

  listDocuments: async () => (await request<{ documents: DocumentDto[] }>('GET', '/api/documents')).documents,
  registerDocument: async (id: string, title: string) => (await request<{ document: DocumentDto }>('PUT', `/api/documents/${id}`, { title })).document,
  renameDocument: async (id: string, title: string) => (await request<{ document: DocumentDto }>('PATCH', `/api/documents/${id}`, { title })).document,
  deleteDocument: (id: string) => request<void>('DELETE', `/api/documents/${id}`),

  listMembers: async (id: string) => (await request<{ members: MemberDto[] }>('GET', `/api/documents/${id}/members`)).members,
  invite: async (id: string, email: string, role: 'editor' | 'viewer') => (await request<{ members: MemberDto[] }>('POST', `/api/documents/${id}/members`, { email, role })).members,
  changeRole: async (id: string, userId: string, role: 'editor' | 'viewer') => (await request<{ members: MemberDto[] }>('PATCH', `/api/documents/${id}/members/${userId}`, { role })).members,
  removeMember: (id: string, userId: string) => request<void>('DELETE', `/api/documents/${id}/members/${userId}`),

  listVersions: async (id: string) => (await request<{ versions: VersionDto[] }>('GET', `/api/documents/${id}/versions`)).versions,
  saveVersion: async (id: string, label?: string) => (await request<{ version: VersionDto }>('POST', `/api/documents/${id}/versions`, { label })).version,
  versionState: (id: string, versionId: string) => requestBytes(`/api/documents/${id}/versions/${versionId}/state`),

  listComments: async (id: string) => (await request<{ comments: CommentDto[] }>('GET', `/api/documents/${id}/comments`)).comments,
  addComment: async (id: string, body: string, quote?: string) => (await request<{ comment: CommentDto }>('POST', `/api/documents/${id}/comments`, { body, quote })).comment,
  resolveComment: async (id: string, commentId: string, resolved: boolean) => (await request<{ comment: CommentDto }>('PATCH', `/api/documents/${id}/comments/${commentId}`, { resolved })).comment,
  deleteComment: (id: string, commentId: string) => request<void>('DELETE', `/api/documents/${id}/comments/${commentId}`),
};

export type Api = typeof api;
