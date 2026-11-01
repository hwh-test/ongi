/* =========================================================
 * 사용자 활동 저장소 — Firebase Realtime Database
 * ---------------------------------------------------------
 * 데이터 구조
 *   favorites/{uid}/{유기번호}   내 찜 목록 (동물 요약 정보)
 *   stats/{유기번호}/views        조회수   (랭킹용)
 *   stats/{유기번호}/likes        찜한 사람 수 (랭킹용)
 *   stats/{유기번호}/info         랭킹에 보여줄 요약 정보
 *   comments/{유기번호}/{pushId}  응원 댓글
 *
 * uid: 로그인 없이 브라우저마다 만든 익명 아이디 (localStorage)
 * Firebase 설정이 비어 있으면 같은 구조를 localStorage에 저장하는
 * '로컬 모드'로 동작합니다.
 * ========================================================= */
const Store = (() => {
  /* ---------- 익명 사용자 아이디 ---------- */
  function getUid() {
    try {
      let id = localStorage.getItem('ongi:uid');
      if (!id) {
        id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('ongi:uid', id);
      }
      return id;
    } catch (_) {
      return 'guest';
    }
  }
  const uid = getUid();

  /* ---------- Firebase 연결 ---------- */
  let db = null;
  const cfg = CONFIG.FIREBASE || {};
  if (cfg.apiKey && cfg.databaseURL && typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      db = firebase.database();
    } catch (e) {
      console.warn('[온기] Firebase 초기화 실패 → 로컬 모드로 동작합니다.', e);
      db = null;
    }
  }
  const isLocal = () => !db;

  /* ---------- 로컬 모드 (localStorage) ---------- */
  const Local = (() => {
    const KEY = 'ongi:local-db';
    const listeners = new Set();
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; } };
    let data = load();
    const notify = () => listeners.forEach((fn) => fn());

    // 다른 탭에서 바뀐 내용도 반영 (실시간 흉내)
    window.addEventListener('storage', (e) => { if (e.key === KEY) { data = load(); notify(); } });

    const get = (path) => path.split('/').reduce((o, k) => (o == null ? undefined : o[k]), data);
    function set(path, value) {
      const keys = path.split('/');
      let o = data;
      keys.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
      const last = keys[keys.length - 1];
      if (value === null || value === undefined) delete o[last]; else o[last] = value;
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* 저장 공간 부족 */ }
      notify();
    }
    function watch(path, cb) {
      const fn = () => { const v = get(path); cb(v === undefined ? null : JSON.parse(JSON.stringify(v))); };
      listeners.add(fn);
      setTimeout(fn, 0);
      return () => listeners.delete(fn);
    }
    return { get, set, watch };
  })();

  /* ---------- 공통 기본 동작 ---------- */
  function watch(path, cb) {
    if (isLocal()) return Local.watch(path, cb);
    const ref = db.ref(path);
    const handler = (snap) => cb(snap.val());
    ref.on('value', handler, (err) => { console.warn('[온기] 읽기 실패', path, err); cb(null, err); });
    return () => ref.off('value', handler);
  }

  async function set(path, value) {
    if (isLocal()) return Local.set(path, value);
    return db.ref(path).set(value);
  }

  /** 숫자 1 증가/감소 — 여러 사람이 동시에 눌러도 정확하도록 트랜잭션 사용 */
  async function increment(path, delta) {
    if (isLocal()) {
      const v = Math.max(0, (Local.get(path) || 0) + delta);
      Local.set(path, v);
      return v;
    }
    const res = await db.ref(path).transaction((cur) => Math.max(0, (cur || 0) + delta));
    return res.snapshot.val();
  }

  /** Firebase는 undefined 값을 저장할 수 없어 JSON으로 한 번 정리 */
  const clean = (obj) => JSON.parse(JSON.stringify(obj));

  /* ---------- 저장할 요약 정보 ---------- */
  function favSnapshot(a) {
    return clean({
      id: a.id, kind: a.kind, upKind: a.upKind, sex: a.sex,
      age: { text: a.age?.text || '', years: a.age?.years ?? null },
      weight: a.weight, careNm: a.careNm, careAddr: a.careAddr || '',
      images: (a.images || []).slice(0, 1), noticeEnd: a.noticeEnd || '', state: a.state || '',
      savedAt: Date.now(),
    });
  }
  function rankInfo(a) {
    return clean({
      kind: a.kind, upKind: a.upKind, sex: a.sex, age: a.age?.text || '',
      careNm: a.careNm, image: a.images?.[0] || '', updatedAt: Date.now(),
    });
  }

  /* ---------- 찜 ---------- */
  let favCache = {};
  let favLoaded = false;
  const favListeners = new Set();
  const emitFavs = () => favListeners.forEach((fn) => fn(favCache, favLoaded));

  watch(`favorites/${uid}`, (v) => { favCache = v || {}; favLoaded = true; emitFavs(); });

  async function toggleFavorite(animal) {
    const id = animal.id;
    const on = !favCache[id];
    // 화면 먼저 바꾸고(낙관적 업데이트) 저장은 뒤에서
    favCache = { ...favCache };
    if (on) favCache[id] = favSnapshot(animal); else delete favCache[id];
    emitFavs();

    await set(`favorites/${uid}/${id}`, on ? favCache[id] : null);
    await increment(`stats/${id}/likes`, on ? 1 : -1);
    if (on) await set(`stats/${id}/info`, rankInfo(animal));
    return on;
  }

  /* ---------- 조회수 (같은 탭에서는 한 번만) ---------- */
  async function recordView(animal) {
    const flag = `ongi:viewed:${animal.id}`;
    try { if (sessionStorage.getItem(flag)) return; sessionStorage.setItem(flag, '1'); } catch (_) { /* 무시 */ }
    try {
      await increment(`stats/${animal.id}/views`, 1);
      await set(`stats/${animal.id}/info`, rankInfo(animal));
    } catch (e) {
      console.warn('[온기] 조회수 저장 실패', e);
    }
  }

  /* ---------- 랭킹 ---------- */
  function toRanking(all, field, limit) {
    return Object.entries(all || {})
      .map(([id, v]) => ({ id, count: v?.[field] || 0, info: v?.info || {} }))
      .filter((x) => x.count > 0 && x.info.kind)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  function watchRanking(field, limit, cb) {
    if (isLocal()) return Local.watch('stats', (all) => cb(toRanking(all, field, limit)));
    // 서버에서 정렬해 상위 n개만 받음 (database.rules.json의 .indexOn 필요)
    const ref = db.ref('stats').orderByChild(field).limitToLast(limit);
    const handler = (snap) => {
      const all = {};
      snap.forEach((child) => { all[child.key] = child.val(); });
      cb(toRanking(all, field, limit));
    };
    ref.on('value', handler, (err) => cb([], err));
    return () => ref.off('value', handler);
  }

  /* ---------- 댓글 ---------- */
  const toList = (v) => Object.entries(v || {})
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  function watchComments(id, cb) {
    if (isLocal()) return Local.watch(`comments/${id}`, (v) => cb(toList(v)));
    const ref = db.ref(`comments/${id}`).orderByChild('createdAt').limitToLast(50);
    const handler = (snap) => cb(toList(snap.val()));
    ref.on('value', handler, (err) => cb([], err));
    return () => ref.off('value', handler);
  }

  async function addComment(id, nick, text) {
    const item = {
      nick: nick.slice(0, 12),
      text: text.slice(0, 200),
      uid,
      createdAt: isLocal() ? Date.now() : firebase.database.ServerValue.TIMESTAMP,   // 서버 시간
    };
    if (isLocal()) return Local.set(`comments/${id}/c${Date.now().toString(36)}`, item);
    return db.ref(`comments/${id}`).push(item);
  }

  /* ---------- AI 소개글 (한 번 만든 글은 모두가 함께 봄) ---------- */
  async function getStory(id) {
    if (isLocal()) return Local.get(`stories/${id}`) ?? null;
    const snap = await db.ref(`stories/${id}`).once('value');
    return snap.val();
  }
  async function saveStory(id, story) {
    const item = clean({
      text: String(story.text || '').slice(0, 1500),
      model: story.model || '',
      createdAt: isLocal() ? Date.now() : firebase.database.ServerValue.TIMESTAMP,
    });
    if (isLocal()) return Local.set(`stories/${id}`, item);
    return db.ref(`stories/${id}`).set(item);
  }

  /* ---------- 연결 상태 ---------- */
  function watchConnection(cb) {
    if (isLocal()) { cb('local'); return () => {}; }
    const ref = db.ref('.info/connected');
    const handler = (snap) => cb(snap.val() ? 'online' : 'offline');
    ref.on('value', handler);
    return () => ref.off('value', handler);
  }

  return {
    uid,
    isLocal,
    isFavorite: (id) => !!favCache[id],
    getFavorites: () => favCache,
    onFavorites(fn) { favListeners.add(fn); fn(favCache, favLoaded); return () => favListeners.delete(fn); },
    toggleFavorite,
    recordView,
    watchStat: (id, cb) => watch(`stats/${id}`, (v) => cb(v || {})),
    watchRanking,
    watchComments,
    addComment,
    watchConnection,
    getStory,
    saveStory,
  };
})();
