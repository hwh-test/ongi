/* =========================================================
 * 상세 페이지 (detail.html?id=유기번호)
 * - 목록에서 저장해 둔 데이터로 즉시 표시, 없으면 API로 조회
 * - 공고 기간 진행률, 보호소 연락처·지도 링크
 * - 같은 보호소의 다른 아이들 (보호소번호로 추가 조회)
 * ========================================================= */
(() => {
  const root = $('#detail-root');
  const id = new URLSearchParams(location.search).get('id');
  let relatedItems = [];
  let stat = {};           // { views, likes } 실시간 값
  let socialReady = false;
  let story = null;          // { text, model, createdAt }
  let storyState = 'idle';   // idle | loading | error
  let storyError = '';

  // 목록에서 넘어왔으면 뒤로가기(필터·페이지 유지), 아니면 목록 첫 화면으로
  $('#btn-back').addEventListener('click', () => {
    const fromList = document.referrer && new URL(document.referrer).origin === location.origin;
    if (fromList && history.length > 1) history.back();
    else location.href = 'index.html';
  });

  function readCache() {
    try {
      const raw = sessionStorage.getItem(`ongi:animal:${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function noticeProgress(a) {
    const s = parseYmd(a.noticeStart);
    const e = parseYmd(a.noticeEnd);
    if (!s || !e) return '';
    const total = Math.max(1, Math.round((e - s) / 86400000));
    const passed = Math.min(total, Math.max(0, Math.round((today() - s) / 86400000)));
    const pct = Math.round((passed / total) * 100);
    const left = daysUntil(a.noticeEnd);
    let help;
    if (a.state.startsWith('종료')) help = `이 아이는 현재 <b>${escapeHtml(a.state)}</b> 상태예요.`;
    else if (left >= 0) help = `공고 기간에는 원래 보호자가 찾아갈 수 있어요. 공고가 끝난 뒤(<b>${left}일 후</b>)부터 입양 신청이 가능해요.`;
    else help = `공고가 끝나 <b>입양 신청이 가능한</b> 아이예요. 보호소에서 ${-left}일째 가족을 기다리고 있어요.`;
    return `
      <div class="panel">
        <h2>공고 기간</h2>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
        <div class="progress-label"><span>${fmtDate(a.noticeStart)}</span><span>${fmtDate(a.noticeEnd)}</span></div>
        <p class="notice-help">${help}</p>
      </div>`;
  }

  function render(a) {
    document.title = `${a.kind} (${a.sex}) · 온기`;
    const badge = statusBadge(a);
    const images = a.images.length ? a.images : [PLACEHOLDER_IMG];
    const tel = a.careTel.replace(/[^\d-]/g, '');
    const mapUrl = a.careAddr ? `https://map.kakao.com/link/search/${encodeURIComponent(a.careAddr)}` : '';

    root.innerHTML = `
      <article class="detail">
        <div>
          <div class="gallery-main"><img id="main-img" src="${escapeHtml(images[0])}" alt="${escapeHtml(a.kind)} 사진"></div>
          ${images.length > 1 ? `<div class="gallery-thumbs">${images.map((src, i) => `
            <button type="button" class="${i === 0 ? 'active' : ''}" data-src="${escapeHtml(src)}" aria-label="사진 ${i + 1}">
              <img src="${escapeHtml(src)}" alt=""></button>`).join('')}</div>` : ''}
        </div>

        <div>
          <div class="detail-head">
            <div class="badges">
              <span class="badge ${badge.cls}">${escapeHtml(badge.text)}</span>
              <span class="chip">${escapeHtml(a.upKind)}</span>
              <span class="chip">${escapeHtml(a.neuter)}</span>
            </div>
            <h1>${escapeHtml(a.kind)}</h1>
            <p class="sub">${escapeHtml(a.sex)} · ${escapeHtml(a.age.text)} · ${escapeHtml(a.weight)} · ${escapeHtml(a.color)}</p>
            <div class="action-row">
              ${favButton(a.id, true)}
              <span class="metric">❤️ <b id="like-count">${stat.likes || 0}</b>명이 찜</span>
              <span class="metric">👀 조회 <b id="view-count">${stat.views || 0}</b></span>
            </div>
          </div>

          ${a.special ? `<div class="panel"><h2>특징</h2><p class="special">${escapeHtml(a.special)}</p></div>` : ''}
          <div class="ai-story" id="ai-story"></div>
          ${noticeProgress(a)}

          <div class="panel">
            <h2>구조 정보</h2>
            <dl class="info-grid">
              <dt>구조일</dt><dd>${fmtDate(a.happenDt)}</dd>
              <dt>구조 장소</dt><dd>${escapeHtml(a.happenPlace)}</dd>
              <dt>공고번호</dt><dd>${escapeHtml(a.noticeNo)}</dd>
              <dt>유기번호</dt><dd>${escapeHtml(a.id)}</dd>
              <dt>관할 기관</dt><dd>${escapeHtml(a.orgNm || '-')}</dd>
            </dl>
          </div>

          <div class="panel">
            <h2>보호소</h2>
            <dl class="info-grid">
              <dt>이름</dt><dd>${escapeHtml(a.careNm)}</dd>
              <dt>전화</dt><dd>${escapeHtml(a.careTel || '-')}</dd>
              <dt>주소</dt><dd>${escapeHtml(a.careAddr || '-')}</dd>
            </dl>
            <div class="shelter-actions">
              ${tel ? `<a class="btn btn-primary" href="tel:${tel}">📞 보호소에 전화하기</a>` : ''}
              ${mapUrl ? `<a class="btn" href="${mapUrl}" target="_blank" rel="noopener">🗺️ 지도에서 보기</a>` : ''}
            </div>
          </div>

          <div class="panel">
            <h2>이 아이 알리기</h2>
            <div class="share-row">
              <button type="button" class="btn" data-share="copy">🔗 링크 복사</button>
              <button type="button" class="btn" data-share="native">📤 공유하기</button>
              <button type="button" class="btn" data-share="qr">▦ QR 코드</button>
            </div>
            <div class="qr-box" id="qr-box" hidden>
              <div class="qr-code" id="qr-code"></div>
              <p>휴대폰 카메라로 찍으면<br>이 페이지가 바로 열려요.<br>보호소 안내문이나 전단지에 활용해 보세요.</p>
            </div>
          </div>
        </div>
      </article>

      <h2 class="section-title">입양은 이렇게 진행돼요</h2>
      <ol class="steps">
        <li><b>보호소 문의</b>입양 가능 여부와 방문 일정을 전화로 확인해요.</li>
        <li><b>방문 · 상담</b>아이를 직접 만나고 생활 환경을 상담해요.</li>
        <li><b>입양 신청</b>신분증을 지참해 입양 신청서를 작성해요.</li>
        <li><b>가족이 돼요</b>동물등록과 건강검진을 챙겨 주세요.</li>
      </ol>`;
    paintStory();
  }

  /* ---------- AI 입양 홍보글 (GAS → Gemini → Firebase 저장) ---------- */
  function paintStory() {
    const box = $('#ai-story');
    if (!box) return;
    const head = '<h2>✨ AI 입양 홍보글 <span class="ai-tag">Gemini</span></h2>';
    if (story) {
      box.innerHTML = `${head}<p class="ai-text">${escapeHtml(story.text)}</p>
        <div class="share-row" style="margin-top:12px"><button type="button" class="btn" data-ai="copy">📋 글 복사</button></div>
        <p class="ai-meta">보호소 공고 정보만으로 AI가 작성한 글이에요. 실제 성격·건강은 보호소에 꼭 확인해 주세요.</p>`;
    } else if (storyState === 'loading') {
      box.innerHTML = `${head}<div class="ai-loading">공고 정보를 읽고 소개글을 쓰는 중이에요… (5~10초)</div>`;
    } else if (!Api.useProxy()) {
      box.innerHTML = `${head}<p class="ai-meta" style="margin:0">GAS 서버(PROXY_URL)를 연결하면 AI가 이 아이의 입양 홍보글을 써 줘요.</p>`;
    } else {
      box.innerHTML = `${head}
        <p class="ai-meta" style="margin:0 0 12px">딱딱한 공고 문구를 SNS에 올리기 좋은 따뜻한 소개글로 바꿔 드려요. 한 번 만든 글은 모든 방문자가 함께 봐요.</p>
        <button type="button" class="btn btn-ai" data-ai="make">✨ 소개글 만들기</button>
        ${storyState === 'error' ? `<p class="ai-meta" style="color:var(--red)">⚠️ ${escapeHtml(storyError)}</p>` : ''}`;
    }
  }

  async function makeStory() {
    storyState = 'loading';
    paintStory();
    try {
      const res = await Api.gas('story', { id });
      story = { text: res.text, model: res.model };
      storyState = 'idle';
      try { await Store.saveStory(id, story); } catch (e) { console.warn('[온기] 소개글 저장 실패', e); }
    } catch (err) {
      storyState = 'error';
      storyError = err.message;
    }
    paintStory();
  }

  async function loadStory() {
    try {
      const saved = await Store.getStory(id);
      if (saved && saved.text) { story = saved; paintStory(); }
    } catch (e) { console.warn('[온기] 소개글 불러오기 실패', e); }
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ai]');
    if (!btn) return;
    if (btn.dataset.ai === 'make') makeStory();
    if (btn.dataset.ai === 'copy' && story) {
      try { await navigator.clipboard.writeText(`${story.text}\n\n${shareUrl()}`); showToast('📋 소개글과 링크를 복사했어요'); }
      catch (_) { showToast('복사하지 못했어요'); }
    }
  });

  // 썸네일 클릭 → 큰 사진 교체
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.gallery-thumbs button');
    if (!btn) return;
    $('#main-img').src = btn.dataset.src;
    $$('.gallery-thumbs button').forEach((b) => b.classList.toggle('active', b === btn));
  });

  /* ---------- 공유 · QR ---------- */
  const shareUrl = () => `${location.origin}${location.pathname}?id=${encodeURIComponent(id)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
    } catch (_) {
      // 클립보드 API가 막힌 환경 대비
      const ta = document.createElement('textarea');
      ta.value = shareUrl();
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('🔗 링크를 복사했어요');
  }

  function drawQr() {
    const box = $('#qr-code');
    if (box.childElementCount) return;
    if (typeof QRCode !== 'undefined') {
      new QRCode(box, { text: shareUrl(), width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
    } else {
      // QR 라이브러리를 못 불러온 경우 외부 QR 이미지 API로 대체
      box.innerHTML = `<img alt="QR 코드" src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(shareUrl())}">`;
    }
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-share]');
    if (!btn) return;
    const type = btn.dataset.share;
    if (type === 'copy') copyLink();
    if (type === 'qr') {
      const box = $('#qr-box');
      box.hidden = !box.hidden;
      if (!box.hidden) drawQr();
    }
    if (type === 'native') {
      const a = AnimalRegistry.get(id);
      const data = {
        title: `온기 · ${a?.kind || '구조동물'}`,
        text: `${a?.careNm || '보호소'}에서 가족을 기다리는 ${a?.kind || '아이'}(${a?.sex || ''}, ${a?.age?.text || ''})를 소개해요.`,
        url: shareUrl(),
      };
      // 휴대폰에서는 카카오톡 등 설치된 앱 목록이 뜸 (Web Share API)
      if (navigator.share) {
        try { await navigator.share(data); } catch (_) { /* 사용자가 취소 */ }
      } else {
        copyLink();
      }
    }
  });

  /* ---------- 찜 수 · 조회수 · 응원 댓글 (Firebase 실시간) ---------- */
  function paintStat() {
    if ($('#like-count')) $('#like-count').textContent = (stat.likes || 0).toLocaleString();
    if ($('#view-count')) $('#view-count').textContent = (stat.views || 0).toLocaleString();
  }

  function renderComments(list, err) {
    const ul = $('#comment-list');
    $('#comment-total').textContent = list.length ? `${list.length}개` : '';
    if (err) {
      ul.innerHTML = '<li class="comment-empty">댓글을 불러오지 못했어요. Firebase 보안 규칙을 확인해 주세요.</li>';
      return;
    }
    ul.innerHTML = list.length
      ? list.map((c) => `
          <li><span class="who">${escapeHtml(c.nick || '익명')}</span><span class="when">${c.createdAt ? timeAgo(c.createdAt) : ''}</span>
          <p>${escapeHtml(c.text)}</p></li>`).join('')
      : '<li class="comment-empty">첫 번째 응원을 남겨 주세요. 따뜻한 한마디가 입양 홍보에 큰 힘이 돼요.</li>';
  }

  function setupSocial(animal) {
    if (socialReady) return;
    socialReady = true;

    Store.recordView(animal);
    Store.watchStat(id, (v) => { stat = v; paintStat(); });

    const section = $('#comment-section');
    section.hidden = false;
    if (Store.isLocal()) {
      $('#comment-local').hidden = false;
    }
    const form = $('#comment-form');
    const nick = form.elements.nick;
    const text = form.elements.text;
    try { nick.value = localStorage.getItem('ongi:nick') || ''; } catch (_) { /* 무시 */ }
    text.addEventListener('input', () => { $('#comment-len').textContent = `${text.value.length}/200`; });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = nick.value.trim() || '익명';
      const t = text.value.trim();
      if (!t) { text.focus(); return; }
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await Store.addComment(id, n, t);
        try { localStorage.setItem('ongi:nick', n); } catch (_) { /* 무시 */ }
        text.value = '';
        $('#comment-len').textContent = '0/200';
        showToast('💌 응원을 남겼어요');
      } catch (err) {
        console.warn(err);
        showToast('댓글을 저장하지 못했어요');
      } finally {
        btn.disabled = false;
      }
    });

    Store.watchComments(id, renderComments);
  }

  async function loadRelated(a) {
    if (!a.careRegNo) return;
    try {
      const res = await Api.getAnimals({
        care_reg_no: a.careRegNo,
        state: 'protect',
        bgnde: toYmd(addDays(today(), -120)),
        endde: toYmd(today()),
      }, 1, 9);
      relatedItems = res.items.filter((x) => x.id !== a.id).slice(0, 8);
      if (!relatedItems.length) return;
      $('#related-grid').innerHTML = relatedItems.map((a) => animalCard(a)).join('');
      $('#related-section').hidden = false;
    } catch (_) { /* 부가 정보이므로 실패해도 화면은 유지 */ }
  }

  async function init() {
    renderHeader('list');

    if (!id) {
      root.innerHTML = stateBox('error', '잘못된 주소예요', '목록에서 아이를 선택해 주세요.',
        '<a class="btn btn-primary" href="index.html">목록으로 가기</a>');
      return;
    }

    let animal = readCache();
    if (animal) { AnimalRegistry.set(animal.id, animal); render(animal); }   // 저장된 데이터로 먼저 표시

    try {
      const fresh = await Api.getAnimal(id);    // 최신 상태로 다시 확인
      if (fresh) { animal = fresh; AnimalRegistry.set(fresh.id, fresh); render(fresh); }
      else if (!animal) {
        root.innerHTML = stateBox('empty', '공고를 찾을 수 없어요', '공고가 삭제되었거나 유기번호가 올바르지 않아요.',
          '<a class="btn btn-primary" href="index.html">목록으로 가기</a>');
        return;
      }
    } catch (err) {
      if (!animal) {
        root.innerHTML = stateBox('error', '정보를 불러오지 못했어요', err.message,
          '<button class="btn btn-primary" onclick="location.reload()">다시 시도</button>');
        return;
      }
    }
    setupSocial(animal);
    loadStory();
    loadRelated(animal);
  }

  init();
})();
