/***********************
 * 설정: Cloudflare Worker URL (A안)
 * - JSONP 제거 / PC 확장프로그램 이슈 해결
 ***********************/
const API_URL = "https://welfare-pay-api.gubossi.workers.dev";

let initData = null;
let lastResult = null;

window.WelmoaAnalytics?.configure({
  toolId: "salary",
  toolName: "salary_calculator",
  toolVersion: "1.0"
});

/***********************
 * UI 유틸
 ***********************/
const $ = (id) => document.getElementById(id);

function setStatus(msg){ $("status").textContent = msg || ""; }
function setError(msg){ $("error").textContent = msg || ""; }

function getPayStandard(){
  return document.querySelector('input[name="payStandard"]:checked')?.value || "MOHW";
}

function setOptions(el, arr){
  el.innerHTML = "";
  (arr || []).forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function money(n){ return Number(n || 0).toLocaleString("ko-KR") + "원"; }

function renderTable(tableId, items){
  const t = $(tableId);
  if (!items || items.length === 0){
    t.innerHTML = `<tr><td class="muted">해당 없음</td></tr>`;
    return;
  }
  t.innerHTML = `
    <tr><th>항목</th><th>금액</th></tr>
    ${items.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.amount)}</td></tr>`).join("")}
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

function buildNotice(res){
  return [
    "• 본 결과는 인건비 가이드라인 및 입력값을 바탕으로 산출한 ‘추정’ 값입니다.",
    "• 기타 수당은 사용자가 직접 입력한 월 기준 금액을 반영합니다.",
    "• 4대보험은 설정된 요율/반올림 규칙을 적용한 추정치입니다.",
    "• 세금(소득세/지방소득세)은 TAX_TABLE(간이세액표) 기반 추정치입니다.",
    "• 지자체 추가수당, 기관 규정, 비과세 적용, 원천징수 방식 등에 따라 실제 지급액은 달라질 수 있습니다.",
    ...(res?.calculationNotes || []).map(note => `• ${note}`)
  ].join("\n");
}

/***********************
 * API 호출: Cloudflare Worker(fetch)만 사용
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
  const activeRules = getPayStandard() === "SEOUL"
    ? [
        { code: "HOLIDAY", name: "명절휴가비", unit: "yearly", enabledDefault: true },
        { code: "FAMILY", name: "가족수당", unit: "monthly", enabledDefault: true }
      ]
    : rules;
  activeRules.forEach(r => {
    const div = document.createElement("div");
    div.style.minWidth = "240px";
    div.innerHTML = `
      <label class="pill">
        <input type="checkbox" id="allow_${escapeHtml(r.code)}" ${r.enabledDefault ? "checked" : ""}/>
        <span>${escapeHtml(r.name)}</span>
        <span class="muted">(${r.unit === "yearly" ? "연" : "월"})</span>
      </label>`;
    wrap.appendChild(div);
  });
}

const OVERTIME_TYPES = [
  { enabledId: "overtimeExtendedEnabled", hoursId: "overtimeExtendedHours", wrapId: "overtimeExtendedHoursWrap", code: "EXTENDED_NIGHT", name: "연장·야간근무", multiplier: 1.5 },
  { enabledId: "overtimeHolidayWithinEnabled", hoursId: "overtimeHolidayWithinHours", wrapId: "overtimeHolidayWithinHoursWrap", code: "HOLIDAY_WITHIN_8", name: "휴일근무 8시간 이내", multiplier: 1.5 },
  { enabledId: "overtimeHolidayOverEnabled", hoursId: "overtimeHolidayOverHours", wrapId: "overtimeHolidayOverHoursWrap", code: "HOLIDAY_OVER_8", name: "휴일근무 8시간 초과분", multiplier: 2 }
];

function getOvertimeEntries(){
  return OVERTIME_TYPES.map(type => ({
    code: type.code,
    name: type.name,
    multiplier: type.multiplier,
    hours: $(type.enabledId)?.checked ? Math.max(0, Number($(type.hoursId)?.value || 0)) : 0
  })).filter(entry => entry.hours > 0);
}

function getTotalOvertimeHours(){
  return getOvertimeEntries().reduce((sum, entry) => sum + entry.hours, 0);
}

function updateOvertimeUi(){
  OVERTIME_TYPES.forEach(type => {
    const checked = Boolean($(type.enabledId)?.checked);
    $(type.wrapId)?.classList.toggle("is-hidden", !checked);
    if (!checked && $(type.hoursId)) $(type.hoursId).value = "0";
  });

  const totalHours = getTotalOvertimeHours();
  const isSeoul = getPayStandard() === "SEOUL";
  const cap = $("overtimeWorkerType")?.value === "shift" ? 40 : 15;
  $("overtimeWorkerTypeWrap")?.classList.toggle("is-hidden", !(isSeoul && totalHours > 0));

  if (totalHours <= 0) {
    $("overtimeSummary").textContent = "시간외근무 유형을 선택하면 시간 입력란이 표시됩니다.";
  } else if (isSeoul && totalHours > cap) {
    $("overtimeSummary").textContent = `총 입력 ${totalHours}시간 · 인정 ${cap}시간 · 상한 초과 ${totalHours - cap}시간`;
  } else if (isSeoul) {
    $("overtimeSummary").textContent = `총 입력 ${totalHours}시간 · 서울시 인정 상한 ${cap}시간`;
  } else {
    $("overtimeSummary").textContent = `총 시간외근무 ${totalHours}시간`;
  }
}

function getEnabledAllowances(){
  const enabled = {};
  document.querySelectorAll('#allowanceChecks input[id^="allow_"]').forEach(el => {
    const code = el.id.replace("allow_", "");
    enabled[code] = el.checked;
  });
  (initData?.rules || []).forEach(r => {
    if (enabled[r.code] !== undefined) return;
    enabled[r.code] = $(`allow_${r.code}`)?.checked || false;
  });
  if (getPayStandard() === "SEOUL") {
    enabled.OT = getTotalOvertimeHours() > 0;
  }
  return enabled;
}

/***********************
 * 시설/직급/호봉 옵션 연동
 ***********************/
function onFacilityChange(){
  const standard = getPayStandard();
  const facility = $("facilityType").value;
  const meta = standard === "SEOUL"
    ? initData.regionalPayMeta?.SEOUL
    : initData.payMeta;
  const grades = [...(meta?.gradesByFacility?.[facility] || [])];
  const gradeOrderByFacility = standard === "SEOUL"
    ? { [facility]: ["1급", "2급", "3급", "4급", "5급", "관리직", "기능직"] }
    : {
        "생활시설": ["원장", "사무국장", "과장/생활복지사", "선임생활지도원", "생활지도원_1", "생활지도원_2", "생활지도원_3", "관리직", "기능직"],
        "이용시설_사회복지직": ["관장", "부장", "과장", "선임사회복지사", "사회복지사"],
        "이용시설_일반직": ["관장", "사무국장", "1급", "2급", "3급", "4급", "5급"],
        "이용시설_관리직": ["1급", "2급", "3급", "4급"],
        "이용시설_사무직": ["1급", "2급", "3급", "4급"],
        "이용시설_의료직": ["1급", "2급", "3급", "4급"]
      };
  const gradeOrder = gradeOrderByFacility[facility] || [];
  grades.sort((a, b) => {
    const ai = gradeOrder.indexOf(a);
    const bi = gradeOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, "ko");
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  setOptions($("grade"), grades);
  onGradeChange();
}

function onGradeChange(){
  const standard = getPayStandard();
  const facility = $("facilityType").value;
  const grade = $("grade").value;
  const regionalSteps = initData.regionalPayMeta?.SEOUL?.validStepsByFacGrade?.[facility]?.[grade];
  const maxStep = initData.payMeta?.maxStepByFacGrade?.[facility]?.[grade] || 31;
  const steps = standard === "SEOUL" && regionalSteps?.length
    ? regionalSteps.map(String)
    : Array.from({ length: maxStep }, (_, i) => String(i + 1));
  setOptions($("step"), steps);
  updateConditionalSeoulFields();
}

function updateConditionalSeoulFields(){
  const isSeoul = getPayStandard() === "SEOUL";
  const grade = $("grade")?.value || "";
  const canBeFacilityHead = isSeoul && ["1급", "2급"].includes(grade);

  $("seoulFacilityHeadWrap").classList.toggle("is-hidden", !canBeFacilityHead);
  updateOvertimeUi();

  if (!canBeFacilityHead && $("managerAllowance")) {
    $("managerAllowance").checked = false;
  }
}

function onPayStandardChange(){
  const standard = getPayStandard();
  const isSeoul = standard === "SEOUL";
  const meta = isSeoul ? initData.regionalPayMeta?.SEOUL : initData.payMeta;
  const years = isSeoul ? (meta?.years || ["2026"]) : (initData.lookup?.year || ["2026"]);
  const facilities = meta?.facilityTypes || initData.lookup?.facility_type || [];

  setOptions($("year"), years);
  setOptions($("facilityType"), facilities);
  $("seoulExtraOptions").classList.toggle("is-hidden", !isSeoul);
  $("seoulExtraOptions").open = false;
  $("payStandardHelp").textContent = isSeoul
    ? "2026년 서울시 사회복지시설 종사자 인건비 가이드라인을 적용합니다."
    : "시설 유형별 보건복지부 인건비 가이드라인을 적용합니다.";
  buildAllowanceChecks(initData.rules || []);
  onFacilityChange();
  updateConditionalSeoulFields();
}

/***********************
 * 계산
 ***********************/
async function onCalc(){
  setError("");
  setStatus("계산 중...");

  window.WelmoaAnalytics?.start({
    tool_action: "calculate"
  });

  try {
    const managerAllowance = $("managerAllowance")?.checked || false;
    const input = {
      payStandard: getPayStandard(),
      year: $("year").value,
      facilityType: $("facilityType").value,
      grade: $("grade").value,
      step: $("step").value,
      enabledAllowances: getEnabledAllowances(),
      includeDeductions: $("includeDeductions").checked,
      includeTax: $("includeTax").checked,
      nonTaxableMonthly: Number($("nonTaxableMonthly").value || 0),
      otherAllowance: Number($("otherAllowance")?.value || 0),
      adjustmentAllowance: Number($("adjustmentAllowance")?.value || 0),
      managerAllowance,
      isFacilityHead: managerAllowance,
      family: {
        spouse: $("spouse").checked,
        children: Number($("children").value || 0),
        otherDependents: Number($("otherDependents").value || 0),
      },
      overtime: {
        entries: getOvertimeEntries(),
        hours: getTotalOvertimeHours(),
        workerType: $("overtimeWorkerType")?.value || "general",
      }
    };

    const res = await apiCalc(input);
    lastResult = { input, res };

    $("resultCard").style.display = "block";
    const standardName = input.payStandard === "SEOUL" ? "서울시 기준" : "보건복지부 기준";
    $("resultMeta").textContent = `${standardName} · ${input.year} · ${input.facilityType} · ${input.grade} · ${input.step}호봉`;

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

    $("noticeText").textContent = buildNotice(res);

    setStatus("완료");

    const analyticsParams = {
      tool_action: "calculate",
      pay_standard: input.payStandard,
      year: input.year,
      facility_type: input.facilityType,
      grade: input.grade,
      step: input.step,
      include_deductions: input.includeDeductions,
      include_tax: input.includeTax,
      has_overtime: input.overtime.hours > 0
    };

    window.WelmoaAnalytics?.complete(analyticsParams);

    // Backward compatibility: keep the legacy event during the migration window.
    window.WelmoaAnalytics?.legacy("salary_calculate", {
      tool: "salary",
      pay_standard: input.payStandard,
      year: input.year,
      facility_type: input.facilityType,
      grade: input.grade,
      step: input.step,
      include_deductions: input.includeDeductions,
      include_tax: input.includeTax,
      overtime_hours: input.overtime.hours
    });

    $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });

  } catch (e) {
    window.WelmoaAnalytics?.error({
      tool_action: "calculate",
      error_code: "calculation_failed",
      error_message: e?.message || String(e)
    });
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
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatNumberForCsv(v){
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return csvEscape(v);
  return String(Math.round(n));
}

function buildFriendlyCsv(last){
  const { input, res } = last;
  const lines = [];
  lines.push("\uFEFF" + "인건비 조회 결과(사용자용)");
  lines.push("");

  lines.push("요약");
  [
    ["급여 기준", input.payStandard === "SEOUL" ? "서울시 기준" : "보건복지부 기준"],
    ["기준년도", input.year],
    ["근무시설 유형", input.facilityType],
    ["직급", input.grade],
    ["호봉", input.step + "호봉"],
  ].forEach(([k, v]) => lines.push(`${csvEscape(k)},${csvEscape(v)}`));
  lines.push("");

  lines.push("핵심 금액");
  lines.push("항목,금액(원)");
  [
    ["월 기본급", res.baseMonthly],
    ["월 수당 합계", res.monthlyAllowanceSum],
    ["기타 수당", input.otherAllowance || 0],
    ["연간 수당 합계", res.yearlyAllowanceSum],
    ["비과세 수당(월)", res.nonTaxableMonthly],
    ["월 총지급액(세전)", res.monthlyGross],
    ["연 총지급액(세전)", res.annualGross],
    ["월 실수령액(추정)", res.monthlyNet],
    ["연 실수령액(추정)", res.annualNet],
  ].forEach(([k, v]) => lines.push(`${csvEscape(k)},${formatNumberForCsv(v)}`));
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
    Object.keys(DEDUCTION_LABELS).forEach(k => {
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
    Object.keys(TAX_LABELS).forEach(k => {
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
  if (!lastResult) {
    alert("먼저 계산을 실행해주세요.");
    return;
  }

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

  // ⭐ GA4 이벤트
  if (typeof gtag === "function") {
    gtag("event", "salary_csv_download", {
      year: input.year,
      facility_type: input.facilityType,
      grade: input.grade,
      step: input.step
    });
  }
}

/***********************
 * 초기화
 ***********************/
async function init(){
  setError("");
  setStatus("초기 데이터 로딩 중...");

  try {
    initData = await apiInit();

    // 구버전 API 응답에서도 기존 보건복지부 계산은 계속 동작한다.
    initData.regionalPayMeta = initData.regionalPayMeta || {};

    $("facilityType").addEventListener("change", onFacilityChange);
    $("grade").addEventListener("change", onGradeChange);
    OVERTIME_TYPES.forEach(type => {
      $(type.enabledId).addEventListener("change", updateOvertimeUi);
      $(type.hoursId).addEventListener("input", updateOvertimeUi);
    });
    $("overtimeWorkerType").addEventListener("change", updateOvertimeUi);
    document.querySelectorAll('input[name="payStandard"]').forEach(el => {
      el.addEventListener("change", onPayStandardChange);
    });
    onPayStandardChange();

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
