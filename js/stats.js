/* =========================================================
 * 통계 페이지 (stats.html)
 * - 시도별·축종별·주별 건수: 조건마다 totalCount만 조회 (정확한 전체 수)
 * - 나이대·처리 결과: 최근 구조 표본(최대 1,000건)을 받아 직접 집계
 * - 요청은 runPool로 동시에 4개씩만 보내 서버 부담을 줄임
 * ========================================================= */
(() => {
  const SAMPLE_SIZE = 1000;
  const COLOR = {
    brand: '#e2763c',
    dog: '#eb6834', cat: '#2a78d6', etc: '#1baf7a',
    grid: '#efe8e0', axis: '#9c8f86', text: '#6f625a',
  };
  const charts = {};
  let loadSeq = 0;

  renderHeader('stats');
  if (typeof Chart === 'undefined') {
    showError(new Error('차트 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
    return;
  }

  Chart.defaults.font.family = "'Pretendard Variable', Pretendard, sans-serif";
  Chart.defaults.color = COLOR.text;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.tooltip.callbacks.label = (ctx) => ` ${Number(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed).toLocaleString()}마리`;

  const numFmt = (n) => Number(n).toLocaleString();

  function setProgress(text) { $('#progress-text').textContent = text; }

  /** 기존 차트를 지우고 새로 그림 (기간 변경 시 재사용) */
  function drawChart(id, config) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), config);
  }

  const axisStyle = {
    grid: { color: COLOR.grid }, border: { color: COLOR.grid },
    ticks: { color: COLOR.axis, precision: 0 },
  };
  const noGrid = { grid: { display: false }, border: { color: COLOR.grid }, ticks: { color: COLOR.text } };

  function barDataset(data, color = COLOR.brand) {
    return { data, backgroundColor: color, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 };
  }

  /* ---------- 주 단위 구간 만들기 ---------- */
  function weekRanges(days) {
    const end = today();
    const start = addDays(end, -days + 1);
    const ranges = [];
    let cursor = new Date(end);
    while (cursor >= start) {
      const from = addDays(cursor, -6) < start ? new Date(start) : addDays(cursor, -6);
      ranges.unshift({ from, to: new Date(cursor) });
      cursor = addDays(from, -1);
    }
    return ranges;
  }

  /* ---------- 표본 집계 ---------- */
  function ageBucket(a) {
    const y = a.age.years;
    if (y === null || y === undefined) return '미상';
    if (y < 1) return '1살 미만';
    if (y <= 2) return '1~2살';
    if (y <= 5) return '3~5살';
    if (y <= 9) return '6~9살';
    return '10살 이상';
  }
  const AGE_ORDER = ['1살 미만', '1~2살', '3~5살', '6~9살', '10살 이상', '미상'];

  function stateLabel(s) {
    if (!s) return '기타';
    if (s === '보호중') return '보호중';
    const m = s.match(/종료\((.+)\)/);
    return m ? m[1] : s;
  }

  function countBy(list, fn) {
    return list.reduce((acc, x) => { const k = fn(x); acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  }

  /* ---------- 불러오기 ---------- */
  async function load(days) {
    const seq = ++loadSeq;
    $('#stats-error').innerHTML = '';
    const range = { bgnde: toYmd(addDays(today(), -days + 1)), endde: toYmd(today()) };
    $('#kpi-range').textContent = `${fmtDate(range.bgnde)} ~ ${fmtDate(range.endde)}`;
    setProgress('지역 목록을 불러오는 중…');

    let sido;
    try { sido = await Api.getSido(); } catch (err) { return showError(err); }
    if (seq !== loadSeq) return;

    const weeks = weekRanges(days);
    const kinds = [['417000', '개', COLOR.dog], ['422400', '고양이', COLOR.cat], ['429900', '기타', COLOR.etc]];

    // 건수 조회 조건 목록 (GAS 연결 시 15개씩 묶어 한 번에 요청)
    const countFilters = [
      range,
      { ...range, state: 'notice' },
      { ...range, state: 'protect' },
      ...kinds.map(([code]) => ({ ...range, upkind: code })),
      ...sido.map((s) => ({ ...range, upr_cd: s.code })),
      ...weeks.map((w) => ({ bgnde: toYmd(w.from), endde: toYmd(w.to) })),
    ];
    const progress = (done, total) => { if (seq === loadSeq) setProgress(`데이터 불러오는 중 ${done}/${total}`); };
    const [counts, sampleRes] = await Promise.all([
      Api.getCounts(countFilters, progress),
      Api.getAnimals(range, 1, SAMPLE_SIZE).then((v) => ({ ok: true, value: v }), (error) => ({ ok: false, error })),
    ]);
    if (seq !== loadSeq) return;
    // 기존 순서(전체, 공고중, 보호중, 표본, 축종…, 시도…, 주…)로 합치기
    const results = [counts[0], counts[1], counts[2], sampleRes, ...counts.slice(3)];

    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) return showError(failed[0].error);
    const val = (i, fallback = 0) => (results[i].ok ? results[i].value : fallback);

    let i = 0;
    const total = val(i++);
    const notice = val(i++);
    const protect = val(i++);
    const sample = val(i++, { items: [] }).items;
    const kindCounts = kinds.map(() => val(i++));
    const sidoCounts = sido.map(() => val(i++));
    const weekCounts = weeks.map(() => val(i++));

    // KPI
    $('#kpi-total').innerHTML = `${numFmt(total)}<small>마리</small>`;
    $('#kpi-notice').innerHTML = `${numFmt(notice)}<small>마리</small>`;
    $('#kpi-protect').innerHTML = `${numFmt(protect)}<small>마리</small>`;
    const ended = sample.filter((a) => a.state.startsWith('종료'));
    const adopted = ended.filter((a) => a.state.includes('입양')).length;
    $('#kpi-adopt').innerHTML = ended.length ? `${Math.round((adopted / ended.length) * 100)}<small>%</small>` : '–';
    $('#kpi-adopt-note').textContent = `처리 완료 ${numFmt(ended.length)}건 중 입양`;
    const sampleNote = `최근 구조 ${numFmt(sample.length)}마리 표본 기준`;
    $('#age-note').textContent = sampleNote;
    $('#state-note').textContent = sampleNote;

    // 주별 추이
    drawChart('chart-trend', {
      type: 'line',
      data: {
        labels: weeks.map((w) => `${w.from.getMonth() + 1}/${w.from.getDate()}~`),
        datasets: [{
          data: weekCounts, borderColor: COLOR.brand, backgroundColor: 'rgba(226,118,60,.12)',
          borderWidth: 2, fill: true, tension: .3, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: COLOR.brand,
        }],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { title: (items) => {
            const w = weeks[items[0].dataIndex];
            return `${fmtDate(toYmd(w.from))} ~ ${fmtDate(toYmd(w.to))}`;
          } } } },
        scales: { x: noGrid, y: { ...axisStyle, beginAtZero: true } },
      },
    });

    // 시도별 (많은 순)
    const sidoSorted = sido.map((s, k) => ({ name: s.name, n: sidoCounts[k] })).sort((a, b) => b.n - a.n);
    drawChart('chart-sido', {
      type: 'bar',
      data: { labels: sidoSorted.map((s) => s.name), datasets: [barDataset(sidoSorted.map((s) => s.n))] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ...axisStyle, beginAtZero: true }, y: { ...noGrid, ticks: { color: COLOR.text, autoSkip: false, font: { size: 12 } } } },
      },
    });

    // 축종 (도넛 + 범례에 비율 표시)
    const kindSum = kindCounts.reduce((a, b) => a + b, 0) || 1;
    drawChart('chart-kind', {
      type: 'doughnut',
      data: {
        labels: kinds.map(([, name], k) => `${name} ${Math.round((kindCounts[k] / kindSum) * 100)}%`),
        datasets: [{ data: kindCounts, backgroundColor: kinds.map((k) => k[2]), borderColor: '#fff', borderWidth: 2 }],
      },
      options: {
        maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: { position: 'right', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14, color: COLOR.text } },
          tooltip: { callbacks: { label: (ctx) => ` ${numFmt(ctx.parsed)}마리` } },
        },
      },
    });

    // 나이대 (표본)
    const ages = countBy(sample, ageBucket);
    drawChart('chart-age', {
      type: 'bar',
      data: { labels: AGE_ORDER, datasets: [barDataset(AGE_ORDER.map((k) => ages[k] || 0))] },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ...noGrid, ticks: { color: COLOR.text, font: { size: 11 } } }, y: { ...axisStyle, beginAtZero: true } },
      },
    });

    // 처리 결과 (표본, 많은 순)
    const states = Object.entries(countBy(sample, (a) => stateLabel(a.state))).sort((a, b) => b[1] - a[1]);
    drawChart('chart-state', {
      type: 'bar',
      data: { labels: states.map((s) => s[0]), datasets: [barDataset(states.map((s) => s[1]))] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ...axisStyle, beginAtZero: true }, y: noGrid },
      },
    });

    setProgress(failed.length ? `일부 데이터(${failed.length}건)를 불러오지 못했어요` : `업데이트: ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
  }

  function showError(err) {
    setProgress('');
    $('#stats-error').innerHTML = stateBox('error', '통계를 불러오지 못했어요', err.message,
      '<button class="btn btn-primary" onclick="location.reload()">다시 시도</button>');
  }

  /* ---------- 시작 ---------- */
  $$('input[name="range"]').forEach((r) => r.addEventListener('change', () => load(Number(r.value))));
  load(60);
})();
