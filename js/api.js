/* =========================================================
 * 공공데이터포털 API 모듈
 * - 요청 URL 생성, JSON 파싱, 오류(XML 응답 포함) 처리
 * - sessionStorage 캐시로 같은 요청 반복 방지
 * - 응답 필드를 화면에서 쓰기 쉬운 형태로 정규화
 * ========================================================= */
class ApiError extends Error {}

const Api = (() => {
  // 3단계: GAS 서버 주소가 있으면 키 없이 GAS를 거쳐 호출 (키 숨김)
  const useProxy = () => !!String(CONFIG.PROXY_URL || '').trim();
  const isMock = () => !useProxy() && !String(CONFIG.SERVICE_KEY || '').trim();

  /** Encoding 키를 넣어도 동작하도록 한 번 디코딩 (이중 인코딩 방지) */
  function serviceKey() {
    let key = String(CONFIG.SERVICE_KEY).trim();
    if (/%[0-9A-F]{2}/i.test(key)) {
      try { key = decodeURIComponent(key); } catch (_) { /* 그대로 사용 */ }
    }
    return key;
  }

  function cleanParams(params) {
    const out = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    });
    return out;
  }

  /* ---------- 캐시 ---------- */
  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const { t, v } = JSON.parse(raw);
      if (Date.now() - t > CONFIG.CACHE_MINUTES * 60000) return null;
      return v;
    } catch (_) { return null; }
  }
  function cacheSet(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); }
    catch (_) { /* 저장 공간 부족 등은 무시 */ }
  }

  /* ---------- 오류 메시지 ---------- */
  const ERROR_TEXT = {
    SERVICE_KEY_IS_NOT_REGISTERED_ERROR: '인증키가 등록되지 않았어요. 활용신청 직후라면 반영까지 최대 1~2시간 걸릴 수 있어요.',
    SERVICE_ACCESS_DENIED_ERROR: '이 API에 대한 활용신청이 필요해요.',
    LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: '오늘 사용할 수 있는 요청 횟수를 모두 사용했어요.',
    DEADLINE_HAS_EXPIRED_ERROR: '활용 기간이 만료됐어요.',
    UNREGISTERED_IP_ERROR: '등록되지 않은 IP에서 요청했어요.',
  };

  /** 인증 오류는 _type=json이어도 XML로 오므로 DOMParser로 읽어 해석 */
  function parseXmlError(text) {
    try {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const pick = (tag) => doc.getElementsByTagName(tag)[0]?.textContent?.trim();
      const code = pick('returnAuthMsg') || pick('resultMsg') || pick('errMsg');
      return ERROR_TEXT[code] || (code ? `API 오류: ${code}` : '알 수 없는 응답을 받았어요.');
    } catch (_) {
      return '알 수 없는 응답을 받았어요.';
    }
  }

  async function fetchText(url) {
    let res;
    try {
      res = await fetch(url);
    } catch (_) {
      throw new ApiError('서버에 연결하지 못했어요. 인터넷 연결을 확인하거나 잠시 후 다시 시도해 주세요.');
    }
    const text = await res.text();
    if (!res.ok && !text.trim().startsWith('<')) throw new ApiError(`서버 오류가 발생했어요 (HTTP ${res.status}).`);
    return text;
  }

  /** 공공데이터 응답(JSON, 오류 시 XML) → { items, totalCount, ... } */
  function parseApiText(text, query = {}) {
    let data;
    try { data = JSON.parse(text); } catch (_) { throw new ApiError(parseXmlError(text)); }
    if (data.error) throw new ApiError(data.error);                 // GAS 서버가 보낸 오류

    const header = data?.response?.header;
    if (header && header.resultCode && header.resultCode !== '00') {
      throw new ApiError(ERROR_TEXT[header.resultMsg] || `API 오류: ${header.resultMsg || header.resultCode}`);
    }
    const body = data?.response?.body || {};
    let items = body.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];      // 결과가 1건이면 배열이 아닌 객체로 옴

    return {
      items,
      totalCount: Number(body.totalCount || 0),
      pageNo: Number(body.pageNo || query.pageNo || 1),
      numOfRows: Number(body.numOfRows || query.numOfRows || 10),
    };
  }

  /** 공통 요청 함수 */
  async function request(operation, params = {}) {
    const query = cleanParams(params);
    if (isMock()) return Mock.handle(operation, query);

    const cacheKey = `ongi:${operation}?${new URLSearchParams(query)}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const url = useProxy()
      ? `${CONFIG.PROXY_URL}?${new URLSearchParams({ action: 'api', op: operation, ...query })}`
      : `${CONFIG.BASE_URL}/${operation}?${new URLSearchParams({ serviceKey: serviceKey(), _type: 'json', ...query })}`;
    const result = parseApiText(await fetchText(url), query);
    cacheSet(cacheKey, result);
    return result;
  }

  /** GAS 서버의 기능 호출 (AI 소개글, 알림 구독, 일괄 조회) */
  async function gas(action, params = {}) {
    if (!useProxy()) throw new ApiError('GAS 서버 주소(PROXY_URL)가 설정되지 않았어요.');
    const text = await fetchText(`${CONFIG.PROXY_URL}?${new URLSearchParams({ action, ...params })}`);
    let data;
    try { data = JSON.parse(text); } catch (_) {
      throw new ApiError('GAS 서버 응답을 읽지 못했어요. 웹 앱 배포의 액세스 권한이 "모든 사용자"인지 확인해 주세요.');
    }
    if (data.error) throw new ApiError(data.error);
    return data;
  }

  /* ---------- 정규화 ---------- */
  function normalizeAnimal(r) {
    const age = parseAge(r.age);
    return {
      id: String(r.desertionNo ?? ''),
      noticeNo: r.noticeNo || '-',
      images: [r.popfile1, r.popfile2, r.popfile].filter(Boolean).map(secureUrl)
        .filter((v, i, a) => a.indexOf(v) === i),
      upKindCd: r.upKindCd || '',
      upKind: r.upKindNm || UPKIND[r.upKindCd] || '',
      kind: r.kindNm || r.kindFullNm || r.kindCd || '품종 미상',
      kindFull: r.kindFullNm || [r.upKindNm, r.kindNm].filter(Boolean).join(' ') || r.kindCd || '',
      color: r.colorCd || '-',
      age,
      weight: cleanUnit(r.weight),
      sexCd: r.sexCd || 'Q',
      sex: SEX_LABEL[r.sexCd] || '성별 미상',
      neuterYn: r.neuterYn || 'U',
      neuter: NEUTER_LABEL[r.neuterYn] || '중성화 미상',
      happenDt: r.happenDt,
      happenPlace: r.happenPlace || '-',
      noticeStart: r.noticeSdt,
      noticeEnd: r.noticeEdt,
      state: r.processState || '',
      special: r.specialMark || '',
      careRegNo: r.careRegNo || '',
      careNm: r.careNm || '보호소 정보 없음',
      careTel: r.careTel || '',
      careAddr: r.careAddr || '',
      orgNm: r.orgNm || '',
      chargeNm: r.chargeNm || '',
      officeTel: r.officetel || '',
      lat: r._lat ?? null,          // 샘플 데이터 전용 (실제 API에는 좌표가 없음)
      lng: r._lng ?? null,
    };
  }

  /* ---------- 공개 함수 ---------- */
  return {
    isMock,
    useProxy,
    gas,

    async getSido() {
      const { items } = await request('sido_v2', { numOfRows: 100, pageNo: 1 });
      return items.map((i) => ({ code: String(i.orgCd), name: i.orgdownNm }));
    },

    async getSigungu(uprCd) {
      if (!uprCd) return [];
      const { items } = await request('sigungu_v2', { upr_cd: uprCd, numOfRows: 100, pageNo: 1 });
      return items.map((i) => ({ code: String(i.orgCd), name: i.orgdownNm }));
    },

    async getShelters(uprCd, orgCd) {
      if (!uprCd || !orgCd) return [];
      const { items } = await request('shelter_v2', { upr_cd: uprCd, org_cd: orgCd, numOfRows: 100, pageNo: 1 });
      return items.map((i) => ({ code: String(i.careRegNo), name: i.careNm }));
    },

    async getKinds(upKindCd) {
      if (!upKindCd) return [];
      const { items } = await request('kind_v2', { up_kind_cd: upKindCd, numOfRows: 500, pageNo: 1 });
      return items.map((i) => ({ code: String(i.kindCd), name: i.kindNm || i.knm }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    },

    /** 구조동물 목록 */
    async getAnimals(filters = {}, pageNo = 1, numOfRows = CONFIG.PAGE_SIZE) {
      const res = await request('abandonmentPublic_v2', { ...filters, pageNo, numOfRows });
      return { ...res, items: res.items.map(normalizeAnimal) };
    },

    /** 조건에 맞는 전체 건수만 필요할 때 (1건만 받아 totalCount 사용) */
    async getCount(filters = {}) {
      const res = await request('abandonmentPublic_v2', { ...filters, pageNo: 1, numOfRows: 1 });
      return res.totalCount;
    },

    /**
     * 여러 조건의 건수를 한꺼번에 조회 → [{ ok, value }]
     * GAS 연결 시: 15개씩 묶어 한 번에 요청 (서버에서 UrlFetchApp.fetchAll로 병렬 처리)
     */
    async getCounts(filtersList, onProgress) {
      if (!useProxy()) {
        return runPool(filtersList.map((f) => () => this.getCount(f)), CONFIG.STATS_CONCURRENCY, onProgress);
      }
      const reqs = filtersList.map((f) => ({ op: 'abandonmentPublic_v2', params: { ...cleanParams(f), pageNo: 1, numOfRows: 1 } }));
      const chunks = [];
      for (let i = 0; i < reqs.length; i += 15) chunks.push(reqs.slice(i, i + 15));
      let done = 0;
      const res = await runPool(chunks.map((chunk) => async () => {
        const data = await gas('batch', { reqs: JSON.stringify(chunk) });
        done += chunk.length;
        if (onProgress) onProgress(done, reqs.length);
        return data.results.map((text) => {
          try { return { ok: true, value: parseApiText(text).totalCount }; } catch (error) { return { ok: false, error }; }
        });
      }), 3);
      return res.flatMap((r, i) => (r.ok ? r.value : chunks[i].map(() => ({ ok: false, error: r.error }))));
    },

    /** 유기번호로 한 마리 조회 (상세 페이지) */
    async getAnimal(desertionNo) {
      const res = await request('abandonmentPublic_v2', { desertion_no: desertionNo, pageNo: 1, numOfRows: 1 });
      return res.items[0] ? normalizeAnimal(res.items[0]) : null;
    },
  };
})();
