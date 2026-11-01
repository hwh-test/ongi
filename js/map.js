/* =========================================================
 * 보호소 지도 (map.html)
 * 1) 최근 구조동물을 받아 보호소별로 묶음 (보호중·공고중만)
 * 2) 보호소 주소 → 좌표 변환 (카카오 주소 검색, 실패 시 장소명 검색)
 *    변환 결과는 localStorage에 저장해 다음 방문 때 재사용
 * 3) 카카오맵 마커 + 클러스터러로 표시
 * 4) 브라우저 위치 정보로 가까운 보호소 순 정렬 (하버사인 공식)
 * ========================================================= */
(() => {
  const listEl = $('#shelter-list');
  const statusEl = $('#map-status');
  const panelEl = $('#shelter-panel');
  const mapEl = $('#map');

  const filters = { upr_cd: '', upkind: '' };
  let shelters = [];
  let selectedKey = null;
  let myPos = null;
  let loadSeq = 0;

  // 카카오맵 관련 객체
  let map = null;
  let geocoder = null;
  let places = null;
  let clusterer = null;
  let label = null;
  let myOverlay = null;
  const markers = new Map();

  /* ---------- 좌표 캐시 ---------- */
  const GEO_KEY = 'ongi:geo';
  let geoCache = {};
  try { geoCache = JSON.parse(localStorage.getItem(GEO_KEY)) || {}; } catch (_) { geoCache = {}; }
  const saveGeo = () => { try { localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)); } catch (_) { /* 무시 */ } };

  /* ---------- 카카오맵 SDK 불러오기 ---------- */
  function loadKakao() {
    return new Promise((resolve, reject) => {
      if (!CONFIG.KAKAO_JS_KEY) return reject(new Error('NO_KEY'));
      if (window.kakao && kakao.maps && kakao.maps.load) return kakao.maps.load(resolve);
      const s = document.createElement('script');
      s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(CONFIG.KAKAO_JS_KEY)}&libraries=services,clusterer&autoload=false`;
      s.onload = () => (window.kakao && kakao.maps ? kakao.maps.load(resolve) : reject(new Error('LOAD_FAIL')));
      s.onerror = () => reject(new Error('LOAD_FAIL'));
      document.head.append(s);
    });
  }

  function initMap() {
    map = new kakao.maps.Map(mapEl, { center: new kakao.maps.LatLng(36.4, 127.8), level: 13 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
    geocoder = new kakao.maps.services.Geocoder();
    places = new kakao.maps.services.Places();
    clusterer = new kakao.maps.MarkerClusterer({ map, averageCenter: true, minLevel: 9, gridSize: 50 });
    label = new kakao.maps.CustomOverlay({ yAnchor: 1, zIndex: 5 });
  }

  function showMapMessage(title, message) {
    mapEl.innerHTML = '';
    mapEl.parentElement.classList.add('no-map');
    mapEl.parentElement.insertAdjacentHTML('beforeend', stateBox('info', title, message));
  }

  /* ---------- 데이터 ---------- */
  function groupShelters(animals) {
    const groups = new Map();
    animals.forEach((a) => {
      if (a.state.startsWith('종료')) return;            // 입양·반환 등 처리 끝난 아이 제외
      const key = a.careRegNo || a.careNm;
      if (!groups.has(key)) {
        groups.set(key, {
          key, regNo: a.careRegNo, name: a.careNm, addr: a.careAddr, tel: a.careTel,
          lat: a.lat, lng: a.lng, animals: [],
        });
      }
      groups.get(key).animals.push(a);
    });
    return [...groups.values()];
  }

  /** 주소 → 좌표. 주소 검색 실패 시 보호소 이름으로 장소 검색 */
  function geocode(sh) {
    return new Promise((resolve) => {
      if (sh.lat != null) return resolve(sh);
      const cacheKey = sh.addr || sh.name;
      if (geoCache[cacheKey]) { Object.assign(sh, geoCache[cacheKey]); return resolve(sh); }
      if (!geocoder) return resolve(sh);

      const done = (lat, lng) => {
        if (lat != null) {
          sh.lat = lat; sh.lng = lng;
          geoCache[cacheKey] = { lat, lng };
          saveGeo();
        }
        resolve(sh);
      };
      const OK = kakao.maps.services.Status.OK;
      const byName = () => places.keywordSearch(sh.name, (res, status) =>
        (status === OK ? done(+res[0].y, +res[0].x) : done(null)));

      const addr = (sh.addr || '').replace(/\(.*?\)/g, '').trim();   // 괄호 속 부가 설명 제거
      if (!addr) return byName();
      geocoder.addressSearch(addr, (res, status) => (status === OK ? done(+res[0].y, +res[0].x) : byName()));
    });
  }

  async function loadData() {
    const seq = ++loadSeq;
    statusEl.textContent = '구조동물 정보를 불러오는 중…';
    listEl.innerHTML = '';
    closePanel();

    const base = {
      bgnde: toYmd(addDays(today(), -CONFIG.MAP_RANGE_DAYS)),
      endde: toYmd(today()),
      upr_cd: filters.upr_cd,
      upkind: filters.upkind,
    };

    // 첫 페이지로 전체 건수를 확인한 뒤 필요한 만큼만 추가 요청
    let first;
    try {
      first = await Api.getAnimals(base, 1, 1000);
    } catch (err) {
      if (seq !== loadSeq) return;
      statusEl.textContent = '';
      listEl.innerHTML = `<li>${stateBox('error', '데이터를 불러오지 못했어요', err.message)}</li>`;
      return;
    }
    const pages = Math.min(CONFIG.MAP_MAX_PAGES, Math.ceil(first.totalCount / 1000));
    const rest = await runPool(
      Array.from({ length: Math.max(0, pages - 1) }, (_, i) => () => Api.getAnimals(base, i + 2, 1000)), 3);
    if (seq !== loadSeq) return;

    const seen = new Set();
    const animals = [first, ...rest.filter((r) => r.ok).map((r) => r.value)]
      .flatMap((r) => r.items)
      .filter((a) => (seen.has(a.id) ? false : seen.add(a.id)));

    shelters = groupShelters(animals);
    const partial = first.totalCount > animals.length;

    // 좌표 변환 (동시에 5개씩)
    await runPool(shelters.map((s) => () => geocode(s)), 5, (done, total) => {
      if (seq === loadSeq) statusEl.textContent = `보호소 위치 확인 중 ${done}/${total}`;
    });
    if (seq !== loadSeq) return;

    const located = shelters.filter((s) => s.lat != null).length;
    const totalAnimals = shelters.reduce((n, s) => n + s.animals.length, 0);
    statusEl.innerHTML = `보호소 <b>${shelters.length}</b>곳 · 보호 중인 아이 <b>${totalAnimals.toLocaleString()}</b>마리`
      + (partial ? `<br><small>최근 구조 ${animals.length.toLocaleString()}마리 기준 · 시도를 선택하면 더 정확해요</small>` : '')
      + (map && located < shelters.length ? `<br><small>위치를 찾지 못한 보호소 ${shelters.length - located}곳은 목록에만 표시</small>` : '');

    drawMarkers();
    renderList();
  }

  /* ---------- 지도 표시 ---------- */
  function drawMarkers() {
    if (!map) return;
    clusterer.clear();
    markers.clear();
    label.setMap(null);
    const bounds = new kakao.maps.LatLngBounds();
    const list = [];
    shelters.forEach((s) => {
      if (s.lat == null) return;
      const pos = new kakao.maps.LatLng(s.lat, s.lng);
      const marker = new kakao.maps.Marker({ position: pos, title: s.name });
      kakao.maps.event.addListener(marker, 'click', () => select(s.key, false));
      markers.set(s.key, marker);
      list.push(marker);
      bounds.extend(pos);
    });
    clusterer.addMarkers(list);
    if (list.length) map.setBounds(bounds);
  }

  function showLabel(s) {
    if (!map || s.lat == null) return;
    label.setContent(`<div class="map-label">${escapeHtml(s.name)} · ${s.animals.length}마리</div>`);
    label.setPosition(new kakao.maps.LatLng(s.lat, s.lng));
    label.setMap(map);
  }

  /* ---------- 목록 ---------- */
  function sortedShelters() {
    const list = shelters.map((s) => ({
      ...s,
      dist: myPos && s.lat != null ? distanceKm(myPos.lat, myPos.lng, s.lat, s.lng) : null,
    }));
    if (myPos) list.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
    else list.sort((a, b) => b.animals.length - a.animals.length);
    return list;
  }

  function renderList() {
    if (!shelters.length) {
      listEl.innerHTML = `<li>${stateBox('empty', '보호 중인 아이가 없어요', '다른 지역이나 축종을 선택해 보세요.')}</li>`;
      return;
    }
    listEl.innerHTML = sortedShelters().map((s) => `
      <li><button type="button" class="shelter-item ${s.key === selectedKey ? 'active' : ''}" data-key="${escapeHtml(s.key)}">
        <div class="si-top"><b>${escapeHtml(s.name)}</b><span class="si-count">${s.animals.length}마리</span></div>
        <div class="si-addr">${escapeHtml(s.addr || '주소 정보 없음')}</div>
        ${s.dist != null ? `<div class="si-dist">내 위치에서 ${fmtKm(s.dist)}</div>` : ''}
        ${map && s.lat == null ? '<div class="si-nogeo">지도 위치 미확인</div>' : ''}
      </button></li>`).join('');
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.shelter-item');
    if (btn) select(btn.dataset.key, true);
  });

  /* ---------- 보호소 선택 ---------- */
  function select(key, fromList) {
    const s = shelters.find((x) => x.key === key);
    if (!s) return;
    selectedKey = key;
    $$('.shelter-item').forEach((b) => b.classList.toggle('active', b.dataset.key === key));

    if (map && s.lat != null) {
      map.setLevel(Math.min(map.getLevel(), 6));
      map.panTo(new kakao.maps.LatLng(s.lat, s.lng));
      showLabel(s);
    }
    if (!fromList) {
      const item = $(`.shelter-item[data-key="${CSS.escape(key)}"]`);
      if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    openPanel(s);
  }

  function openPanel(s) {
    const tel = (s.tel || '').replace(/[^\d-]/g, '');
    const animals = [...s.animals].sort((a, b) => (daysUntil(a.noticeEnd) ?? 0) - (daysUntil(b.noticeEnd) ?? 0));
    animals.forEach((a) => AnimalRegistry.set(a.id, a));
    const qs = new URLSearchParams({ care_reg_no: s.regNo || '', care_nm: s.name });
    panelEl.innerHTML = `
      <h3>${escapeHtml(s.name)}</h3>
      <p class="sp-addr">${escapeHtml(s.addr || '')}</p>
      <div class="sp-actions">
        ${tel ? `<a class="btn btn-primary" href="tel:${tel}">📞 전화</a>` : ''}
        ${s.regNo ? `<a class="btn" href="index.html?${qs}">이 보호소 공고 전체 보기</a>` : ''}
        <button type="button" class="btn" id="btn-close-panel" aria-label="닫기">✕</button>
      </div>
      <div class="mini-grid">
        ${animals.slice(0, 6).map((a) => `
          <a href="detail.html?id=${encodeURIComponent(a.id)}" data-id="${escapeHtml(a.id)}" title="${escapeHtml(a.kind)}">
            <img src="${escapeHtml(a.images[0] || PLACEHOLDER_IMG)}" alt="${escapeHtml(a.kind)}" loading="lazy">
            <span>${escapeHtml(statusBadge(a).text)}</span>
          </a>`).join('')}
      </div>`;
    panelEl.hidden = false;
    panelEl.scrollTop = 0;
  }

  function closePanel() {
    panelEl.hidden = true;
    selectedKey = null;
    $$('.shelter-item.active').forEach((b) => b.classList.remove('active'));
    if (label) label.setMap(null);
  }

  panelEl.addEventListener('click', (e) => {
    if (e.target.closest('#btn-close-panel')) { closePanel(); return; }
    const link = e.target.closest('a[data-id]');
    if (link) {
      const a = AnimalRegistry.get(link.dataset.id);
      try { sessionStorage.setItem(`ongi:animal:${a.id}`, JSON.stringify(a)); } catch (_) { /* 무시 */ }
    }
  });

  /* ---------- 내 위치 ---------- */
  $('#btn-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('이 브라우저는 위치 정보를 지원하지 않아요'); return; }
    const btn = $('#btn-locate');
    btn.disabled = true;
    btn.textContent = '위치 확인 중…';
    navigator.geolocation.getCurrentPosition((pos) => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.disabled = false;
      btn.textContent = '📍 내 위치 새로고침';
      renderList();
      listEl.scrollTop = 0;
      if (map) {
        const p = new kakao.maps.LatLng(myPos.lat, myPos.lng);
        if (!myOverlay) myOverlay = new kakao.maps.CustomOverlay({ content: '<div class="my-dot" title="내 위치"></div>', zIndex: 6 });
        myOverlay.setPosition(p);
        myOverlay.setMap(map);
        map.setLevel(9);
        map.panTo(p);
      }
      showToast('가까운 보호소 순으로 정렬했어요');
    }, (err) => {
      btn.disabled = false;
      btn.textContent = '📍 내 위치에서 가까운 순';
      const msg = err.code === 1 ? '위치 권한이 거부됐어요. 주소창의 자물쇠 아이콘에서 허용해 주세요.' : '위치를 확인하지 못했어요';
      showToast(msg);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  /* ---------- 필터 ---------- */
  $('#m-sido').addEventListener('change', (e) => { filters.upr_cd = e.target.value; loadData(); });
  $$('input[name="m-upkind"]').forEach((r) => r.addEventListener('change', () => { filters.upkind = r.value; loadData(); }));

  /* ---------- 시작 ---------- */
  async function init() {
    renderHeader('map');
    try {
      const sido = await Api.getSido();
      $('#m-sido').innerHTML = '<option value="">전국</option>' +
        sido.map((s) => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.name)}</option>`).join('');
    } catch (_) { /* 시도 목록 실패 시 전국만 */ }

    try {
      await loadKakao();
      initMap();
    } catch (err) {
      showMapMessage(
        err.message === 'NO_KEY' ? '카카오맵 키가 아직 없어요' : '지도를 불러오지 못했어요',
        err.message === 'NO_KEY'
          ? 'js/config.js의 KAKAO_JS_KEY에 JavaScript 키를 넣으면 지도가 표시돼요. 보호소 목록은 지금도 볼 수 있어요.'
          : '카카오 개발자 콘솔에서 JavaScript SDK 도메인 등록과 카카오맵 사용 설정을 확인해 주세요.');
    }
    loadData();
  }

  init();
})();
