// Thin fetch wrapper for the JSON API. Errors carry the server's German message.

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung. Bist du online?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Da ist etwas schiefgelaufen.');
  return data;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  return s.toString() ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/api/me'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  register: (data) => request('POST', '/api/auth/register', data),
  demoLogin: (userId) => request('POST', '/api/auth/demo', { userId }),
  logout: () => request('POST', '/api/auth/logout'),
  updateMe: (data) => request('PATCH', '/api/me', data),

  posts: (params = {}) => request('GET', `/api/posts${q(params)}`),
  post: (id) => request('GET', `/api/posts/${id}`),
  createPost: (data) => request('POST', '/api/posts', data),
  cancelPost: (id) => request('DELETE', `/api/posts/${id}`),
  participate: (id, status) => request('PUT', `/api/posts/${id}/participation`, { status }),
  unparticipate: (id) => request('DELETE', `/api/posts/${id}/participation`),
  comment: (id, body, kind = 'comment') => request('POST', `/api/posts/${id}/comments`, { body, kind }),
  deleteComment: (id) => request('DELETE', `/api/comments/${id}`),

  share: (code) => request('GET', `/api/share/${code}`),
  joinShare: (code) => request('POST', `/api/share/${code}/join`),

  groups: () => request('GET', '/api/groups'),
  group: (id) => request('GET', `/api/groups/${id}`),
  createGroup: (data) => request('POST', '/api/groups', data),
  leaveGroup: (id) => request('POST', `/api/groups/${id}/leave`),
  invite: (code) => request('GET', `/api/invites/${code}`),
  acceptInvite: (code) => request('POST', `/api/invites/${code}/accept`),

  slots: (params = {}) => request('GET', `/api/slots${q(params)}`),
  setSlot: (date, part, free) => request('PUT', '/api/slots', { date, part, free }),
  round: (groupId, date, part) => request('GET', `/api/rounds/${groupId}/${date}/${part}`),
  roundMessage: (groupId, date, part, body) => request('POST', `/api/rounds/${groupId}/${date}/${part}/messages`, { body }),

  notifications: () => request('GET', '/api/notifications'),
  readNotifications: () => request('POST', '/api/notifications/read'),
};
