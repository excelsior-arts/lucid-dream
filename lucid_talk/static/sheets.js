/* A pill's paperwork: what it remembers, what you have already said to it,
 * and how it is taking you.
 *
 * These are used from two places and they are the same three things in both.
 * From the box's dashboard, where a row per pill is the natural way to look
 * after them — read what it remembers, open a conversation you had last week,
 * put the temperature back to nothing. And from inside a room, through the
 * console, because somebody who is already in a conversation should not have
 * to leave it to check what it remembers.
 *
 * One implementation, two doorways. Written as a plain script rather than a
 * module because both pages that want it are plain scripts, and it asks the
 * page for the only two things it cannot know by itself: how to send a
 * command, and — since neither page's socket is ours — a look at the replies.
 *
 *     Sheets.use({send});          // your send(), once
 *     Sheets.take(msg);            // every message you receive, forwarded
 *     Sheets.history(slug, name);  // and then any of these
 *     Sheets.memory(slug, name);
 *     Sheets.forget(slug, name);
 *
 * The pill is a parameter, always. A room can only ever mean the one you are
 * in; the dashboard means whichever row you pressed, and the server takes a
 * slug on all four commands for exactly that reason.
 */
window.Sheets = (() => {
  let send = () => {};
  let sheet, body, head, foot, title, waiting = null;
  let hiding = null;   // the close that is still fading

  // Where the app is mounted, so a deep link works from either page: from
  // /lucid-talk/lover and from /lucid-talk/ this is the same string.
  const base = location.pathname.replace(/[^/]*$/, '');
  const safe = t => String(t == null ? '' : t)
    .replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  function build() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.hidden = true;
    /* Three bands: a title, whatever there is to read, and whatever there is
       to press. The last of those is outside the scrolling part on purpose —
       with the buttons inside it, a long memory pushed Save off the bottom of
       the card and you had to scroll a text box to find the way to keep what
       you had written. */
    sheet.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true">
        <div class="sheet-head"><b></b>
          <button class="sheet-x" type="button" aria-label="close">&times;</button></div>
        <div class="sheet-body"></div>
        <div class="sheet-foot" hidden></div>
      </div>`;
    document.body.appendChild(sheet);
    head = sheet.querySelector('.sheet-head');
    title = head.querySelector('b');
    body = sheet.querySelector('.sheet-body');
    foot = sheet.querySelector('.sheet-foot');
    head.querySelector('.sheet-x').onclick = close;
    /* The scrim is the way out, and a press inside the card is not a press on
       the scrim — which is what makes a textarea usable in one of these.

       Both ends of the press, though, not just the one the browser reports.
       A click is delivered to the nearest ancestor the press and the release
       have in common, so selecting a line of text and letting go a few pixels
       outside the card arrives here as a click on the scrim: the sheet closed,
       and in the memory sheet it took the edit with it. Dragging out of a text
       box is how anybody selects to the end of a line, so this was reachable
       by ordinary use of the thing. */
    let downOnScrim = false;
    sheet.addEventListener('pointerdown', e => { downOnScrim = e.target === sheet; });
    sheet.onclick = e => { if (e.target === sheet && downOnScrim) close(); };
    addEventListener('keydown', e => {
      if (e.key === 'Escape' && !sheet.hidden) { e.stopPropagation(); close(); }
    }, true);
  }

  function open(name, what) {
    build();
    clearTimeout(hiding);        // an older close must not hide this one
    title.textContent = what;
    body.innerHTML = '<div class="sheet-wait">…</div>';
    foot.innerHTML = '';
    foot.hidden = true;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('on'));
  }

  function close() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove('on');
    waiting = null;
    /* The hiding waits for the fade, and the fade is long enough to reopen
       inside. Reopened in that window, the old timer still fired and hid a
       sheet that had just been asked for — and close() then found it already
       hidden and did nothing, so it could not be reached again. */
    clearTimeout(hiding);
    hiding = setTimeout(() => { sheet.hidden = true; }, 160);
  }

  // ---- what it has already been told --------------------------------------
  function history(slug, name) {
    waiting = {kind: 'sessions', slug};
    open(name, `${name} — conversations`);
    send({cmd: 'sessions', slug});
  }

  function drawSessions(items, slug) {
    if (!items.length) {
      body.innerHTML = '<div class="sheet-none">nothing yet</div>';
      return;
    }
    body.innerHTML = items.map(x =>
      `<a class="sheet-row" href="${safe(base + slug)}?session=${encodeURIComponent(x.id)}">`
      + `<b>${safe(x.when)}</b><span>${safe(x.turns)} turns</span>`
      + `<span class="pv">${safe(x.preview)}</span></a>`).join('');
    /* Real links, not click handlers: a conversation has an address, so it can
       be opened in a new tab, bookmarked, or sent to the phone by the same
       code that puts this page there. */
  }

  // ---- what it remembers --------------------------------------------------
  function memory(slug, name) {
    waiting = {kind: 'memory', slug};
    open(name, `${name} — memory`);
    send({cmd: 'memory_get', slug});
  }

  function drawMemory(text, slug, off) {
    /* Off is a state worth drawing rather than hiding. The file is still
       yours to read, and the two things this sheet says when it is on —
       fills in as you talk, goes into every reply — are both untrue then. A
       sheet that lied about that would be discovered a week later, by
       somebody wondering why nothing is remembered. */
    body.innerHTML = `<textarea class="sheet-text" spellcheck="false"${off ? ' readonly' : ''}
        placeholder="${off ? 'memory is off — nothing is being kept'
                           : 'nothing remembered yet — this fills in as you talk'}"></textarea>`;
    foot.innerHTML = off
      ? `<span>memory is off in this game's config: what is here is not read,
           and nothing new is written</span>`
      : `<span>edit freely; this is prepended to every reply</span>
         <button type="button" class="sheet-save">Save</button>`;
    foot.hidden = false;
    const box = body.querySelector('textarea');
    box.value = text || '';
    if (off) return;
    foot.querySelector('.sheet-save').onclick = () => {
      send({cmd: 'memory_save', slug, text: box.value});
      close();
    };
  }

  // ---- and how it is taking you -------------------------------------------
  function forget(slug, name) {
    build();
    open(name, `${name} — start from nothing`);
    body.innerHTML = `<p class="sheet-say">Warmth, trust and mood go back to
        nothing, and the record of how you got here is deleted. Your
        conversations, and what ${safe(name)} remembers about you, are not
        touched.</p>`;
    foot.innerHTML = `<span></span>
        <button type="button" class="sheet-no">Leave it</button>
        <button type="button" class="sheet-yes danger">Reset</button>`;
    foot.hidden = false;
    foot.querySelector('.sheet-no').onclick = close;
    foot.querySelector('.sheet-yes').onclick = () => {
      send({cmd: 'relation_reset', slug});
      close();
    };
  }

  return {
    use(how) { send = how.send || send; },
    /* Every message the page receives, offered here. Only the two we asked
       for are taken, and only while the sheet that asked is still open —
       otherwise a stale reply redraws a sheet somebody has moved on from. */
    take(m) {
      if (!waiting || !sheet || sheet.hidden) return false;
      /* And only about the pill this sheet is about. The reply carries the
         slug it is for, and a sheet opened on one pill while another's reply
         was still in the air drew that one's conversations under this one's
         title. */
      if (m.slug && waiting.slug && m.slug !== waiting.slug) return false;
      if (m.type === 'sessions' && waiting.kind === 'sessions') {
        drawSessions(m.items || [], m.slug || waiting.slug);
        return true;
      }
      if (m.type === 'memory' && waiting.kind === 'memory') {
        drawMemory(m.text, m.slug || waiting.slug, m.off);
        return true;
      }
      return false;
    },
    history, memory, forget, close,
    get open() { return !!sheet && !sheet.hidden; },
  };
})();
