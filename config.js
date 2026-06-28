/* ============================================================
   クラウド接続設定（複数人でデータを共有する場合に入力）
   ------------------------------------------------------------
   Supabase でプロジェクトを作成し、下の 2 つを書き換えてください。
   取得場所： Supabase ダッシュボード > Project Settings > API
     - Project URL        → url
     - Project API keys > anon public → anonKey
   ※ anon キーは公開しても安全な「公開鍵」です（Row Level Security で保護）。
   ※ 空欄のままなら、アプリは端末内のみ（オフライン単体）で動作します。
   ============================================================ */
window.UNION_CONFIG = {
  url: "",       // 例: "https://xxxxxxxx.supabase.co"
  anonKey: "",   // 例: "eyJhbGciOiJIUzI1NiIsIn..."
};
