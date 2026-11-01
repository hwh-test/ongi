/* =========================================================
 * 온기 — 유기동물 입양 찾기 | 설정 파일
 * ---------------------------------------------------------
 * 1) 공공데이터포털에서 '농림축산식품부 농림축산검역본부_
 *    국가동물보호정보시스템 구조동물 조회 서비스'를 활용신청합니다.
 * 2) 마이페이지 > 개발계정 > 일반 인증키(Decoding)를 복사해
 *    아래 SERVICE_KEY 따옴표 안에 붙여넣습니다.
 *    (Encoding 키를 넣어도 자동으로 변환됩니다)
 * 3) SERVICE_KEY가 비어 있으면 '샘플 데이터 모드'로 동작합니다.
 * ========================================================= */
const CONFIG = {
  SERVICE_KEY: '',

  // 구조동물 조회 서비스 v2 (https 필수: GitHub Pages가 https이기 때문)
  BASE_URL: 'https://apis.data.go.kr/1543061/abandonmentPublicService_v2',

  PAGE_SIZE: 24,            // 목록 한 페이지에 보여줄 마릿수
  DEFAULT_RANGE_DAYS: 60,   // 기본 검색 기간(오늘 기준 며칠 전부터)
  CACHE_MINUTES: 10,        // 같은 요청 결과를 브라우저에 보관하는 시간
  STATS_CONCURRENCY: 4,     // 통계 페이지에서 동시에 보내는 요청 수

  /* ---------- 2단계 ---------- */
  // 카카오 개발자 콘솔 > 앱 > 플랫폼 키 > JavaScript 키
  // (비어 있으면 지도 없이 보호소 목록만 표시)
  KAKAO_JS_KEY: 'b9f7dbc78988b58efc3a09cc71035d28',

  // Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 > firebaseConfig
  // 중괄호 { } 안의 내용을 통째로 바꿔 붙여넣으세요. (databaseURL 필수)
  // (비어 있으면 '로컬 모드': 찜·댓글이 이 브라우저에만 저장됨)
  FIREBASE: {
    apiKey: 'AIzaSyBFRFhvygJObtFlOKKsvpeuHBwXm-vL1s8',
    authDomain: 'ongi-94d4d.firebaseapp.com',
    databaseURL: 'https://ongi-94d4d-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'ongi-94d4d',
    storageBucket: 'ongi-94d4d.firebasestorage.app',
    messagingSenderId: '774094866983',
    appId: '1:774094866983:web:45d30f202ae42365109c02',
  },

  /* ---------- 3단계 ---------- */
  // GAS 웹 앱 배포 URL (https://script.google.com/macros/s/.../exec)
  // 이 값을 넣으면 공공데이터 API를 GAS를 거쳐 호출하므로 위 SERVICE_KEY를 비워도 됩니다.
  // AI 소개글 · 신규 공고 알림 기능도 이 주소가 있어야 동작합니다.
  PROXY_URL: 'https://script.google.com/macros/s/AKfycbxZYQYT8gvOeGgSEgCcq5qfEkarxPMJf9tDXiFkcWjy_e84DgYWkRew5ysN-vNioBOo/exec',

  MAP_RANGE_DAYS: 60,       // 지도에 표시할 구조 기간
  MAP_MAX_PAGES: 3,         // 전국 조회 시 최대 페이지 수 (1페이지 = 1,000마리)
};
