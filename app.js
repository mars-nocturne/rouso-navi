/* ============================================================
   労組結成ナビ — 労働組合づくりアプリ
   バニラJS / オフライン対応PWA。
   - クラウド未設定: データは端末内(localStorage)に保存。
   - クラウド設定済み(config.js): Supabase で複数人共有＋リアルタイム同期。
   ============================================================ */

'use strict';

/* ---------- データ層 ---------- */
const DB_KEY = 'union_app_v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const defaultDB = () => ({
  settings: { unionName: '私たちの労働組合', companyName: '', targetMembers: 30 },
  members: [],
  cards: [],
  notices: [],
  polls: [],
  votes: [], // { poll_id, voter_id, opt }
  payments: [], // 納付記録 { id, memberId, period:'YYYY-MM', amount, method, note, paidAt } ＋ 徴収設定（id='dues_config'）
});

let DB = load();
let MY_VOTER_ID = null; // 投票者ID（クラウド時は認証ユーザID、ローカル時は端末ID）

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return seed();
    return Object.assign(defaultDB(), JSON.parse(raw));
  } catch (e) {
    return defaultDB();
  }
}
function save() { localStorage.setItem(DB_KEY, JSON.stringify(DB)); }

/* 初回起動時のサンプルデータ */
function seed() {
  const db = defaultDB();
  db.notices.push({
    id: uid(), title: '結成準備委員会へようこそ', pinned: true,
    body: 'このアプリで組合員の名簿づくり・加入カードの署名集め・お知らせの共有・投票ができます。\nまずは「名簿」から仲間を登録していきましょう。',
    author: '準備委員会', createdAt: Date.now(),
  });
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  return db;
}

/* ---------- 保存ヘルパー（ローカル＋クラウド） ---------- */
function cloudErr(e) {
  console.warn('[Cloud] sync error:', e && e.message);
  toast('クラウド同期に失敗しました（ローカルには保存済み）');
}
const Store = {
  upsert(coll, obj) {
    const arr = DB[coll];
    const i = arr.findIndex(x => x.id === obj.id);
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    save();
    if (Cloud.org) Cloud.upsert(coll, obj).catch(cloudErr);
  },
  del(coll, id) {
    DB[coll] = DB[coll].filter(x => x.id !== id);
    save();
    if (Cloud.org) Cloud.del(coll, id).catch(cloudErr);
  },
  vote(pollId, opt) {
    const i = DB.votes.findIndex(v => v.poll_id === pollId && v.voter_id === MY_VOTER_ID);
    if (i >= 0) DB.votes[i].opt = opt; else DB.votes.push({ poll_id: pollId, voter_id: MY_VOTER_ID, opt });
    save();
    if (Cloud.org) Cloud.vote(pollId, opt).catch(cloudErr);
  },
  unvote(pollId) {
    DB.votes = DB.votes.filter(v => !(v.poll_id === pollId && v.voter_id === MY_VOTER_ID));
    save();
    if (Cloud.org) Cloud.unvote(pollId).catch(cloudErr);
  },
};

/* クラウドから全データを再取得して再描画 */
let _refreshing = false;
async function refreshFromCloud() {
  if (!Cloud.org || _refreshing) return;
  _refreshing = true;
  try {
    const data = await Cloud.pullAll();
    const cloudEmpty = !(data.members.length || data.cards.length || data.notices.length || data.polls.length || data.votes.length || data.payments.length);
    const localHas = DB.members.length || DB.cards.length || DB.notices.length || DB.polls.length || DB.votes.length || DB.payments.length;
    if (cloudEmpty && localHas) {
      // クラウドが空なのに端末にデータがある = 接続/権限の一時的な問題の可能性。
      // 端末のデータは絶対に消さず、クラウドへ復元を試みる（自己修復）。
      console.warn('[Cloud] empty cloud with local data — keeping local & re-pushing');
      pushLocalToCloud().catch(() => {});
    } else {
      DB.members = data.members; DB.cards = data.cards;
      DB.notices = data.notices; DB.polls = data.polls; DB.votes = data.votes;
      DB.payments = data.payments;
      save();
    }
    go(current);
  } catch (e) {
    console.warn('[Cloud] pull failed:', e && e.message);
  } finally {
    _refreshing = false;
  }
}

/* ---------- ユーティリティ ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtDate = (ts) => new Date(ts).toLocaleDateString('ja-JP', { year:'numeric', month:'short', day:'numeric' });
const fmtDateTime = (ts) => new Date(ts).toLocaleString('ja-JP', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
const initial = (name) => (name || '？').trim().charAt(0);

const EMP_TYPES = ['正社員', '契約社員', 'パート・アルバイト', '派遣', '嘱託・その他'];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.hidden = true, 2200);
}

/* ---------- モーダル ---------- */
function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  $('#modalBackdrop').hidden = true;
  $('#modal').innerHTML = '';
  document.body.style.overflow = '';
}
$('#modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

/* ============================================================
   ルーティング
   ============================================================ */
const routes = { home: renderHome, members: renderMembers, card: renderCard, notices: renderNotices, polls: renderPolls, dues: renderDues };
let current = 'home';

function go(route) {
  current = routes[route] ? route : 'home';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.route === current));
  $('#view').innerHTML = '';
  routes[current]();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => go(tab.dataset.route)));

$('#settingsBtn').addEventListener('click', openSettings);

/* ヘッダーの組合名タップ → 組合の切り替え／管理（クラウド接続時） */
(function () {
  const brand = document.querySelector('.brand');
  if (!brand) return;
  brand.style.cursor = 'pointer';
  brand.addEventListener('click', () => {
    if (typeof Cloud !== 'undefined' && Cloud.configured()) openCloudConnect();
  });
})();

/* ============================================================
   ホーム画面
   ============================================================ */
function renderHome() {
  const v = $('#view');
  const total = DB.members.length;
  const signed = DB.cards.length;
  const target = DB.settings.targetMembers || 30;
  const pct = Math.min(100, Math.round((total / target) * 100));
  const openPolls = DB.polls.filter(p => !isPollClosed(p)).length;
  const online = !!Cloud.org;

  v.innerHTML = `
    <div class="hero">
      <h2>${esc(DB.settings.unionName)}</h2>
      <p>${DB.settings.companyName ? esc(DB.settings.companyName) + '　' : ''}結成に向けて、仲間を増やしていきましょう。</p>
      <div style="margin-top:10px">
        <span class="badge ${online ? 'badge-green' : 'badge-gray'}">${online ? '☁ 共有モード（' + esc(Cloud.org.name) + '）' : '📴 この端末のみ'}</span>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat"><div class="num">${total}</div><div class="lbl">登録した仲間</div></div>
      <div class="stat"><div class="num">${signed}</div><div class="lbl">加入カード署名</div></div>
    </div>

    <div class="card">
      <div class="card-row">
        <strong style="font-size:14px">結成目標まで</strong>
        <span class="muted" style="font-size:13px">${total} / ${target} 名</span>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
      <p class="muted" style="font-size:12px;margin:8px 0 0">過半数の組織化で団体交渉力が高まります。</p>
    </div>

    <div class="section-title">⚡ クイック操作</div>
    <div class="quick-grid">
      <button class="quick" data-q="member"><span class="q-ico">➕</span><strong>仲間を登録</strong><small>名簿に追加</small></button>
      <button class="quick" data-q="card"><span class="q-ico">✍️</span><strong>加入カード</strong><small>署名を集める</small></button>
      <button class="quick" data-q="notice"><span class="q-ico">📢</span><strong>お知らせ</strong><small>連絡を共有</small></button>
      <button class="quick" data-q="poll"><span class="q-ico">🗳️</span><strong>投票を作成</strong><small>意思決定</small></button>
    </div>

    ${!online ? `<div class="card" style="margin-top:14px"><div class="card-row"><span style="font-size:13px">☁ 仲間とデータを共有しますか？</span><button class="btn btn-ghost btn-sm" id="goShare">設定</button></div></div>` : ''}
    ${openPolls ? `<div class="card" style="margin-top:14px"><div class="card-row"><span>🗳️ 受付中の投票が <strong>${openPolls}</strong> 件あります</span><button class="btn btn-ghost btn-sm" data-q="poll">見る</button></div></div>` : ''}
  `;

  v.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    const q = b.dataset.q;
    if (q === 'member') { go('members'); setTimeout(memberForm, 50); }
    else if (q === 'card') go('card');
    else if (q === 'notice') { go('notices'); setTimeout(noticeForm, 50); }
    else if (q === 'poll') { go('polls'); }
  }));
  const gs = $('#goShare'); if (gs) gs.addEventListener('click', openCloudConnect);
}

/* ============================================================
   名簿（組合員登録・管理）
   ============================================================ */
function renderMembers() {
  const v = $('#view');
  v.innerHTML = `
    <div class="list-head">
      <div class="section-title" style="margin:0">👥 組合員名簿（${DB.members.length}）</div>
      <button class="btn btn-ghost btn-sm" id="exportMembers">⬇ CSV</button>
    </div>
    <div class="search"><input type="search" id="memberSearch" placeholder="名前・部署で検索"></div>
    <div id="memberList"></div>
    <button class="fab" id="addMember" aria-label="仲間を追加">＋</button>
  `;
  $('#addMember').addEventListener('click', () => memberForm());
  $('#exportMembers').addEventListener('click', exportMembersCSV);
  $('#memberSearch').addEventListener('input', e => drawMemberList(e.target.value));
  drawMemberList('');
}

function drawMemberList(q) {
  const list = $('#memberList');
  const kw = q.trim().toLowerCase();
  const rows = DB.members
    .filter(m => !kw || (m.name + m.kana + m.dept).toLowerCase().includes(kw))
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!rows.length) {
    list.innerHTML = `<div class="empty"><div class="e-ico">👥</div><p>${DB.members.length ? '該当する仲間がいません' : 'まだ仲間が登録されていません。<br>右下の＋から追加しましょう。'}</p></div>`;
    return;
  }

  list.innerHTML = rows.map(m => {
    const hasCard = DB.cards.some(c => c.memberId === m.id);
    return `
    <div class="item" data-id="${m.id}">
      <div class="item-flex">
        <div class="avatar">${esc(initial(m.name))}</div>
        <div style="flex:1;min-width:0">
          <div class="item-title">${esc(m.name)} ${hasCard ? '<span class="badge badge-green">署名済</span>' : ''}</div>
          <div class="item-meta">${esc(m.dept || '部署未設定')}・${esc(m.empType || '—')}</div>
        </div>
        <button class="icon-btn" style="background:#f1f5f9;color:#333" data-edit="${m.id}">⋯</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => memberForm(b.dataset.edit)));
}

function memberForm(id) {
  const m = id ? DB.members.find(x => x.id === id) : null;
  openModal(`
    <h3>${m ? '組合員を編集' : '仲間を登録'}</h3>
    <div class="field"><label>氏名<span class="req">必須</span></label><input id="f_name" value="${esc(m?.name || '')}" placeholder="山田 太郎"></div>
    <div class="field"><label>ふりがな</label><input id="f_kana" value="${esc(m?.kana || '')}" placeholder="やまだ たろう"></div>
    <div class="row2">
      <div class="field"><label>部署</label><input id="f_dept" value="${esc(m?.dept || '')}" placeholder="製造2課"></div>
      <div class="field"><label>雇用形態</label><select id="f_emp">${EMP_TYPES.map(t => `<option ${m?.empType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    </div>
    <div class="row2">
      <div class="field"><label>電話</label><input id="f_phone" type="tel" value="${esc(m?.phone || '')}" placeholder="090-..."></div>
      <div class="field"><label>メール</label><input id="f_email" type="email" value="${esc(m?.email || '')}" placeholder="任意"></div>
    </div>
    <div class="field"><label>メモ</label><textarea id="f_note" placeholder="関心ごと・要求事項など">${esc(m?.note || '')}</textarea></div>
    <div class="btn-row">
      ${m ? '<button class="btn btn-ghost" id="delMember" style="flex:0 0 auto;color:#b91c1c">削除</button>' : ''}
      <button class="btn btn-ghost" id="cancelM">キャンセル</button>
      <button class="btn btn-primary" id="saveM">保存</button>
    </div>
  `);
  $('#cancelM').addEventListener('click', closeModal);
  $('#saveM').addEventListener('click', () => {
    const name = $('#f_name').value.trim();
    if (!name) { toast('氏名を入力してください'); return; }
    const data = {
      name, kana: $('#f_kana').value.trim(), dept: $('#f_dept').value.trim(),
      empType: $('#f_emp').value, phone: $('#f_phone').value.trim(),
      email: $('#f_email').value.trim(), note: $('#f_note').value.trim(),
    };
    const obj = m ? Object.assign({}, m, data)
                  : Object.assign({ id: uid(), createdAt: Date.now() }, data);
    Store.upsert('members', obj);
    closeModal(); toast(m ? '更新しました' : '仲間を登録しました'); drawMemberList($('#memberSearch')?.value || '');
  });
  if (m) $('#delMember').addEventListener('click', () => {
    if (confirm(`${m.name} さんを名簿から削除しますか？`)) {
      DB.cards.filter(c => c.memberId === m.id).forEach(c => Store.del('cards', c.id));
      Store.del('members', m.id);
      closeModal(); toast('削除しました'); drawMemberList('');
    }
  });
}

function exportMembersCSV() {
  if (!DB.members.length) { toast('名簿が空です'); return; }
  const head = ['氏名','ふりがな','部署','雇用形態','電話','メール','署名','登録日'];
  const rows = DB.members.map(m => [
    m.name, m.kana, m.dept, m.empType, m.phone, m.email,
    DB.cards.some(c => c.memberId === m.id) ? '済' : '',
    fmtDate(m.createdAt),
  ]);
  const csv = [head, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  downloadFile('﻿' + csv, `組合員名簿_${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
  toast('CSVを書き出しました');
}

/* ============================================================
   加入カード（署名）
   ============================================================ */
let signCtx = null, signing = false, signed = false;

function renderCard() {
  const v = $('#view');
  v.innerHTML = `
    <div class="section-title">✍️ 加入申込カード</div>
    <div class="card">
      <p style="font-size:13px;margin:0 0 14px" class="muted">下記に同意のうえ署名すると、組合への加入意思として記録されます。署名は安全に保存されます。</p>

      <div class="field"><label>加入する組合員<span class="req">必須</span></label>
        <select id="c_member"><option value="">— 名簿から選択 —</option>${
          DB.members.map(m => `<option value="${m.id}">${esc(m.name)}（${esc(m.dept || '部署未設定')}）</option>`).join('')
        }<option value="__new">＋ 新しく登録する</option></select>
      </div>

      <div class="check"><input type="checkbox" id="c_agree1"><label for="c_agree1" style="margin:0;font-weight:400">${esc(DB.settings.unionName)}の組合員となり、規約を守ることに同意します。</label></div>
      <div class="check"><input type="checkbox" id="c_agree2"><label for="c_agree2" style="margin:0;font-weight:400">組合費の納入に同意します。</label></div>
      <div class="check"><input type="checkbox" id="c_agree3"><label for="c_agree3" style="margin:0;font-weight:400">加入の事実を会社・第三者に開示することについて、組合の判断に委ねます。</label></div>

      <label style="font-size:13px;font-weight:600;display:block;margin:14px 0 6px">署名</label>
      <div class="sign-wrap">
        <canvas id="signPad"></canvas>
        <div class="sign-hint" id="signHint">ここに指でサインしてください</div>
      </div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" id="clearSign">消す</button>
        <button class="btn btn-primary" id="submitCard">加入カードを提出</button>
      </div>
    </div>

    <div class="section-title">📋 提出済みカード（${DB.cards.length}）</div>
    <div id="cardList"></div>
  `;

  setupSignPad();
  $('#clearSign').addEventListener('click', clearSign);
  $('#submitCard').addEventListener('click', submitCard);
  $('#c_member').addEventListener('change', e => {
    if (e.target.value === '__new') { e.target.value = ''; memberForm(); }
  });
  drawCardList();
}

function setupSignPad() {
  const cv = $('#signPad');
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = rect.width * dpr; cv.height = 180 * dpr;
  signCtx = cv.getContext('2d');
  signCtx.scale(dpr, dpr);
  signCtx.lineWidth = 2.5; signCtx.lineCap = 'round'; signCtx.lineJoin = 'round'; signCtx.strokeStyle = '#1f2430';
  signed = false;

  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  };
  const start = (e) => { e.preventDefault(); signing = true; signed = true; $('#signHint').style.display = 'none';
    const { x, y } = pos(e); signCtx.beginPath(); signCtx.moveTo(x, y); };
  const move = (e) => { if (!signing) return; e.preventDefault(); const { x, y } = pos(e); signCtx.lineTo(x, y); signCtx.stroke(); };
  const end = () => { signing = false; };

  cv.addEventListener('mousedown', start); cv.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  cv.addEventListener('touchstart', start, { passive: false });
  cv.addEventListener('touchmove', move, { passive: false });
  cv.addEventListener('touchend', end);
}
function clearSign() {
  if (!signCtx) return;
  const cv = $('#signPad');
  signCtx.clearRect(0, 0, cv.width, cv.height);
  signed = false; $('#signHint').style.display = 'flex';
}
function submitCard() {
  const mid = $('#c_member').value;
  if (!mid) { toast('加入する組合員を選択してください'); return; }
  if (!($('#c_agree1').checked && $('#c_agree2').checked)) { toast('必須の同意項目にチェックしてください'); return; }
  if (!signed) { toast('署名を入力してください'); return; }
  const member = DB.members.find(m => m.id === mid);
  const sig = $('#signPad').toDataURL('image/png');
  // 既存カードがあれば置き換え
  const existing = DB.cards.find(c => c.memberId === mid);
  if (existing) Store.del('cards', existing.id);
  Store.upsert('cards', {
    id: uid(), memberId: mid, name: member?.name || '',
    agree3: $('#c_agree3').checked, signature: sig, signedAt: Date.now(),
  });
  toast('加入カードを提出しました ✊');
  renderCard();
}
function drawCardList() {
  const el = $('#cardList');
  if (!DB.cards.length) { el.innerHTML = `<div class="empty"><div class="e-ico">✍️</div><p>まだ署名がありません</p></div>`; return; }
  el.innerHTML = DB.cards.slice().sort((a,b) => b.signedAt - a.signedAt).map(c => `
    <div class="item">
      <div class="item-head">
        <div><div class="item-title">${esc(c.name)}</div><div class="item-meta">署名日時：${fmtDateTime(c.signedAt)}</div></div>
        <button class="btn btn-ghost btn-sm" data-view="${c.id}">表示</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    const c = DB.cards.find(x => x.id === b.dataset.view);
    openModal(`<h3>加入カード — ${esc(c.name)}</h3>
      <p class="muted" style="font-size:13px">署名日時：${fmtDateTime(c.signedAt)}</p>
      <div style="border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff;text-align:center">
        <img src="${c.signature}" alt="署名" style="max-width:100%;height:auto">
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn btn-ghost" id="closeCard">閉じる</button></div>`);
    $('#closeCard').addEventListener('click', closeModal);
  }));
}

/* ============================================================
   お知らせ・連絡掲示板
   ============================================================ */
function renderNotices() {
  const v = $('#view');
  v.innerHTML = `
    <div class="section-title">📢 お知らせ・連絡掲示板</div>
    <div id="noticeList"></div>
    <button class="fab" id="addNotice" aria-label="お知らせを投稿">＋</button>
  `;
  $('#addNotice').addEventListener('click', () => noticeForm());
  drawNoticeList();
}
function drawNoticeList() {
  const el = $('#noticeList');
  const rows = [...DB.notices].sort((a,b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
  if (!rows.length) { el.innerHTML = `<div class="empty"><div class="e-ico">📢</div><p>お知らせはまだありません</p></div>`; return; }
  el.innerHTML = rows.map(n => `
    <div class="item">
      <div class="item-head">
        <div class="item-title">${n.pinned ? '<span class="pin">📌</span> ' : ''}${esc(n.title)}</div>
        <button class="icon-btn" style="background:#f1f5f9;color:#333" data-edit="${n.id}">⋯</button>
      </div>
      <div class="item-meta">${esc(n.author || '組合')}・${fmtDateTime(n.createdAt)}</div>
      <div class="item-body">${esc(n.body)}</div>
    </div>`).join('');
  el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => noticeForm(b.dataset.edit)));
}
function noticeForm(id) {
  const n = id ? DB.notices.find(x => x.id === id) : null;
  openModal(`
    <h3>${n ? 'お知らせを編集' : 'お知らせを投稿'}</h3>
    <div class="field"><label>タイトル<span class="req">必須</span></label><input id="n_title" value="${esc(n?.title || '')}" placeholder="次回ミーティングのお知らせ"></div>
    <div class="field"><label>本文</label><textarea id="n_body" placeholder="内容を入力">${esc(n?.body || '')}</textarea></div>
    <div class="field"><label>投稿者</label><input id="n_author" value="${esc(n?.author || '準備委員会')}"></div>
    <div class="check"><input type="checkbox" id="n_pin" ${n?.pinned ? 'checked' : ''}><label for="n_pin" style="margin:0;font-weight:400">先頭に固定する（📌）</label></div>
    <div class="btn-row">
      ${n ? '<button class="btn btn-ghost" id="delN" style="flex:0 0 auto;color:#b91c1c">削除</button>' : ''}
      <button class="btn btn-ghost" id="cancelN">キャンセル</button>
      <button class="btn btn-primary" id="saveN">投稿</button>
    </div>
  `);
  $('#cancelN').addEventListener('click', closeModal);
  $('#saveN').addEventListener('click', () => {
    const title = $('#n_title').value.trim();
    if (!title) { toast('タイトルを入力してください'); return; }
    const data = { title, body: $('#n_body').value.trim(), author: $('#n_author').value.trim() || '組合', pinned: $('#n_pin').checked };
    const obj = n ? Object.assign({}, n, data)
                  : Object.assign({ id: uid(), createdAt: Date.now() }, data);
    Store.upsert('notices', obj);
    closeModal(); toast('投稿しました'); drawNoticeList();
  });
  if (n) $('#delN').addEventListener('click', () => {
    if (confirm('このお知らせを削除しますか？')) { Store.del('notices', n.id); closeModal(); drawNoticeList(); }
  });
}

/* ============================================================
   投票・アンケート
   ============================================================ */
const VOTER_KEY = 'union_voter_id';
function localVoterId() {
  let id = localStorage.getItem(VOTER_KEY);
  if (!id) { id = uid(); localStorage.setItem(VOTER_KEY, id); }
  return id;
}
function isPollClosed(p) { return p.closed || (p.deadline && Date.now() > p.deadline); }
function pollVotes(pollId) { return DB.votes.filter(v => v.poll_id === pollId); }

function renderPolls() {
  const v = $('#view');
  v.innerHTML = `
    <div class="section-title">🗳️ 投票・アンケート</div>
    <div id="pollList"></div>
    <button class="fab" id="addPoll" aria-label="投票を作成">＋</button>
  `;
  $('#addPoll').addEventListener('click', pollForm);
  drawPollList();
}
function drawPollList() {
  const el = $('#pollList');
  const rows = [...DB.polls].sort((a,b) => b.createdAt - a.createdAt);
  if (!rows.length) { el.innerHTML = `<div class="empty"><div class="e-ico">🗳️</div><p>投票はまだありません</p></div>`; return; }
  el.innerHTML = rows.map(p => {
    const closed = isPollClosed(p);
    const vs = pollVotes(p.id);
    const total = vs.length;
    const mine = vs.find(v => v.voter_id === MY_VOTER_ID);
    const myVote = mine ? mine.opt : null;
    const reveal = closed || myVote != null;
    const opts = p.options.map((o, i) => {
      const count = vs.filter(v => v.opt === i).length;
      const pctv = total ? Math.round((count / total) * 100) : 0;
      return `<div class="poll-opt ${reveal ? 'voted' : ''} ${myVote === i ? 'chosen' : ''}" ${reveal ? '' : `data-vote="${p.id}:${i}"`}>
          ${reveal ? `<span class="fill" style="width:${pctv}%"></span>` : ''}
          <span class="opt-content"><span>${myVote === i ? '✓ ' : ''}${esc(o)}</span>${reveal ? `<span class="muted">${count}票・${pctv}%</span>` : ''}</span>
        </div>`;
    }).join('');
    return `
    <div class="item">
      <div class="item-head">
        <div class="item-title">${esc(p.question)}</div>
        <span class="badge ${closed ? 'badge-gray' : 'badge-green'}">${closed ? '締切' : '受付中'}</span>
      </div>
      <div class="item-meta">${p.deadline ? '締切：' + fmtDateTime(p.deadline) + '・' : ''}${total}人が投票</div>
      <div style="margin-top:10px">${opts}</div>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" data-pmenu="${p.id}">⋯ 管理</button>
        ${!closed && myVote != null ? `<button class="btn btn-ghost btn-sm" data-revote="${p.id}">投票し直す</button>` : ''}
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-vote]').forEach(o => o.addEventListener('click', () => {
    const [pid, idx] = o.dataset.vote.split(':');
    castVote(pid, +idx);
  }));
  el.querySelectorAll('[data-revote]').forEach(b => b.addEventListener('click', () => {
    Store.unvote(b.dataset.revote); drawPollList();
  }));
  el.querySelectorAll('[data-pmenu]').forEach(b => b.addEventListener('click', () => pollMenu(b.dataset.pmenu)));
}
function castVote(pid, idx) {
  const p = DB.polls.find(x => x.id === pid);
  if (!p || isPollClosed(p)) { toast('この投票は締め切られています'); return; }
  Store.vote(pid, idx); toast('投票しました'); drawPollList();
}
function pollMenu(pid) {
  const p = DB.polls.find(x => x.id === pid);
  const closed = isPollClosed(p);
  openModal(`<h3>投票の管理</h3>
    <p style="font-weight:600">${esc(p.question)}</p>
    <div class="btn-row" style="flex-direction:column">
      <button class="btn btn-ghost" id="toggleClose">${closed ? '受付を再開する' : '今すぐ締め切る'}</button>
      <button class="btn btn-ghost" id="delPoll" style="color:#b91c1c">投票を削除</button>
      <button class="btn btn-primary" id="closePM">閉じる</button>
    </div>`);
  $('#closePM').addEventListener('click', closeModal);
  $('#toggleClose').addEventListener('click', () => {
    const obj = Object.assign({}, p, { closed: !closed });
    if (obj.closed) obj.deadline = null;
    Store.upsert('polls', obj); closeModal(); drawPollList();
  });
  $('#delPoll').addEventListener('click', () => {
    if (confirm('この投票を削除しますか？')) {
      DB.votes = DB.votes.filter(v => v.poll_id !== pid); save();
      Store.del('polls', pid); closeModal(); drawPollList();
    }
  });
}
function pollForm() {
  openModal(`
    <h3>投票・アンケートを作成</h3>
    <div class="field"><label>質問<span class="req">必須</span></label><input id="p_q" placeholder="例：ストライキの実施に賛成しますか？"></div>
    <div class="field"><label>選択肢<span class="req">必須</span></label><div id="p_opts">
      <input class="p_opt" style="margin-bottom:8px" placeholder="選択肢1">
      <input class="p_opt" style="margin-bottom:8px" placeholder="選択肢2">
    </div><button class="btn btn-ghost btn-sm" id="addOpt">＋ 選択肢を追加</button></div>
    <div class="field"><label>締切（任意）</label><input type="datetime-local" id="p_deadline"></div>
    <div class="btn-row"><button class="btn btn-ghost" id="cancelP">キャンセル</button><button class="btn btn-primary" id="saveP">作成</button></div>
  `);
  $('#addOpt').addEventListener('click', () => {
    const i = document.createElement('input');
    i.className = 'p_opt'; i.style.marginBottom = '8px'; i.placeholder = '選択肢' + ($('#p_opts').children.length + 1);
    $('#p_opts').appendChild(i);
  });
  $('#cancelP').addEventListener('click', closeModal);
  $('#saveP').addEventListener('click', () => {
    const q = $('#p_q').value.trim();
    const opts = [...document.querySelectorAll('.p_opt')].map(i => i.value.trim()).filter(Boolean);
    if (!q) { toast('質問を入力してください'); return; }
    if (opts.length < 2) { toast('選択肢を2つ以上入力してください'); return; }
    const dl = $('#p_deadline').value ? new Date($('#p_deadline').value).getTime() : null;
    Store.upsert('polls', { id: uid(), question: q, options: opts, deadline: dl, closed: false, createdAt: Date.now() });
    closeModal(); toast('投票を作成しました'); drawPollList();
  });
}

/* ============================================================
   組合費（納付管理）
   徴収設定は payments コレクション内の固定ID('dues_config')の
   共有レコードとして保存する（組合の全員に同期される）。
   決済リンクは必ずアプリ外のブラウザで開く（Play 決済ポリシー対応）。
   ============================================================ */
const DUES_CONFIG_ID = 'dues_config';
const PAY_METHODS = ['決済リンク', '銀行振込', '現金', 'その他'];
const duesConfig = () => DB.payments.find(p => p.id === DUES_CONFIG_ID) || { id: DUES_CONFIG_ID, amount: 100, payUrl: '', payInfo: '' };
const duesRecords = () => DB.payments.filter(p => p.id !== DUES_CONFIG_ID);
const periodKey = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const periodLabel = (key) => { const [y, m] = key.split('-'); return `${y}年${+m}月`; };
const shiftPeriod = (key, delta) => { const [y, m] = key.split('-').map(Number); return periodKey(new Date(y, m - 1 + delta, 1)); };
const yen = (n) => '¥' + (Number(n) || 0).toLocaleString('ja-JP');
let duesPeriod = periodKey(new Date());

function renderDues() {
  const v = $('#view');
  const cfg = duesConfig();
  const recs = duesRecords().filter(r => r.period === duesPeriod);
  const paidIds = new Set(recs.map(r => r.memberId));
  const total = DB.members.length;
  const paid = DB.members.filter(m => paidIds.has(m.id)).length;
  const sum = recs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const pct = total ? Math.round((paid / total) * 100) : 0;

  v.innerHTML = `
    <div class="list-head">
      <div class="section-title" style="margin:0">💰 組合費の納付管理</div>
      <button class="btn btn-ghost btn-sm" id="exportDues">⬇ CSV</button>
    </div>

    <div class="card">
      <div class="card-row">
        <button class="btn btn-ghost btn-sm" id="prevPeriod">◀ 前月</button>
        <strong style="font-size:16px">${periodLabel(duesPeriod)}</strong>
        <button class="btn btn-ghost btn-sm" id="nextPeriod">翌月 ▶</button>
      </div>
      <div class="card-row" style="margin-top:12px">
        <span style="font-size:13px">納付済み <strong style="color:var(--red)">${paid}</strong> / ${total} 名</span>
        <span class="muted" style="font-size:13px">集計 ${yen(sum)}</span>
      </div>
      <div class="progress"><span style="width:${pct}%"></span></div>
    </div>

    <div class="card">
      <div class="card-row">
        <div><strong style="font-size:14px">月額 ${yen(cfg.amount)}</strong><div class="muted" style="font-size:12px">組合費の設定（全員に共有）</div></div>
        <button class="btn btn-ghost btn-sm" id="duesSettings">⚙ 変更</button>
      </div>
      ${cfg.payUrl ? `<button class="btn btn-primary" id="payNow" style="margin-top:12px">💳 組合費を納付する（外部サイト）</button>` : ''}
      ${cfg.payInfo ? `<div class="item-body" style="margin-top:10px">${esc(cfg.payInfo)}</div>` : ''}
      ${!cfg.payUrl && !cfg.payInfo ? `<p class="muted" style="font-size:12px;margin:10px 0 0">「⚙ 変更」から決済リンク（Stripe等）や振込先の案内を設定すると、ここに納付ボタンが表示されます。</p>` : ''}
    </div>

    <div class="section-title">📋 ${periodLabel(duesPeriod)}の納付状況</div>
    <div id="duesList"></div>
  `;
  $('#prevPeriod').addEventListener('click', () => { duesPeriod = shiftPeriod(duesPeriod, -1); renderDues(); });
  $('#nextPeriod').addEventListener('click', () => { duesPeriod = shiftPeriod(duesPeriod, 1); renderDues(); });
  $('#duesSettings').addEventListener('click', duesSettingsForm);
  $('#exportDues').addEventListener('click', exportDuesCSV);
  const pay = $('#payNow');
  if (pay) pay.addEventListener('click', () => window.open(cfg.payUrl, '_blank', 'noopener'));
  drawDuesList();
}

function drawDuesList() {
  const el = $('#duesList');
  if (!DB.members.length) {
    el.innerHTML = `<div class="empty"><div class="e-ico">💰</div><p>名簿に仲間を登録すると、<br>ここで納付状況を管理できます。</p></div>`;
    return;
  }
  const recs = duesRecords().filter(r => r.period === duesPeriod);
  const byMember = new Map(recs.map(r => [r.memberId, r]));
  const rows = [...DB.members].sort((a, b) => {
    const pa = byMember.has(a.id) ? 1 : 0, pb = byMember.has(b.id) ? 1 : 0;
    return (pa - pb) || (b.createdAt - a.createdAt); // 未納を上に
  });
  el.innerHTML = rows.map(m => {
    const r = byMember.get(m.id);
    return `
    <div class="item" data-dues="${m.id}" style="cursor:pointer">
      <div class="item-flex">
        <div class="avatar">${esc(initial(m.name))}</div>
        <div style="flex:1;min-width:0">
          <div class="item-title">${esc(m.name)}</div>
          <div class="item-meta">${r ? `${fmtDate(r.paidAt)}・${esc(r.method || '—')}・${yen(r.amount)}` : 'タップして納付を記録'}</div>
        </div>
        ${r ? '<span class="badge badge-green">納付済</span>' : '<span class="badge badge-amber">未納</span>'}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-dues]').forEach(it =>
    it.addEventListener('click', () => duesRecordForm(it.dataset.dues)));
}

function duesRecordForm(memberId) {
  const m = DB.members.find(x => x.id === memberId);
  if (!m) return;
  const cfg = duesConfig();
  const r = duesRecords().find(x => x.memberId === memberId && x.period === duesPeriod);
  if (r) {
    openModal(`<h3>納付記録 — ${esc(m.name)}</h3>
      <p style="font-size:13px">${periodLabel(duesPeriod)}分：<strong>${yen(r.amount)}</strong>（${esc(r.method || '—')}）</p>
      <p class="muted" style="font-size:13px">記録日時：${fmtDateTime(r.paidAt)}${r.note ? '<br>メモ：' + esc(r.note) : ''}</p>
      <div class="btn-row">
        <button class="btn btn-ghost" id="delDues" style="color:#b91c1c">記録を取り消す</button>
        <button class="btn btn-primary" id="closeDues">閉じる</button>
      </div>`);
    $('#closeDues').addEventListener('click', closeModal);
    $('#delDues').addEventListener('click', () => {
      if (confirm(`${m.name} さんの${periodLabel(duesPeriod)}分の納付記録を取り消しますか？`)) {
        Store.del('payments', r.id);
        closeModal(); toast('取り消しました'); renderDues();
      }
    });
    return;
  }
  openModal(`<h3>納付を記録 — ${esc(m.name)}</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px">${periodLabel(duesPeriod)}分の組合費の納付を記録します。</p>
    <div class="row2">
      <div class="field"><label>金額（円）</label><input id="d_amount" type="number" min="0" value="${esc(cfg.amount ?? 100)}"></div>
      <div class="field"><label>納付方法</label><select id="d_method">${PAY_METHODS.map(t => `<option>${t}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>メモ</label><input id="d_note" placeholder="任意"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="cancelD">キャンセル</button>
      <button class="btn btn-primary" id="saveD">納付済みにする</button>
    </div>`);
  $('#cancelD').addEventListener('click', closeModal);
  $('#saveD').addEventListener('click', () => {
    Store.upsert('payments', {
      id: uid(), memberId, period: duesPeriod,
      amount: Math.max(0, parseInt($('#d_amount').value) || 0),
      method: $('#d_method').value, note: $('#d_note').value.trim(), paidAt: Date.now(),
    });
    closeModal(); toast('納付を記録しました ✊'); renderDues();
  });
}

function duesSettingsForm() {
  const cfg = duesConfig();
  openModal(`<h3>💰 徴収の設定</h3>
    <p class="muted" style="font-size:13px;margin:0 0 14px">この設定は組合の全員に共有されます。決済は必ずアプリの外（ブラウザ）で行われます。</p>
    <div class="field"><label>月額（円）</label><input id="ds_amount" type="number" min="0" value="${esc(cfg.amount ?? 100)}"></div>
    <div class="field"><label>決済リンクURL</label><input id="ds_url" type="url" value="${esc(cfg.payUrl || '')}" placeholder="https://buy.stripe.com/..."></div>
    <div class="field"><label>納付方法の説明</label><textarea id="ds_info" placeholder="例：毎月25日までに上記リンクからお支払いください。銀行振込の場合は◯◯銀行 普通 1234567 まで。">${esc(cfg.payInfo || '')}</textarea></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="cancelDS">キャンセル</button>
      <button class="btn btn-primary" id="saveDS">保存</button>
    </div>`);
  $('#cancelDS').addEventListener('click', closeModal);
  $('#saveDS').addEventListener('click', () => {
    const url = $('#ds_url').value.trim();
    if (url && !/^https:\/\//i.test(url)) { toast('決済リンクは https:// で始まるURLを入力してください'); return; }
    Store.upsert('payments', Object.assign({}, cfg, {
      id: DUES_CONFIG_ID,
      amount: Math.max(0, parseInt($('#ds_amount').value) || 0),
      payUrl: url, payInfo: $('#ds_info').value.trim(),
    }));
    closeModal(); toast('設定を保存しました'); renderDues();
  });
}

function exportDuesCSV() {
  if (!DB.members.length) { toast('名簿が空です'); return; }
  const recs = duesRecords().filter(r => r.period === duesPeriod);
  const byMember = new Map(recs.map(r => [r.memberId, r]));
  const head = ['氏名', '部署', '対象月', '納付状況', '納付日', '方法', '金額', 'メモ'];
  const rows = DB.members.map(m => {
    const r = byMember.get(m.id);
    return [m.name, m.dept, periodLabel(duesPeriod), r ? '納付済' : '未納',
      r ? fmtDate(r.paidAt) : '', r ? r.method : '', r ? r.amount : '', r ? r.note : ''];
  });
  const csv = [head, ...rows].map(rr => rr.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  downloadFile('﻿' + csv, `組合費納付状況_${duesPeriod}.csv`, 'text/csv');
  toast('CSVを書き出しました');
}

/* ============================================================
   クラウド接続（複数人共有）
   ============================================================ */
function openCloudConnect() {
  if (!Cloud.configured()) {
    openModal(`<h3>☁ データ共有の設定</h3>
      <p style="font-size:13px" class="muted">仲間とリアルタイムでデータを共有するには、無料の <b>Supabase</b> を接続します。手順は同梱の <b>README.md</b> と <b>supabase_setup.sql</b> をご覧ください。</p>
      <ol style="font-size:13px;padding-left:20px;line-height:1.9">
        <li>Supabase でプロジェクトを作成</li>
        <li><b>supabase_setup.sql</b> を SQL Editor で実行</li>
        <li>Anonymous Sign-ins を ON</li>
        <li><b>config.js</b> に URL と anon キーを記入</li>
      </ol>
      <div class="btn-row" style="margin-top:8px"><button class="btn btn-primary" id="closeCC">わかった</button></div>`);
    $('#closeCC').addEventListener('click', closeModal);
    return;
  }
  if (Cloud.orgs && Cloud.orgs.length) {
    // 複数の組合を管理・切り替え
    const list = Cloud.orgs.map(o => `
      <div class="item" data-sw="${o.id}" style="margin-bottom:8px;${o.id === Cloud.org.id ? 'border-color:var(--red)' : 'cursor:pointer'}">
        <div class="card-row">
          <div style="min-width:0">
            <div class="item-title">${o.id === Cloud.org.id ? '✓ ' : ''}${esc(o.name)}</div>
            <div class="item-meta">コード：${esc(o.join_code)}</div>
          </div>
          ${o.id === Cloud.org.id ? '<span class="badge badge-green">表示中</span>' : '<button class="btn btn-ghost btn-sm" data-sw="' + o.id + '">切替</button>'}
        </div>
      </div>`).join('');
    openModal(`<h3>☁ 組合の管理（${Cloud.orgs.length}）</h3>
      <p class="muted" style="font-size:13px;margin:0 0 10px">複数の組合を切り替えて管理できます。名前をタップで切替。</p>
      ${list}
      <div class="card center" style="background:var(--red-light);border:0;margin-top:4px">
        <div class="item-meta" style="color:var(--red)">表示中の組合の参加コード</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:4px;color:var(--red)">${esc(Cloud.org.join_code)}</div>
      </div>
      <div class="btn-row" style="flex-direction:column">
        <button class="btn btn-ghost" id="copyCode">📋 参加コードをコピー</button>
        <button class="btn btn-primary" id="addOrg">＋ 別の組合を作成／参加</button>
        <button class="btn btn-ghost" id="leaveOrg" style="color:#b91c1c">表示中の組合をこの端末から外す</button>
        <button class="btn btn-ghost" id="closeCC2">閉じる</button>
      </div>`);
    $('#closeCC2').addEventListener('click', closeModal);
    $('#copyCode').addEventListener('click', () => { navigator.clipboard?.writeText(Cloud.org.join_code); toast('コピーしました'); });
    $('#addOrg').addEventListener('click', () => { closeModal(); openOrgAddForm(); });
    document.querySelectorAll('[data-sw]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.sw;
      if (id === Cloud.org.id) return;
      closeModal(); switchOrg(id);
    }));
    $('#leaveOrg').addEventListener('click', () => {
      if (confirm('表示中の組合をこの端末から外します。クラウド上のデータは消えません。よろしいですか？')) {
        Cloud.leaveOrg(Cloud.org.id);
        closeModal();
        if (Cloud.org) { switchOrg(Cloud.org.id); }
        else {
          DB.members = []; DB.cards = []; DB.notices = []; DB.polls = []; DB.votes = []; DB.payments = [];
          DB.settings.unionName = '私たちの労働組合'; save();
          $('#unionNameDisplay').textContent = DB.settings.unionName; go('home');
        }
        toast('外しました');
      }
    });
    return;
  }
  // 未参加：作成 or 参加
  openOrgAddForm();
}

/* 組合の作成／参加フォーム */
function openOrgAddForm() {
  openModal(`<h3>☁ 組合を作成／参加</h3>
    <div class="card">
      <strong style="font-size:14px">🆕 新しく組合をつくる</strong>
      <p class="muted" style="font-size:12px;margin:4px 0 10px">代表として領域を作成し、参加コードを仲間に配ります。</p>
      <div class="field" style="margin:0 0 10px"><input id="cc_name" placeholder="組合名（例：◯◯ユニオン）"></div>
      <button class="btn btn-primary" id="cc_create">作成して参加コードを発行</button>
    </div>
    <div class="card">
      <strong style="font-size:14px">🔑 既存の組合に参加する</strong>
      <p class="muted" style="font-size:12px;margin:4px 0 10px">受け取った参加コードを入力します。</p>
      <div class="field" style="margin:0 0 10px"><input id="cc_code" placeholder="参加コード（6桁）" style="text-transform:uppercase"></div>
      <button class="btn btn-primary" id="cc_join">参加する</button>
    </div>
    <button class="btn btn-ghost" id="cc_cancel">キャンセル</button>`);
  $('#cc_cancel').addEventListener('click', () => { closeModal(); if (Cloud.orgs && Cloud.orgs.length) openCloudConnect(); });
  $('#cc_create').addEventListener('click', async () => {
    const name = $('#cc_name').value.trim() || '労働組合';
    const btn = $('#cc_create'); btn.disabled = true; btn.textContent = '作成中…';
    try {
      const first = Cloud.orgs.length === 0;
      await Cloud.createOrg(name);
      if (first) {
        await pushLocalToCloud();  // 初回だけ端末内データを移行
      } else {
        DB.members = []; DB.cards = []; DB.notices = []; DB.polls = []; DB.votes = []; DB.payments = []; save();  // 追加の組合は空から
      }
      DB.settings.unionName = name; save();
      $('#unionNameDisplay').textContent = name;
      Cloud.subscribe(refreshFromCloud);
      MY_VOTER_ID = await Cloud.userId();
      await refreshFromCloud();
      closeModal(); toast('組合を作成しました ✊'); openCloudConnect();
    } catch (e) {
      btn.disabled = false; btn.textContent = '作成して参加コードを発行';
      toast('作成に失敗：' + (e.message || 'エラー'));
    }
  });
  $('#cc_join').addEventListener('click', async () => {
    const code = $('#cc_code').value.trim();
    if (!code) { toast('参加コードを入力してください'); return; }
    const btn = $('#cc_join'); btn.disabled = true; btn.textContent = '参加中…';
    try {
      const org = await Cloud.joinOrg(code);   // 成功後に手元をクリア（失敗時のデータ消失を防ぐ）
      DB.members = []; DB.cards = []; DB.notices = []; DB.polls = []; DB.votes = []; DB.payments = []; save();
      DB.settings.unionName = org.name; save();
      $('#unionNameDisplay').textContent = org.name;
      Cloud.subscribe(refreshFromCloud);
      MY_VOTER_ID = await Cloud.userId();
      await refreshFromCloud();
      closeModal(); toast('参加しました ✊'); openCloudConnect();
    } catch (e) {
      btn.disabled = false; btn.textContent = '参加する';
      toast(e.message || '参加に失敗しました');
    }
  });
}

/* 組合を切り替え（アクティブ変更 → その組合のデータを取得） */
async function switchOrg(id) {
  const target = Cloud.orgs.find(o => o.id === id);
  if (!target) return;
  toast('切り替え中…');
  try { await Cloud.joinOrg(target.join_code); }  // メンバー資格を確実にしつつアクティブ化
  catch (e) { Cloud.setActive(id); }
  DB.members = []; DB.cards = []; DB.notices = []; DB.polls = []; DB.votes = []; DB.payments = []; save();
  DB.settings.unionName = Cloud.org.name; save();
  $('#unionNameDisplay').textContent = Cloud.org.name;
  MY_VOTER_ID = await Cloud.userId();
  await refreshFromCloud();
  toast('「' + Cloud.org.name + '」に切替');
}

/* 端末内の既存データをクラウドへ初期反映（組合作成時） */
async function pushLocalToCloud() {
  for (const coll of ['members', 'cards', 'notices', 'polls', 'payments']) {
    for (const obj of DB[coll]) { try { await Cloud.upsert(coll, obj); } catch (e) { /* 続行 */ } }
  }
  for (const v of DB.votes) {
    if (v.voter_id === MY_VOTER_ID) { try { await Cloud.vote(v.poll_id, v.opt); } catch (e) { /* 続行 */ } }
  }
}

/* ============================================================
   設定
   ============================================================ */
function openSettings() {
  const s = DB.settings;
  const online = !!Cloud.org;
  openModal(`
    <h3>⚙️ 設定</h3>
    <div class="card" style="box-shadow:none">
      <div class="card-row">
        <div><strong style="font-size:14px">☁ データ共有</strong><div class="muted" style="font-size:12px">${online ? '共有中：' + esc(Cloud.org.name) : 'この端末のみ'}</div></div>
        <button class="btn btn-ghost btn-sm" id="s_cloud">${online ? '管理' : '設定'}</button>
      </div>
    </div>
    <div class="field"><label>組合名</label><input id="s_union" value="${esc(s.unionName)}"></div>
    <div class="field"><label>会社・事業所名</label><input id="s_company" value="${esc(s.companyName)}" placeholder="任意"></div>
    <div class="field"><label>結成目標人数</label><input id="s_target" type="number" min="1" value="${esc(s.targetMembers)}"></div>
    <hr class="div">
    <div class="btn-row" style="flex-direction:column">
      <button class="btn btn-ghost" id="openManual">📖 使い方ガイド</button>
      <button class="btn btn-ghost" id="exportAll">⬇ 全データをバックアップ（JSON）</button>
      <button class="btn btn-ghost" id="importAll">⬆ バックアップから復元</button>
      <input type="file" id="importFile" accept="application/json" hidden>
      <button class="btn btn-ghost" id="resetAll" style="color:#b91c1c">この端末のデータを消去</button>
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-ghost" id="cancelS">閉じる</button>
      <button class="btn btn-primary" id="saveS">保存</button>
    </div>
  `);
  $('#s_cloud').addEventListener('click', () => { closeModal(); openCloudConnect(); });
  $('#openManual').addEventListener('click', () => window.open('manual.html', '_blank', 'noopener'));
  $('#cancelS').addEventListener('click', closeModal);
  $('#saveS').addEventListener('click', () => {
    s.unionName = $('#s_union').value.trim() || '私たちの労働組合';
    s.companyName = $('#s_company').value.trim();
    s.targetMembers = Math.max(1, parseInt($('#s_target').value) || 30);
    save(); $('#unionNameDisplay').textContent = s.unionName; closeModal(); toast('設定を保存しました'); go(current);
  });
  $('#exportAll').addEventListener('click', () =>
    downloadFile(JSON.stringify(DB, null, 2), `労組結成ナビ_バックアップ_${new Date().toISOString().slice(0,10)}.json`, 'application/json'));
  $('#importAll').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try { DB = Object.assign(defaultDB(), JSON.parse(r.result)); save(); closeModal(); toast('復元しました'); go('home'); }
      catch { toast('ファイルを読み込めませんでした'); }
    };
    r.readAsText(file);
  });
  $('#resetAll').addEventListener('click', () => {
    if (confirm('この端末のデータを消去します。よろしいですか？この操作は取り消せません。')) {
      localStorage.removeItem(DB_KEY); DB = load(); closeModal(); toast('消去しました'); go('home');
    }
  });
}

/* ---------- ファイルダウンロード ---------- */
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============================================================
   起動
   ============================================================ */
async function boot() {
  if (Cloud.configured()) {
    await Cloud.init();
    if (Cloud.org) {
      // 匿名IDが変わってもメンバー資格を失わないよう、保存済みの参加コードで毎回“再参加”（冪等）
      if (Cloud.org.join_code) {
        try { await Cloud.joinOrg(Cloud.org.join_code); }
        catch (e) { console.warn('[Cloud] rejoin skipped:', e && e.message); }
      }
      MY_VOTER_ID = await Cloud.userId();
      Cloud.subscribe(refreshFromCloud);
      await refreshFromCloud();
    } else {
      MY_VOTER_ID = localVoterId();
    }
  } else {
    MY_VOTER_ID = localVoterId();
  }
  $('#unionNameDisplay').textContent = DB.settings.unionName;
  go('home');
}
boot();

/* Service Worker 登録（オフライン対応） */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
