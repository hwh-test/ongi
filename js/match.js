/* =========================================================
 * 맞춤 추천 (match.html)
 * 1) 7문항 성향 테스트
 * 2) 조건(지역·축종)에 맞는 보호 중인 아이들을 API로 받아
 *    생활 환경과의 궁합 점수를 계산 → 상위 12마리 추천 + 추천 이유
 * 3) 같은 조건으로 신규 공고 메일 알림 구독 (GAS → 구글 시트 + 매일 트리거)
 * ========================================================= */
(() => {
  const QUESTIONS = [
    { id: 'home', q: '어떤 집에 살고 있나요?', options: [
      ['apt', '🏢 아파트 · 빌라', '이웃 소음이 조금 신경 쓰여요'],
      ['house', '🏡 마당 있는 주택', '공간이 넉넉해요'],
      ['small', '🛏️ 원룸 · 오피스텔', '공간이 작은 편이에요'] ] },
    { id: 'time', q: '하루에 집을 비우는 시간은?', options: [
      ['short', '🏠 거의 집에 있어요', '재택근무 · 프리랜서'],
      ['mid', '⏰ 4~8시간', '학교 · 파트타임'],
      ['long', '🌙 9시간 이상', '출근 · 장시간 외출'] ] },
    { id: 'walk', q: '산책은 얼마나 할 수 있나요?', options: [
      ['high', '🏃 매일 1시간 이상', '운동을 좋아해요'],
      ['mid', '🚶 하루 30분 정도', '가볍게 동네 한 바퀴'],
      ['low', '🛋️ 산책은 어려워요', '실내 생활이 편해요'] ] },
    { id: 'exp', q: '반려동물을 키워본 경험은?', options: [
      ['pro', '🎓 여러 번 있어요', ''],
      ['some', '🙂 한 번 있어요', ''],
      ['none', '🌱 처음이에요', ''] ] },
    { id: 'kind', q: '함께하고 싶은 친구는?', options: [
      ['417000', '🐶 강아지', ''],
      ['422400', '🐱 고양이', ''],
      ['', '💛 상관없어요', '잘 맞는 아이라면 누구든'] ] },
    { id: 'age', q: '마음이 가는 나이대는?', options: [
      ['baby', '🍼 아기 (1살 미만)', '에너지가 넘치고 손이 많이 가요'],
      ['adult', '✨ 1~7살', '성격이 안정된 시기예요'],
      ['senior', '🧡 8살 이상', '차분하고 사람을 잘 따라요'],
      ['any', '상관없어요', ''] ] },
    { id: 'region', q: '어느 지역에서 찾을까요?', type: 'region' },
  ];

  let step = 0;
  let answers = {};
  let sidoList = [];

  /* ---------- 퀴즈 ---------- */
  function renderStep() {
    const q = QUESTIONS[step];
    $('#quiz-bar').style.width = `${(step / QUESTIONS.length) * 100}%`;
    $('#quiz-step').textContent = `질문 ${step + 1} / ${QUESTIONS.length}`;
    $('#quiz-q').textContent = q.q;
    $('#quiz-back').style.visibility = step === 0 ? 'hidden' : 'visible';

    if (q.type === 'region') {
      $('#quiz-options').innerHTML = `
        <div class="quiz-region">
          <select id="q-region" aria-label="지역">
            <option value="">전국</option>
            ${sidoList.map((s) => `<option value="${escapeHtml(s.code)}" ${answers.region === s.code ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
          </select>
          <button type="button" class="btn btn-primary" id="q-done">결과 보기 →</button>
        </div>`;
      $('#q-done').addEventListener('click', () => {
        answers.region = $('#q-region').value;
        answers.regionName = $('#q-region').selectedOptions[0].textContent;
        showResult();
      });
      return;
    }
    $('#quiz-options').innerHTML = q.options.map(([v, label, desc]) => `
      <button type="button" class="quiz-opt ${answers[q.id] === v ? 'picked' : ''}" data-v="${escapeHtml(v)}">
        <b>${escapeHtml(label)}</b>${desc ? `<small>${escapeHtml(desc)}</small>` : ''}
      </button>`).join('');
  }

  $('#quiz-options').addEventListener('click', (e) => {
    const btn = e.target.closest('.quiz-opt');
    if (!btn) return;
    answers[QUESTIONS[step].id] = btn.dataset.v;
    step++;
    renderStep();
  });
  $('#quiz-back').addEventListener('click', () => { if (step > 0) { step--; renderStep(); } });

  /* ---------- 궁합 점수 ---------- */
  const GENTLE = /순하|온순|사람을\s*(잘\s*)?따|친화|애교|얌전|사람\s*좋아/;
  const CAUTION = /공격|입질|경계심|사나|예민/;

  function sizeOf(a) {
    const kg = parseFloat(a.weight);
    if (Number.isNaN(kg)) return 'unknown';
    return kg < 7 ? 'small' : kg <= 15 ? 'medium' : 'large';
  }
  function ageGroup(a) {
    const y = a.age.years;
    if (y === null || y === undefined) return 'unknown';
    return y < 1 ? 'baby' : y <= 7 ? 'adult' : 'senior';
  }

  /** 0~99점과 추천 이유를 계산 */
  function score(a, ans) {
    let s = 45;
    const why = [];
    const add = (n, reason) => { s += n; if (reason && n > 0) why.push([n, reason]); };
    const dog = a.upKindCd === '417000';
    const cat = a.upKindCd === '422400';
    const size = sizeOf(a);
    const age = ageGroup(a);

    // 주거 환경
    if (dog && (ans.home === 'apt' || ans.home === 'small')) {
      if (size === 'small') add(14, '작은 체구라 실내 생활에 잘 맞아요');
      if (size === 'large') add(-16);
      if (ans.home === 'small' && size === 'medium') add(-6);
    }
    if (dog && ans.home === 'house' && size !== 'small') add(10, '마당 있는 집에서 뛰어놀기 좋아요');
    if (cat && ans.home !== 'house') add(8, '고양이는 작은 공간에서도 잘 지내요');

    // 집을 비우는 시간
    if (ans.time === 'long') {
      if (cat) add(12, '혼자 있는 시간에도 비교적 잘 적응해요');
      if (dog) add(age === 'baby' ? -14 : -5);
    }
    if (ans.time === 'short') {
      if (dog) add(6, '함께 있는 시간이 길어 강아지가 안정감을 느껴요');
      if (age === 'baby') add(8, '아기 시기에 곁에서 돌봐줄 수 있어요');
    }

    // 산책
    if (dog) {
      if (ans.walk === 'high' && age !== 'senior') add(10, '활발한 산책 메이트가 될 수 있어요');
      if (ans.walk === 'low') add(age === 'senior' && size === 'small' ? -3 : -15);
      if (ans.walk === 'mid' && (size === 'small' || age === 'senior')) add(6, '하루 30분 산책이면 충분해요');
    }
    if (cat && ans.walk === 'low') add(5, '산책이 필요 없어 실내 생활에 딱이에요');

    // 경험
    if (ans.exp === 'none') {
      if (age === 'baby') add(-8);
      if (age === 'senior') add(-6);
      if (a.neuterYn === 'Y') add(6, '중성화가 완료되어 있어 첫 입양에 부담이 적어요');
    }
    if (ans.exp === 'pro' && age === 'senior') add(10, '경험 많은 보호자가 필요한 노령 친구예요');

    // 나이 선호
    if (ans.age && ans.age !== 'any') add(ans.age === age ? 12 : -6, ans.age === age ? '원하는 나이대예요' : '');

    // 특징 기록
    if (GENTLE.test(a.special)) add(8, '사람을 잘 따른다는 보호소 기록이 있어요');
    if (CAUTION.test(a.special)) add(ans.exp === 'pro' ? -3 : -10);

    // 입양 가능 시점
    const left = daysUntil(a.noticeEnd);
    if (left !== null && left < 0) {
      add(8, '공고가 끝나 지금 바로 입양 신청이 가능해요');
      if (-left >= 30) add(5, `${-left}일째 가족을 기다리고 있어요`);
    } else if (left !== null) {
      add(-4);
    }

    return {
      score: Math.max(5, Math.min(99, Math.round(s))),
      reasons: why.sort((x, y) => y[0] - x[0]).slice(0, 3).map((w) => w[1]),
    };
  }

  /* ---------- 결과 유형 ---------- */
  function profileOf(ans) {
    if (ans.exp === 'pro' && ans.age === 'senior') return ['🧡', '든든한 노령동물 보호자형', '경험과 여유로 나이 든 친구의 남은 시간을 행복하게 채워줄 수 있어요.'];
    if (ans.walk === 'high' && ans.kind !== '422400') return ['🏃', '활동파 산책 메이트형', '에너지 넘치는 강아지와 함께 매일의 산책을 즐길 수 있어요.'];
    if (ans.time === 'long' && ans.kind === '417000') return ['🌙', '바쁜 일상 속 든든한 보호자형', '혼자 있는 시간에도 차분하게 기다릴 줄 아는 성견과 잘 어울려요.'];
    if (ans.time === 'long' || ans.kind === '422400') return ['🌙', '독립적인 집사형', '각자의 시간을 존중하는 차분한 친구와 잘 어울려요.'];
    if (ans.exp === 'none') return ['🌱', '차근차근 첫 가족형', '순하고 중성화가 된 아이부터 천천히 시작해 보는 걸 추천해요.'];
    return ['🏡', '포근한 홈메이트형', '집에서 함께하는 시간을 소중히 여기는 다정한 보호자예요.'];
  }

  /* ---------- 결과 ---------- */
  async function showResult() {
    try { localStorage.setItem('ongi:match', JSON.stringify(answers)); } catch (_) { /* 무시 */ }
    $('#quiz').hidden = true;
    $('#result').hidden = false;
    const [icon, title, desc] = profileOf(answers);
    $('#profile').innerHTML = `
      <div class="profile-icon">${icon}</div>
      <div><p class="profile-label">나의 입양 유형</p><h2>${title}</h2><p>${desc}</p></div>`;
    $('#match-grid').innerHTML = skeletonCards(6);
    $('#match-count').textContent = '잘 맞는 아이를 찾는 중…';
    renderAlertBox();
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await Api.getAnimals({
        bgnde: toYmd(addDays(today(), -90)),
        endde: toYmd(today()),
        upr_cd: answers.region,
        upkind: answers.kind,
      }, 1, 500);
      const pool = res.items.filter((a) => !a.state.startsWith('종료'));
      const ranked = pool.map((a) => ({ a, ...score(a, answers) }))
        .sort((x, y) => y.score - x.score)
        .slice(0, 12);

      if (!ranked.length) {
        $('#match-count').textContent = '';
        $('#match-grid').innerHTML = stateBox('empty', '조건에 맞는 아이가 지금은 없어요', '지역을 넓히거나 아래 알림을 신청해 보세요.');
        return;
      }
      $('#match-count').innerHTML = `보호 중인 <b>${pool.length.toLocaleString()}</b>마리 중 잘 맞는 아이 <b>${ranked.length}</b>마리`;
      $('#match-grid').innerHTML = ranked.map(({ a, score: sc, reasons }) => animalCard(a, `
        <div class="match-score"><span style="--p:${sc}%"></span><b>${sc}%</b> 잘 맞아요</div>
        ${reasons.length ? `<ul class="reasons">${reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}`)).join('');
    } catch (err) {
      $('#match-count').textContent = '';
      $('#match-grid').innerHTML = stateBox('error', '아이들을 불러오지 못했어요', err.message);
    }
  }

  function restart() {
    step = 0;
    $('#result').hidden = true;
    $('#quiz').hidden = false;
    renderStep();
  }
  $('#btn-retry-quiz').addEventListener('click', restart);

  /* ---------- 신규 공고 알림 구독 ---------- */
  function renderAlertBox() {
    const kindName = { '417000': '강아지', '422400': '고양이' }[answers.kind] || '모든 동물';
    $('#alert-cond').innerHTML = `<span class="chip">📍 ${escapeHtml(answers.regionName || '전국')}</span>
      <span class="chip">${escapeHtml(kindName)}</span> 조건으로 새 공고가 올라오면 메일로 알려드려요.`;
    const form = $('#alert-form');
    const enabled = Api.useProxy();
    [...form.elements].forEach((el) => { el.disabled = !enabled; });
    if (!enabled) {
      $('#alert-note').textContent = 'GAS 서버(PROXY_URL)를 연결하면 사용할 수 있어요.';
    }
  }

  $('#alert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = '신청 중…';
    try {
      const res = await Api.gas('subscribe', {
        email: form.elements.email.value.trim(),
        upr_cd: answers.region || '',
        upkind: answers.kind || '',
        sido_nm: answers.regionName || '전국',
      });
      showToast(res.message || '구독 완료!');
      $('#alert-note').textContent = `✅ ${res.message || '구독 완료!'} 메일함(스팸함 포함)을 확인해 주세요.`;
      form.reset();
    } catch (err) {
      showToast(err.message);
      $('#alert-note').textContent = `⚠️ ${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '알림 받기';
    }
  });

  /* ---------- 시작 ---------- */
  async function init() {
    renderHeader('match');
    try { sidoList = await Api.getSido(); } catch (_) { sidoList = []; }
    renderStep();
  }
  init();
})();
