// Wires services, API routes, landing pages and static files into one request handler.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { createRouter, readJson, sendJson, sendHtml, parseCookies, cookie, baseUrl } from './http.js';
import { AppError, unauthorized, badRequest } from './util.js';
import { createUserService, publicUser } from './domain/users.js';
import { createGroupService } from './domain/groups.js';
import { createPostService } from './domain/posts.js';
import { createSlotService } from './domain/slots.js';
import { interpret } from './domain/interpret.js';
import { createNotificationService } from './notifications/index.js';
import { createWhatsApp } from './integrations/whatsapp.js';
import { renderSharePage, renderInvitePage, renderNotFound } from './pages/landing.js';

const SESSION_COOKIE = 'sid';

export function createServices(db, { tz = 'Europe/Berlin' } = {}) {
  const notifications = createNotificationService({ db });
  const users = createUserService({ db });
  const groups = createGroupService({ db });
  const posts = createPostService({ db, groups, notifications });
  const slots = createSlotService({ db, groups, notifications, tz });
  return { users, groups, posts, slots, notifications };
}

export function createApp({ config, db }) {
  const services = createServices(db, { tz: config.tz });
  const { users, groups, posts, slots, notifications } = services;
  const api = createRouter();
  const loginAttempts = new Map();

  const requireUser = (ctx) => {
    if (!ctx.user) throw unauthorized();
    return ctx.user;
  };

  function startSession(ctx, user) {
    const { token, maxAge } = users.createSession(user.id);
    ctx.setCookie(cookie(SESSION_COOKIE, token, { maxAge, secure: config.cookieSecure }));
  }

  function mePayload(user) {
    return {
      user: user ? { ...publicUser(user), email: user.email, isDemo: Boolean(user.is_demo) } : null,
      groups: user ? groups.listForUser(user.id) : [],
      unread: user ? notifications.unreadCount(user.id) : 0,
      app: { name: config.appName, demoMode: config.demoMode, tz: config.tz, openSignup: config.allowOpenSignup },
      demoUsers: config.demoMode && !user ? users.listDemoUsers() : [],
    };
  }

  function throttle(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip) ?? { n: 0, since: now };
    if (now - entry.since > 60_000) Object.assign(entry, { n: 0, since: now });
    entry.n += 1;
    loginAttempts.set(ip, entry);
    if (entry.n > 10) throw new AppError(429, 'Zu viele Versuche. Bitte eine Minute warten.');
  }

  // ---- Auth & profile -------------------------------------------------------------------------
  api.get('/api/me', (ctx) => mePayload(ctx.user));

  api.post('/api/auth/login', async (ctx) => {
    throttle(ctx.ip);
    const user = await users.authenticate(ctx.body.email, ctx.body.password);
    startSession(ctx, user);
    return mePayload(user);
  });

  api.post('/api/auth/register', async (ctx) => {
    throttle(ctx.ip);
    const { inviteCode, shareCode } = ctx.body;
    // Private app: you need an invite link (group) or a share link (single post) to sign up.
    if (inviteCode) groups.invitePreview(inviteCode);
    else if (shareCode) posts.sharePreview(shareCode);
    else if (!config.allowOpenSignup) throw badRequest('Du brauchst einen Einladungslink von deinen Freunden.');

    const user = await users.register(ctx.body);
    if (inviteCode) groups.acceptInvite(user.id, inviteCode);
    startSession(ctx, user);
    return mePayload(user);
  });

  api.post('/api/auth/demo', (ctx) => {
    if (!config.demoMode) throw badRequest('Demo-Modus ist deaktiviert.');
    const user = users.getById(ctx.body.userId);
    if (!user?.is_demo) throw badRequest('Unbekannter Demo-User.');
    startSession(ctx, user);
    return mePayload(user);
  });

  api.post('/api/auth/logout', (ctx) => {
    users.deleteSession(ctx.cookies[SESSION_COOKIE]);
    ctx.setCookie(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.cookieSecure }));
    return { ok: true };
  });

  api.patch('/api/me', (ctx) => mePayload(users.updateProfile(requireUser(ctx).id, ctx.body)));

  // ---- Posts ----------------------------------------------------------------------------------
  api.get('/api/posts', (ctx) => ({ posts: posts.list(requireUser(ctx).id, ctx.query) }));
  api.post('/api/posts', (ctx) => ({ post: posts.create(requireUser(ctx).id, ctx.body) }));
  api.get('/api/posts/:id', (ctx) => ({ post: posts.get(requireUser(ctx).id, ctx.params.id) }));
  api.delete('/api/posts/:id', (ctx) => {
    posts.cancel(requireUser(ctx).id, ctx.params.id);
    return { ok: true };
  });

  api.put('/api/posts/:id/participation', (ctx) => ({
    post: posts.setParticipation(requireUser(ctx).id, ctx.params.id, ctx.body.status),
  }));
  api.delete('/api/posts/:id/participation', (ctx) => ({
    post: posts.removeParticipation(requireUser(ctx).id, ctx.params.id),
  }));

  api.post('/api/posts/:id/comments', (ctx) => ({ post: posts.addComment(requireUser(ctx).id, ctx.params.id, ctx.body) }));
  api.delete('/api/comments/:id', (ctx) => ({ post: posts.deleteComment(requireUser(ctx).id, ctx.params.id) }));

  // Natural-language entry point (same interpreter the WhatsApp bot uses).
  api.post('/api/interpret', (ctx) => {
    requireUser(ctx);
    if (typeof ctx.body.text !== 'string' || !ctx.body.text.trim()) throw badRequest('Text fehlt.');
    return { draft: interpret(ctx.body.text.slice(0, 500), { tz: config.tz }) };
  });

  // ---- "Wann hast du Zeit?" slots & automatic rounds ------------------------------------------
  api.get('/api/slots', (ctx) => slots.overview(requireUser(ctx).id, ctx.query));
  api.put('/api/slots', (ctx) => slots.set(requireUser(ctx).id, ctx.body));
  api.get('/api/rounds/:groupId/:date/:part', (ctx) => ({
    round: slots.round(requireUser(ctx).id, ctx.params.groupId, ctx.params.date, ctx.params.part),
  }));
  api.post('/api/rounds/:groupId/:date/:part/messages', (ctx) => ({
    round: slots.postMessage(requireUser(ctx).id, ctx.params.groupId, ctx.params.date, ctx.params.part, ctx.body.body),
  }));

  // ---- Share links ----------------------------------------------------------------------------
  api.get('/api/share/:code', (ctx) => {
    const preview = posts.sharePreview(ctx.params.code);
    const canOpen = ctx.user ? posts.canView(ctx.user.id, { id: preview.id, author_id: preview.author.id }) : false;
    return { preview, postId: canOpen ? preview.id : null };
  });
  api.post('/api/share/:code/join', (ctx) => ({ post: posts.joinViaShare(requireUser(ctx).id, ctx.params.code) }));

  // ---- Groups & invites -----------------------------------------------------------------------
  api.get('/api/groups', (ctx) => ({ groups: groups.listForUser(requireUser(ctx).id) }));
  api.post('/api/groups', (ctx) => ({ group: groups.create(requireUser(ctx).id, ctx.body) }));
  api.get('/api/groups/:id', (ctx) => ({ group: groups.get(requireUser(ctx).id, ctx.params.id) }));
  api.post('/api/groups/:id/leave', (ctx) => {
    groups.leave(requireUser(ctx).id, ctx.params.id);
    return { ok: true };
  });
  api.post('/api/groups/:id/invite/rotate', (ctx) => ({ group: groups.rotateInvite(requireUser(ctx).id, ctx.params.id) }));
  api.get('/api/invites/:code', (ctx) => ({
    invite: groups.invitePreview(ctx.params.code),
    isMember: ctx.user ? groups.isMember(ctx.user.id, groups.invitePreview(ctx.params.code).id) : false,
  }));
  api.post('/api/invites/:code/accept', (ctx) => ({ group: groups.acceptInvite(requireUser(ctx).id, ctx.params.code) }));

  // ---- Notifications --------------------------------------------------------------------------
  api.get('/api/notifications', (ctx) => {
    const user = requireUser(ctx);
    return { notifications: notifications.list(user.id), unread: notifications.unreadCount(user.id) };
  });
  api.post('/api/notifications/read', (ctx) => {
    notifications.markAllRead(requireUser(ctx).id);
    return { ok: true };
  });

  // ---- WhatsApp Business Cloud API webhook (disabled unless configured) -----------------------
  api.get('/api/integrations/whatsapp/webhook', (ctx) => {
    const q = ctx.query;
    if (!config.whatsapp.enabled) throw new AppError(404, 'WhatsApp-Integration ist nicht aktiviert.');
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.whatsapp.verifyToken) {
      return { raw: q['hub.challenge'] };
    }
    throw new AppError(403, 'Verify token falsch.');
  });
  api.post('/api/integrations/whatsapp/webhook', async (ctx) => {
    if (!config.whatsapp.enabled) throw new AppError(404, 'WhatsApp-Integration ist nicht aktiviert.');
    const wa = createWhatsApp({ config, services, baseUrl: baseUrl(ctx.req, config) });
    if (!wa.verifySignature(ctx.req.rawBody ?? Buffer.alloc(0), ctx.req.headers['x-hub-signature-256'])) {
      throw new AppError(401, 'Signatur ungültig.');
    }
    for (const msg of wa.extractMessages(ctx.body)) {
      const reply = wa.handleInbound(msg);
      wa.send(msg.from, reply).catch((err) => console.error('[whatsapp]', err.message));
    }
    return { ok: true };
  });

  // ---- Request handler ------------------------------------------------------------------------
  return {
    services,
    async handle(req, res) {
      const url = new URL(req.url, 'http://local');
      const pathname = decodeURIComponent(url.pathname);
      const cookies = parseCookies(req.headers.cookie);
      const ctx = {
        req,
        res,
        url,
        cookies,
        ip: req.headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress,
        query: Object.fromEntries(url.searchParams),
        user: users.userForSession(cookies[SESSION_COOKIE]),
        headers: {},
        setCookie(c) {
          this.headers['Set-Cookie'] = c;
        },
      };

      try {
        if (pathname.startsWith('/api/')) {
          const match = api.match(req.method, pathname);
          if (!match) throw new AppError(404, 'Unbekannter Endpunkt.');
          if (match.methodNotAllowed) throw new AppError(405, 'Methode nicht erlaubt.');
          ctx.params = match.params;
          ctx.body = await readJson(req);
          const result = await match.handler(ctx);
          if (result && 'raw' in result) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end(String(result.raw));
          }
          return sendJson(res, 200, result, ctx.headers);
        }

        const share = /^\/e\/([\w-]+)\/?$/.exec(pathname);
        if (share) {
          const preview = posts.sharePreview(share[1]);
          return sendHtml(res, 200, renderSharePage({ preview, appName: config.appName, url: baseUrl(req, config) + pathname, tz: config.tz }));
        }
        const invite = /^\/i\/([\w-]+)\/?$/.exec(pathname);
        if (invite) {
          const preview = groups.invitePreview(invite[1]);
          return sendHtml(res, 200, renderInvitePage({ invite: preview, code: invite[1], appName: config.appName, url: baseUrl(req, config) + pathname }));
        }

        return serveStatic(req, res, pathname);
      } catch (err) {
        const status = err instanceof AppError ? err.status : 500;
        if (status === 500) console.error(err);
        if (!pathname.startsWith('/api/') && status === 404) {
          return sendHtml(res, 404, renderNotFound({ appName: config.appName }));
        }
        return sendJson(res, status, { error: status === 500 ? 'Da ist etwas schiefgelaufen.' : err.message, code: err.code }, ctx.headers);
      }
    },
  };
}

// ---- Static files (app shell + shared modules) --------------------------------------------------
const STATIC_ROOTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end();
  }
  for (const [prefix, dir] of STATIC_ROOTS) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, pathname.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    let target = file;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) {
      // SPA fallback for client routes without file extension
      if (prefix === '/' && !path.extname(pathname)) target = path.join(dir, 'index.html');
      else break;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(target).pipe(res);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}
