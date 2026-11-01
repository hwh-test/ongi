/* =========================================================
 * 공통 유틸리티: 날짜, D-day, 표시용 변환, 헤더/푸터, 상태 화면
 * ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------- 날짜 ---------- */
const pad2 = (n) => String(n).padStart(2, '0');

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 'YYYYMMDD' 또는 'YYYY-MM-DD' → Date */
function parseYmd(value) {
  const s = String(value ?? '').replace(/\D/g, '');
  if (s.length < 8) return null;
  const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date → 'YYYYMMDD' (API 형식) */
function toYmd(date) {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

/** Date → 'YYYY-MM-DD' (input[type=date] 형식) */
function toInputDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(value) {
  const d = parseYmd(value);
  return d ? `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}` : '-';
}

/** 오늘부터 해당 날짜까지 남은 일수 (지났으면 음수) */
function daysUntil(value) {
  const d = parseYmd(value);
  if (!d) return null;
  return Math.round((d - today()) / 86400000);
}

/* ---------- D-day 배지 ----------
 * 공고 기간: 원래 보호자가 찾아갈 수 있는 기간 → 'D-n'
 * 공고 종료 후 보호중: 입양을 기다리는 기간 → '입양 대기 n일째'
 * (보호 기간이 길어질수록 위험하므로 오래 기다린 아이를 강조)
 */
function statusBadge(animal) {
  const state = animal.state || '';
  if (state.startsWith('종료')) {
    const label = state.replace(/종료\(?|\)/g, '') || '종료';
    return { text: label, cls: 'badge-end', title: `처리 상태: ${state}` };
  }
  const left = daysUntil(animal.noticeEnd);
  if (left === null) return { text: state || '보호중', cls: 'badge-calm' };
  if (left === 0) return { text: '공고 D-DAY', cls: 'badge-urgent', title: '오늘 공고가 마감돼요' };
  if (left > 0) {
    return {
      text: `공고 D-${left}`,
      cls: left <= 3 ? 'badge-urgent' : left <= 7 ? 'badge-warn' : 'badge-calm',
      title: `공고 마감까지 ${left}일 (마감 후 입양 가능)`,
    };
  }
  const waited = -left;
  return {
    text: `입양 대기 ${waited}일째`,
    cls: waited >= 14 ? 'badge-long' : 'badge-ready',
    title: '공고가 끝나 입양 신청이 가능한 아이예요',
  };
}

/* ---------- 표시용 변환 ---------- */
const SEX_LABEL = { M: '수컷', F: '암컷', Q: '성별 미상' };
const NEUTER_LABEL = { Y: '중성화 O', N: '중성화 X', U: '중성화 미상' };
const UPKIND = { '417000': '개', '422400': '고양이', '429900': '기타' };

/** '2024(년생)' → { year: 2024, years: 2, text: '2024년생 (약 2살)' } */
function parseAge(raw) {
  const s = String(raw ?? '');
  const m = s.match(/(\d{4})/);
  if (m) {
    const year = +m[1];
    const years = Math.max(0, new Date().getFullYear() - year);
    return { year, years, text: years === 0 ? `${year}년생 (1살 미만)` : `${year}년생 (약 ${years}살)` };
  }
  if (/60일\s*미만/.test(s)) return { year: null, years: 0, text: '60일 미만' };
  return { year: null, years: null, text: s.replace(/\(년생\)/, '').trim() || '나이 미상' };
}

function cleanUnit(raw) {
  return String(raw ?? '').replace(/\((kg|Kg|KG)\)/, 'kg').trim() || '-';
}

/** http 이미지 → https (GitHub Pages의 혼합 콘텐츠 차단 방지) */
function secureUrl(url) {
  if (!url) return '';
  return String(url).replace(/^http:\/\//i, 'https://');
}

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f3ece4"/>
  <g fill="#d8c8b8"><circle cx="160" cy="120" r="22"/><circle cx="240" cy="120" r="22"/><circle cx="125" cy="165" r="18"/><circle cx="275" cy="165" r="18"/><ellipse cx="200" cy="195" rx="48" ry="40"/></g>
  <text x="200" y="270" font-family="sans-serif" font-size="18" fill="#a8968a" text-anchor="middle">사진 준비 중</text></svg>`
);

// 깨진 이미지는 자리표시 이미지로 교체 (페이지 전체에 한 번만 등록)
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName === 'IMG' && img.dataset.fallback !== 'done') {
    img.dataset.fallback = 'done';
    img.src = PLACEHOLDER_IMG;
  }
}, true);

/* ---------- 레이아웃 ---------- */
function renderHeader(active) {
  const links = [
    ['index.html', '입양 찾기', 'list'],
    ['match.html', '맞춤 추천', 'match'],
    ['map.html', '보호소 지도', 'map'],
    ['stats.html', '통계', 'stats'],
    ['favorites.html', '찜 · 랭킹', 'fav'],
  ];
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <div class="container header-inner">
      <a class="logo" href="index.html" aria-label="온기 홈">
        <span class="logo-mark">🐾</span><span class="logo-text">온기</span>
        <span class="logo-sub">유기동물 입양 찾기</span>
      </a>
      <nav class="nav">
        ${links.map(([href, label, key]) =>
          `<a href="${href}" class="${key === active ? 'active' : ''}">${label}${key === 'fav'
            ? ' <span class="nav-count" id="nav-fav-count" hidden></span>' : ''}</a>`).join('')}
      </nav>
    </div>
    ${Api.isMock() ? `<div class="mock-banner">샘플 데이터 모드예요. <code>js/config.js</code>에 인증키를 넣으면 실제 공고가 표시됩니다.</div>` : ''}`;
  document.body.prepend(header);

  // 찜 개수 배지 (실시간)
  Store.onFavorites((favs) => {
    const n = Object.keys(favs).length;
    const el = $('#nav-fav-count');
    el.textContent = n;
    el.hidden = n === 0;
    syncFavButtons();
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="container">
      데이터 출처: 공공데이터포털 · 농림축산식품부 농림축산검역본부 국가동물보호정보시스템 구조동물 조회 서비스<br>
      입양 문의는 각 보호소로 직접 연락해 주세요.
    </div>`;
  document.body.append(footer);
}

/* ---------- 토스트 알림 ---------- */
function showToast(message) {
  let box = $('#toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.className = 'toast';
    box.setAttribute('role', 'status');
    document.body.append(box);
  }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => box.classList.remove('show'), 2200);
}

/* ---------- 동물 카드 (목록·상세·찜 공용) ---------- */
// 화면에 그린 동물 데이터를 보관 → 찜 버튼·상세 이동 시 사용
const AnimalRegistry = new Map();

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

function favButton(id, big = false) {
  const on = Store.isFavorite(id);
  return `<button type="button" class="fav-btn ${big ? 'fav-big' : ''} ${on ? 'on' : ''}" data-fav="${escapeHtml(id)}"
    aria-pressed="${on}" aria-label="찜하기">${HEART_SVG}${big ? `<span>${on ? '찜했어요' : '찜하기'}</span>` : ''}</button>`;
}

function animalCard(a, extra = '') {
  AnimalRegistry.set(a.id, a);
  const badge = statusBadge(a);
  return `
    <article class="card" data-id="${escapeHtml(a.id)}">
      <a class="card-link" href="detail.html?id=${encodeURIComponent(a.id)}">
        <div class="card-img">
          <img src="${escapeHtml(a.images?.[0] || PLACEHOLDER_IMG)}" alt="${escapeHtml(a.kind)} 사진" loading="lazy">
          <span class="badge ${badge.cls}" title="${escapeHtml(badge.title || '')}">${escapeHtml(badge.text)}</span>
        </div>
        <div class="card-body">
          <h3 class="card-title"><span class="kind-tag">${escapeHtml(a.upKind)}</span>${escapeHtml(a.kind)}</h3>
          <p class="card-meta">${escapeHtml(a.sex)} · ${escapeHtml(a.age?.text || '')} · ${escapeHtml(a.weight)}</p>
          <p class="card-place">📍 ${escapeHtml(a.careNm)}</p>
          ${extra}
        </div>
      </a>
      ${favButton(a.id)}
    </article>`;
}

/** 찜 상태가 바뀌면 화면의 모든 하트 버튼을 갱신 */
function syncFavButtons() {
  $$('.fav-btn[data-fav]').forEach((btn) => {
    const on = Store.isFavorite(btn.dataset.fav);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
    const label = btn.querySelector('span');
    if (label) label.textContent = on ? '찜했어요' : '찜하기';
  });
}

// 하트 버튼 클릭 (페이지 어디서든)
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.fav-btn[data-fav]');
  if (!btn) return;
  e.preventDefault();
  const animal = AnimalRegistry.get(btn.dataset.fav);
  if (!animal) return;
  btn.classList.add('pop');
  setTimeout(() => btn.classList.remove('pop'), 300);
  try {
    const on = await Store.toggleFavorite(animal);
    showToast(on ? '❤️ 찜 보관함에 담았어요' : '찜을 취소했어요');
  } catch (err) {
    console.warn(err);
    showToast('저장하지 못했어요. Firebase 설정과 보안 규칙을 확인해 주세요.');
  }
});

// 카드를 눌러 상세로 갈 때 데이터를 잠시 저장 → 상세 화면이 즉시 표시됨
document.addEventListener('click', (e) => {
  const link = e.target.closest('.card .card-link');
  if (!link) return;
  const item = AnimalRegistry.get(link.closest('.card').dataset.id);
  if (!item) return;
  try { sessionStorage.setItem(`ongi:animal:${item.id}`, JSON.stringify(item)); } catch (_) { /* 무시 */ }
});

/* ---------- 거리 계산 (하버사인 공식) ---------- */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km < 10 ? km.toFixed(1) : Math.round(km)}km`;
}

/** '3분 전' 같은 상대 시간 */
function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  const d = new Date(ms);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/* ---------- 상태 화면 ---------- */
function stateBox(type, title, message = '', action = '') {
  const icon = { error: '⚠️', empty: '🔍', info: 'ℹ️' }[type] || '';
  return `<div class="state-box state-${type}">
    <div class="state-icon">${icon}</div>
    <p class="state-title">${escapeHtml(title)}</p>
    ${message ? `<p class="state-msg">${escapeHtml(message)}</p>` : ''}
    ${action}
  </div>`;
}

function skeletonCards(n) {
  return Array.from({ length: n }, () => `
    <div class="card skeleton">
      <div class="card-img"></div>
      <div class="card-body"><div class="sk-line w70"></div><div class="sk-line w50"></div><div class="sk-line w40"></div></div>
    </div>`).join('');
}

/** 동시에 limit개씩만 요청을 보내는 작업 풀 (서버 과부하·트래픽 제한 방지) */
async function runPool(tasks, limit, onProgress) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      try {
        results[idx] = { ok: true, value: await tasks[idx]() };
      } catch (error) {
        results[idx] = { ok: false, error };
      }
      done++;
      if (onProgress) onProgress(done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
