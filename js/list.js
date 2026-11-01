/* =========================================================
 * 목록 페이지 (index.html)
 * - 연쇄 필터(시도→시군구→보호소, 축종→품종)
 * - 필터 상태를 URL에 저장 → 새로고침·뒤로가기·링크 공유 시 유지
 * - 페이지네이션, D-day 배지, 정렬
 * ========================================================= */
(() => {
  const FILTER_KEYS = ['upkind', 'kind', 'state', 'upr_cd', 'org_cd', 'care_reg_no', 'sex_cd', 'neuter_yn', 'bgnde', 'endde'];
  const form = $('#filter-form');
  const grid = $('#animal-grid');
  const pager = $('#pagination');
  const countEl = $('#result-count');
  const sortSel = $('#f-sort');

  let requestSeq = 0;     // 늦게 도착한 이전 응답을 무시하기 위한 번호
  let currentItems = [];
  let state = readStateFromUrl();

  /* ---------- URL ↔ 상태 ---------- */
  function defaultState() {
    return {
      bgnde: toYmd(addDays(today(), -CONFIG.DEFAULT_RANGE_DAYS)),
      endde: toYmd(today()),
      page: 1,
      sort: 'default',
    };
  }

  function readStateFromUrl() {
    const qs = new URLSearchParams(location.search);
    const s = defaultState();
    FILTER_KEYS.forEach((k) => { if (qs.has(k)) s[k] = qs.get(k); });
    s.page = Math.max(1, parseInt(qs.get('page'), 10) || 1);
    s.sort = qs.get('sort') || 'default';
    s.care_nm = qs.get('care_nm') || '';
    return s;
  }

  function writeStateToUrl() {
    const qs = new URLSearchParams();
    FILTER_KEYS.forEach((k) => { if (state[k]) qs.set(k, state[k]); });
    if (state.page > 1) qs.set('page', state.page);
    if (state.sort !== 'default') qs.set('sort', state.sort);
    if (state.care_reg_no && state.care_nm) qs.set('care_nm', state.care_nm);
    history.replaceState(null, '', `${location.pathname}${qs.toString() ? '?' + qs : ''}`);
  }

  function apiFilters() {
    const f = {};
    FILTER_KEYS.forEach((k) => { if (state[k]) f[k] = state[k]; });
    return f;
  }

  /* ---------- 셀렉트 박스 채우기 ---------- */
  function fillSelect(select, options, placeholder, selected = '') {
    select.innerHTML = `<option value="">${placeholder}</option>` +
      options.map((o) => `<option value="${escapeHtml(o.code)}">${escapeHtml(o.name)}</option>`).join('');
    select.value = options.some((o) => o.code === selected) ? selected : '';
    select.disabled = false;
  }

  function lockSelect(select, message) {
    select.innerHTML = `<option value="">${message}</option>`;
    select.disabled = true;
  }

  async function loadSigungu() {
    const sel = $('#f-sigungu');
    if (!state.upr_cd) return lockSelect(sel, '시도를 먼저 선택');
    lockSelect(sel, '불러오는 중…');
    try { fillSelect(sel, await Api.getSigungu(state.upr_cd), '전체', state.org_cd); }
    catch (_) { lockSelect(sel, '불러오기 실패'); }
  }

  async function loadShelters() {
    const sel = $('#f-shelter');
    if (!state.upr_cd || !state.org_cd) return lockSelect(sel, '시군구를 먼저 선택');
    lockSelect(sel, '불러오는 중…');
    try {
      const list = await Api.getShelters(state.upr_cd, state.org_cd);
      list.length ? fillSelect(sel, list, '전체', state.care_reg_no) : lockSelect(sel, '등록된 보호소 없음');
    } catch (_) { lockSelect(sel, '불러오기 실패'); }
  }

  async function loadKinds() {
    const sel = $('#f-kind');
    if (!state.upkind) return lockSelect(sel, '축종을 먼저 선택');
    lockSelect(sel, '불러오는 중…');
    try { fillSelect(sel, await Api.getKinds(state.upkind), '전체 품종', state.kind); }
    catch (_) { lockSelect(sel, '불러오기 실패'); }
  }

  /** URL 상태를 폼 화면에 반영 */
  function syncFormFromState() {
    $$('input[name="upkind"]', form).forEach((r) => { r.checked = r.value === (state.upkind || ''); });
    ['state', 'sex_cd', 'neuter_yn'].forEach((k) => { form.elements[k].value = state[k] || ''; });
    form.elements.bgnde.value = toInputDate(parseYmd(state.bgnde) || today());
    form.elements.endde.value = toInputDate(parseYmd(state.endde) || today());
    sortSel.value = state.sort;
  }

  /* ---------- 이벤트 ---------- */
  form.addEventListener('change', async (e) => {
    const { name, value } = e.target;
    if (!name) return;

    if (name === 'bgnde' || name === 'endde') {
      const d = parseYmd(value);
      if (!d) return;
      state[name] = toYmd(d);
      if (state.bgnde > state.endde) {           // 시작일이 종료일보다 늦으면 맞바꿈
        [state.bgnde, state.endde] = [state.endde, state.bgnde];
        syncFormFromState();
      }
    } else {
      state[name] = value;
    }

    // 상위 조건이 바뀌면 하위 조건 초기화 후 다시 불러오기
    if (name === 'upr_cd') { state.org_cd = ''; state.care_reg_no = ''; loadSigungu(); loadShelters(); }
    if (name === 'org_cd') { state.care_reg_no = ''; loadShelters(); }
    if (name === 'upkind') { state.kind = ''; loadKinds(); }

    state.page = 1;
    loadList();
  });

  sortSel.addEventListener('change', () => {
    state.sort = sortSel.value;
    writeStateToUrl();
    renderCards();
  });

  $('#btn-reset').addEventListener('click', () => {
    state = defaultState();
    syncFormFromState();
    $('#f-sido').value = '';
    loadSigungu(); loadShelters(); loadKinds();
    loadList();
  });

  pager.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    loadList();
    window.scrollTo({ top: $('.result-bar').offsetTop - 80, behavior: 'smooth' });
  });

  // 지도 페이지에서 '이 보호소 아이들 보기'로 넘어온 경우 표시되는 칩
  $('#active-chip').addEventListener('click', (e) => {
    if (!e.target.closest('button')) return;
    state.care_reg_no = '';
    state.care_nm = '';
    state.page = 1;
    loadShelters();
    loadList();
  });

  function renderChip() {
    const chip = $('#active-chip');
    const show = state.care_reg_no && !state.org_cd;
    chip.hidden = !show;
    if (show) {
      chip.innerHTML = `📍 <b>${escapeHtml(state.care_nm || '선택한 보호소')}</b> 아이들만 보는 중
        <button type="button" aria-label="보호소 조건 해제">✕ 해제</button>`;
    }
  }

  /* ---------- 목록 ---------- */
  async function loadList() {
    writeStateToUrl();
    renderChip();
    const seq = ++requestSeq;
    grid.innerHTML = skeletonCards(8);
    pager.innerHTML = '';
    countEl.textContent = '불러오는 중…';

    try {
      const res = await Api.getAnimals(apiFilters(), state.page, CONFIG.PAGE_SIZE);
      if (seq !== requestSeq) return;            // 그사이 조건이 바뀌었으면 버림

      const totalPages = Math.max(1, Math.ceil(res.totalCount / CONFIG.PAGE_SIZE));
      if (state.page > totalPages && res.totalCount > 0) {
        state.page = totalPages;
        return loadList();
      }
      currentItems = res.items;
      renderCount(res.totalCount);
      renderCards();
      renderPagination(totalPages);
    } catch (err) {
      if (seq !== requestSeq) return;
      countEl.textContent = '목록을 불러오지 못했어요';
      grid.innerHTML = stateBox('error', '데이터를 불러오지 못했어요', err.message,
        '<button class="btn btn-primary" id="btn-retry">다시 시도</button>');
      $('#btn-retry').addEventListener('click', loadList);
    }
  }

  function renderCount(total) {
    const urgent = currentItems.filter((a) => {
      const d = daysUntil(a.noticeEnd);
      return !a.state.startsWith('종료') && d !== null && d >= 0 && d <= 3;
    }).length;
    countEl.innerHTML = `총 <b>${total.toLocaleString()}</b>마리` +
      (urgent ? `<span class="result-hint">· 이 페이지에 공고 마감 임박 ${urgent}마리</span>` : '');
  }

  function sortItems(items) {
    const list = [...items];
    // 이미 종료된(입양·반환 등) 아이는 항상 뒤로
    const edt = (a) => (a.state.startsWith('종료') ? 9999 : daysUntil(a.noticeEnd) ?? 9998);
    if (state.sort === 'deadline') {
      // 아직 공고 중인 아이(남은 일수 0 이상)를 마감 임박순으로 앞에 배치
      // 공고중(마감 임박순) → 입양 대기 → 종료 순서
      const group = (d) => (d === 9999 ? 2 : d >= 0 ? 0 : 1);
      list.sort((a, b) => {
        const da = edt(a), db = edt(b);
        return group(da) - group(db) || (group(da) === 0 ? da - db : db - da);
      });
    } else if (state.sort === 'waiting') {
      list.sort((a, b) => edt(a) - edt(b));      // 공고 종료가 오래될수록 음수가 큼
    } else if (state.sort === 'young') {
      const age = (a) => (a.age.years ?? 99);
      list.sort((a, b) => age(a) - age(b));
    }
    return list;
  }

  function renderCards() {
    if (!currentItems.length) {
      grid.innerHTML = stateBox('empty', '조건에 맞는 아이가 없어요', '기간을 넓히거나 필터를 줄여 보세요.');
      return;
    }
    grid.innerHTML = sortItems(currentItems).map((a) => animalCard(a)).join('');
    const hint = $('.result-hint.sort-hint');
    if (hint) hint.remove();
    if (state.sort !== 'default') {
      countEl.insertAdjacentHTML('beforeend', '<span class="result-hint sort-hint">· 정렬은 현재 페이지 기준</span>');
    }
  }

  function renderPagination(totalPages) {
    if (totalPages <= 1) { pager.innerHTML = ''; return; }
    const p = state.page;
    const windowSize = 5;
    let start = Math.max(1, p - Math.floor(windowSize / 2));
    const end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const btn = (page, label, opts = {}) =>
      `<button type="button" data-page="${page}" class="${opts.active ? 'active' : ''}" ${opts.disabled ? 'disabled' : ''}
        aria-label="${opts.aria || page + '페이지'}" ${opts.active ? 'aria-current="page"' : ''}>${label}</button>`;

    let html = btn(p - 1, '‹', { disabled: p === 1, aria: '이전 페이지' });
    if (start > 1) html += btn(1, '1') + (start > 2 ? '<span class="gap">…</span>' : '');
    for (let i = start; i <= end; i++) html += btn(i, i, { active: i === p });
    if (end < totalPages) html += (end < totalPages - 1 ? '<span class="gap">…</span>' : '') + btn(totalPages, totalPages);
    html += btn(p + 1, '›', { disabled: p === totalPages, aria: '다음 페이지' });
    pager.innerHTML = html;
  }

  /* ---------- 시작 ---------- */
  async function init() {
    renderHeader('list');
    syncFormFromState();
    loadList();                                   // 목록은 바로 요청
    try {
      fillSelect($('#f-sido'), await Api.getSido(), '전국', state.upr_cd);
    } catch (_) {
      lockSelect($('#f-sido'), '불러오기 실패');
    }
    loadSigungu(); loadShelters(); loadKinds();
  }

  init();
})();
