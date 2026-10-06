import { api } from '../api.js';
import { store } from '../store.js';
import { html, avatar, avatarStack, openSheet, closeSheet, confirmSheet, toast, $$ } from '../ui.js';
import { navigate } from '../router.js';
import { postCard, remember, emptyState } from '../components.js';
import { shareInvite, inviteShareText, whatsappHref } from '../share.js';

const GROUP_EMOJIS = ['🐻', '🎾', '🎓', '🏠', '⚽', '🍻', '🎉', '🧗', '🚲', '🌴', '💼', '❤️'];

function openCreateSheet() {
  let emoji = GROUP_EMOJIS[0];
  openSheet(
    html`<h2>Neue Gruppe</h2>
      <form data-submit="create-group" class="form">
        <input class="input big" name="name" placeholder="z. B. Berlin Crew" maxlength="40" autocomplete="off" autofocus required>
        <div class="emoji-pick">${GROUP_EMOJIS.map((e, i) => html`<button type="button" class="${i === 0 ? 'on' : ''}" data-action="pick-emoji" data-emoji="${e}">${e}</button>`)}</div>
        <button class="btn dark block lg" type="submit">Gruppe erstellen</button>
      </form>`,
    {
      'pick-emoji': (el) => {
        emoji = el.dataset.emoji;
        $$('.emoji-pick button').forEach((b) => b.classList.toggle('on', b === el));
      },
      'create-group': async (form) => {
        const name = form.name.value.trim();
        if (!name) return toast('Wie heißt eure Gruppe?');
        const { group } = await api.createGroup({ name, emoji });
        await store.refresh();
        closeSheet();
        navigate(`/groups/${group.id}?created=1`);
      },
    },
  );
}

export default async function groupsView(_params, query) {
  const { groups } = await api.groups();
  store.groups = groups;
  if (query.new) setTimeout(openCreateSheet, 50);

  return {
    html: html`
      <header class="topbar">
        <div class="title-wrap"><div class="sub">Privat, nur für euch</div><h1>Gruppen</h1></div>
        <button class="icon-btn" data-action="new-group" aria-label="Neue Gruppe">＋</button>
      </header>
      <div style="margin-top:10px">
        ${groups.length
          ? groups.map(
              (g) => html`<article class="card plain" data-action="open-group" data-id="${g.id}">
                <div class="group-card">
                  <div class="group-emoji">${g.emoji ?? '👥'}</div>
                  <div class="grow"><h3>${g.name}</h3>
                    <div class="row" style="gap:8px;justify-content:flex-start">${avatarStack(g.members, 5)}<span class="muted" style="font-size:14px;flex:none">${g.members.length} ${g.members.length === 1 ? 'Person' : 'Leute'}</span></div>
                  </div>
                  <button class="btn soft sm" data-action="invite" data-id="${g.id}">Einladen</button>
                </div></article>`,
            )
          : emptyState('👥', 'Noch keine Gruppe', 'Gründe eure erste Gruppe – z. B. „Berlin Crew“ oder „Tennis“ – und lade Freunde per Link ein.')}
        <button class="btn ghost block lg" data-action="new-group" style="margin-top:8px">+ Neue Gruppe</button>
      </div>`,
    actions: {
      'new-group': openCreateSheet,
      'open-group': (el) => navigate(`/groups/${el.dataset.id}`),
      invite: (el) => shareInvite(groups.find((g) => g.id === el.dataset.id)),
    },
  };
}

export async function groupDetailView({ id }, query) {
  const [{ group }, { posts }] = await Promise.all([api.group(id), api.posts({ groupId: id })]);
  remember(posts);
  const created = query.created;

  return {
    html: html`
      <header class="topbar compact">
        <button class="icon-btn" data-action="to-groups" aria-label="Zurück">←</button>
        <span style="flex:1"></span>
      </header>
      <div class="center" style="padding:6px 0 4px">
        <div style="font-size:56px">${group.emoji ?? '👥'}</div>
        <h1 style="margin:8px 0 4px;font-size:28px">${group.name}</h1>
        <div class="muted">${group.members.length} ${group.members.length === 1 ? 'Person' : 'Leute'}</div>
      </div>

      <div class="banner tone-activity" style="margin-top:18px">
        <h3>${created ? '🎉 Gruppe steht! Jetzt Freunde einladen' : 'Freunde einladen'}</h3>
        <p>Wer den Link öffnet, kann der Gruppe direkt beitreten.</p>
        <div class="actions" style="margin:0">
          <a class="btn whatsapp" href="${whatsappHref(inviteShareText(group))}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <button class="btn ghost" data-action="invite">Mehr…</button>
        </div>
      </div>

      <section class="section"><h2 class="section-title"><span>Mitglieder</span></h2>
        <div class="list">${group.members.map(
          (m) => html`<div class="list-item">${avatar(m, 'md')}<div class="grow"><div class="title">${m.id === store.user.id ? `${m.name} (du)` : m.name}</div></div>
            ${m.role === 'admin' ? html`<span class="tag">Admin</span>` : ''}</div>`,
        )}</div>
      </section>

      <section class="section"><h2 class="section-title"><span>Was geht in der Gruppe</span></h2>
        ${posts.length ? posts.map(postCard) : html`<p class="hint">Noch nichts geplant.</p>`}
      </section>

      <button class="btn danger block" data-action="leave" style="margin-top:28px">Gruppe verlassen</button>`,
    actions: {
      'to-groups': () => navigate('/groups'),
      invite: () => shareInvite(group),
      leave: async () => {
        if (!(await confirmSheet({ title: `„${group.name}“ verlassen?`, confirmLabel: 'Verlassen' }))) return;
        await api.leaveGroup(group.id);
        await store.refresh();
        toast('Gruppe verlassen');
        navigate('/groups', { replace: true });
      },
    },
  };
}
