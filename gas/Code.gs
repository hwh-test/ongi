/* =========================================================
 * 온기 — Google Apps Script 서버
 * ---------------------------------------------------------
 * GitHub Pages(정적 웹)에서는 키를 숨길 수 없기 때문에,
 * 키가 필요한 일은 모두 이 GAS 웹 앱이 대신 처리합니다.
 *
 *   ?action=api        공공데이터 API 대리 호출 (인증키는 서버에만 보관)
 *   ?action=batch      여러 요청을 한 번에 병렬 호출 (UrlFetchApp.fetchAll)
 *   ?action=story      Gemini로 입양 홍보글 생성
 *   ?action=subscribe  신규 공고 알림 구독 (구글 시트에 저장)
 *   ?action=unsubscribe 알림 해지 (메일의 링크)
 *   ?action=ping       연결 확인
 *
 * 시간 트리거: 매일 오전 9시 checkNewAnimals() → 조건에 맞는 새 공고를 메일로 발송
 *
 * [스크립트 속성] 프로젝트 설정(톱니바퀴) > 스크립트 속성
 *   SERVICE_KEY     공공데이터포털 일반 인증키
 *   GEMINI_API_KEY  Gemini API 키
 *   SITE_URL        GitHub Pages 주소 (예: https://hwh-test.github.io/ongi/)
 *   GEMINI_MODEL    (선택) 사용할 모델 이름을 직접 지정할 때
 *   SHEET_ID        setup() 실행 시 자동으로 저장됨
 * ========================================================= */

const API_BASE = 'https://apis.data.go.kr/1543061/abandonmentPublicService_v2';
const ALLOWED_OPS = ['sido_v2', 'sigungu_v2', 'shelter_v2', 'kind_v2', 'abandonmentPublic_v2'];
const ALLOWED_PARAMS = ['bgnde', 'endde', 'upkind', 'kind', 'upr_cd', 'org_cd', 'care_reg_no', 'state', 'neuter_yn',
  'sex_cd', 'pageNo', 'numOfRows', 'bgupd', 'enupd', 'desertion_no', 'notice_no', 'up_kind_cd'];
// 앞에서부터 차례로 시도 (새 프로젝트는 2.5 모델 사용이 제한될 수 있음)
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash'];
const UPKIND_NAME = { '417000': '개', '422400': '고양이', '429900': '기타 동물' };
const SHEET_NAME = '구독';
const HEADERS = ['토큰', '이메일', '시도코드', '시도명', '축종코드', '축종명', '구독일', '마지막 확인', '보낸 유기번호', '알림 횟수', '상태'];
const MAX_SUBS_PER_EMAIL = 3;

/* =========================================================
 * 웹 앱 진입점
 * ========================================================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'api': return textOut(callApi(p.op, pickParams(p)));
      case 'batch': return jsonOut({ results: batch(JSON.parse(p.reqs || '[]')) });
      case 'story': return jsonOut(makeStory(p.id));
      case 'subscribe': return jsonOut(subscribe(p));
      case 'unsubscribe': return unsubscribePage(p.token);
      case 'ping': return jsonOut({ ok: true, time: new Date().toISOString() });
      default: return jsonOut({ error: '알 수 없는 요청이에요.' });
    }
  } catch (err) {
    console.error(err);
    return jsonOut({ error: String((err && err.message) || err) });
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function textOut(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}
function prop(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

/* =========================================================
 * 1. 공공데이터 API 프록시 (+ 10분 캐시)
 * ========================================================= */
/** 허용된 파라미터만 골라냄 (임의 파라미터 전달 방지) */
function pickParams(src) {
  const out = {};
  ALLOWED_PARAMS.forEach(function (k) {
    if (src[k] !== undefined && src[k] !== null && String(src[k]) !== '') out[k] = String(src[k]).slice(0, 30);
  });
  return out;
}

function buildUrl(op, params) {
  if (ALLOWED_OPS.indexOf(op) < 0) throw new Error('허용되지 않은 API 요청이에요: ' + op);
  const key = prop('SERVICE_KEY');
  if (!key) throw new Error('GAS 스크립트 속성에 SERVICE_KEY가 없어요.');
  const query = Object.keys(params).sort().map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  });
  query.push('_type=json');
  return API_BASE + '/' + op + '?serviceKey=' + encodeURIComponent(key) + '&' + query.join('&');
}

function cacheKey(prefix, text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return prefix + Utilities.base64EncodeWebSafe(digest);
}

function callApi(op, params) {
  const url = buildUrl(op, params);
  const cache = CacheService.getScriptCache();
  const key = cacheKey('api:', url);
  const hit = cache.get(key);
  if (hit) return hit;

  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const text = res.getContentText('UTF-8');
  saveToCache(cache, key, res.getResponseCode(), text);
  return text;
}

/** 정상 JSON이고 100KB 미만일 때만 캐시 (CacheService 한도) */
function saveToCache(cache, key, code, text) {
  if (code === 200 && text.charAt(0) === '{' && text.length < 95000) {
    try { cache.put(key, text, 600); } catch (e) { /* 용량 초과 등 무시 */ }
  }
}

/** 여러 요청을 병렬로 처리 → 통계 페이지 30여 개 요청을 몇 번의 호출로 줄임 */
function batch(reqs) {
  if (!Array.isArray(reqs)) throw new Error('잘못된 일괄 요청이에요.');
  if (reqs.length > 25) throw new Error('한 번에 최대 25개까지 요청할 수 있어요.');
  const cache = CacheService.getScriptCache();
  const urls = reqs.map(function (r) { return buildUrl(r.op, pickParams(r.params || {})); });
  const keys = urls.map(function (u) { return cacheKey('api:', u); });
  const hits = cache.getAll(keys);
  const results = new Array(urls.length);
  const misses = [];
  urls.forEach(function (u, i) {
    if (hits[keys[i]]) results[i] = hits[keys[i]];
    else misses.push(i);
  });
  if (misses.length) {
    const responses = UrlFetchApp.fetchAll(misses.map(function (i) {
      return { url: urls[i], muteHttpExceptions: true };
    }));
    responses.forEach(function (res, j) {
      const i = misses[j];
      results[i] = res.getContentText('UTF-8');
      saveToCache(cache, keys[i], res.getResponseCode(), results[i]);
    });
  }
  return results;
}

/** 구조동물 목록을 배열로 받기 (서버 내부용) */
function fetchAnimals(params) {
  const text = callApi('abandonmentPublic_v2', params);
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('공공데이터 API 오류: ' + text.slice(0, 200)); }
  const body = (data.response && data.response.body) || {};
  let items = (body.items && body.items.item) || [];
  if (!Array.isArray(items)) items = [items];
  return items;
}

/* =========================================================
 * 2. Gemini 입양 홍보글
 *    - 동물 정보는 서버가 직접 API로 조회 → 사용자가 임의의 질문을
 *      보낼 수 없으므로 Gemini 키가 다른 용도로 쓰일 수 없음
 * ========================================================= */
function makeStory(id) {
  if (!/^\d{5,20}$/.test(String(id || ''))) throw new Error('유기번호가 올바르지 않아요.');
  const cache = CacheService.getScriptCache();
  const hit = cache.get('story:' + id);
  if (hit) return JSON.parse(hit);

  const items = fetchAnimals({ desertion_no: id, pageNo: '1', numOfRows: '1' });
  if (!items.length) throw new Error('해당 공고를 찾을 수 없어요.');
  const a = items[0];

  const sex = { M: '수컷', F: '암컷' }[a.sexCd] || '미상';
  const neuter = { Y: '완료', N: '안 함' }[a.neuterYn] || '미상';
  const prompt = [
    '너는 유기동물 보호소의 입양 홍보 담당자야.',
    '아래 [정보]만 사용해서 이 아이를 소개하는 따뜻하고 진솔한 입양 홍보글을 한국어로 써줘.',
    '',
    '규칙:',
    '- 4~5문장, 공백 포함 350자 이내',
    '- [정보]에 없는 성격, 건강 상태, 사연은 절대 지어내지 말 것',
    '- 동물의 1인칭 시점이 아니라 소개하는 사람의 시점으로 쓸 것',
    '- 굵게, 제목 같은 마크다운 기호는 쓰지 말 것',
    '- 마지막 줄에만 해시태그 3개 (#입양 포함)',
    '',
    '[정보]',
    '종류: ' + (a.kindFullNm || a.kindNm || a.kindCd || '미상'),
    '성별: ' + sex + ' / 중성화: ' + neuter,
    '나이: ' + (a.age || '미상') + ' / 체중: ' + (a.weight || '미상') + ' / 털색: ' + (a.colorCd || '미상'),
    '발견 장소: ' + (a.happenPlace || '미상'),
    '특징: ' + (a.specialMark || '기록 없음'),
    '보호소: ' + (a.careNm || '미상'),
  ].join('\n');

  const result = callGemini(prompt);
  const out = { text: result.text, model: result.model };
  cache.put('story:' + id, JSON.stringify(out), 21600);   // 6시간
  return out;
}

function callGemini(prompt) {
  const key = prop('GEMINI_API_KEY');
  if (!key) throw new Error('GAS 스크립트 속성에 GEMINI_API_KEY가 없어요.');
  const models = prop('GEMINI_MODEL') ? [prop('GEMINI_MODEL')] : GEMINI_MODELS;
  let lastError = '';

  for (let i = 0; i < models.length; i++) {
    const res = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
        }),
        muteHttpExceptions: true,
      });
    const code = res.getResponseCode();
    let data = {};
    try { data = JSON.parse(res.getContentText()); } catch (e) { /* 무시 */ }

    if (code === 404 || (code === 403 && /model/i.test(JSON.stringify(data)))) {
      lastError = models[i] + ' 사용 불가';
      continue;                                       // 다음 모델로
    }
    if (code !== 200) {
      const msg = (data.error && data.error.message) || ('HTTP ' + code);
      if (code === 429) throw new Error('AI 사용량 한도를 넘었어요. 잠시 후 다시 시도해 주세요.');
      throw new Error('Gemini 오류: ' + msg);
    }
    const cand = (data.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || [])
      .map(function (p) { return p.text || ''; }).join('').trim();
    if (!text) throw new Error('AI가 글을 만들지 못했어요. (' + ((cand && cand.finishReason) || '응답 없음') + ')');
    return { text: text.replace(/\*\*/g, ''), model: models[i] };
  }
  throw new Error('사용 가능한 Gemini 모델을 찾지 못했어요. (' + lastError + ') 스크립트 속성 GEMINI_MODEL로 지정해 주세요.');
}

/* =========================================================
 * 3. 신규 공고 알림 구독 (구글 시트를 DB로 사용)
 * ========================================================= */
function getSheet() {
  const id = prop('SHEET_ID');
  if (!id) throw new Error('GAS 편집기에서 setup()을 먼저 실행해 주세요.');
  return SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
}

function subscribe(p) {
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 100) throw new Error('이메일 주소를 확인해 주세요.');
  const uprCd = /^\d{7}$/.test(p.upr_cd || '') ? p.upr_cd : '';
  const upkind = UPKIND_NAME[p.upkind] ? p.upkind : '';
  const sidoNm = String(p.sido_nm || '').slice(0, 20) || '전국';

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues().slice(1);
    const mine = rows.filter(function (r) { return r[1] === email && r[10] === '활성'; });
    const same = mine.some(function (r) { return String(r[2]) === uprCd && String(r[4]) === upkind; });
    if (same) return { ok: true, already: true, message: '이미 같은 조건으로 구독 중이에요.' };
    if (mine.length >= MAX_SUBS_PER_EMAIL) throw new Error('한 이메일로 최대 ' + MAX_SUBS_PER_EMAIL + '개 조건까지 구독할 수 있어요.');

    const token = Utilities.getUuid();
    const now = new Date();
    // 지금 공고 중인 아이들은 '이미 본 것'으로 기록 → 다음 알림부터 새 공고만 발송
    const current = fetchNotices(uprCd, upkind);
    const seen = current.map(function (a) { return String(a.desertionNo); }).slice(0, 500);
    sheet.appendRow([token, email, uprCd, sidoNm, upkind, UPKIND_NAME[upkind] || '전체', now, now,
      JSON.stringify(seen), 0, '활성']);

    // 구독 확인 메일 (지금 공고 중인 아이 최대 6마리 소개)
    sendMail(email, {
      title: '알림 구독이 완료됐어요',
      intro: conditionText(sidoNm, upkind) + ' 조건으로 새 공고가 올라오면 매일 오전 9시에 알려드릴게요. '
        + '지금 이 조건에서 공고 중인 아이들도 함께 보내드려요.',
      animals: current.slice(0, 6),
      total: current.length,
      token: token,
    });
    return { ok: true, message: '구독 완료! 확인 메일을 보냈어요.' };
  } finally {
    lock.releaseLock();
  }
}

function fetchNotices(uprCd, upkind) {
  const params = {
    bgnde: ymd(addDays(new Date(), -30)), endde: ymd(new Date()),
    state: 'notice', pageNo: '1', numOfRows: '500',
  };
  if (uprCd) params.upr_cd = uprCd;
  if (upkind) params.upkind = upkind;
  return fetchAnimals(params).sort(function (a, b) {
    return String(b.noticeSdt).localeCompare(String(a.noticeSdt));
  });
}

/** 매일 실행 (setup()이 트리거 등록) */
function checkNewAnimals() {
  const sheet = getSheet();
  const values = sheet.getDataRange().getValues();
  const now = new Date();
  const results = {};                                 // 같은 조건은 한 번만 조회

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row[10] !== '활성') continue;
    const uprCd = String(row[2] || '');
    const upkind = String(row[4] || '');
    const condKey = uprCd + '|' + upkind;
    try {
      if (!results[condKey]) results[condKey] = fetchNotices(uprCd, upkind);
      const seen = new Set(JSON.parse(row[8] || '[]'));
      const fresh = results[condKey].filter(function (a) { return !seen.has(String(a.desertionNo)); });

      if (fresh.length) {
        sendMail(row[1], {
          title: '새로운 아이 ' + fresh.length + '마리가 가족을 기다려요',
          intro: conditionText(row[3], upkind) + ' 조건에 새 공고가 올라왔어요.',
          animals: fresh.slice(0, 10),
          total: fresh.length,
          token: row[0],
        });
        sheet.getRange(r + 1, 10).setValue(Number(row[9] || 0) + 1);
      }
      // 최근 본 목록 갱신 (최대 500개)
      const merged = results[condKey].map(function (a) { return String(a.desertionNo); })
        .concat(Array.from(seen)).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).slice(0, 500);
      sheet.getRange(r + 1, 8, 1, 2).setValues([[now, JSON.stringify(merged)]]);
    } catch (err) {
      console.error('구독 ' + row[1] + ' 처리 실패: ' + err);
    }
  }
}

function unsubscribePage(token) {
  let message = '알림이 해지됐어요. 그동안 관심 가져 주셔서 고마워요.';
  try {
    const sheet = getSheet();
    const values = sheet.getDataRange().getValues();
    const idx = values.findIndex(function (r) { return r[0] && r[0] === token; });
    if (idx < 1) message = '이미 해지됐거나 잘못된 링크예요.';
    else sheet.getRange(idx + 1, 11).setValue('해지');
  } catch (err) {
    message = '처리 중 오류가 발생했어요: ' + err.message;
  }
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;max-width:420px;margin:80px auto;text-align:center;line-height:1.6">'
    + '<div style="font-size:40px">🐾</div><h2 style="color:#e2763c">온기</h2><p>' + message + '</p>'
    + (prop('SITE_URL') ? '<p><a href="' + prop('SITE_URL') + '">온기로 돌아가기</a></p>' : '') + '</div>')
    .setTitle('온기 알림 해지');
}

/* ---------- 메일 ---------- */
function conditionText(sidoNm, upkind) {
  return "'" + (sidoNm || '전국') + ' · ' + (UPKIND_NAME[upkind] || '모든 동물') + "'";
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function sendMail(to, opt) {
  const site = (prop('SITE_URL') || '').replace(/\/?$/, '/');
  const webapp = ScriptApp.getService().getUrl();
  const cards = opt.animals.map(function (a) {
    const img = String(a.popfile1 || a.popfile || '').replace(/^http:\/\//, 'https://');
    const age = String(a.age || '').replace('(년생)', '년생');
    const link = site + 'detail.html?id=' + encodeURIComponent(a.desertionNo);
    return '<tr><td style="padding:10px 0;border-top:1px solid #eee">'
      + '<a href="' + link + '" style="text-decoration:none;color:#2b2420">'
      + '<table cellpadding="0" cellspacing="0"><tr>'
      + '<td><img src="' + esc(img) + '" width="96" height="96" style="border-radius:10px;object-fit:cover;display:block;background:#f3ece4"></td>'
      + '<td style="padding-left:14px;font-size:14px;line-height:1.6">'
      + '<b style="font-size:15px">' + esc(a.kindNm || a.kindFullNm || '') + '</b><br>'
      + esc(({ M: '수컷', F: '암컷' })[a.sexCd] || '성별 미상') + ' · ' + esc(age) + ' · ' + esc(a.weight || '') + '<br>'
      + '<span style="color:#9c8f86">📍 ' + esc(a.careNm || '') + '</span><br>'
      + '<span style="color:#c45e27">공고 마감 ' + esc(fmt(a.noticeEdt)) + '</span>'
      + '</td></tr></table></a></td></tr>';
  }).join('');

  const html = '<div style="font-family:Apple SD Gothic Neo,Malgun Gothic,sans-serif;max-width:560px;margin:0 auto;color:#2b2420">'
    + '<div style="font-size:22px;font-weight:800;color:#e2763c;padding:16px 0">🐾 온기</div>'
    + '<h2 style="margin:0 0 8px;font-size:20px">' + esc(opt.title) + '</h2>'
    + '<p style="color:#6f625a;line-height:1.6;margin:0 0 12px">' + esc(opt.intro) + '</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0">' + cards + '</table>'
    + (opt.total > opt.animals.length ? '<p style="color:#6f625a">외 ' + (opt.total - opt.animals.length) + '마리가 더 있어요.</p>' : '')
    + (site.length > 1 ? '<p style="margin:20px 0"><a href="' + site + '" style="background:#e2763c;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">온기에서 더 보기</a></p>' : '')
    + '<p style="font-size:12px;color:#9c8f86;border-top:1px solid #eee;padding-top:12px;margin-top:24px">'
    + '공공데이터포털 국가동물보호정보시스템 데이터를 사용해요.<br>'
    + (webapp ? '<a href="' + webapp + '?action=unsubscribe&token=' + encodeURIComponent(opt.token) + '" style="color:#9c8f86">알림 그만 받기</a>' : '')
    + '</p></div>';

  MailApp.sendEmail({ to: to, subject: '[온기] ' + opt.title, htmlBody: html, name: '온기 유기동물 입양 알림' });
}

/* ---------- 날짜 ---------- */
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d) { return Utilities.formatDate(d, 'Asia/Seoul', 'yyyyMMdd'); }
function fmt(s) { s = String(s || ''); return s.length === 8 ? s.slice(0, 4) + '.' + s.slice(4, 6) + '.' + s.slice(6) : s; }

/* =========================================================
 * 설정 · 테스트 (GAS 편집기에서 직접 실행)
 * ========================================================= */
/** 1회 실행: 구독자 시트 생성 + 매일 오전 9시 트리거 등록 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (!id) {
    const ss = SpreadsheetApp.create('온기 알림 구독자');
    const sheet = ss.getSheets()[0].setName(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#fdeee4');
    id = ss.getId();
    props.setProperty('SHEET_ID', id);
    console.log('구독자 시트 생성: ' + ss.getUrl());
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkNewAnimals') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkNewAnimals').timeBased().everyDays(1).atHour(9).inTimezone('Asia/Seoul').create();
  console.log('매일 오전 9시 알림 트리거 등록 완료');
}

/** 키가 제대로 들어갔는지 확인 */
function testApi() {
  const text = callApi('sido_v2', { numOfRows: '3', pageNo: '1' });
  console.log(text.slice(0, 300));
}
function testGemini() {
  console.log(JSON.stringify(callGemini('강아지 입양을 응원하는 한 문장을 써줘.')));
}
