/* =========================================================
 * 찜 · 랭킹 페이지 (favorites.html)
 * - 내 찜: Firebase에 저장된 목록을 실시간 표시
 *          + 공공데이터 API로 최신 상태를 다시 조회해 '입양됨' 등 변화 알림
 * - 인기 랭킹: 찜 수·조회수 TOP 10 (Firebase 정렬 쿼리, 실시간)
 * ========================================================= */
(() => {
  const grid = $('#fav-grid');
  const fresh = new Map();        // 유기번호 → 최신 데이터 (null이면 공고 없음)
  const checking = new Set();
  let favs = {};

  /* ---------- 탭 (주소의 #rank로 기억) ---------- */
  function showTab(name) {
    $$('.tabs button').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('#tab-mine').hidden = name !== 'mine';
    $('#tab-rank').hidden = name !== 'rank';
    history.replaceState(null, '', name === 'rank' ? '#rank' : location.pathname);
  }
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });

  /* ---------- 내 찜 ---------- */
  function statusNote(saved, now) {
    if (now === null) return '<span class="changed gone">공고가 내려갔어요</span>';
    if (!now || now.state === saved.state) return '';
    if (now.state.includes('입양')) return '<span class="changed">🎉 새 가족을 만났어요</span>';
    if (now.state.includes('반환')) return '<span class="changed">🏠 원래 가족에게 돌아갔어요</span>';
    return `<span class="changed gone">상태 변경: ${escapeHtml(now.state)}</span>`;
  }

  function renderFavs(loaded) {
    const list = Object.values(favs).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    $('#tab-fav-count').textContent = list.length ? `(${list.length})` : '';
    if (!loaded) { grid.innerHTML = skeletonCards(4); return; }
    if (!list.length) {
      grid.innerHTML = stateBox('empty', '아직 찜한 아이가 없어요', '목록이나 상세 화면에서 ♡ 버튼을 눌러 보세요.',
        '<a class="btn btn-primary" href="index.html">아이들 보러 가기</a>');
      return;
    }
    grid.innerHTML = list.map((saved) => {
      const now = fresh.get(saved.id);
      const animal = now ? { ...now } : saved;      // 최신 데이터가 있으면 그걸로 표시
      const extra = `<p class="saved-at">찜한 날 ${timeAgo(saved.savedAt || Date.now())}</p>${statusNote(saved, now)}`;
      return animalCard(animal, extra);
    }).join('');
  }

  /** 찜한 아이들의 최신 상태를 API로 다시 확인 (처음 한 번, 동시에 4개씩) */
  async function refreshStatus() {
    const ids = Object.keys(favs).filter((id) => !fresh.has(id) && !checking.has(id));
    if (!ids.length) return;
    ids.forEach((id) => checking.add(id));
    await runPool(ids.map((id) => async () => {
      try {
        fresh.set(id, await Api.getAnimal(id));
      } catch (_) {
        /* 조회 실패 시 저장된 정보 그대로 표시 */
      }
      checking.delete(id);
    }), 4);
    renderFavs(true);
  }

  Store.onFavorites((v, loaded) => {
    favs = v;
    renderFavs(loaded);
    if (loaded) refreshStatus();
  });

  /* ---------- 인기 랭킹 ---------- */
  function renderRanking(el, rows, unit, err) {
    if (err) {
      el.innerHTML = '<li class="rank-empty">랭킹을 불러오지 못했어요. Firebase 보안 규칙의 .indexOn 설정을 확인해 주세요.</li>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<li class="rank-empty">아직 집계된 데이터가 없어요.</li>';
      return;
    }
    el.innerHTML = rows.map((r, i) => `
      <li class="rank-row">
        <span class="rank-no">${i + 1}</span>
        <a href="detail.html?id=${encodeURIComponent(r.id)}"><img src="${escapeHtml(r.info.image || PLACEHOLDER_IMG)}" alt="" loading="lazy"></a>
        <a href="detail.html?id=${encodeURIComponent(r.id)}">
          <b>${escapeHtml(r.info.kind)}</b>
          <small>${escapeHtml([r.info.sex, r.info.age, r.info.careNm].filter(Boolean).join(' · '))}</small>
        </a>
        <span class="rank-val">${r.count.toLocaleString()}${unit}</span>
      </li>`).join('');
  }

  /* ---------- 시작 ---------- */
  renderHeader('fav');
  if (location.hash === '#rank') showTab('rank');

  Store.watchConnection((s) => {
    const map = {
      local: ['var(--amber)', 'Firebase 설정 전이라 이 브라우저에만 저장돼요 (로컬 모드)'],
      online: ['var(--green)', 'Firebase 실시간 연결됨 · 다른 사람의 찜과 조회가 바로 반영돼요'],
      offline: ['var(--text-3)', '연결 중… (오프라인이면 다시 연결되면 자동으로 저장돼요)'],
    };
    const [color, text] = map[s];
    $('#conn').innerHTML = `<i class="dot" style="background:${color}"></i>${text}`;
  });

  Store.watchRanking('likes', 10, (rows, err) => renderRanking($('#rank-likes'), rows, '명', err));
  Store.watchRanking('views', 10, (rows, err) => renderRanking($('#rank-views'), rows, '회', err));
})();
