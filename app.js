/***********************
 * 설정: Cloudflare Worker URL (A안)
 * - JSONP 제거 / PC 확장프로그램 이슈 해결
 ***********************/
const API_URL = "https://welfare-pay-api.gubossi.workers.dev";

let initData = null;
let lastResult = null;

/***********************
 * UI 유틸
 ***********************/
const $ = (id) => document.getElementById(id);

function setStatus(msg){ $("status").textContent = msg || ""; }
function setError(msg){ $("error").textContent = msg || ""; }

function setOptions(el, arr){
  el.innerHTML = "";
  (arr || []).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
}

function money(n){ return Number(n||0).toLocaleString("ko-KR") + "원"; }

function renderTable(tableId, items){
  const t = $(tableId);
  if (!items || items.length === 0){
    t.innerHTML = `<tr><td class="muted">해당 없음</td></tr>`;
    return;
  }
  t.innerHTML = `
    <tr><th>항목</th><th>금액</th></tr>
    ${items.map(x=>`<tr><td>${escapeHtml(x.name)}</td><td>${money(x.amount)}</td></tr>`).join("")}
  `;
}

function renderKpis(res){
  const baseAnnual = res.baseMonthly * 12;
  const monthlyAllowAnnual = res.monthlyAllowanceSum * 12;
  const yearlyAllow = res.yearlyAllowanceSum;

  $("kpiBoxes").innerHTML = `
    <div class="kpi-card kpi-card--blue">
      <div class="kpi-title">월 실수령(추정)</div>
      <div class="kpi-value">${money(res.monthlyNet)}</div>
    </div>

    <div class="kpi-card kpi-card--green">
      <div class="kpi-title">연 실수령(추정)</div>
      <div class="kpi-value">${money(res.annualNet)}</div>
    </div>

    <div class="kpi-card kpi-card--gold">
      <div class="kpi-title">연 총지급(세전)</div>
      <div class="kpi-value">${money(res.annualGross)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">연 기본급</div>
      <div class="kpi-value">${money(baseAnnual)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">연 월수당 합계(×12)</div>
      <div class="kpi-value">${money(monthlyAllowAnnual)}</div>
    </div>

    <div class="kpi-card">
      <div class="kpi-title">연 수당 합계(연단위)</div>
      <div class="kpi-value">${money(yearlyAllow)}</div>
    </div>
  `;
}

function renderDeductionTable(d){
  const t = $("deductionTable");
  t.innerHTML = `
    <tr><th>항목</th><th>금액</th></tr>
    <tr><td>공제 대상 월급여(추정)</td><td>${money(d.contributableMonthly)}</td></tr>
    <tr><td>국민연금(본인 부담)</td><td>${money(d.nps)}</td></tr>
    <tr><td>건강보험(본인 부담)</td><td>${money(d.health)}</td></tr>
    <tr><td>장기요양보험</td><td>${money(d.ltc)}</td></tr>
    <tr><td>고용보험(본인 부담)</td><td>${money(d.employment)}</td></tr>
    <tr><td><b>월 4대보험 공제 합계</b></td><td><b>${money(d.monthlyDeductionSum)}</b></td></tr>
  `;
}

function renderTaxTable(tax){
  const t = $("taxTable");
  t.innerHTML = `
    <tr><th>항목</th><th>값</th></tr>
    <tr><td>공제대상가족수(본인 포함)</td><td>${tax.famCount}명</td></tr>
    <tr><td>과세 대상 월급여(추정)</td><td>${money(tax.taxableMonthlyWage)}</td></tr>
    <tr><td>소득세(간이세액표)</td><td>${money(tax.incomeTax)}</td></tr>
    <tr><td>지방소득세</td><td>${money(tax.localTax)}</td></tr>
    <tr><td><b>월 세금 합계</b></td><td><b>${money(tax.monthlyTaxSum)}</b></td></tr>
  `;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function buildNotice(){
  return [
    "• 본 결과는 인건비 가이드라인 및 입력값을 바탕으로 산출한 ‘추정’ 값입니다.",
    "• 4대보험은 설정된 요율/반올림 규칙을 적용한 추정치입니다.",
    "• 세금(소득세/지방소득세)은 TAX_TABLE(간이세액표) 기반 추정치입니다.",
    "• 지자체 추가수당, 기관 규정, 비과세 적용, 원천징수 방식 등에 따라 실제 지급액은 달라질 수 있습니다."
  ].join("\n");
}

/***********************
 * API 호출: Cloudflare Worker(fetch)만 사용 (JSONP 제거)
 ***********************/
async function apiInit(){
  const url = `${API_URL}/api/init`;
  const res = await fetch(url, { method: "GET" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || "init failed");
  return json.data;
}

async function apiCalc(input){
  const url = `${API_URL}/api/calc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.message || "calc failed");
  return json.result;
}

/***********************
 * 입력/수당 체크 렌더
 ***********************/
function buildAllowanceChecks(rules){
  const wrap = $("allowanceChecks");
  wrap.innerHTML = "";
  rules.forEach(r=>{
    const div = document.createElement("div");
    div.style.minWidth = "240px";
    div.innerHTML = `
      <label class="pill">
        <input type="checkbox" id="allow_${escapeHtml(r.code)}" ${r.enabledDefault ? "checked":""}/>
        <span>${escapeHtml(r.name)}</span>
        <span class="muted">(${r.unit === "yearly" ? "연" : "월"})</span>
      </label>`;
    wrap.appendChild(div);
  });
}

function getEnabledAllowances(){
  const enabled = {};
  (initData?.rules || []).forEach(r=>{
    enabled[r.code] = $(`allow_${r.code}`)?.checked || false;
  });
  return enabled;
}

/***********************
 * 시설/직급/호봉 옵션 연동
 ***********************/
function onFacilityChange(){
  const facility = $("facilityType").value;
  const grades = initData.payMeta.gradesByFacility[facility] || [];
  setOptions($("grade"), grades);
  onGradeChange();
}

function onGradeChange(){
  const facility = $("facilityType").value;
  const grade = $("grade").value;
  const maxStep = initData.payMeta.maxStepByFacGrade?.[facility]?.[grade] || 31;
  const steps = Array.from({length: maxStep}, (_,i)=>String(i+1));
  setOptions($("step"), steps);
}

/***********************
 * 계산
 ***********************/
async function onCalc(){
  setError("");
  setStatus("계산 중...");

  try {
    const input = {
      year: $("year").value,
      facilityType: $("facilityType").value,
      grade: $("grade").value,
      step: $("step").value,
      enabledAllowances: getEnabledAllowances(),
      includeDeductions: $("includeDeductions").checked,
      includeTax: $("includeTax").checked,
      nonTaxableMonthly: Number($("nonTaxableMonthly").value || 0),
      family: {
        spouse: $("spouse").checked,
        children: Number($("children").value || 0),
        otherDependents: Number($("otherDependents").value || 0),
      },
      overtime: {
        hours: Number($("overtimeHours").value || 0),
        kindMultiplier: Number($("overtimeKind").value || 1.5),
      }
    };

    const res = await apiCalc(input);
    lastResult = { input, res };

    // 화면 출력
    $("resultCard").style.display = "block";
    $("resultMeta").textContent = `${input.year} · ${input.facilityType} · ${input.grade} · ${input.step}호봉`;

    renderKpis(res);
    renderTable("monthlyTable", res.monthlyAllowances);
    renderTable("yearlyTable", res.yearlyAllowances);

    if (res.deductions) {
      $("deductionCard").style.display = "block";
      renderDeductionTable(res.deductions);
    } else {
      $("deductionCard").style.display = "none";
    }

    if (res.tax) {
      $("taxCard").style.display = "block";
      renderTaxTable(res.tax);
    } else {
      $("taxCard").style.display = "none";
    }

    $("noticeText").textContent = buildNotice();

    setStatus("완료");
    $("resultCard").scrollIntoView({ behavior:"smooth", block:"start" });

  } catch (e) {
    setStatus("");
    setError("조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.\n" + (e?.message || String(e)));
  }
}

/***********************
 * 사용자 친화 CSV 다운로드
 ***********************/
const DEDUCTION_LABELS = {
  contributableMonthly: "공제 대상 월급여(추정)",
  nps: "국민연금(본인 부담)",
  health: "건강보험(본인 부담)",
  ltc: "장기요양보험",
  employment: "고용보험(본인 부담)",
  monthlyDeductionSum: "월 4대보험 공제 합계"
};

const TAX_LABELS = {
  famCount: "공제 대상 가족 수(본인 포함)",
  taxableMonthlyWage: "과세 대상 월급여(추정)",
  incomeTax: "소득세(간이세액표)",
  localTax: "지방소득세",
  monthlyTaxSum: "월 세금 합계"
};

function csvEscape(v){
  const s = (v === null || v === undefined) ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function formatNumberForCsv(v){
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return csvEscape(v);
  return String(Math.round(n)); // 엑셀 숫자 인식(콤마 없이)
}
function buildFriendlyCsv(last){
  const { input, res } = last;
  const lines = [];
  lines.push("\uFEFF" + "인건비 조회 결과(사용자용)");
  lines.push("");

  lines.push("요약");
  [
    ["기준년도", input.year],
    ["근무시설 유형", input.facilityType],
    ["직급", input.grade],
    ["호봉", input.step + "호봉"],
  ].forEach(([k,v])=>lines.push(`${csvEscape(k)},${csvEscape(v)}`));
  lines.push("");

  lines.push("핵심 금액");
  lines.push("항목,금액(원)");
  [
    ["월 기본급", res.baseMonthly],
    ["월 수당 합계", res.monthlyAllowanceSum],
    ["연간 수당 합계", res.yearlyAllowanceSum],
    ["비과세 수당(월)", res.nonTaxableMonthly],
    ["월 총지급액(세전)", res.monthlyGross],
    ["연 총지급액(세전)", res.annualGross],
    ["월 실수령액(추정)", res.monthlyNet],
    ["연 실수령액(추정)", res.annualNet],
  ].forEach(([k,v])=>lines.push(`${csvEscape(k)},${formatNumberForCsv(v)}`));
  lines.push("");

  lines.push("월별 수당 내역");
  lines.push("수당 항목,금액(원)");
  (res.monthlyAllowances || []).forEach(a => lines.push(`${csvEscape(a.name)},${formatNumberForCsv(a.amount)}`));
  if (!res.monthlyAllowances || res.monthlyAllowances.length === 0) lines.push("해당 없음,0");
  lines.push("");

  lines.push("연간 수당 내역");
  lines.push("수당 항목,금액(원)");
  (res.yearlyAllowances || []).forEach(a => lines.push(`${csvEscape(a.name)},${formatNumberForCsv(a.amount)}`));
  if (!res.yearlyAllowances || res.yearlyAllowances.length === 0) lines.push("해당 없음,0");
  lines.push("");

  lines.push("4대보험 공제 내역 (월 기준 · 추정)");
  lines.push("항목,금액(원)");
  if (res.deductions){
    Object.keys(DEDUCTION_LABELS).forEach(k=>{
      if (res.deductions[k] === undefined) return;
      lines.push(`${csvEscape(DEDUCTION_LABELS[k])},${formatNumberForCsv(res.deductions[k])}`);
    });
  } else {
    lines.push("미포함(사용자 선택 해제),");
  }
  lines.push("");

  lines.push("소득세 및 지방소득세 (월 기준 · 추정)");
  lines.push("항목,값");
  if (res.tax){
    Object.keys(TAX_LABELS).forEach(k=>{
      if (res.tax[k] === undefined) return;
      lines.push(`${csvEscape(TAX_LABELS[k])},${formatNumberForCsv(res.tax[k])}`);
    });
  } else {
    lines.push("미포함(사용자 선택 해제),");
  }
  lines.push("");

  lines.push("안내");
  lines.push(csvEscape("※ 본 자료는 인건비 가이드라인 및 입력값/간이세액표를 기준으로 한 추정 금액입니다."));
  lines.push(csvEscape("※ 실제 지급액은 기관 규정, 개인별 세액, 비과세 적용, 지자체 수당, 근무 형태 등에 따라 달라질 수 있습니다."));
  return lines.join("\n");
}

function downloadCsv(){
  if (!lastResult) { alert("먼저 계산을 실행해주세요."); return; }
  const { input } = lastResult;

  const csv = buildFriendlyCsv(lastResult);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  const fileName = `${input.year}_${input.facilityType}_${input.grade}_${input.step}호봉_인건비(사용자용).csv`.replaceAll(" ", "");
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/***********************
 * 초기화
 ***********************/
async function init(){
  setError("");
  setStatus("초기 데이터 로딩 중...");

  try {
    initData = await apiInit();

    // year
    setOptions($("year"), initData.lookup?.year || ["2026"]);

    // facility types
    const facilityTypes =
      initData.payMeta?.facilityTypes ||
      initData.lookup?.facility_type ||
      [];
    setOptions($("facilityType"), facilityTypes);

    // allowance checks
    buildAllowanceChecks(initData.rules || []);

    // cascade
    $("facilityType").addEventListener("change", onFacilityChange);
    $("grade").addEventListener("change", onGradeChange);
    onFacilityChange();

    $("btnCalc").addEventListener("click", onCalc);
    $("btnDownload").addEventListener("click", downloadCsv);

    setStatus("준비 완료");
  } catch (e) {
    setStatus("");
    setError(
      "초기화 실패: " + (e?.message || String(e)) +
      "\n\n다음을 확인하세요:" +
      "\n1) API_URL(Worker URL)이 올바른지" +
      "\n2) Worker의 GAS_URL 환경변수가 올바른 Apps Script exec URL인지" +
      "\n3) Apps Script 웹앱이 '모든 사용자(익명 포함)'로 배포되었는지"
    );
  }
}

init();
