/* =========================================================
 * 샘플 데이터 모드
 * 인증키가 없을 때 실제 API와 같은 형태의 응답을 만들어 줍니다.
 * (화면 미리보기, 시연 중 API 장애 대비용)
 * ========================================================= */
const Mock = (() => {
  let seed = 20261031;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  const SIDO = [
    ['6110000', '서울특별시'], ['6260000', '부산광역시'], ['6270000', '대구광역시'], ['6280000', '인천광역시'],
    ['6290000', '광주광역시'], ['5690000', '세종특별자치시'], ['6300000', '대전광역시'], ['6310000', '울산광역시'],
    ['6410000', '경기도'], ['6530000', '강원특별자치도'], ['6430000', '충청북도'], ['6440000', '충청남도'],
    ['6540000', '전북특별자치도'], ['6460000', '전라남도'], ['6470000', '경상북도'], ['6480000', '경상남도'],
    ['6500000', '제주특별자치도'],
  ];
  // 샘플 보호소 위치용 시도 중심 좌표 (실제 모드에서는 카카오 주소 검색으로 좌표를 구함)
  const CENTER = {
    6110000: [37.566, 126.978], 6260000: [35.180, 129.075], 6270000: [35.871, 128.601], 6280000: [37.456, 126.705],
    6290000: [35.160, 126.851], 5690000: [36.480, 127.289], 6300000: [36.350, 127.385], 6310000: [35.539, 129.311],
    6410000: [37.275, 127.009], 6530000: [37.885, 127.730], 6430000: [36.635, 127.491], 6440000: [36.659, 126.673],
    6540000: [35.820, 127.108], 6460000: [34.816, 126.463], 6470000: [36.576, 128.506], 6480000: [35.238, 128.692],
    6500000: [33.499, 126.531],
  };
  const SGG_NAMES = ['중앙구', '동구', '서구', '남구', '북구'];
  const SIGUNGU = {};
  const SHELTERS = {};
  SIDO.forEach(([code, name]) => {
    SIGUNGU[code] = SGG_NAMES.slice(0, 3 + (Number(code[3]) % 3)).map((n, i) => {
      const org = String(3000000 + Number(code.slice(1, 4)) * 10 + i);
      const [lat, lng] = CENTER[code];
      SHELTERS[org] = [{ careRegNo: `3${org}00${i}`, careNm: `${name.slice(0, 2)} ${n} 동물보호센터`,
        _lat: lat + Math.sin(i * 2.1) * 0.06, _lng: lng + Math.cos(i * 2.1) * 0.08 }];
      return { uprCd: code, orgCd: org, orgdownNm: n };
    });
  });

  const KINDS = {
    '417000': [['000054', '믹스견'], ['000056', '말티즈'], ['000062', '푸들'], ['000089', '진도견'],
      ['000116', '포메라니안'], ['000037', '시바'], ['000114', '웰시 코기'], ['000032', '비숑 프리제']],
    '422400': [['000200', '한국 고양이'], ['000201', '코리안 숏헤어'], ['000202', '러시안 블루'],
      ['000203', '페르시안'], ['000204', '터키시 앙고라']],
    '429900': [['000300', '토끼'], ['000301', '기니피그'], ['000302', '햄스터']],
  };
  const UPKIND_NM = { '417000': '개', '422400': '고양이', '429900': '기타축종' };
  const COLORS = ['흰색', '갈색', '검정', '크림색', '치즈', '삼색', '고등어', '회색', '흑백'];
  const MARKS = ['사람을 잘 따르고 순함', '겁이 많아 천천히 다가가야 함', '활발하고 식욕 좋음', '목줄 착용 상태로 발견',
    '오른쪽 귀에 작은 상처 있음', '산책을 좋아함', '다른 동물과 잘 지냄', '배변 훈련이 되어 있음'];
  const PLACES = ['공원 산책로', '아파트 단지 내', '시장 인근', '도로변', '하천 둔치', '주택가 골목', '버스정류장 부근'];
  const EMOJI = { '417000': '🐶', '422400': '🐱', '429900': '🐰' };
  const BG = ['#f6e3d3', '#e3eedf', '#e2e8f3', '#f3e2ea', '#efe9d6', '#e0eeee'];

  const img = (up, i) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="${BG[i % BG.length]}"/>
     <text x="200" y="185" font-size="120" text-anchor="middle">${EMOJI[up]}</text></svg>`);

  // 샘플 동물 생성
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const ANIMALS = [];
  for (let i = 0; i < 420; i++) {
    const r = rnd();
    const up = r < 0.62 ? '417000' : r < 0.94 ? '422400' : '429900';
    const [kindCd, kindNm] = pick(KINDS[up]);
    const [uprCd, sidoNm] = rnd() < 0.3 ? pick(SIDO.slice(8, 9)) : pick(SIDO);
    const sgg = pick(SIGUNGU[uprCd]);
    const shelter = SHELTERS[sgg.orgCd][0];
    const happen = new Date(now); happen.setDate(now.getDate() - Math.floor(rnd() * 88));
    const nStart = new Date(happen); nStart.setDate(happen.getDate() + 1);
    const nEnd = new Date(nStart); nEnd.setDate(nStart.getDate() + 10);
    let processState = '보호중';
    if (nEnd < now) {
      const p = rnd();
      processState = p < 0.55 ? '보호중' : p < 0.78 ? '종료(입양)' : p < 0.88 ? '종료(반환)' : p < 0.95 ? '종료(자연사)' : '종료(안락사)';
    }
    const ageRoll = rnd();
    const age = ageRoll < 0.08 ? '60일미만(년생)' : `${now.getFullYear() - Math.floor(ageRoll * ageRoll * 14)}(년생)`;
    ANIMALS.push({
      desertionNo: String(448000000000 + i * 7919),
      happenDt: ymd(happen),
      happenPlace: `${sidoNm.slice(0, 2)} ${sgg.orgdownNm} ${pick(PLACES)}`,
      upKindCd: up, upKindNm: UPKIND_NM[up], kindCd, kindNm, kindFullNm: `[${UPKIND_NM[up]}] ${kindNm}`,
      colorCd: pick(COLORS), age, weight: `${(up === '429900' ? 0.3 + rnd() : up === '422400' ? 1 + rnd() * 5 : 1.5 + rnd() * 20).toFixed(1)}(Kg)`,
      noticeNo: `${sidoNm.slice(0, 2)}-${sgg.orgdownNm}-${now.getFullYear()}-${String(i).padStart(5, '0')}`,
      noticeSdt: ymd(nStart), noticeEdt: ymd(nEnd),
      popfile1: img(up, i), popfile2: rnd() < 0.5 ? img(up, i + 3) : '',
      processState,
      sexCd: pick(['M', 'F', 'F', 'M', 'Q']), neuterYn: pick(['Y', 'N', 'U', 'N']),
      specialMark: `${pick(MARKS)}, ${pick(MARKS)}`,
      careRegNo: shelter.careRegNo, careNm: shelter.careNm,
      careTel: `0${2 + (i % 60)}-${100 + (i % 800)}-${1000 + (i * 37) % 9000}`,
      careAddr: `${sidoNm} ${sgg.orgdownNm} 보호소로 ${10 + (i % 90)}`,
      orgNm: `${sidoNm} ${sgg.orgdownNm}`, uprCd, orgCd: sgg.orgCd,
      _lat: shelter._lat, _lng: shelter._lng,
    });
  }
  ANIMALS.sort((a, b) => b.happenDt.localeCompare(a.happenDt));

  function filterAnimals(q) {
    const todayYmd = ymd(now);
    return ANIMALS.filter((a) =>
      (!q.desertion_no || a.desertionNo === String(q.desertion_no)) &&
      (!q.bgnde || a.happenDt >= q.bgnde) && (!q.endde || a.happenDt <= q.endde) &&
      (!q.upkind || a.upKindCd === q.upkind) && (!q.kind || a.kindCd === q.kind) &&
      (!q.upr_cd || a.uprCd === q.upr_cd) && (!q.org_cd || a.orgCd === q.org_cd) &&
      (!q.care_reg_no || a.careRegNo === q.care_reg_no) &&
      (!q.sex_cd || a.sexCd === q.sex_cd) && (!q.neuter_yn || a.neuterYn === q.neuter_yn) &&
      (!q.state || (q.state === 'notice' ? a.processState === '보호중' && a.noticeEdt >= todayYmd : a.processState === '보호중')));
  }

  function page(list, q) {
    const pageNo = Number(q.pageNo || 1);
    const numOfRows = Number(q.numOfRows || 10);
    const items = list.slice((pageNo - 1) * numOfRows, pageNo * numOfRows).map((x) => ({ ...x }));
    return { items, totalCount: list.length, pageNo, numOfRows };
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    async handle(operation, q) {
      await wait(150 + Math.random() * 250);   // 실제 네트워크처럼 약간 지연
      switch (operation) {
        case 'sido_v2': return page(SIDO.map(([orgCd, orgdownNm]) => ({ orgCd, orgdownNm })), q);
        case 'sigungu_v2': return page(SIGUNGU[q.upr_cd] || [], q);
        case 'shelter_v2': return page((SHELTERS[q.org_cd] || []).map(({ careRegNo, careNm }) => ({ careRegNo, careNm })), q);
        case 'kind_v2': return page((KINDS[q.up_kind_cd] || []).map(([kindCd, kindNm]) => ({ kindCd, kindNm })), q);
        case 'abandonmentPublic_v2': return page(filterAnimals(q), q);
        default: throw new ApiError(`알 수 없는 요청: ${operation}`);
      }
    },
  };
})();
