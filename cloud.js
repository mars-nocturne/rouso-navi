/* ============================================================
   労組結成ナビ — クラウド同期層（Supabase）
   設定が無ければ何もしない（アプリはローカル単体で動作）。
   ============================================================ */
'use strict';

const Cloud = {
  client: null,
  org: null,        // { id, name, join_code }
  _uid: null,
  lastError: null,

  /** config.js に有効な値があるか */
  configured() {
    const c = window.UNION_CONFIG || {};
    return !!(c.url && c.anonKey && typeof supabase !== 'undefined');
  },

  /** クライアント生成・匿名サインイン・保存済み組合の復元 */
  async init() {
    if (!this.configured()) return false;
    try {
      this.client = supabase.createClient(UNION_CONFIG.url, UNION_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      let { data: { session } } = await this.client.auth.getSession();
      if (!session) {
        const { error } = await this.client.auth.signInAnonymously();
        if (error) throw error;
      }
      const saved = localStorage.getItem('union_org');
      if (saved) this.org = JSON.parse(saved);
      return true;
    } catch (e) {
      this.lastError = e;
      console.warn('[Cloud] init failed:', e.message);
      return false;
    }
  },

  async userId() {
    if (this._uid) return this._uid;
    const { data } = await this.client.auth.getUser();
    this._uid = data.user ? data.user.id : null;
    return this._uid;
  },

  _setOrg(o) {
    this.org = { id: o.id, name: o.name, join_code: o.join_code };
    localStorage.setItem('union_org', JSON.stringify(this.org));
  },

  /** 新しい組合（オンライン領域）を作成し参加コードを得る */
  async createOrg(name) {
    const { data, error } = await this.client.rpc('create_org', { p_name: name });
    if (error) throw error;
    this._setOrg(data);
    return this.org;
  },

  /** 参加コードで既存の組合に参加 */
  async joinOrg(code) {
    const { data, error } = await this.client.rpc('join_org', { p_code: (code || '').trim().toUpperCase() });
    if (error) throw error;
    if (!data) throw new Error('参加コードが見つかりません');
    this._setOrg(data);
    return this.org;
  },

  leave() {
    this.org = null;
    localStorage.removeItem('union_org');
  },

  /** 全コレクションを取得（{members,cards,notices,polls,votes}） */
  async pullAll() {
    const o = this.org.id;
    const out = { members: [], cards: [], notices: [], polls: [], votes: [] };
    for (const t of ['members', 'cards', 'notices', 'polls']) {
      const { data, error } = await this.client.from(t).select('data').eq('org_id', o);
      if (error) throw error;
      out[t] = (data || []).map(r => r.data);
    }
    const { data: votes } = await this.client.from('votes').select('poll_id,voter_id,opt').eq('org_id', o);
    out.votes = votes || [];
    return out;
  },

  async upsert(table, obj) {
    if (!this.org) return;
    const { error } = await this.client.from(table).upsert({
      id: obj.id, org_id: this.org.id, data: obj, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  },

  async del(table, id) {
    if (!this.org) return;
    const { error } = await this.client.from(table).delete().eq('id', id).eq('org_id', this.org.id);
    if (error) throw error;
  },

  async vote(pollId, opt) {
    if (!this.org) return;
    const uid = await this.userId();
    const { error } = await this.client.from('votes').upsert({
      poll_id: pollId, voter_id: uid, opt, org_id: this.org.id,
    });
    if (error) throw error;
  },

  async unvote(pollId) {
    if (!this.org) return;
    const uid = await this.userId();
    const { error } = await this.client.from('votes').delete().eq('poll_id', pollId).eq('voter_id', uid);
    if (error) throw error;
  },

  /** リアルタイム購読（変更があれば cb を呼ぶ） */
  subscribe(cb) {
    if (!this.org || this._channel) return;
    this._channel = this.client
      .channel('org-' + this.org.id)
      .on('postgres_changes', { event: '*', schema: 'public' }, () => cb())
      .subscribe();
  },
};
