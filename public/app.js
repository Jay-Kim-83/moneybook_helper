let DB = { banks: [], cards: [], fixedExpenses: [], monthly: [] };

const api = async (method, url, body) => {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
        location.href = "/login.html";
        throw new Error("로그인이 필요합니다");
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "요청 실패");
    return res.json();
};

const won = (n) => `${new Intl.NumberFormat("ko-KR").format(Number(n) || 0)}원`;

const toNum = (v) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;

const comma = (v) => {
    const s = String(v ?? "");
    const neg = /^\s*-/.test(s) ? "-" : "";
    const digits = s.replace(/[^\d]/g, "");
    return digits ? neg + Number(digits).toLocaleString("ko-KR") : neg;
};

function formatMoneyInput(el) {
    const digitsBeforeCaret = el.value.slice(0, el.selectionStart).replace(/[^\d]/g, "").length;
    el.value = comma(el.value);
    let pos = 0, seen = 0;
    while (pos < el.value.length && seen < digitsBeforeCaret) {
        if (el.value.charCodeAt(pos) >= 48 && el.value.charCodeAt(pos) <= 57) seen++;
        pos++;
    }
    if (pos === 0 && el.value.startsWith("-")) pos = 1;
    el.setSelectionRange(pos, pos);
}

const last4 = (n) => (n ? `•••• ${n}` : "-");

const bankName = (id) => DB.banks.find((b) => b.id === id)?.name || "미지정";

const toast = (icon, title) =>
    Swal.fire({ toast: true, position: "top-end", icon, title, showConfirmButton: false, timer: 2000, timerProgressBar: true });

const confirmDelete = async (text) =>
    (
        await Swal.fire({
            title: "삭제하시겠습니까?",
            text,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "삭제",
            cancelButtonText: "취소",
            confirmButtonColor: "#dc2626",
        })
    ).isConfirmed;

const formModal = async ({ title, fields, values = {} }) => {
    const html = fields
        .map((f) => {
            const v = values[f.name] ?? "";
            const label = `<label class="block text-left text-sm font-medium text-slate-600 mt-3 mb-1">${f.label}</label>`;
            if (f.type === "select") {
                const opts = f.options.map((o) => `<option value="${o.value}" ${o.value === v ? "selected" : ""}>${o.label}</option>`).join("");
                return `${label}<select id="f_${f.name}" class="swal2-input !m-0 !w-full !flex">${opts}</select>`;
            }
            if (f.type === "number") {
                return `${label}<input id="f_${f.name}" type="text" inputmode="numeric" value="${comma(v)}" placeholder="${f.label}" oninput="formatMoneyInput(this)" class="swal2-input !m-0 !w-full" />`;
            }
            return `${label}<input id="f_${f.name}" type="${f.type || "text"}" value="${v}" placeholder="${f.label}" class="swal2-input !m-0 !w-full" />`;
        })
        .join("");
    const { value } = await Swal.fire({
        title,
        html: `<div class="text-left">${html}</div>`,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: "저장",
        cancelButtonText: "취소",
        confirmButtonColor: "#4f46e5",
        didOpen: () => {
            document.getElementById(`f_${fields[0].name}`)?.focus();
            document.querySelectorAll("[id^='f_']").forEach((el) => {
                if (el.tagName === "INPUT")
                    el.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            Swal.clickConfirm();
                        }
                    });
            });
        },
        preConfirm: () => {
            const result = {};
            for (const f of fields) {
                const el = document.getElementById(`f_${f.name}`);
                const raw = el.value.trim();
                if (f.required && !raw) {
                    Swal.showValidationMessage(`${f.label}을(를) 입력하세요`);
                    return false;
                }
                result[f.name] = f.type === "number" ? toNum(raw) : raw;
            }
            return result;
        },
    });
    return value;
};

const bankOptions = () => DB.banks.map((b) => ({ value: b.id, label: b.name }));

const card = (inner) => `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">${inner}</div>`;

const sectionHeader = (title, btnLabel, onClick, resetFn = "") =>
    `<div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-700">${title}</h2>
        <div class="flex items-center gap-3">
            ${resetFn ? `<button onclick="${resetFn}" class="text-xs text-slate-400 hover:text-red-500 hover:underline">🗑️ 초기화</button>` : ""}
            <button onclick="${onClick}" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">${btnLabel}</button>
        </div>
    </div>`;

async function confirmReset(title, lines) {
    const { value } = await Swal.fire({
        title,
        html: `<div class="text-left text-sm text-slate-600">
            ${lines.map((l) => `<p class="py-0.5">• ${l}</p>`).join("")}
            <p class="mt-3 text-red-600 font-bold">이 작업은 되돌릴 수 없습니다.<br>계속하려면 아래에 <u>초기화</u>를 입력하세요.</p>
        </div>`,
        input: "text",
        inputPlaceholder: "초기화",
        showCancelButton: true,
        confirmButtonText: "초기화 실행",
        cancelButtonText: "취소",
        confirmButtonColor: "#dc2626",
    });
    if (value === undefined) return false;
    if (value !== "초기화") {
        if (value !== "") toast("error", "'초기화'를 정확히 입력해야 실행됩니다");
        return false;
    }
    return true;
}

async function resetBanks() {
    if (!(await confirmReset("은행 데이터 초기화", [
        `등록된 은행 ${DB.banks.length}개가 모두 삭제됩니다.`,
        "은행에 연결된 카드·고정 지출도 함께 삭제됩니다.",
        "이체 설정(순서·남길 금액·고정 이체)도 사라집니다.",
        "저장된 월별 기록·거래 내역은 남지만 은행명이 '미지정'으로 표시됩니다.",
    ]))) return;
    for (const b of [...DB.banks]) await api("DELETE", `/api/banks/${b.id}`);
    await reload();
    toast("success", "은행 데이터가 초기화되었습니다");
}

async function resetCards() {
    if (!(await confirmReset("카드 데이터 초기화", [
        `등록된 카드 ${DB.cards.length}개가 모두 삭제됩니다.`,
        "카드 결제 입력·카드 사용 현황에서 해당 카드가 사라집니다.",
        "저장된 월별 기록의 카드 결제액은 남지만 '삭제된 카드'로 표시됩니다.",
    ]))) return;
    for (const c of [...DB.cards]) await api("DELETE", `/api/cards/${c.id}`);
    await reload();
    toast("success", "카드 데이터가 초기화되었습니다");
}

async function resetFixed() {
    if (!(await confirmReset("고정 지출 초기화", [
        `등록된 고정 지출 ${DB.fixedExpenses.length}개가 모두 삭제됩니다.`,
        "다음 기간부터 카드 외 지출 자동 등록이 되지 않습니다.",
        "이미 저장된 월별 기록의 지출 내역은 그대로 유지됩니다.",
    ]))) return;
    for (const e of [...DB.fixedExpenses]) await api("DELETE", `/api/fixedExpenses/${e.id}`);
    await reload();
    toast("success", "고정 지출이 초기화되었습니다");
}

async function resetLedger() {
    if (!(await confirmReset("거래·수집 데이터 초기화", [
        "문자로 수집된 거래 내역 전체가 삭제됩니다 (모든 기간).",
        "은행별 현재 잔액(수집·직접 입력)이 모두 지워집니다.",
        "카드사 누적·결제 예정 수집값도 초기화됩니다.",
        "월별 결제 기록(이번달 결제·이력)과 은행·카드 정보는 유지됩니다.",
        "이후 새 문자가 오면 다시 수집됩니다.",
    ]))) return;
    await api("DELETE", "/api/transactions");
    await reload();
    renderLedger();
    toast("success", "거래·수집 데이터가 초기화되었습니다");
}

async function resetMonthly() {
    const p = cyclePeriod(selectedMonth, cycleDay());
    if (!(await confirmReset("이 기간 기록 초기화", [
        `${p.start.replace(/-/g, ".")} ~ ${p.end.replace(/-/g, ".")} (${selectedMonth}) 기록이 삭제됩니다.`,
        "입력한 은행 잔액·카드 결제·카드 외 지출이 지워집니다.",
        "이체 플랜 체크 상태와 이체 로그도 함께 삭제됩니다.",
        "수집된 거래 내역과 다른 기간 기록은 유지됩니다.",
    ]))) return;
    await api("DELETE", `/api/monthly/${selectedMonth}`);
    renderMonthly();
    toast("success", "이 기간 기록이 초기화되었습니다");
}

async function resetHistory() {
    const records = await api("GET", "/api/monthly");
    if (!records.length) return toast("info", "삭제할 기록이 없습니다");
    if (!(await confirmReset("결제 이력 전체 초기화", [
        `저장된 기간 기록 ${records.length}개가 모두 삭제됩니다.`,
        "각 기록의 잔액·카드 결제·지출·이체 플랜·로그가 지워집니다.",
        "수집된 거래 내역과 은행·카드 정보는 유지됩니다.",
    ]))) return;
    for (const r of records) await api("DELETE", `/api/monthly/${r.month}`);
    renderHistory();
    toast("success", "결제 이력이 초기화되었습니다");
}

const emptyState = (msg) => `<p class="text-center text-slate-400 py-10">${msg}</p>`;

const reload = async () => {
    DB = await api("GET", "/api/data");
    renderAll();
};

const SECRET_FIELDS = {
    bank: [
        { name: "accountNo", label: "계좌번호", required: true },
        { name: "hint", label: "힌트 (평문 저장 — 예: 급여 통장)" },
    ],
    card: [
        { name: "cardNo", label: "카드번호", required: true },
        { name: "cvc", label: "CVC" },
        { name: "expiry", label: "만료 (MM/YY)" },
        { name: "hint", label: "힌트 (평문 저장)" },
    ],
};
const SECRET_LABELS = { accountNo: "계좌번호", cardNo: "카드번호", cvc: "CVC", expiry: "만료" };

const secretName = (type, id) => (type === "bank" ? bankName(id) : DB.cards.find((c) => c.id === id)?.company || "카드");

async function secretOpen(type, id) {
    const name = secretName(type, id);
    const meta = DB.secrets?.[id];
    if (!meta?.has) return secretEdit(type, id);
    const { isConfirmed, isDenied } = await Swal.fire({
        title: `🔒 ${name} 보안 정보`,
        html: `<div class="text-left text-sm">
            <p class="text-slate-600">힌트: <b>${meta.hint || "(없음)"}</b></p>
            <p class="text-xs text-slate-400 mt-2">암호화되어 저장되어 있습니다. [보기]를 누르면 복호화해 표시합니다.</p>
            <button onclick="secretDelete('${type}', '${id}')" class="mt-3 text-xs text-red-500 hover:underline">🗑️ 저장된 보안 정보 삭제</button>
        </div>`,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: "보기",
        denyButtonText: "수정",
        cancelButtonText: "닫기",
        confirmButtonColor: "#4f46e5",
        denyButtonColor: "#64748b",
    });
    if (isDenied) return secretEdit(type, id);
    if (!isConfirmed) return;
    try {
        const r = await api("POST", `/api/secrets/${id}/reveal`);
        window._secretVals = r.fields;
        const rows = Object.entries(r.fields)
            .filter(([, v]) => v)
            .map(
                ([k, v]) => `<div class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100">
                <span class="text-slate-500 text-sm shrink-0">${SECRET_LABELS[k] || k}</span>
                <span class="font-mono text-slate-800 tabular-nums">${v}</span>
                <button onclick="copySecret('${k}')" class="text-xs text-indigo-600 hover:underline shrink-0">복사</button>
            </div>`
            )
            .join("");
        await Swal.fire({
            title: `🔒 ${name}`,
            html: `<div class="text-left">${rows}<p class="text-xs text-slate-400 mt-3">창을 닫으면 화면에서 사라집니다.</p></div>`,
            confirmButtonText: "닫기",
            confirmButtonColor: "#4f46e5",
        });
        window._secretVals = null;
    } catch (e) {
        toast("error", e.message);
    }
}

async function secretEdit(type, id) {
    const name = secretName(type, id);
    const meta = DB.secrets?.[id];
    let values = { hint: meta?.hint || "" };
    if (meta?.has) {
        try {
            const r = await api("POST", `/api/secrets/${id}/reveal`);
            values = { ...r.fields, hint: r.hint };
        } catch {}
    }
    const v = await formModal({ title: `🔒 ${name} 보안 정보 ${meta?.has ? "수정" : "등록"}`, fields: SECRET_FIELDS[type], values });
    if (!v) return;
    await api("PUT", `/api/secrets/${id}`, v);
    await reload();
    toast("success", "암호화되어 저장되었습니다");
}

async function secretDelete(type, id) {
    Swal.close();
    if (!(await confirmDelete("저장된 보안 정보를 삭제합니다."))) return;
    await api("DELETE", `/api/secrets/${id}`);
    await reload();
    toast("success", "보안 정보가 삭제되었습니다");
}

async function copySecret(k) {
    const v = window._secretVals?.[k];
    if (v == null) return;
    try {
        await navigator.clipboard.writeText(String(v));
        toast("success", "복사되었습니다");
    } catch {
        toast("error", "복사 실패");
    }
}

const relayChain = () => DB.banks.filter((b) => !b.relayExclude);

const relayBadges = (b) => {
    const tag = (text, cls) => `<span class="inline-block text-xs px-2 py-0.5 rounded ${cls}">${text}</span>`;
    if (b.relayExclude) return tag("🚫 릴레이 제외", "bg-slate-100 text-slate-500");
    const chain = relayChain();
    const next = chain[chain.findIndex((x) => x.id === b.id) + 1];
    const target =
        b.relayTarget === "none" ? "보유 (이체 안 함)" : b.relayTarget ? `${bankName(b.relayTarget)} 이체` : next ? `${next.name} 이체 (자동)` : "보유 (마지막)";
    const badges = [tag(`➡ ${target}`, "bg-indigo-50 text-indigo-700")];
    if (Number(b.retainAmount)) badges.push(tag(`남김 ${won(b.retainAmount)}`, "bg-emerald-50 text-emerald-700"));
    if (b.fixedTransfers?.length) badges.push(tag(`고정: ${b.fixedTransfers.map((t) => `${bankName(t.bankId)} ${won(t.amount)}`).join(" · ")}`, "bg-amber-50 text-amber-700"));
    return badges.join(" ");
};

function renderBanks() {
    const chain = relayChain();
    const list = DB.banks.length
        ? DB.banks
              .map((b, i) => {
                  const order = chain.findIndex((x) => x.id === b.id);
                  return `<div draggable="true" data-bank-id="${b.id}" ondragstart="onBankDragStart('${b.id}')" ondragover="event.preventDefault()" ondrop="onBankDrop(event, '${b.id}')">
            ${card(`
            <div class="flex items-start justify-between">
                <div class="flex items-start gap-2">
                    <span class="cursor-move text-slate-300 select-none pt-0.5" title="드래그해서 순서 변경">⠿</span>
                    <div>
                        <p class="font-bold text-slate-800">
                            ${order >= 0 ? `<span class="inline-flex items-center justify-center w-5 h-5 mr-1 rounded-full bg-indigo-600 text-white text-xs">${order + 1}</span>` : ""}
                            ${b.name}${b.alias ? ` <span class="text-sm font-normal text-slate-400">(${b.alias})</span>` : ""}
                        </p>
                        <p class="text-sm text-slate-500 mt-1">계좌 끝 4자리: ${last4(b.accountLast4)}</p>
                        <div class="mt-2 flex flex-wrap gap-1">${relayBadges(b)}</div>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    <button onclick="moveBank('${b.id}', -1)" class="text-slate-400 hover:text-indigo-600 text-sm ${i === 0 ? "invisible" : ""}">▲</button>
                    <button onclick="moveBank('${b.id}', 1)" class="text-slate-400 hover:text-indigo-600 text-sm ${i === DB.banks.length - 1 ? "invisible" : ""}">▼</button>
                    <button onclick="secretOpen('bank', '${b.id}')" title="계좌번호 보안 저장" class="text-sm ${DB.secrets?.[b.id]?.has ? "text-amber-500" : "text-slate-300"} hover:text-amber-600">🔒</button>
                    <button onclick="relaySettings('${b.id}')" class="text-emerald-600 hover:underline text-sm">이체 설정</button>
                    <button onclick="editBank('${b.id}')" class="text-indigo-600 hover:underline text-sm">수정</button>
                    <button onclick="deleteBank('${b.id}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>`)}
        </div>`;
              })
              .join("")
        : emptyState("등록된 은행이 없습니다. 은행을 추가해 주세요.");
    document.getElementById("tab-banks").innerHTML =
        sectionHeader("나의 은행", "+ 은행 추가", "saveBank()", DB.banks.length ? "resetBanks()" : "") +
        `<p class="text-xs text-slate-400 -mt-2 mb-3">카드를 드래그하거나 ▲▼로 순서를 바꾸면 이체 릴레이·이번달 결제 순서가 함께 바뀝니다.</p>
        <div class="grid gap-3 md:grid-cols-2">${list}</div>`;
}

let dragBankId = null;

const onBankDragStart = (id) => (dragBankId = id);

async function persistBankOrder(ids) {
    await api("POST", "/api/banks/reorder", { ids });
    await reload();
}

async function onBankDrop(e, targetId) {
    e.preventDefault();
    if (!dragBankId || dragBankId === targetId) return;
    const ids = DB.banks.map((b) => b.id);
    ids.splice(ids.indexOf(targetId), 0, ids.splice(ids.indexOf(dragBankId), 1)[0]);
    dragBankId = null;
    await persistBankOrder(ids);
}

async function moveBank(id, dir) {
    const ids = DB.banks.map((b) => b.id);
    const i = ids.indexOf(id), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await persistBankOrder(ids);
}

const fixedRowHtml = (bankId, t = {}) => {
    const opts = DB.banks
        .filter((x) => x.id !== bankId)
        .map((x) => `<option value="${x.id}" ${x.id === t.bankId ? "selected" : ""}>${x.name}</option>`)
        .join("");
    return `<div class="ftRow flex items-center gap-2 mt-2">
        <select class="ftBank swal2-input !m-0 !flex !flex-1">${opts}</select>
        <input class="ftAmount swal2-input !m-0 !w-32 text-right" type="text" inputmode="numeric" value="${comma(t.amount ?? "")}" placeholder="금액" oninput="formatMoneyInput(this)" />
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 text-sm px-1">✕</button>
    </div>`;
};

const addFixedRow = (bankId) => document.getElementById("ftList").insertAdjacentHTML("beforeend", fixedRowHtml(bankId));

async function relaySettings(id) {
    const b = DB.banks.find((x) => x.id === id);
    const targetOpts = [
        { value: "", label: "자동 (다음 순서 은행)" },
        { value: "none", label: "보유 (이체 안 함 — 최종 도착지)" },
        ...DB.banks.filter((x) => x.id !== id).map((x) => ({ value: x.id, label: x.name })),
    ]
        .map((o) => `<option value="${o.value}" ${o.value === (b.relayTarget || "") ? "selected" : ""}>${o.label}</option>`)
        .join("");
    const { value: v } = await Swal.fire({
        title: `${b.name} 이체 설정`,
        html: `<div class="text-left text-sm">
            <label class="flex items-center gap-2 mt-1 cursor-pointer"><input id="r_exclude" type="checkbox" ${b.relayExclude ? "checked" : ""} class="w-4 h-4 accent-indigo-600" /> 이체 릴레이에서 제외</label>
            <label class="block font-medium text-slate-600 mt-4 mb-1">남는 돈 이체 대상</label>
            <select id="r_target" class="swal2-input !m-0 !w-full !flex">${targetOpts}</select>
            <label class="block font-medium text-slate-600 mt-3 mb-1">남길 금액 <span class="text-xs font-normal text-slate-400">(카드값·카드외지출 외에 추가로 남길 돈)</span></label>
            <input id="r_retain" type="text" inputmode="numeric" value="${comma(b.retainAmount || "")}" placeholder="0" oninput="formatMoneyInput(this)" class="swal2-input !m-0 !w-full text-right" />
            <div class="flex items-center justify-between mt-4 mb-1">
                <span class="font-medium text-slate-600">고정 이체 <span class="text-xs font-normal text-slate-400">(남는 돈과 별개로 무조건 송금)</span></span>
                <button type="button" onclick="addFixedRow('${b.id}')" class="text-indigo-600 text-xs hover:underline">+ 추가</button>
            </div>
            <div id="ftList">${(b.fixedTransfers || []).map((t) => fixedRowHtml(b.id, t)).join("")}</div>
        </div>`,
        showCancelButton: true,
        confirmButtonText: "저장",
        cancelButtonText: "취소",
        confirmButtonColor: "#4f46e5",
        didOpen: () => {
            document.querySelectorAll("#r_retain, .ftAmount").forEach((el) =>
                el.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        Swal.clickConfirm();
                    }
                })
            );
        },
        preConfirm: () => ({
            relayExclude: document.getElementById("r_exclude").checked,
            relayTarget: document.getElementById("r_target").value,
            retainAmount: toNum(document.getElementById("r_retain").value),
            fixedTransfers: [...document.querySelectorAll("#ftList .ftRow")]
                .map((r) => ({ bankId: r.querySelector(".ftBank").value, amount: toNum(r.querySelector(".ftAmount").value) }))
                .filter((t) => t.bankId && t.amount > 0),
        }),
    });
    if (!v) return;
    await api("PUT", `/api/banks/${id}`, v);
    await reload();
    toast("success", "이체 설정이 저장되었습니다");
}

const bankFields = () => [
    { name: "name", label: "은행명", required: true },
    { name: "alias", label: "별칭 (예: 생활비 통장)" },
    { name: "accountLast4", label: "계좌 끝 4자리" },
];

async function saveBank() {
    const v = await formModal({ title: "은행 추가", fields: bankFields() });
    if (!v) return;
    await api("POST", "/api/banks", v);
    await reload();
    toast("success", "은행이 추가되었습니다");
}

async function editBank(id) {
    const bank = DB.banks.find((b) => b.id === id);
    const v = await formModal({ title: "은행 수정", fields: bankFields(), values: bank });
    if (!v) return;
    await api("PUT", `/api/banks/${id}`, v);
    await reload();
    toast("success", "은행이 수정되었습니다");
}

async function deleteBank(id) {
    const linked = DB.cards.filter((c) => c.bankId === id).length;
    const text = linked ? `연결된 카드 ${linked}개와 고정 지출도 함께 삭제됩니다.` : "되돌릴 수 없습니다.";
    if (!(await confirmDelete(text))) return;
    await api("DELETE", `/api/banks/${id}`);
    await reload();
    toast("success", "은행이 삭제되었습니다");
}

function renderCards() {
    const list = DB.cards.length
        ? DB.cards
              .map(
                  (c) => card(`
            <div class="flex items-start justify-between">
                <div>
                    <p class="font-bold text-slate-800">${c.company}${c.alias ? ` <span class="text-sm font-normal text-slate-400">(${c.alias})</span>` : ""}</p>
                    <p class="text-sm text-slate-500 mt-1">카드 끝 4자리: ${last4(c.cardLast4)}</p>
                    <span class="inline-block mt-2 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">🏦 ${bankName(c.bankId)}</span>
                    ${c.payDay ? `<span class="inline-block mt-2 ml-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">📅 매월 ${c.payDay}일 결제</span>` : ""}
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="secretOpen('card', '${c.id}')" title="카드번호 보안 저장" class="text-sm ${DB.secrets?.[c.id]?.has ? "text-amber-500" : "text-slate-300"} hover:text-amber-600">🔒</button>
                    <button onclick="editCard('${c.id}')" class="text-indigo-600 hover:underline text-sm">수정</button>
                    <button onclick="deleteCard('${c.id}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>`)
              )
              .join("")
        : emptyState("등록된 카드가 없습니다.");
    document.getElementById("tab-cards").innerHTML =
        sectionHeader("나의 카드", "+ 카드 추가", "saveCard()", DB.cards.length ? "resetCards()" : "") + `<div class="grid gap-3 md:grid-cols-2">${list}</div>`;
}

const cardFields = () => [
    { name: "company", label: "카드사", required: true },
    { name: "alias", label: "카드 별칭 (예: 주유 카드)" },
    { name: "cardLast4", label: "카드 끝 4자리" },
    { name: "bankId", label: "연결 은행", type: "select", options: bankOptions() },
    { name: "payDay", label: "결제일 (매월 며칠, 휴일이면 다음 영업일 출금)", type: "number" },
];

const requireBank = async () => {
    if (DB.banks.length) return true;
    await Swal.fire({ icon: "info", title: "은행을 먼저 등록하세요", text: "카드는 은행에 연결됩니다.", confirmButtonColor: "#4f46e5" });
    return false;
};

async function saveCard() {
    if (!(await requireBank())) return;
    const v = await formModal({ title: "카드 추가", fields: cardFields() });
    if (!v) return;
    await api("POST", "/api/cards", v);
    await reload();
    toast("success", "카드가 추가되었습니다");
}

async function editCard(id) {
    const c = DB.cards.find((x) => x.id === id);
    const v = await formModal({ title: "카드 수정", fields: cardFields(), values: c });
    if (!v) return;
    await api("PUT", `/api/cards/${id}`, v);
    await reload();
    toast("success", "카드가 수정되었습니다");
}

async function deleteCard(id) {
    if (!(await confirmDelete("되돌릴 수 없습니다."))) return;
    await api("DELETE", `/api/cards/${id}`);
    await reload();
    toast("success", "카드가 삭제되었습니다");
}

function renderFixed() {
    const list = DB.fixedExpenses.length
        ? DB.fixedExpenses
              .map(
                  (e) => card(`
            <div class="flex items-start justify-between">
                <div>
                    <p class="font-bold text-slate-800">${e.name}</p>
                    <p class="text-lg font-bold text-indigo-600 mt-1">${won(e.amount)}</p>
                    <span class="inline-block mt-1 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">🏦 ${bankName(e.bankId)}</span>
                    ${e.description ? `<p class="text-sm text-slate-500 mt-2">${e.description}</p>` : ""}
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="editFixed('${e.id}')" class="text-indigo-600 hover:underline text-sm">수정</button>
                    <button onclick="deleteFixed('${e.id}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>`)
              )
              .join("")
        : emptyState("등록된 고정 지출이 없습니다.");
    document.getElementById("tab-fixed").innerHTML =
        sectionHeader("카드 외 고정 지출", "+ 지출 추가", "saveFixed()", DB.fixedExpenses.length ? "resetFixed()" : "") + `<div class="grid gap-3 md:grid-cols-2">${list}</div>`;
}

const fixedFields = () => [
    { name: "name", label: "지출명", required: true },
    { name: "amount", label: "금액", type: "number", required: true },
    { name: "bankId", label: "출금 은행", type: "select", options: bankOptions() },
    { name: "description", label: "설명" },
];

async function saveFixed() {
    if (!(await requireBank())) return;
    const v = await formModal({ title: "고정 지출 추가", fields: fixedFields() });
    if (!v) return;
    await api("POST", "/api/fixedExpenses", v);
    await reload();
    toast("success", "고정 지출이 추가되었습니다");
}

async function editFixed(id) {
    const e = DB.fixedExpenses.find((x) => x.id === id);
    const v = await formModal({ title: "고정 지출 수정", fields: fixedFields(), values: e });
    if (!v) return;
    await api("PUT", `/api/fixedExpenses/${id}`, v);
    await reload();
    toast("success", "고정 지출이 수정되었습니다");
}

async function deleteFixed(id) {
    if (!(await confirmDelete("되돌릴 수 없습니다."))) return;
    await api("DELETE", `/api/fixedExpenses/${id}`);
    await reload();
    toast("success", "고정 지출이 삭제되었습니다");
}

function renderOverview() {
    const sections = DB.banks.length
        ? DB.banks
              .map((b) => {
                  const cards = DB.cards.filter((c) => c.bankId === b.id);
                  const cardList = cards.length
                      ? `<div class="grid gap-2 sm:grid-cols-2 mt-3">${cards
                            .map(
                                (c) => `<div class="bg-slate-50 rounded-lg p-3 border border-slate-200">
                            <p class="font-medium text-slate-700">💳 ${c.company}${c.alias ? ` (${c.alias})` : ""}</p>
                            <p class="text-sm text-slate-500">${last4(c.cardLast4)}</p>
                        </div>`
                            )
                            .join("")}</div>`
                      : `<p class="text-sm text-slate-400 mt-3">연결된 카드가 없습니다.</p>`;
                  return card(`
            <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 class="font-bold text-slate-800">🏦 ${b.name}</h3>
                <span class="text-xs text-slate-500">${b.accountNumber || ""}</span>
            </div>${cardList}`);
              })
              .join("")
        : emptyState("등록된 은행이 없습니다.");
    document.getElementById("tab-overview").innerHTML =
        `<h2 class="text-lg font-bold text-slate-700 mb-4">은행별 연결 카드</h2><div class="grid gap-4">${sections}</div>`;
}

let ledgerMonth = null;
let ledgerFilter = null;

const cycleDay = () => Number(DB.settings?.cycleStartDay) || 25;

const pad0 = (n) => String(n).padStart(2, "0");

function cyclePeriod(anchor, day) {
    const [y, m] = anchor.split("-").map(Number);
    const endD = new Date(y, m, day - 1);
    return {
        start: `${y}-${pad0(m)}-${pad0(day)}`,
        end: `${endD.getFullYear()}-${pad0(endD.getMonth() + 1)}-${pad0(endD.getDate())}`,
    };
}

function currentAnchor(day) {
    const now = new Date();
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (now.getDate() < day) {
        m -= 1;
        if (m === 0) {
            m = 12;
            y -= 1;
        }
    }
    return `${y}-${pad0(m)}`;
}

function moveLedger(dir) {
    const [y, m] = ledgerMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    ledgerMonth = `${d.getFullYear()}-${pad0(d.getMonth() + 1)}`;
    renderLedger();
}

async function setCycleDay() {
    const v = await formModal({
        title: "기간 기준일 설정",
        fields: [{ name: "day", label: "시작일 (1~28 — 예: 25 = 전달 25일 ~ 이번달 24일)", type: "number", required: true }],
        values: { day: cycleDay() },
    });
    if (!v) return;
    const d = Number(v.day);
    if (!(d >= 1 && d <= 28)) return toast("error", "1~28 사이로 입력하세요");
    DB.settings = await api("PUT", "/api/settings", { cycleStartDay: d });
    ledgerMonth = null;
    renderLedger();
    toast("success", `기준일이 매월 ${d}일로 설정되었습니다`);
}

async function renderLedger() {
    if (!ledgerMonth) ledgerMonth = currentAnchor(cycleDay());
    const period = cyclePeriod(ledgerMonth, cycleDay());
    window._ledgerPeriod = period;
    [window._ledgerAll, window._ledgerRec] = await Promise.all([
        api("GET", `/api/transactions?from=${period.start}&to=${period.end}`),
        api("GET", `/api/monthly/${ledgerMonth}`),
    ]);
    drawLedger();
}

const setLedgerFilter = (k) => {
    ledgerFilter = ledgerFilter === k ? null : k;
    drawLedger();
};

function showNeedTip(el, bankId) {
    hideNeedTip();
    const html = window._needTips?.[bankId];
    if (!html) return;
    const tip = document.createElement("div");
    tip.id = "needTip";
    tip.className = "fixed z-50 w-64 bg-slate-800 text-white text-xs rounded-xl p-3 shadow-2xl";
    tip.innerHTML = `<div id="needTipArrow" class="absolute w-2.5 h-2.5 bg-slate-800 rotate-45"></div>${html}`;
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - 256, window.innerWidth - 272));
    tip.style.left = left + "px";
    const arrow = tip.querySelector("#needTipArrow");
    arrow.style.right = Math.max(12, left + 256 - r.right + 24) + "px";
    if (r.bottom + tip.offsetHeight + 14 > window.innerHeight) {
        tip.style.top = r.top - tip.offsetHeight - 8 + "px";
        arrow.style.bottom = "-5px";
    } else {
        tip.style.top = r.bottom + 8 + "px";
        arrow.style.top = "-5px";
    }
}

const hideNeedTip = () => document.getElementById("needTip")?.remove();

async function editBalance(bankId) {
    const b = DB.banks.find((x) => x.id === bankId);
    const cur = DB.currentBalances?.[bankId];
    const v = await formModal({
        title: `${b.name} 현재 잔액 입력`,
        fields: [{ name: "amount", label: "현재 잔액 (오늘 통장 기준)", type: "number", required: true }],
        values: { amount: cur?.amount ?? "" },
    });
    if (!v) return;
    const saved = await api("PUT", `/api/balances/${bankId}`, { amount: v.amount });
    DB.currentBalances = DB.currentBalances || {};
    DB.currentBalances[bankId] = saved;
    drawLedger();
    toast("success", `${b.name} 잔액이 입력되었습니다`);
}

const LEDGER_KINDS = [
    { key: "입금", sign: "+", amtCls: "text-green-600" },
    { key: "출금", sign: "−", amtCls: "text-red-500" },
    { key: "카드", sign: "−", amtCls: "text-purple-600" },
    { key: "이체", sign: "", amtCls: "text-slate-500" },
    { key: "안내", sign: "", amtCls: "text-sky-600" },
    { key: "미분류", sign: "", amtCls: "text-amber-600" },
];

function drawLedger() {
    const txs = window._ledgerAll || [];
    const cb = DB.currentBalances || {};

    const rec = window._ledgerRec || {};
    const dueBy = {};
    Object.entries(rec.payments || {}).forEach(([cardId, v]) => {
        const cardObj = DB.cards.find((c) => c.id === cardId);
        if (cardObj?.bankId && Number(v)) (dueBy[cardObj.bankId] = dueBy[cardObj.bankId] || []).push({ label: `💳 ${cardObj.company}`, amount: Number(v) });
    });
    (rec.expenses || []).forEach((e) => {
        if (e.bankId && Number(e.amount)) (dueBy[e.bankId] = dueBy[e.bankId] || []).push({ label: `🧾 ${e.name}`, amount: Number(e.amount) });
    });

    window._needTips = {};
    let total = 0, totalNeed = 0;
    const balRows = DB.banks
        .map((b) => {
            const c = cb[b.id];
            const due = dueBy[b.id] || [];
            const pool = txs.filter((t) => t.bankId === b.id && t.kind === "출금" && t.amount > 0).map((t) => t.amount);
            let paid = 0;
            due.forEach((item) => {
                const i = pool.indexOf(item.amount);
                if (i >= 0) {
                    pool.splice(i, 1);
                    item.paid = true;
                    paid += item.amount;
                }
            });
            const retain = Number(b.retainAmount) || 0;
            const retainUsed = Math.min(retain, pool.reduce((s, a) => s + a, 0));
            const need = due.filter((d) => !d.paid).reduce((s, d) => s + d.amount, 0) + retain - retainUsed;
            if (c) total += c.amount;
            totalNeed += need;
            const free = c && need ? c.amount - need : null;

            if (due.length || retain) {
                const tipRow = (label, amount, opt = {}) =>
                    `<div class="flex justify-between gap-3 py-0.5 ${opt.dim ? "text-slate-400" : ""}">
                        <span class="${opt.strike ? "line-through" : ""}">${label}</span>
                        <span class="tabular-nums ${opt.strike ? "line-through" : ""}">${won(amount)}${opt.check ? ' <span class="text-green-400 no-underline">✓</span>' : ""}</span>
                    </div>`;
                window._needTips[b.id] =
                    `<p class="font-bold text-slate-200 mb-2">🏦 ${b.name} 유지 필요 내역</p>` +
                    due.map((d) => tipRow(d.label, d.amount, d.paid ? { strike: true, dim: true, check: true } : {})).join("") +
                    (retain ? tipRow("🔒 남길 금액", retain) : "") +
                    (retainUsed ? tipRow("&nbsp;&nbsp;↳ 출금 소진", -retainUsed, { dim: true }) : "") +
                    `<div class="border-t border-slate-600 mt-2 pt-2 flex justify-between gap-3 font-bold"><span>유지 필요</span><span class="tabular-nums text-orange-300">${won(need)}</span></div>` +
                    (paid ? `<p class="text-[10px] text-green-400 mt-1">✓ 취소선 = 이미 출금 확인되어 차감된 항목</p>` : "");
            }

            return `<tr class="border-b border-slate-100">
                <td class="py-2 px-2 font-medium text-slate-700 whitespace-nowrap">🏦 ${b.name}</td>
                <td onclick="editBalance('${b.id}')" title="클릭해서 잔액 직접 입력" class="py-2 px-2 text-right tabular-nums font-bold cursor-pointer hover:bg-slate-50 ${c ? (c.amount >= 0 ? "text-slate-800" : "text-red-600") : "text-slate-300"}">${c ? won(c.amount) : "✏️ 입력"}</td>
                <td ${window._needTips[b.id] ? `onmouseenter="showNeedTip(this, '${b.id}')" onmouseleave="hideNeedTip()" onclick="showNeedTip(this, '${b.id}')"` : ""} class="py-2 px-2 text-right tabular-nums ${window._needTips[b.id] ? "cursor-help" : ""} ${need ? "text-orange-500" : "text-slate-300"}">${need ? won(need) : "—"}${paid ? `<span class="block text-[10px] text-green-600">✓ ${won(paid)} 출금 확인</span>` : ""}${retainUsed ? `<span class="block text-[10px] text-slate-400">남길 ${won(retain)} 중 ${won(retainUsed)} 출금 소진</span>` : ""}</td>
                <td class="py-2 px-2 text-right tabular-nums font-bold ${free == null ? "text-slate-300" : free >= 0 ? "text-green-600" : "text-red-600"}">${free == null ? "—" : won(free)}</td>
                <td class="py-2 px-2 text-right text-xs text-slate-400 whitespace-nowrap">${c ? (c.manual ? "✏️ " : "📩 ") + c.at.slice(5) : "수집 전"}</td>
            </tr>`;
        })
        .join("");

    const approvedByCard = {};
    txs.forEach((t) => {
        if (t.kind === "카드" && t.cardId) approvedByCard[t.cardId] = (approvedByCard[t.cardId] || 0) + (t.amount || 0);
    });
    const cs = DB.cardStats || {};
    const cardRows = DB.cards
        .map((c) => {
            const approved = approvedByCard[c.id] || 0;
            const cum = cs[c.id]?.cumulative;
            const up = cs[c.id]?.upcoming;
            const p = window._ledgerPeriod;
            const cumThisMonth = cum && String(cum.at) >= p.start && String(cum.at) <= p.end + " 99:99";
            const diff = approved && cumThisMonth && cum.amount !== approved ? cum.amount - approved : 0;
            return `<tr class="border-b border-slate-100">
                <td class="py-2 px-2 font-medium text-slate-700 whitespace-nowrap">💳 ${c.company}${c.alias ? ` <span class="text-xs font-normal text-slate-400">(${c.alias})</span>` : ""}${c.payDay ? `<span class="block text-[10px] text-slate-400">📅 매월 ${c.payDay}일</span>` : ""}</td>
                <td class="py-2 px-2 text-right tabular-nums font-bold ${approved ? "text-purple-600" : "text-slate-300"}">${approved ? won(approved) : "—"}</td>
                <td class="py-2 px-2 text-right tabular-nums ${cum ? "text-slate-700" : "text-slate-300"}">${cum ? won(cum.amount) : "—"}${cum ? `<span class="block text-[10px] text-slate-400">📩 ${cum.at.slice(5)}</span>` : ""}${diff ? `<span class="block text-[10px] text-amber-600">⚠ 승인 합계와 ${won(Math.abs(diff))} 차이</span>` : ""}</td>
                <td class="py-2 px-2 text-right tabular-nums font-bold ${up ? "text-red-500" : "text-slate-300"}">${up ? won(up.amount) : "—"}${up ? `<span class="block text-[10px] text-slate-400">📩 ${up.at.slice(5)}</span>` : ""}${(() => {
                    const entered = Number(window._ledgerRec?.payments?.[c.id]) || 0;
                    return up && entered && entered !== up.amount ? `<span class="block text-[10px] text-amber-600">⚠ 입력값 ${won(entered)}과 ${won(Math.abs(entered - up.amount))} 차이</span>` : "";
                })()}</td>
                <td class="py-2 px-2 text-right text-xs text-slate-400 whitespace-nowrap">🏦 ${bankName(c.bankId)}</td>
            </tr>`;
        })
        .join("");

    const stats = txs.reduce((a, t) => {
        const k = t.kind || "미분류";
        a[k] = a[k] || { sum: 0, n: 0 };
        a[k].sum += t.amount || 0;
        a[k].n++;
        return a;
    }, {});
    const net = (stats["입금"]?.sum || 0) - (stats["출금"]?.sum || 0);
    const tiles = LEDGER_KINDS.map((k) => {
        const s = stats[k.key] || { sum: 0, n: 0 };
        const active = ledgerFilter === k.key;
        return `<button onclick="setLedgerFilter('${k.key}')"
            class="rounded-xl border p-3 text-center transition ${active ? "border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}">
            <p class="text-xs text-slate-500">${k.key}</p>
            <p class="text-sm sm:text-base font-bold tabular-nums ${k.amtCls}">${k.key === "미분류" ? `${s.n}건` : k.sign + won(s.sum)}</p>
            <p class="text-[11px] text-slate-400">${k.key === "미분류" ? "원문 보존" : `${s.n}건`}</p>
        </button>`;
    }).join("");
    const netTile = `<div class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
        <p class="text-xs text-slate-500">순변동</p>
        <p class="text-sm sm:text-base font-bold tabular-nums ${net >= 0 ? "text-slate-700" : "text-red-600"}">${won(net)}</p>
        <p class="text-[11px] text-slate-400">입금 − 출금</p>
    </div>`;

    const kindCls = { 입금: "bg-green-50 text-green-700", 출금: "bg-red-50 text-red-600", 카드: "bg-purple-50 text-purple-700", 이체: "bg-slate-100 text-slate-500", 안내: "bg-sky-50 text-sky-600", 미분류: "bg-amber-50 text-amber-700" };
    const shown = ledgerFilter ? txs.filter((t) => (t.kind || "미분류") === ledgerFilter) : txs;
    window._ledgerTx = shown;
    const txRows = shown.length
        ? shown
              .map((t, i) => {
                  const srcs = [t.bankId ? bankName(t.bankId) : "", t.cardId ? DB.cards.find((c) => c.id === t.cardId)?.company || "" : ""].filter(Boolean).join(" · ");
                  const amt = t.amount == null ? "—" : (t.kind === "입금" ? "+" : t.kind === "출금" || t.kind === "카드" ? "−" : "") + won(Math.abs(t.amount));
                  return `<div onclick="showTxRaw(${i})" class="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 ${t.status === "pending" ? "opacity-60" : ""}">
                <span class="text-xs text-slate-400 tabular-nums w-24 shrink-0">${String(t.at).slice(5)}</span>
                <span class="text-xs px-1.5 py-0.5 rounded shrink-0 ${kindCls[t.kind] || kindCls.이체}">${t.kind}</span>
                <span class="flex-1 text-sm text-slate-700 truncate">${t.title}
                    ${srcs ? `<span class="text-xs text-slate-400">(${srcs})</span>` : ""}
                    ${t.balance != null ? `<span class="text-xs text-sky-500">잔액 ${won(t.balance)}</span>` : ""}
                </span>
                <span class="font-bold tabular-nums text-sm shrink-0 ${t.kind === "입금" ? "text-green-600" : t.kind === "출금" ? "text-red-500" : t.kind === "카드" ? "text-purple-600" : "text-slate-400"}">${amt}</span>
            </div>`;
              })
              .join("")
        : `<p class="text-center text-slate-400 py-8">${ledgerFilter ? `${ledgerFilter} 거래가 없습니다.` : `이 기간의 거래 내역이 없습니다.`}</p>`;

    const period = window._ledgerPeriod;
    const periodLabel = `${period.start.replace(/-/g, ".")} ~ ${period.end.replace(/-/g, ".")}`;
    document.getElementById("tab-ledger").innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 class="text-lg font-bold text-slate-700">잔액·거래</h2>
            <div class="flex items-center gap-1.5">
                <button onclick="moveLedger(-1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">◀</button>
                <span class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-medium text-slate-700 tabular-nums">${periodLabel}</span>
                <button onclick="moveLedger(1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">▶</button>
                <button onclick="setCycleDay()" title="기준일 설정 (현재 매월 ${cycleDay()}일 시작)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">⚙</button>
                <button onclick="resetLedger()" title="거래·수집 데이터 초기화" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-400 hover:text-red-500 hover:bg-red-50 text-sm">🗑️</button>
            </div>
        </div>
        <div class="grid gap-4">
            ${card(`
            <h3 class="font-bold text-slate-700 mb-3">은행별 현재 잔액 <span class="text-xs font-normal text-slate-400">(유지 필요 = 이번 기간에 안 빠져나간 카드값+카드외지출 + 남길 금액 — 같은 금액의 출금 문자가 오면 자동 차감)</span></h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-slate-500 border-b-2 border-slate-200 text-xs">
                            <th class="text-left py-2 px-2">은행</th>
                            <th class="text-right py-2 px-2">현재 잔액</th>
                            <th class="text-right py-2 px-2">유지 필요</th>
                            <th class="text-right py-2 px-2">여유</th>
                            <th class="text-right py-2 px-2">수집</th>
                        </tr>
                    </thead>
                    <tbody>${balRows}</tbody>
                    <tfoot>
                        <tr class="border-t-2 border-slate-300 bg-slate-50">
                            <td class="py-2.5 px-2 font-bold text-slate-800">합계</td>
                            <td class="py-2.5 px-2 text-right tabular-nums text-base font-bold ${total >= 0 ? "text-slate-800" : "text-red-600"}">${won(total)}</td>
                            <td class="py-2.5 px-2 text-right tabular-nums font-bold text-orange-500">${totalNeed ? won(totalNeed) : "—"}</td>
                            <td class="py-2.5 px-2 text-right tabular-nums font-bold ${total - totalNeed >= 0 ? "text-green-600" : "text-red-600"}">${totalNeed ? won(total - totalNeed) : "—"}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>`)}
            ${DB.cards.length ? card(`
            <h3 class="font-bold text-slate-700 mb-3">카드 사용 현황 <span class="text-xs font-normal text-slate-400">(승인 합계 = 기간 내 승인 문자 합산 · 누적/결제 예정 = 카드사 문자 수집)</span></h3>
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-slate-500 border-b-2 border-slate-200 text-xs">
                            <th class="text-left py-2 px-2">카드</th>
                            <th class="text-right py-2 px-2">승인 합계</th>
                            <th class="text-right py-2 px-2">카드사 누적</th>
                            <th class="text-right py-2 px-2">결제 예정</th>
                            <th class="text-right py-2 px-2">연결 은행</th>
                        </tr>
                    </thead>
                    <tbody>${cardRows}</tbody>
                </table>
            </div>`) : ""}
            ${card(`
            <h3 class="font-bold text-slate-700 mb-3">기간 요약 <span class="text-xs font-normal text-slate-400">(누르면 해당 구분만 필터)</span></h3>
            <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">${tiles}${netTile}</div>`)}
            ${card(`
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 class="font-bold text-slate-700">거래 내역
                    <span class="text-xs font-normal text-slate-400">(${ledgerFilter ? `${ledgerFilter} ${shown.length}건 / 전체 ${txs.length}건` : `${txs.length}건`}, 행을 누르면 원문)</span>
                </h3>
                ${ledgerFilter ? `<button onclick="setLedgerFilter(null)" class="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">✕ ${ledgerFilter} 필터 해제</button>` : ""}
            </div>
            ${txRows}`)}
        </div>`;
}

async function showTxRaw(i) {
    const t = window._ledgerTx?.[i];
    if (!t) return;
    const { isDenied } = await Swal.fire({
        title: t.title,
        html: `<div class="text-left text-sm">
            <p class="text-slate-500 mb-2">${t.at} · ${t.kind}${t.amount != null ? ` · ${won(t.amount)}` : ""}${t.balance != null ? ` · 잔액 ${won(t.balance)}` : ""}${t.status === "pending" ? ' · <b class="text-amber-600">미분류(pending)</b>' : ""}</p>
            <pre class="bg-slate-100 rounded-lg p-3 text-xs whitespace-pre-wrap text-slate-700">${t.raw || "(원문 없음)"}</pre>
            <p class="text-xs text-slate-400 mt-2">발신: ${t.sender || "-"}</p>
        </div>`,
        confirmButtonText: "닫기",
        confirmButtonColor: "#4f46e5",
        showDenyButton: true,
        denyButtonText: "삭제",
        denyButtonColor: "#dc2626",
        reverseButtons: true,
    });
    if (isDenied && (await confirmDelete("이 거래를 삭제합니다."))) {
        await api("DELETE", `/api/transactions/${t.id}`);
        toast("success", "거래가 삭제되었습니다");
        renderLedger();
    }
}

const prevMonth = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthlyEl = document.getElementById("tab-monthly");
let selectedMonth = null;

function moveMonthly(dir) {
    const [y, m] = selectedMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    renderMonthly();
}

async function renderMonthly() {
    if (!selectedMonth) selectedMonth = currentAnchor(cycleDay());
    const current = (await api("GET", `/api/monthly/${selectedMonth}`)) || { month: selectedMonth, balances: {}, payments: {}, expenses: [] };
    const previous = await api("GET", `/api/monthly/${prevMonth(selectedMonth)}`);
    window._monthlyExpenses = current.expenses?.length
        ? current.expenses
        : DB.fixedExpenses.map((e) => ({ name: e.name, amount: e.amount, bankId: e.bankId, memo: e.description || "" }));
    window._transfersDone = current.transfersDone || {};
    window._transferLog = current.transferLog || [];

    const balanceRows = DB.banks.length
        ? DB.banks
              .map((b) => {
                  const saved = current.balances?.[b.id];
                  const auto = saved == null ? DB.currentBalances?.[b.id] : null;
                  return `<div class="flex items-center justify-between gap-3 py-2">
            <span class="text-slate-700">🏦 ${b.name}${auto ? ` <span class="text-xs text-sky-500" title="문자 수집 잔액 (${auto.at})">📩 ${auto.at.slice(5)}</span>` : ""}</span>
            <input data-balance="${b.id}" value="${comma(saved ?? auto?.amount ?? "")}" type="text" inputmode="numeric" placeholder="잔액" oninput="formatMoneyInput(this); renderSummary()"
                class="border border-slate-300 rounded-lg px-3 py-1.5 w-40 text-right" />
        </div>`;
              })
              .join("")
        : emptyState("등록된 은행이 없습니다.");

    const paymentRows = DB.cards.length
        ? DB.cards
              .map((c) => {
                  const prev = previous?.payments?.[c.id];
                  const up = DB.cardStats?.[c.id]?.upcoming;
                  const upRel = up && String(up.at).startsWith(selectedMonth) ? up : null;
                  const auto = current.payments?.[c.id] == null ? upRel : null;
                  const curVal = current.payments?.[c.id] ?? auto?.amount ?? "";
                  return `<div class="py-2 border-b border-slate-100 last:border-0">
            <div class="flex items-center justify-between gap-3">
                <span class="text-slate-700">💳 ${c.company} <span class="text-xs text-slate-400">(${bankName(c.bankId)})</span>${auto ? ` <span class="text-xs text-sky-500" title="결제예정 안내 문자 자동 입력 (${auto.at})">📩 ${auto.at.slice(5)}</span>` : ""}</span>
                <input data-payment="${c.id}" data-prev="${prev ?? ""}" data-upcoming="${upRel?.amount ?? ""}" value="${comma(curVal)}" type="text" inputmode="numeric" placeholder="결제 금액" oninput="formatMoneyInput(this); updateDiff('${c.id}')"
                    class="border border-slate-300 rounded-lg px-3 py-1.5 w-40 text-right" />
            </div>
            <p data-diff="${c.id}" class="text-xs text-right mt-1 text-slate-400">${diffText(curVal, prev)}</p>
            <p data-updiff="${c.id}" class="text-xs text-right mt-0.5">${upDiffText(curVal, upRel?.amount)}</p>
        </div>`;
              })
              .join("")
        : emptyState("등록된 카드가 없습니다.");

    const mPeriod = cyclePeriod(selectedMonth, cycleDay());
    monthlyEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 class="text-lg font-bold text-slate-700">이번달 결제 입력</h2>
            <div class="flex items-center gap-1.5">
                <button onclick="moveMonthly(-1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">◀</button>
                <span title="기록 키: ${selectedMonth}" class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-medium text-slate-700 tabular-nums">${mPeriod.start.replace(/-/g, ".")} ~ ${mPeriod.end.replace(/-/g, ".")}</span>
                <button onclick="moveMonthly(1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">▶</button>
                <button onclick="resetMonthly()" title="이 기간 기록 초기화" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-400 hover:text-red-500 hover:bg-red-50 text-sm">🗑️</button>
            </div>
        </div>
        <div class="grid gap-4 lg:grid-cols-2">
            ${card(`<h3 class="font-bold text-slate-700 mb-2">① 은행 잔액</h3>${balanceRows}`)}
            ${card(`<h3 class="font-bold text-slate-700 mb-2">② 카드 결제 금액 <span class="text-xs font-normal text-slate-400">(전월 대비 비교)</span></h3>${paymentRows}`)}
        </div>
        <div class="mt-4">
            ${card(`
            <div class="flex items-center justify-between mb-2">
                <h3 class="font-bold text-slate-700">③ 카드 외 지출 (고정 지출 자동 등록)</h3>
                <button onclick="addMonthlyExpense()" class="text-indigo-600 text-sm hover:underline">+ 항목 추가</button>
            </div>
            <div id="monthlyExpenseList"></div>`)}
        </div>
        <div id="monthlySummary" class="mt-4"></div>
        <div class="mt-5 flex justify-end">
            <button onclick="saveMonthly()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-2.5 rounded-lg transition">저장하기</button>
        </div>`;

    renderMonthlyExpenses();
    renderSummary();
}

const upDiffText = (cur, upAmount) => {
    if (upAmount == null || upAmount === "" || cur === "" || cur == null) return "";
    const d = toNum(cur) - Number(upAmount);
    if (d === 0) return `<span class="text-green-600">📩 안내 금액과 일치</span>`;
    return `<span class="text-amber-600">📩 안내 ${won(upAmount)}과 ${d > 0 ? "▲" : "▼"} ${won(Math.abs(d))} 차이</span>`;
};

const diffText = (cur, prev) => {
    if (prev === undefined || prev === null || prev === "") return "전월 기록 없음";
    if (cur === "" || cur === undefined) return `전월 ${won(prev)}`;
    const d = toNum(cur) - Number(prev);
    if (d === 0) return `전월과 동일 (${won(prev)})`;
    return d > 0 ? `▲ 전월 대비 ${won(d)} 더 지출` : `▼ 전월 대비 ${won(-d)} 절약`;
};

function updateDiff(cardId) {
    const input = document.querySelector(`[data-payment="${cardId}"]`);
    const prevRaw = input.dataset.prev;
    const prev = prevRaw === "" ? null : Number(prevRaw);
    const el = document.querySelector(`[data-diff="${cardId}"]`);
    const cur = input.value;
    el.textContent = diffText(cur, prev);
    el.className = "text-xs text-right mt-1 " + (cur === "" || prev === null ? "text-slate-400" : toNum(cur) - prev > 0 ? "text-red-500" : toNum(cur) - prev < 0 ? "text-green-600" : "text-slate-400");
    const upEl = document.querySelector(`[data-updiff="${cardId}"]`);
    if (upEl) upEl.innerHTML = upDiffText(cur, input.dataset.upcoming || null);
    renderSummary();
}

function renderMonthlyExpenses() {
    const list = window._monthlyExpenses;
    const wrap = document.getElementById("monthlyExpenseList");
    wrap.innerHTML = list.length
        ? list
              .map(
                  (e, i) => `<div class="py-2 border-b border-slate-100 last:border-0">
            <div class="flex items-center gap-3">
                <span class="flex-1 text-slate-700">${e.name} <span class="text-xs text-slate-400">(${bankName(e.bankId)})</span></span>
                <input data-expense="${i}" value="${comma(e.amount)}" type="text" inputmode="numeric" oninput="formatMoneyInput(this); onExpenseInput(${i}, this.value)"
                    class="border border-slate-300 rounded-lg px-3 py-1.5 w-36 text-right" />
                <button onclick="removeMonthlyExpense(${i})" class="text-red-500 text-sm hover:underline">삭제</button>
            </div>
            <div class="flex items-center gap-2 mt-1.5">
                <input value="${String(e.memo ?? "").replace(/"/g, "&quot;")}" placeholder="메모 (예: 월세및관리비26.08(이창하, 선불) - 17회차)" oninput="onExpenseMemo(${i}, this.value)"
                    class="flex-1 border border-slate-200 rounded-lg px-3 py-1 text-sm text-slate-600 placeholder:text-slate-300" />
                <button onclick="copyExpenseMemo(${i})" class="text-slate-400 hover:text-indigo-600 text-sm shrink-0" title="메모 복사 (네이버가계부 붙여넣기용)">📋 복사</button>
            </div>
        </div>`
              )
              .join("")
        : `<p class="text-sm text-slate-400 py-2">등록된 고정 지출이 없습니다.</p>`;
}

const onExpenseInput = (i, val) => {
    window._monthlyExpenses[i].amount = toNum(val);
    renderSummary();
};

const onExpenseMemo = (i, val) => (window._monthlyExpenses[i].memo = val);

async function copyExpenseMemo(i) {
    const memo = window._monthlyExpenses[i].memo || "";
    if (!memo) return toast("info", "메모가 비어 있습니다");
    try {
        await navigator.clipboard.writeText(memo);
        toast("success", "메모가 복사되었습니다");
    } catch {
        toast("error", "복사 실패 — 직접 선택해 주세요");
    }
}

const removeMonthlyExpense = (i) => {
    window._monthlyExpenses.splice(i, 1);
    renderMonthlyExpenses();
    renderSummary();
};

async function addMonthlyExpense() {
    const v = await formModal({
        title: "지출 항목 추가",
        fields: [
            { name: "name", label: "지출명", required: true },
            { name: "amount", label: "금액", type: "number", required: true },
            { name: "bankId", label: "출금 은행", type: "select", options: bankOptions() },
            { name: "memo", label: "메모 (예: 월세및관리비26.08(이창하, 선불) - 17회차)" },
        ],
    });
    if (!v) return;
    window._monthlyExpenses.push(v);
    renderMonthlyExpenses();
    renderSummary();
}

function renderSummary() {
    const balanceOf = (id) => toNum(document.querySelector(`[data-balance="${id}"]`)?.value);
    const sumByBank = (entries, idKey, amountFn) =>
        entries.reduce((acc, e) => {
            const bankId = idKey(e);
            if (bankId) acc[bankId] = (acc[bankId] || 0) + amountFn(e);
            return acc;
        }, {});
    const paymentByBank = sumByBank(
        [...document.querySelectorAll("[data-payment]")],
        (el) => DB.cards.find((c) => c.id === el.dataset.payment)?.bankId,
        (el) => toNum(el.value)
    );
    const expenseByBank = sumByBank(window._monthlyExpenses, (e) => e.bankId, (e) => toNum(e.amount));

    const plan = computeRelayPlan(balanceOf, paymentByBank, expenseByBank);
    const done = window._transfersDone || {};

    const remainClass = (v) => (v >= 0 ? "text-green-600" : "text-red-600");
    const num = (v, cls = "text-slate-700") => `<td class="text-right py-2 px-2 tabular-nums ${cls}">${won(v)}</td>`;
    const totals = { bal: 0, pay: 0, exp: 0, inf: 0, remain: 0 };
    const rows = DB.banks
        .map((b) => {
            const bal = balanceOf(b.id), pay = paymentByBank[b.id] || 0, exp = expenseByBank[b.id] || 0;
            const inf = plan.inflow[b.id] || 0, out = plan.outflow[b.id] || 0;
            const remain = bal + inf - pay - exp - out;
            totals.bal += bal;
            totals.pay += pay;
            totals.exp += exp;
            totals.inf += inf;
            totals.remain += remain;
            return `<tr class="border-b border-slate-100 ${b.relayExclude ? "opacity-50" : ""}">
                <td class="py-2 px-2 font-medium text-slate-700 whitespace-nowrap">🏦 ${b.name}${b.relayExclude ? ' <span class="text-xs text-slate-400">(제외)</span>' : ""}</td>
                ${num(bal)}${num(pay, "text-red-500")}${num(exp, "text-orange-500")}
                ${b.relayExclude ? '<td class="text-right py-2 px-2 text-slate-300">—</td>' : num(inf, inf ? "text-sky-600" : "text-slate-300")}
                ${num(remain, `font-bold ${remainClass(remain)}`)}
            </tr>`;
        })
        .join("");

    const doneCount = plan.items.filter((t) => done[t.key]).length;
    const holdingOf = (bankId) =>
        plan.items.reduce((s, t) => {
            if (!done[t.key]) return s;
            if (t.kind === "expense") return t.fromId === bankId ? s - t.amount : s;
            return s + (t.toId === bankId ? t.amount : 0) - (t.fromId === bankId ? t.amount : 0);
        }, balanceOf(bankId));
    window._planCtx = { items: plan.items, holdingOf };
    const planRows = plan.items
        .map((t, i) => {
            const d = done[t.key];
            const checked = !!d;
            const snap = d && typeof d === "object" ? d : null;
            const tag = (text, cls) => `<span class="text-xs px-1.5 py-0.5 rounded ${cls}">${text}</span>`;
            const isExp = t.kind === "expense";
            const title = isExp
                ? `${bankName(t.fromId)} <span class="text-slate-400">→</span> ${t.name} ${tag("지출", "bg-orange-50 text-orange-600")}`
                : `${bankName(t.fromId)} <span class="text-slate-400">→</span> ${bankName(t.toId)}
                    ${t.fixed ? tag("고정", "bg-amber-50 text-amber-700") : ""}
                    ${t.back ? tag("반환", "bg-emerald-50 text-emerald-700") : ""}
                    ${t.short ? tag("⚠ 잔액 부족 주의", "bg-red-50 text-red-600") : ""}`;
            const fromBal = snap?.fromBal ?? holdingOf(t.fromId);
            const time = snap?.at ? `${snap.at} ` : "";
            const log = isExp
                ? `✓ ${time}지출 완료 — ${bankName(t.fromId)} 잔액 ${won(fromBal)}`
                : `✓ ${time}이체 완료 — ${bankName(t.fromId)} 잔액 ${won(fromBal)} <span class="text-slate-300">|</span> ${bankName(t.toId)} 잔액 ${won(snap?.toBal ?? holdingOf(t.toId))}`;
            return `<label class="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer">
                <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleTransferDone('${t.key}', this.checked)" class="w-4 h-4 accent-indigo-600 shrink-0" />
                <span class="text-xs text-slate-400 w-4 text-right">${i + 1}</span>
                <span class="flex-1">
                    <span class="text-slate-700 ${checked ? "line-through opacity-50" : ""}">${title}</span>
                    ${checked ? `<span class="block text-xs text-sky-600 mt-0.5">${log}</span>` : ""}
                </span>
                <span class="font-bold tabular-nums ${checked ? "text-slate-400 line-through" : isExp ? "text-orange-500" : "text-indigo-600"}">${won(t.amount)}</span>
            </label>`;
        })
        .join("");

    document.getElementById("monthlySummary").innerHTML = DB.banks.length
        ? card(`
        <h3 class="font-bold text-slate-700 mb-3">④ 은행별 정산 <span class="text-xs font-normal text-slate-400">(잔액 + 받을 이체 − 카드결제 − 카드외지출 − 보낼 이체)</span></h3>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead>
                    <tr class="text-slate-500 border-b-2 border-slate-200">
                        <th class="text-left py-2 px-2">은행</th>
                        <th class="text-right py-2 px-2">잔액</th>
                        <th class="text-right py-2 px-2">카드 결제</th>
                        <th class="text-right py-2 px-2">카드 외</th>
                        <th class="text-right py-2 px-2">받을 이체</th>
                        <th class="text-right py-2 px-2">남는 금액</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                    <tr class="border-t-2 border-slate-300 bg-slate-50">
                        <td class="py-2.5 px-2 font-bold text-slate-800">합계</td>
                        ${num(totals.bal, "font-bold text-slate-800")}${num(totals.pay, "font-bold text-red-500")}${num(totals.exp, "font-bold text-orange-500")}
                        ${num(totals.inf, "font-bold text-sky-600")}
                        ${num(totals.remain, `text-base font-bold ${remainClass(totals.remain)}`)}
                    </tr>
                </tfoot>
            </table>
        </div>`) +
      `<div class="mt-4">` +
          card(`
        <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h3 class="font-bold text-slate-700">⑤ 이체 플랜 <span class="text-xs font-normal text-slate-400">(위에서부터 순서대로 이체하고 체크)</span></h3>
            ${plan.items.length ? `<span class="text-xs font-medium px-2.5 py-1 rounded-full ${doneCount === plan.items.length ? "bg-green-100 text-green-700" : "bg-indigo-50 text-indigo-700"}">${doneCount}/${plan.items.length} 완료</span>` : ""}
        </div>
        ${plan.items.length ? planRows : '<p class="text-sm text-slate-400 py-2">이체할 항목이 없습니다. 잔액을 입력하면 플랜이 자동 계산됩니다.</p>'}
        ${(window._transferLog || []).length ? `
        <div class="mt-3 pt-3 border-t border-slate-200">
            <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-bold text-slate-500">📜 이체 로그</span>
                <button onclick="clearTransferLog()" class="text-xs text-slate-400 hover:text-red-500 hover:underline">로그 지우기</button>
            </div>
            ${window._transferLog.map((l) => `<p class="text-xs py-0.5 ${l.undo ? "text-slate-400" : "text-slate-600"}"><span class="text-slate-400 tabular-nums">${l.at}</span> ${l.text}</p>`).join("")}
        </div>` : ""}`) +
      `</div>`
        : "";
}

function computeRelayPlan(balanceOf, paymentByBank, expenseByBank) {
    const chain = relayChain();
    const inflow = {}, outflow = {}, items = [];
    chain.forEach((b, i) => {
        (window._monthlyExpenses || []).forEach((e, idx) => {
            if (e.bankId === b.id && toNum(e.amount)) items.push({ kind: "expense", key: `x:${idx}:${b.id}`, fromId: b.id, name: e.name, amount: toNum(e.amount) });
        });
        let avail = balanceOf(b.id) + (inflow[b.id] || 0) - (paymentByBank[b.id] || 0) - (expenseByBank[b.id] || 0);
        for (const t of b.fixedTransfers || []) {
            items.push({ kind: "transfer", key: `${b.id}>${t.bankId}:f`, fromId: b.id, toId: t.bankId, amount: t.amount, fixed: true, short: avail < t.amount });
            inflow[t.bankId] = (inflow[t.bankId] || 0) + t.amount;
            outflow[b.id] = (outflow[b.id] || 0) + t.amount;
            avail -= t.amount;
        }
        const targetId = b.relayTarget === "none" ? null : b.relayTarget || chain[i + 1]?.id;
        const amount = avail - (Number(b.retainAmount) || 0);
        if (targetId && amount > 0) {
            items.push({ kind: "transfer", key: `${b.id}>${targetId}:a`, fromId: b.id, toId: targetId, amount, back: chain.findIndex((x) => x.id === targetId) < i });
            inflow[targetId] = (inflow[targetId] || 0) + amount;
            outflow[b.id] = (outflow[b.id] || 0) + amount;
        }
    });
    return { items, inflow, outflow };
}

const monthlyPayload = () => {
    const balances = {};
    document.querySelectorAll("[data-balance]").forEach((el) => {
        if (el.value !== "") balances[el.dataset.balance] = toNum(el.value);
    });
    const payments = {};
    document.querySelectorAll("[data-payment]").forEach((el) => {
        if (el.value !== "") payments[el.dataset.payment] = toNum(el.value);
    });
    return {
        month: selectedMonth,
        balances,
        payments,
        expenses: window._monthlyExpenses,
        transfersDone: window._transfersDone || {},
        transferLog: window._transferLog || [],
        plan: (window._planCtx?.items || []).map((t) => ({
            kind: t.kind,
            key: t.key,
            from: bankName(t.fromId),
            to: t.kind === "expense" ? t.name : bankName(t.toId),
            amount: t.amount,
            fixed: !!t.fixed,
            back: !!t.back,
        })),
    };
};

let autosaveTimer = null;

const scheduleAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => api("POST", "/api/monthly", monthlyPayload()).catch(() => {}), 400);
};

function toggleTransferDone(key, checked) {
    window._transfersDone = window._transfersDone || {};
    window._transferLog = window._transferLog || [];
    const ctx = window._planCtx;
    const item = ctx?.items.find((t) => t.key === key);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const at = `${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (checked) {
        const snap = { at };
        window._transfersDone[key] = snap;
        if (item && ctx) {
            snap.fromBal = ctx.holdingOf(item.fromId);
            if (item.kind === "expense") {
                window._transferLog.push({ at, text: `${bankName(item.fromId)} → ${item.name} ${won(item.amount)} 지출 완료 (${bankName(item.fromId)} 잔액 ${won(snap.fromBal)})` });
            } else {
                snap.toBal = ctx.holdingOf(item.toId);
                window._transferLog.push({ at, text: `${bankName(item.fromId)} → ${bankName(item.toId)} ${won(item.amount)} 이체 완료 (${bankName(item.fromId)} 잔액 ${won(snap.fromBal)} · ${bankName(item.toId)} 잔액 ${won(snap.toBal)})` });
            }
        }
    } else {
        delete window._transfersDone[key];
        if (item) window._transferLog.push({ at, text: `${bankName(item.fromId)} → ${item.kind === "expense" ? item.name : bankName(item.toId)} ${won(item.amount)} 체크 해제`, undo: true });
    }
    renderSummary();
    scheduleAutosave();
}

async function clearTransferLog() {
    if (!(await confirmDelete("이체 로그를 모두 지웁니다."))) return;
    window._transferLog = [];
    renderSummary();
    scheduleAutosave();
}

async function saveMonthly() {
    await api("POST", "/api/monthly", monthlyPayload());
    await reload();
    toast("success", `${selectedMonth} 결제 내역이 저장되었습니다`);
}

function renderAll() {
    renderBanks();
    renderCards();
    renderFixed();
    renderOverview();
}

const sumValues = (obj) => Object.values(obj || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const sumExpenses = (arr) => (arr || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
const histItem = (label, val, color, sub = "") => `<div class="text-center"><p class="text-xs text-slate-500">${label}</p><p class="text-base font-bold ${color}">${won(val)}</p>${sub ? `<p class="leading-tight">${sub}</p>` : ""}</div>`;

let historyChart = null;
const CHART_PALETTE = ["#fca5a5", "#fdba74", "#fde047", "#86efac", "#67e8f9", "#a5b4fc", "#d8b4fe", "#f9a8d4", "#5eead4", "#fcd34d"];
const cardLabel = (id) => {
    const c = DB.cards.find((x) => x.id === id);
    return c ? c.alias || c.company : `삭제된 카드(${id.slice(-4)})`;
};

function renderHistoryChart(records, actByMonth = {}) {
    const ctx = document.getElementById("historyChart");
    if (!ctx || typeof Chart === "undefined") return;
    if (historyChart) historyChart.destroy();
    const cardIds = [...new Set(records.flatMap((r) => Object.keys(r.payments || {})))];
    const cardBars = cardIds.map((id, i) => ({
        type: "bar",
        label: `💳 ${cardLabel(id)}`,
        stack: "지출",
        data: records.map((r) => (r.payments && r.payments[id]) || 0),
        backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
        borderRadius: 3,
        order: 2,
    }));
    const expBar = { type: "bar", label: "카드 외 지출", stack: "지출", data: records.map((r) => sumExpenses(r.expenses)), backgroundColor: "#cbd5e1", borderRadius: 3, order: 2 };
    const balLine = { type: "line", label: "총 잔액 (우측 축)", yAxisID: "y2", order: 1, data: records.map((r) => sumValues(r.balances)), borderColor: "#0f172a", borderWidth: 2, tension: 0.3, pointRadius: 3 };
    const remainLine = {
        type: "line",
        order: 1,
        label: "예상 잔액 (우측 축)",
        yAxisID: "y2",
        data: records.map((r) => sumValues(r.balances) - sumValues(r.payments) - sumExpenses(r.expenses)),
        borderColor: "#64748b",
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.3,
        pointRadius: 3,
    };
    const actOutLine = {
        type: "line",
        order: 1,
        label: "실제 출금",
        stack: "_actOut",
        data: records.map((r) => actByMonth[r.month]?.out || 0),
        borderColor: "#dc2626",
        borderWidth: 2.5,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#dc2626",
    };
    const actInLine = {
        type: "line",
        order: 1,
        label: "실제 입금",
        stack: "_actIn",
        data: records.map((r) => actByMonth[r.month]?.in || 0),
        borderColor: "#16a34a",
        borderWidth: 2.5,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#16a34a",
    };
    historyChart = new Chart(ctx, {
        data: { labels: records.map((r) => r.month), datasets: [...cardBars, expBar, balLine, remainLine, actOutLine, actInLine] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { labels: { boxWidth: 14, font: { family: "Noto Sans KR" } } },
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${won(c.parsed.y)}` } },
            },
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    position: "left",
                    title: { display: true, text: "지출·거래", font: { family: "Noto Sans KR", size: 11 } },
                    ticks: { callback: (v) => `${Math.round(v / 10000)}만` },
                },
                y2: {
                    position: "right",
                    grid: { drawOnChartArea: false },
                    title: { display: true, text: "잔액", font: { family: "Noto Sans KR", size: 11 } },
                    ticks: { callback: (v) => `${Math.round(v / 10000)}만` },
                },
            },
        },
    });
}

const histDiff = (cur, prev, invert = false) => {
    if (prev == null) return "";
    const d = cur - prev;
    if (d === 0) return `<span class="text-[10px] text-slate-400">전기간과 동일</span>`;
    const worse = invert ? d < 0 : d > 0;
    return `<span class="text-[10px] ${worse ? "text-red-500" : "text-green-600"}">${d > 0 ? "▲" : "▼"} ${won(Math.abs(d))}</span>`;
};

async function renderHistory() {
    const records = await api("GET", "/api/monthly");
    const day = cycleDay();
    const actuals = await Promise.all(
        records.map((r) => {
            const p = cyclePeriod(r.month, day);
            return api("GET", `/api/transactions?from=${p.start}&to=${p.end}`).catch(() => []);
        })
    );
    const actByMonth = {};
    records.forEach((r, i) => {
        actByMonth[r.month] = actuals[i].reduce(
            (a, t) => {
                if (t.kind === "입금") a.in += t.amount || 0;
                if (t.kind === "출금") a.out += t.amount || 0;
                if (t.kind === "카드") a.card += t.amount || 0;
                return a;
            },
            { in: 0, out: 0, card: 0, n: actuals[i].length }
        );
    });
    const list = records.length
        ? records
              .map((r, idx) => {
                  const bal = sumValues(r.balances), pay = sumValues(r.payments), exp = sumExpenses(r.expenses);
                  const remain = bal - pay - exp;
                  const p = cyclePeriod(r.month, day);
                  const prev = records[idx + 1];
                  const prevPay = prev ? sumValues(prev.payments) : null;
                  const prevExp = prev ? sumExpenses(prev.expenses) : null;
                  const act = actByMonth[r.month];
                  const hasAct = act.n > 0;
                  const planSpend = pay + exp;
                  const doneN = r.plan?.filter((x) => r.transfersDone?.[x.key]).length || 0;
                  return card(`
            <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 class="font-bold text-slate-800 text-lg">${r.month} <span class="text-sm font-normal text-slate-400 tabular-nums">(${p.start.slice(5).replace("-", ".")} ~ ${p.end.slice(5).replace("-", ".")})</span></h3>
                <div class="flex gap-3">
                    <button onclick="viewMonth('${r.month}')" class="text-indigo-600 hover:underline text-sm">보기</button>
                    <button onclick="deleteMonth('${r.month}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>
            <p class="text-[11px] font-bold text-slate-400 mb-1">계획 (${day}일 입력 기준)</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                ${histItem("총 잔액", bal, "text-slate-800")}
                ${histItem("카드 결제", pay, "text-red-500", histDiff(pay, prevPay))}
                ${histItem("카드 외 지출", exp, "text-orange-500", histDiff(exp, prevExp))}
                ${histItem("예상 잔액", remain, remain >= 0 ? "text-green-600" : "text-red-600")}
            </div>
            ${hasAct ? `
            <p class="text-[11px] font-bold text-slate-400 mt-3 mb-1">실제 (문자 수집 기준, ${actuals[idx].length}건)</p>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                ${histItem("입금", act.in, "text-green-600")}
                ${histItem("출금", act.out, "text-red-500", planSpend ? histDiff(act.out, planSpend).replace("전기간과 동일", "계획과 동일") + `<span class="text-[10px] text-slate-400"> (계획 대비)</span>` : "")}
                ${histItem("카드 승인", act.card, "text-purple-600")}
                ${histItem("순변동", act.in - act.out, act.in - act.out >= 0 ? "text-slate-700" : "text-red-600")}
            </div>` : ""}
            ${(() => {
                const payEntries = Object.entries(r.payments || {}).filter(([, v]) => Number(v));
                const expEntries = (r.expenses || []).filter((e) => Number(e.amount));
                if (!payEntries.length && !expEntries.length) return "";
                return `
            <details class="mt-3 pt-3 border-t border-slate-100">
                <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none hover:text-indigo-600">상세 내역 (카드 ${payEntries.length} · 지출 ${expEntries.length}) <span class="font-normal text-slate-400">(펼치기)</span></summary>
                <div class="mt-1 grid gap-3 sm:grid-cols-2">
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 mb-0.5">💳 카드 결제</p>
                        ${payEntries.map(([id, v]) => `<p class="text-xs text-slate-600 py-0.5 flex justify-between gap-2"><span>${cardLabel(id)}</span><span class="tabular-nums">${won(v)}</span></p>`).join("") || '<p class="text-xs text-slate-400">없음</p>'}
                    </div>
                    <div>
                        <p class="text-[11px] font-bold text-slate-400 mb-0.5">🧾 카드 외 지출</p>
                        ${expEntries.map((e) => `<div class="py-0.5"><p class="text-xs text-slate-600 flex justify-between gap-2"><span>${e.name} <span class="text-slate-400">(${bankName(e.bankId)})</span></span><span class="tabular-nums">${won(e.amount)}</span></p>${e.memo ? `<p class="text-[10px] text-sky-600">📝 ${e.memo}</p>` : ""}</div>`).join("") || '<p class="text-xs text-slate-400">없음</p>'}
                    </div>
                </div>
            </details>`;
            })()}
            ${r.plan?.length ? `
            <details class="mt-2">
                <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none hover:text-indigo-600">이체 플랜 ${doneN}/${r.plan.length} 완료 ${doneN === r.plan.length ? "✅" : ""} <span class="font-normal text-slate-400">(펼치기)</span></summary>
                <div class="mt-1">
                ${r.plan
                    .map(
                        (x) => `<p class="text-xs text-slate-600 py-0.5">${r.transfersDone?.[x.key] ? "✅" : "⬜"} ${x.from} → ${x.to} <b class="tabular-nums">${won(x.amount)}</b>${x.fixed ? ' <span class="text-amber-600">고정</span>' : ""}${x.back ? ' <span class="text-emerald-600">반환</span>' : ""}${x.kind === "expense" ? ' <span class="text-orange-500">지출</span>' : ""}</p>`
                    )
                    .join("")}
                </div>
            </details>` : ""}
            ${r.transferLog?.length ? `
            <details class="mt-2">
                <summary class="text-xs font-bold text-slate-500 cursor-pointer select-none hover:text-indigo-600">📜 이체 로그 (${r.transferLog.length}건)</summary>
                <div class="mt-1">
                ${r.transferLog.map((l) => `<p class="text-xs py-0.5 ${l.undo ? "text-slate-400" : "text-slate-600"}"><span class="text-slate-400 tabular-nums">${l.at}</span> ${l.text}</p>`).join("")}
                </div>
            </details>` : ""}`);
              })
              .join("")
        : emptyState("저장된 결제 이력이 없습니다. '이번달 결제'에서 입력 후 저장하세요.");
    const chart = records.length
        ? card(`<div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 class="font-bold text-slate-700">월별 추이 <span class="text-xs font-normal text-slate-400">(카드별 누적 막대 + 잔액 추이선)</span></h3>
            <span class="text-xs text-slate-400">범례를 클릭하면 항목을 숨기거나 표시할 수 있어요</span>
        </div><div class="relative h-80"><canvas id="historyChart"></canvas></div>`)
        : "";
    document.getElementById("tab-history").innerHTML =
        `<div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-bold text-slate-700">결제 이력 (기간별 저장)</h2>
            ${records.length ? `<button onclick="resetHistory()" class="text-xs text-slate-400 hover:text-red-500 hover:underline">🗑️ 전체 초기화</button>` : ""}
        </div>${chart}<div class="grid gap-4 mt-4">${list}</div>`;
    if (records.length) renderHistoryChart([...records].sort((a, b) => a.month.localeCompare(b.month)), actByMonth);
}

function viewMonth(month) {
    selectedMonth = month;
    showTab("monthly");
}

async function deleteMonth(month) {
    if (!(await confirmDelete(`${month} 결제 기록을 삭제합니다.`))) return;
    await api("DELETE", `/api/monthly/${month}`);
    await renderHistory();
    toast("success", `${month} 기록이 삭제되었습니다`);
}

async function renderSystem() {
    document.getElementById("tab-system").innerHTML = `
        <h2 class="text-lg font-bold text-slate-700 mb-4">시스템</h2>
        <div class="grid gap-4">
            ${card(`<h3 class="font-bold text-slate-700 mb-2">상태</h3><div id="sysInfo" class="text-sm text-slate-500 space-y-1">불러오는 중…</div>`)}
            ${card(`
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h3 class="font-bold text-slate-700">커밋 & 푸시</h3>
                    <p class="text-sm text-slate-500 mt-1">변경사항을 GitHub에 올립니다. (Render가 자동 배포)</p>
                </div>
                <button onclick="runDeploy()" id="deployBtn" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">커밋 & 푸시</button>
            </div>`)}
            ${card(`
            <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h3 class="font-bold text-slate-700">앱 재시작</h3>
                    <p class="text-sm text-slate-500 mt-1">서버를 재시작합니다. 몇 초간 응답이 느려집니다.</p>
                </div>
                <button onclick="runRestart()" id="restartBtn" class="border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition">재시작</button>
            </div>`)}
            <pre id="sysOutput" class="hidden bg-slate-900 text-slate-100 text-xs rounded-xl p-4 overflow-auto max-h-80 whitespace-pre-wrap"></pre>
        </div>`;
    loadSystemInfo();
}

async function loadSystemInfo() {
    try {
        const d = await api("GET", "/api/system/info");
        const pg = d.storage === "postgres";
        document.getElementById("sysInfo").innerHTML = `
            <p>Node: <b>${d.node}</b> ${d.production ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">production</span>' : ""}</p>
            <p>저장소: <b>${pg ? "Postgres (영구 저장)" : "파일 (임시 저장)"}</b> ${pg ? '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Neon 연결됨</span>' : '<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">DATABASE_URL 미설정</span>'}</p>
            <p>브랜치: <b>${d.branch}</b></p>
            <p>최근 커밋: ${d.lastCommit}</p>
            <p>변경된 파일: <b>${d.changes}</b>개</p>`;
    } catch {
        document.getElementById("sysInfo").textContent = "상태 조회 실패";
    }
}

async function runDeploy() {
    const { value: message } = await Swal.fire({
        title: "커밋 & 푸시",
        input: "text",
        inputLabel: "커밋 메시지 (비우면 자동 생성)",
        inputPlaceholder: "예: 고정지출 항목 추가",
        showCancelButton: true,
        confirmButtonText: "실행",
        cancelButtonText: "취소",
        confirmButtonColor: "#4f46e5",
    });
    if (message === undefined) return;
    const btn = document.getElementById("deployBtn");
    const out = document.getElementById("sysOutput");
    btn.disabled = true;
    btn.textContent = "진행 중…";
    out.classList.remove("hidden");
    out.textContent = "git add / commit / push 실행 중…";
    try {
        const res = await api("POST", "/api/system/deploy", { message });
        out.textContent = res.log;
        toast(res.ok ? "success" : "error", res.ok ? "푸시 완료 (Render 배포 시작)" : "실패 — 출력을 확인하세요");
        loadSystemInfo();
    } catch (e) {
        out.textContent = "요청 실패: " + e.message;
        toast("error", "요청 실패");
    } finally {
        btn.disabled = false;
        btn.textContent = "커밋 & 푸시";
    }
}

async function runRestart() {
    const ok = (
        await Swal.fire({
            title: "앱을 재시작할까요?",
            text: "몇 초간 응답이 느려집니다.",
            icon: "question",
            showCancelButton: true,
            confirmButtonText: "재시작",
            cancelButtonText: "취소",
            confirmButtonColor: "#4f46e5",
        })
    ).isConfirmed;
    if (!ok) return;
    try {
        await api("POST", "/api/system/restart");
    } catch {}
    let n = 6;
    Swal.fire({
        title: "재시작 중…",
        html: `<b>${n}</b>초 후 새로고침`,
        allowOutsideClick: false,
        didOpen: () => {
            Swal.showLoading();
            const timer = setInterval(() => {
                n -= 1;
                const b = Swal.getHtmlContainer()?.querySelector("b");
                if (b) b.textContent = n;
                if (n <= 0) {
                    clearInterval(timer);
                    location.reload();
                }
            }, 1000);
        },
    });
}

let currentTab = "banks";

function showTab(name) {
    currentTab = name;
    localStorage.setItem("activeTab", name);
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`tab-${name}`).classList.remove("hidden");
    if (name === "ledger") renderLedger();
    if (name === "monthly") renderMonthly();
    if (name === "history") renderHistory();
    if (name === "system") renderSystem();
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("POST", "/api/logout");
    location.href = "/login.html";
});

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

const addActions = { banks: saveBank, cards: saveCard, fixed: saveFixed };
document.addEventListener("keydown", (e) => {
    if (e.key !== "+" || e.repeat || Swal.isVisible()) return;
    const t = e.target;
    if (t && (t.matches?.("input, textarea, select") || t.isContentEditable)) return;
    const action = addActions[currentTab];
    if (!action) return;
    e.preventDefault();
    action();
});

async function loadStorageBadge() {
    const el = document.getElementById("storageBadge");
    try {
        const { storage } = await api("GET", "/api/system/info");
        const pg = storage === "postgres";
        el.textContent = pg ? "🟢 Postgres 영구 저장" : "🟠 파일 임시 저장";
        el.className = `ml-auto text-xs font-medium px-2.5 py-1 rounded-full ${pg ? "bg-green-500 text-white" : "bg-amber-400 text-amber-900"}`;
        el.title = pg ? "Neon Postgres에 저장 — 재배포·재시작해도 데이터 유지" : "DATABASE_URL 미설정 — 재배포/재시작 시 데이터 소실 위험";
    } catch {
        el.textContent = "저장소 확인 실패";
    }
}

(async () => {
    await reload();
    showTab("ledger");
})();
loadStorageBadge();
