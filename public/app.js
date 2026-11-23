let DB = { banks: [], cards: [], fixedExpenses: [], trips: [], monthly: [] };

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

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const txName = (t) => t.memo || t.title;

const txLabel = (t) => (t.memo ? "📝 " : "") + esc(txName(t));

async function copyText(text, done = "복사되었습니다") {
    try {
        await navigator.clipboard.writeText(text);
        toast("success", done);
    } catch {
        toast("error", "복사 실패 — 직접 선택해 주세요");
    }
}

const last4 = (n) => (n ? `•••• ${n}` : "-");

const bankName = (id) => DB.banks.find((b) => b.id === id)?.name || "미지정";

const toast = (icon, title, text = "") =>
    Swal.fire({ toast: true, position: "top-end", icon, title, text, showConfirmButton: false, timer: text ? 5000 : 2000, timerProgressBar: true });

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

const SAVE_DIALOG = { focusConfirm: false, showCancelButton: true, confirmButtonText: "저장", cancelButtonText: "취소", confirmButtonColor: "#4f46e5" };

const validated = (error, value) => (error ? (Swal.showValidationMessage(error), false) : value);

const optionTags = (options, value) => options.map((o) => `<option value="${esc(o.value)}" ${o.value === value ? "selected" : ""}>${esc(o.label)}</option>`).join("");

const formModal = async ({ title, fields, values = {}, validate }) => {
    const html = fields
        .map((f) => {
            const v = values[f.name] ?? "";
            const label = `<label class="block text-left text-sm font-medium text-slate-600 mt-3 mb-1">${f.label}</label>`;
            if (f.type === "select") {
                return `${label}<select id="f_${f.name}" class="swal2-input !m-0 !w-full !flex">${optionTags(f.options, v)}</select>`;
            }
            if (f.type === "number") {
                return `${label}<input id="f_${f.name}" type="text" inputmode="numeric" value="${comma(v)}" placeholder="${f.label}" oninput="formatMoneyInput(this)" class="swal2-input !m-0 !w-full" />`;
            }
            return `${label}<input id="f_${f.name}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${f.label}" class="swal2-input !m-0 !w-full" />`;
        })
        .join("");
    const { value } = await Swal.fire({
        title,
        html: `<div class="text-left">${html}</div>`,
        ...SAVE_DIALOG,
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
            return validated(validate?.(result), result);
        },
    });
    return value;
};

const bankOptions = (prefix = "") => DB.banks.map((b) => ({ value: b.id, label: prefix + b.name }));

const card = (inner) => `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">${inner}</div>`;

const sectionHeader = (title, btnLabel, onClick, resetFn = "", extra = "") =>
    `<div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 class="text-lg font-bold text-slate-700">${title}</h2>
        <div class="flex items-center gap-3">
            ${resetFn ? `<button onclick="${resetFn}" class="text-xs text-slate-400 hover:text-red-500 hover:underline">🗑️ 초기화</button>` : ""}
            ${extra}
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
    if (isConfirmed) await revealSecret(id, `🔒 ${name}`);
}

async function revealSecret(id, title) {
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
            title,
            html: `<div class="text-left">${rows}<p class="text-xs text-slate-400 mt-3">창을 닫으면 화면에서 사라집니다.</p></div>`,
            confirmButtonText: "닫기",
            confirmButtonColor: "#4f46e5",
        });
        window._secretVals = null;
    } catch (e) {
        toast("error", e.message);
    }
}

const readSecret = (id) => (DB.secrets?.[id]?.has ? api("POST", `/api/secrets/${id}/reveal`).catch(() => null) : null);

async function secretEdit(type, id) {
    const name = secretName(type, id);
    const meta = DB.secrets?.[id];
    const r = await readSecret(id);
    const values = r ? { ...r.fields, hint: r.hint } : { hint: meta?.hint || "" };
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
    if (v != null) await copyText(String(v));
}

const relayChain = () => DB.banks.filter((b) => !b.relayExclude);

const fundSource = () => {
    const chain = relayChain();
    return DB.banks.find((b) => b.relayExclude && chain.some((x) => x.id === b.fundTarget));
};

const relayBadges = (b) => {
    const tag = (text, cls) => `<span class="inline-block text-xs px-2 py-0.5 rounded ${cls}">${text}</span>`;
    if (b.relayExclude)
        return tag("🚫 릴레이 제외", "bg-slate-100 text-slate-500") + (fundSource() === b ? ` ${tag(`💰 부족분 충당 → ${bankName(b.fundTarget)}`, "bg-sky-50 text-sky-700")}` : "");
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
        <div class="grid gap-3 md:grid-cols-2">${list}</div>
        <div class="mt-10">${accountsSection()}</div>`;
}

const findAccount = (id) => DB.accounts.find((a) => a.id === id);

const accountCard = (a) =>
    card(`<div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
            <p class="font-bold text-slate-800">${esc(a.owner)}${a.relation ? ` <span class="text-sm font-normal text-slate-400">(${esc(a.relation)})</span>` : ""}</p>
            <p class="text-sm text-slate-500 mt-1">${esc(a.bank)} ${last4(a.accountLast4)}</p>
            ${a.memo ? `<p class="text-xs text-slate-500 mt-1 break-words">📝 ${esc(a.memo)}</p>` : ""}
        </div>
        ${rowButtons("Account", a.id, ["show", "edit", "delete"])}
    </div>`);

const accountsSection = () =>
    sectionHeader("가족 계좌", "+ 계좌 추가", "addAccount()") +
    `<p class="text-xs text-slate-400 -mt-2 mb-3">계좌번호는 암호화해 저장합니다. 잔액·이체 릴레이·문자 거래 수집에는 쓰이지 않습니다.</p>` +
    (DB.accounts.length ? `<div class="grid gap-3 md:grid-cols-2">${DB.accounts.map(accountCard).join("")}</div>` : emptyState("등록된 가족 계좌가 없습니다."));

const ACCOUNT_FIELDS = [
    { name: "owner", label: "예금주", required: true },
    { name: "relation", label: "관계 (예: 어머니)" },
    { name: "bank", label: "은행", required: true },
    { name: "accountNo", label: "계좌번호", required: true },
    { name: "memo", label: "메모" },
];

const showAccount = (id) => {
    const { owner, bank } = findAccount(id);
    return revealSecret(id, `${esc(owner)} · ${esc(bank)}`);
};

async function editAccount(id) {
    const v = await formModal({ title: id ? "가족 계좌 수정" : "가족 계좌 추가", fields: ACCOUNT_FIELDS, values: { ...findAccount(id), ...(await readSecret(id))?.fields } });
    if (!v) return;
    await saveList("accounts", id, v);
    await reload();
    toast("success", id ? "가족 계좌가 수정되었습니다" : "가족 계좌가 추가되었습니다");
}

const addAccount = () => editAccount(null);

async function deleteAccount(id) {
    if (!(await confirmDelete(`${findAccount(id).owner}님 계좌와 암호화된 계좌번호가 삭제됩니다.`))) return;
    await api("DELETE", `/api/accounts/${id}`);
    await reload();
    toast("success", "가족 계좌가 삭제되었습니다");
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
    const fundOpts = optionTags([{ value: "", label: "사용 안 함" }, ...relayChain().filter((x) => x.id !== id).map((x) => ({ value: x.id, label: x.name }))], b.fundTarget || "");
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
            <label class="block font-medium text-slate-600 mt-4 mb-1">부족분 충당 <span class="text-xs font-normal text-slate-400">(이체 플랜에 모자란 돈을 이 통장에서 보낼 은행 · 릴레이에서 제외한 통장 하나만 적용)</span></label>
            <select id="r_fund" class="swal2-input !m-0 !w-full !flex">${fundOpts}</select>
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
            fundTarget: document.getElementById("r_fund").value,
            fixedTransfers: [...document.querySelectorAll("#ftList .ftRow")]
                .map((r) => ({ bankId: r.querySelector(".ftBank").value, amount: toNum(r.querySelector(".ftAmount").value) }))
                .filter((t) => t.bankId && t.amount > 0),
        }),
    });
    if (!v) return;
    if (v.fundTarget) await Promise.all(DB.banks.filter((x) => x.id !== id && x.fundTarget).map((x) => api("PUT", `/api/banks/${x.id}`, { fundTarget: "" })));
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
let ledgerBank = "";

function bankTxModal(bankId) {
    const txs = (window._ledgerAll || []).filter((t) => t.bankId === bankId);
    const p = window._ledgerPeriod;
    const name = bankName(bankId);
    const sums = txs.reduce(
        (a, t) => {
            if (t.kind === "입금") a.in += t.amount || 0;
            if (t.kind === "출금") a.out += t.amount || 0;
            if (t.kind === "카드") a.card += t.amount || 0;
            return a;
        },
        { in: 0, out: 0, card: 0 }
    );
    const kindCls = { 입금: "bg-green-50 text-green-700", 출금: "bg-red-50 text-red-600", 카드: "bg-purple-50 text-purple-700", 이체: "bg-slate-100 text-slate-500", 안내: "bg-sky-50 text-sky-600", 해외: "bg-teal-50 text-teal-600", 미분류: "bg-amber-50 text-amber-700" };
    const chip = (label, v, cls) => (v ? `<span class="text-xs px-2 py-0.5 rounded-full ${cls}">${label} ${won(v)}</span>` : "");
    const rows = txs.length
        ? txs
              .map((t) => {
                  const amt = t.kind === "해외" && t.fxAmount != null ? `${t.currency} ${t.fxAmount}` : t.amount == null ? "—" : (t.kind === "입금" ? "+" : t.kind === "출금" || t.kind === "카드" ? "−" : "") + won(Math.abs(t.amount));
                  return `<div title="${String(t.raw || "").replace(/"/g, "&quot;").slice(0, 200)}" class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 text-left">
                <span class="text-[11px] text-slate-400 tabular-nums w-20 shrink-0">${String(t.at).slice(5)}</span>
                <span class="text-[11px] px-1.5 py-0.5 rounded shrink-0 ${kindCls[t.kind] || kindCls.이체}">${t.kind}</span>
                <span class="flex-1 text-sm text-slate-700 truncate">${txLabel(t)}</span>
                ${t.balance != null ? `<span class="text-[11px] text-sky-500 shrink-0">잔액 ${won(t.balance)}</span>` : ""}
                <span class="font-bold tabular-nums text-sm shrink-0 ${t.kind === "입금" ? "text-green-600" : t.kind === "출금" ? "text-red-500" : t.kind === "카드" ? "text-purple-600" : t.kind === "해외" ? "text-teal-600" : "text-slate-400"}">${amt}</span>
            </div>`;
              })
              .join("")
        : `<p class="text-center text-slate-400 py-8">이 기간 ${name} 거래가 없습니다.</p>`;
    Swal.fire({
        title: `🏦 ${name} <span class="text-sm font-normal text-slate-400 tabular-nums">${p.start.replace(/-/g, ".")} ~ ${p.end.replace(/-/g, ".")}</span>`,
        html: `<div class="text-left">
            <div class="flex gap-1.5 flex-wrap mb-2">
                <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">${txs.length}건</span>
                ${chip("입금 +", sums.in, "bg-green-50 text-green-700")}
                ${chip("출금 −", sums.out, "bg-red-50 text-red-600")}
                ${chip("카드 −", sums.card, "bg-purple-50 text-purple-700")}
            </div>
            <div class="max-h-96 overflow-y-auto pr-1">${rows}</div>
            <p class="text-[11px] text-slate-400 mt-2">행에 마우스를 올리면 원문 일부가 보입니다.</p>
        </div>`,
        width: 620,
        confirmButtonText: "닫기",
        confirmButtonColor: "#4f46e5",
    });
}

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

function currentAnchor(day, now = new Date()) {
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

const shiftMonth = (ym, dir) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    return `${d.getFullYear()}-${pad0(d.getMonth() + 1)}`;
};

function moveLedger(dir) {
    ledgerMonth = shiftMonth(ledgerMonth, dir);
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

const setLedgerBank = (id) => {
    ledgerBank = id;
    drawLedger();
};

const clearLedgerFilters = () => {
    ledgerFilter = null;
    setLedgerBank("");
};

const sectionOpen = (k) => {
    try {
        return localStorage.getItem("ledgerSect_" + k) !== "0";
    } catch {
        return true;
    }
};
const sectionToggle = (k, open) => {
    try {
        localStorage.setItem("ledgerSect_" + k, open ? "1" : "0");
    } catch {}
};
const collapsible = (key, titleHtml, bodyHtml) =>
    card(`<details ${sectionOpen(key) ? "open" : ""} ontoggle="sectionToggle('${key}', this.open)">
        <summary class="cursor-pointer select-none">
            <h3 class="font-bold text-slate-700 inline">${titleHtml}</h3>
        </summary>
        <div class="mt-3">${bodyHtml}</div>
    </details>`);

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

const balanceSourceTag = (c) => `${c.manual ? "✏️" : c.est ? "≈" : "📩"} ${c.at.slice(5)}`;

const LEDGER_KINDS = [
    { key: "입금", sign: "+", amtCls: "text-green-600" },
    { key: "출금", sign: "−", amtCls: "text-red-500" },
    { key: "카드", sign: "−", amtCls: "text-purple-600" },
    { key: "이체", sign: "", amtCls: "text-slate-500" },
    { key: "안내", sign: "", amtCls: "text-sky-600" },
    { key: "해외", sign: "", amtCls: "text-teal-600" },
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
                <td onclick="bankTxModal('${b.id}')" title="클릭하면 이 기간 거래를 팝업으로 표시" class="py-2 px-2 font-medium whitespace-nowrap cursor-pointer text-slate-700 hover:text-indigo-600">🏦 ${b.name}</td>
                <td onclick="editBalance('${b.id}')" title="클릭해서 잔액 직접 입력" class="py-2 px-2 text-right tabular-nums font-bold cursor-pointer hover:bg-slate-50 ${c ? (c.amount >= 0 ? "text-slate-800" : "text-red-600") : "text-slate-300"}">${c ? won(c.amount) : "✏️ 입력"}</td>
                <td ${window._needTips[b.id] ? `onmouseenter="showNeedTip(this, '${b.id}')" onmouseleave="hideNeedTip()" onclick="showNeedTip(this, '${b.id}')"` : ""} class="py-2 px-2 text-right tabular-nums ${window._needTips[b.id] ? "cursor-help" : ""} ${need ? "text-orange-500" : "text-slate-300"}">${need ? won(need) : "—"}${paid ? `<span class="block text-[10px] text-green-600">✓ ${won(paid)} 출금 확인</span>` : ""}${retainUsed ? `<span class="block text-[10px] text-slate-400">남길 ${won(retain)} 중 ${won(retainUsed)} 출금 소진</span>` : ""}</td>
                <td class="py-2 px-2 text-right tabular-nums font-bold ${free == null ? "text-slate-300" : free >= 0 ? "text-green-600" : "text-red-600"}">${free == null ? "—" : won(free)}</td>
                <td class="py-2 px-2 text-right text-xs text-slate-400 whitespace-nowrap">${c ? balanceSourceTag(c) : "수집 전"}</td>
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

    const bankTxs = ledgerBank ? txs.filter((t) => t.bankId === ledgerBank) : txs;
    const stats = bankTxs.reduce((a, t) => {
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
            class="rounded-xl border px-1.5 py-3 text-center transition ${active ? "border-indigo-400 ring-2 ring-indigo-200 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}">
            <p class="text-xs text-slate-500">${k.key}</p>
            <p class="text-sm font-bold tabular-nums whitespace-nowrap ${k.amtCls}">${k.key === "미분류" || k.key === "해외" ? `${s.n}건` : k.sign + won(s.sum)}</p>
            <p class="text-[11px] text-slate-400 whitespace-nowrap">${k.key === "미분류" ? "원문 보존" : k.key === "해외" ? "합산 제외" : `${s.n}건`}</p>
        </button>`;
    }).join("");
    const netTile = `<div class="rounded-xl border border-slate-200 bg-slate-50 px-1.5 py-3 text-center">
        <p class="text-xs text-slate-500">순변동</p>
        <p class="text-sm font-bold tabular-nums whitespace-nowrap ${net >= 0 ? "text-slate-700" : "text-red-600"}">${won(net)}</p>
        <p class="text-[11px] text-slate-400 whitespace-nowrap">입금 − 출금</p>
    </div>`;

    const kindCls = { 입금: "bg-green-50 text-green-700", 출금: "bg-red-50 text-red-600", 카드: "bg-purple-50 text-purple-700", 이체: "bg-slate-100 text-slate-500", 안내: "bg-sky-50 text-sky-600", 해외: "bg-teal-50 text-teal-600", 미분류: "bg-amber-50 text-amber-700" };
    const shown = ledgerFilter ? bankTxs.filter((t) => (t.kind || "미분류") === ledgerFilter) : bankTxs;
    const filterLabel = [ledgerBank && bankName(ledgerBank), ledgerFilter].filter(Boolean).join(" · ");
    window._ledgerTx = shown;
    const links = tripLinks();
    const txRows = shown.length
        ? shown
              .map((t, i) => {
                  const srcs = [t.bankId ? bankName(t.bankId) : "", t.cardId ? DB.cards.find((c) => c.id === t.cardId)?.company || "" : ""].filter(Boolean).join(" · ");
                  const amt = t.kind === "해외" && t.fxAmount != null ? `${t.currency} ${t.fxAmount}` : t.amount == null ? "—" : (t.kind === "입금" ? "+" : t.kind === "출금" || t.kind === "카드" ? "−" : "") + won(Math.abs(t.amount));
                  return `<div onclick="showTxRaw(${i})" class="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 cursor-pointer hover:bg-slate-50 ${t.status === "pending" ? "opacity-60" : ""}">
                <span class="text-xs text-slate-400 tabular-nums w-24 shrink-0">${String(t.at).slice(5)}</span>
                <span class="text-xs px-1.5 py-0.5 rounded shrink-0 ${kindCls[t.kind] || kindCls.이체}">${t.kind}</span>
                <span class="flex-1 text-sm text-slate-700 truncate">${t.imported ? "📄 " : t.manual ? "✍️ " : ""}${txLabel(t)}
                    ${srcs ? `<span class="text-xs text-slate-400">(${srcs})</span>` : ""}
                    ${t.balance != null ? `<span class="text-xs text-sky-500">잔액 ${won(t.balance)}</span>` : ""}
                    ${links[t.id] ? `<span class="text-xs text-teal-600">🧳 ${esc(links[t.id])}</span>` : ""}
                </span>
                <span class="font-bold tabular-nums text-sm shrink-0 ${t.kind === "입금" ? "text-green-600" : t.kind === "출금" ? "text-red-500" : t.kind === "카드" ? "text-purple-600" : t.kind === "해외" ? "text-teal-600" : "text-slate-400"}">${amt}</span>
            </div>`;
              })
              .join("")
        : `<p class="text-center text-slate-400 py-8">${filterLabel ? `${filterLabel} 거래가 없습니다.` : `이 기간의 거래 내역이 없습니다.`}</p>`;

    const period = window._ledgerPeriod;
    const periodLabel = `${period.start.replace(/-/g, ".")} ~ ${period.end.replace(/-/g, ".")}`;
    document.getElementById("tab-ledger").innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 class="text-lg font-bold text-slate-700">잔액·거래</h2>
            <div class="flex flex-wrap items-center gap-1.5">
                <button onclick="moveLedger(-1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">◀</button>
                <span class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-sm font-medium text-slate-700 tabular-nums whitespace-nowrap">${periodLabel}</span>
                <button onclick="moveLedger(1)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">▶</button>
                <button onclick="setCycleDay()" title="기준일 설정 (현재 매월 ${cycleDay()}일 시작)" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-50 text-sm">⚙</button>
                <button onclick="resetLedger()" title="거래·수집 데이터 초기화" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-400 hover:text-red-500 hover:bg-red-50 text-sm">🗑️</button>
                <button onclick="importStatement()" title="은행 거래내역 엑셀 가져오기" class="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm whitespace-nowrap">📥 엑셀</button>
                <button onclick="saveLedgerTx()" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition whitespace-nowrap">+ 거래 추가</button>
            </div>
        </div>
        <div class="grid grid-cols-1 gap-4">
            ${collapsible("bal", `은행별 현재 잔액 <span class="text-xs font-normal text-slate-400">(유지 필요 = 이번 기간에 안 빠져나간 카드값+카드외지출 + 남길 금액 — 같은 금액의 출금 문자가 오면 자동 차감)</span>`, `
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
            ${DB.cards.length ? collapsible("cards", `카드 사용 현황 <span class="text-xs font-normal text-slate-400">(승인 합계 = 기간 내 승인 문자 합산 · 누적/결제 예정 = 카드사 문자 수집)</span>`, `
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
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 class="font-bold text-slate-700">기간 요약 <span class="text-xs font-normal text-slate-400">(누르면 해당 구분만 필터)</span></h3>
                <select onchange="setLedgerBank(this.value)" aria-label="은행 필터" class="text-sm border rounded-lg px-2 py-1.5 bg-white ${ledgerBank ? "border-indigo-400 text-indigo-700" : "border-slate-300 text-slate-600"}">${optionTags([{ value: "", label: "🏦 전체 은행" }, ...bankOptions("🏦 ")], ledgerBank)}</select>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(5,1fr)_0.55fr_0.6fr_1fr] gap-2">${tiles}${netTile}</div>`)}
            ${collapsible("tx", `거래 내역 <span class="text-xs font-normal text-slate-400">(${filterLabel ? `${esc(filterLabel)} ${shown.length}건 / 전체 ${txs.length}건` : `${txs.length}건`}, 행을 누르면 원문)</span>`, `
            ${filterLabel ? `<div class="mb-2 text-right"><button onclick="clearLedgerFilters()" class="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">✕ ${esc(filterLabel)} 필터 해제</button></div>` : ""}
            ${txRows}`)}
        </div>`;
}

async function showTxRaw(i) {
    const t = window._ledgerTx?.[i];
    if (!t) return;
    const linked = tripLinks()[t.id];
    const { isDenied, dismiss } = await Swal.fire({
        title: esc(t.title),
        html: `<div class="text-left text-sm">
            <p class="text-slate-500 mb-2">${t.at} · ${t.kind}${t.kind === "해외" && t.fxAmount != null ? ` · ${t.currency} ${t.fxAmount}` : ""}${t.amount != null ? ` · ${won(t.amount)}` : ""}${t.balance != null ? ` · 잔액 ${won(t.balance)}` : ""}${t.status === "pending" ? ' · <b class="text-amber-600">미분류(pending)</b>' : ""}</p>
            <p class="mb-2 text-slate-700">📝 ${t.memo ? esc(t.memo) : '<span class="text-slate-400">메모 없음</span>'}
                <button onclick="editTxMemo(${i})" class="ml-1 text-xs text-indigo-600 hover:underline">수정</button></p>
            ${t.manual
                ? `<p class="text-xs text-slate-500">${t.imported ? "📄 엑셀 거래내역에서 가져온 거래입니다." : "✍️ 직접 입력한 거래입니다."} <button onclick="editLedgerTx(${i})" class="ml-1 text-xs text-indigo-600 hover:underline">거래 수정</button></p>`
                : `<pre class="bg-slate-100 rounded-lg p-3 text-xs whitespace-pre-wrap text-slate-700">${esc(t.raw || "(원문 없음)")}</pre>
            <p class="text-xs text-slate-400 mt-2">발신: ${esc(t.sender || "-")}</p>`}
            ${linked ? `<p class="text-xs text-teal-600 mt-2">🧳 ${esc(linked)}에 담긴 거래입니다.</p>` : ""}
        </div>`,
        confirmButtonText: "닫기",
        confirmButtonColor: "#4f46e5",
        showDenyButton: true,
        denyButtonText: "삭제",
        denyButtonColor: "#dc2626",
        showCancelButton: !linked && !!t.amount,
        cancelButtonText: "🧳 모임에 담기",
        cancelButtonColor: "#0d9488",
        reverseButtons: true,
    });
    if (dismiss === Swal.DismissReason.cancel) return addTxToTrip(t);
    if (isDenied && (await confirmDelete("이 거래를 삭제합니다."))) {
        const { reverted, currentBalances } = await api("DELETE", `/api/transactions/${t.id}`);
        DB.currentBalances = currentBalances;
        toast("success", "거래가 삭제되었습니다", reverted ? `${bankName(t.bankId)} 잔액을 되돌렸습니다` : "");
        renderLedger();
    }
}

async function editTxMemo(i) {
    const t = window._ledgerTx?.[i];
    if (!t) return;
    const v = await formModal({ title: "📝 메모", fields: [{ name: "memo", label: "메모" }], values: t });
    if (!v) return;
    Object.assign(t, await api("PUT", `/api/transactions/${t.id}`, v));
    toast("success", "메모가 저장되었습니다");
    drawLedger();
}

const txSourceKey = (kind) => (kind === "카드" ? "cardId" : "bankId");

const txSourceOptions = (kind, value) =>
    optionTags(
        [
            { value: "", label: "선택하세요" },
            ...(kind === "카드" ? DB.cards.map((c) => ({ value: c.id, label: `💳 ${c.company}${c.alias ? ` (${c.alias})` : ""}` })) : bankOptions("🏦 ")),
        ],
        value
    );

const balanceText = (cur) => `${won(cur.amount)}${cur.est ? "(≈ 추정)" : ""}`;

const ledgerAnchorOf = (at) => currentAnchor(cycleDay(), new Date(at.replace(" ", "T")));

const BALANCE_NOTES = {
    applied: (name, cur) => `${name} 잔액이 ${balanceText(cur)}으로 반영되었습니다`,
    noCurrent: (name) => `현재 잔액이 없어 ${name} 잔액은 반영하지 않았습니다. ✏️로 잔액을 입력하세요`,
    beforeEstimate: (name, cur) => `${String(cur.base ?? cur.at).slice(5)} 이전 거래라 ${name} 추정 잔액은 그대로입니다. 필요하면 ✏️로 맞추세요`,
    older: (name, cur) => `${cur.at.slice(5)} 잔액이 더 최근이라 ${name} 잔액은 그대로입니다`,
};

const balanceNote = (t, result) => BALANCE_NOTES[result]?.(bankName(t.bankId), DB.currentBalances?.[t.bankId]) || "";

const editLedgerTx = (i) => window._ledgerTx?.[i] && saveLedgerTx(window._ledgerTx[i]);

async function saveLedgerTx(t = null) {
    const kind = t?.kind || "출금";
    const { value } = await Swal.fire({
        title: t ? "거래 수정" : "거래 직접 추가",
        html: `<div class="text-left text-sm">
            <div class="grid grid-cols-2 gap-2">
                <div>${fieldLabel("일시")}<input id="lt_at" type="datetime-local" class="swal2-input !m-0 !w-full" value="${(t?.at || stampNow()).replace(" ", "T")}" /></div>
                <div>${fieldLabel("구분")}<select id="lt_kind" class="swal2-input !m-0 !w-full !flex">${optionTags(["출금", "입금", "카드"].map((k) => ({ value: k, label: k })), kind)}</select></div>
            </div>
            ${fieldLabel("은행·카드")}
            <select id="lt_src" class="swal2-input !m-0 !w-full !flex">${txSourceOptions(kind, t?.[txSourceKey(kind)])}</select>
            <div class="grid grid-cols-2 gap-2">
                <div>${fieldLabel("금액")}${moneyInput("lt_amount", t?.amount ?? "")}</div>
                <div id="lt_balWrap" class="${kind === "카드" ? "invisible" : ""}">${fieldLabel("거래 후 잔액 (선택)")}${moneyInput("lt_balance", t?.balance ?? "")}</div>
            </div>
            ${fieldLabel("내용")}
            <input id="lt_title" class="swal2-input !m-0 !w-full" placeholder="예: 김수연 송금" value="${esc(t?.title || "")}" />
            <p class="text-xs text-slate-400 mt-2">잔액을 적으면 그 값으로, 비우면 현재 잔액에서 더하거나 빼서 반영합니다. 이 일시 뒤에 실제 잔액이 이미 들어왔으면 잔액은 바꾸지 않습니다.${t ? " 수정하면 이전 값의 잔액 반영을 되돌린 뒤 새 값으로 다시 반영합니다." : ""}</p>
        </div>`,
        ...SAVE_DIALOG,
        didOpen: () => {
            const kind = document.getElementById("lt_kind");
            kind.onchange = () => {
                document.getElementById("lt_src").innerHTML = txSourceOptions(kind.value);
                document.getElementById("lt_balWrap").classList.toggle("invisible", kind.value === "카드");
            };
        },
        preConfirm: () => {
            const val = (id) => document.getElementById(id).value.trim();
            const kind = val("lt_kind");
            const src = val("lt_src");
            const v = {
                at: val("lt_at").replace("T", " "),
                kind,
                amount: toNum(val("lt_amount")),
                balance: val("lt_balance") ? toNum(val("lt_balance")) : null,
                title: val("lt_title"),
                [txSourceKey(kind)]: src,
            };
            const sources = kind === "카드" ? DB.cards : DB.banks;
            const error = !v.at ? "일시를 입력하세요" : !src ? (sources.length ? "은행·카드를 선택하세요" : "은행·카드를 먼저 등록하세요") : !(v.amount > 0) ? "금액을 입력하세요" : "";
            return validated(error, v);
        },
    });
    if (!value) return;
    const { transaction, balanceResult, reverted, currentBalances } = await api(t ? "PUT" : "POST", t ? `/api/transactions/${t.id}` : "/api/transactions", value);
    DB.currentBalances = currentBalances;
    ledgerMonth = ledgerAnchorOf(value.at);
    await renderLedger();
    const movedFrom = reverted && t.bankId !== transaction.bankId ? `${bankName(t.bankId)} 잔액은 되돌렸습니다` : "";
    toast("success", t ? "거래가 수정되었습니다" : "거래가 추가되었습니다", [balanceNote(transaction, balanceResult), movedFrom].filter(Boolean).join(" · "));
}

const concatBytes = (...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((offset, p) => (out.set(p, offset), offset + p.length), 0);
    return out;
};

const le32 = (n) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
};

const sha1 = async (...parts) => new Uint8Array(await crypto.subtle.digest("SHA-1", concatBytes(...parts)));

async function aesEcbDecrypt(rawKey, data) {
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-CBC", false, ["encrypt", "decrypt"]);
    const pad = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: data.slice(-16) }, key, new Uint8Array(0)));
    const out = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, concatBytes(data, pad)));
    for (let i = 16; i < data.length; i++) out[i] ^= data[i - 16];
    return out;
}

async function standardEncryptionKey(password, salt, keyLength) {
    const utf16 = new Uint8Array(password.length * 2);
    for (let i = 0; i < password.length; i++) new DataView(utf16.buffer).setUint16(i * 2, password.charCodeAt(i), true);
    let hash = await sha1(salt, utf16);
    for (let i = 0; i < 50000; i++) hash = await sha1(le32(i), hash);
    hash = await sha1(hash, le32(0));
    const derive = (fill) => sha1(new Uint8Array(64).fill(fill).map((b, i) => b ^ (hash[i] ?? 0)));
    return concatBytes(await derive(0x36), await derive(0x5c)).slice(0, keyLength);
}

async function decryptWorkbook(XLSX, cfb, password) {
    const stream = (name) => Uint8Array.from(XLSX.CFB.find(cfb, name)?.content || []);
    const info = stream("EncryptionInfo"), pkg = stream("EncryptedPackage");
    const view = new DataView(info.buffer);
    if (!pkg.length || view.getUint16(2, true) !== 2) throw new Error("이 파일의 암호 방식은 지원하지 않습니다. 엑셀에서 암호를 풀어 저장한 파일을 올려 주세요");
    if (!password) throw new Error("암호가 걸린 파일입니다. 파일 비밀번호를 입력하세요");
    const verifierAt = 12 + view.getUint32(8, true);
    const saltEnd = verifierAt + 4 + view.getUint32(verifierAt, true);
    const key = await standardEncryptionKey(password, info.slice(verifierAt + 4, saltEnd), view.getUint32(28, true) / 8);
    const verifier = await aesEcbDecrypt(key, info.slice(saltEnd, saltEnd + 16));
    const verifierHash = await aesEcbDecrypt(key, info.slice(saltEnd + 20, saltEnd + 52));
    if ((await sha1(verifier)).some((b, i) => b !== verifierHash[i])) throw new Error("파일 비밀번호가 맞지 않습니다");
    const size = Number(new DataView(pkg.buffer).getBigUint64(0, true));
    return (await aesEcbDecrypt(key, pkg.slice(8, 8 + Math.floor((pkg.length - 8) / 16) * 16))).slice(0, size);
}

async function readSheetRows(file, password) {
    const XLSX = await loadXlsx();
    let bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
        const cfb = XLSX.CFB.read(bytes, { type: "array" });
        if (XLSX.CFB.find(cfb, "EncryptionInfo")) bytes = await decryptWorkbook(XLSX, cfb, password);
    }
    const book = XLSX.read(bytes, { type: "array", cellDates: true });
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, defval: "" });
}

const STATEMENT_COLUMNS = {
    at: [/일시|일자|거래일|날짜/],
    time: [/시간|시각/],
    amount: [/금액/, /입금|출금|맡기신|찾으신|잔액/],
    inflow: [/입금|맡기신/, /구분|유형|잔액|후/],
    outflow: [/출금|찾으신|지급/, /구분|유형|잔액|후/],
    balance: [/잔액/],
    type: [/유형|구분/],
    title: [/적요|내용|거래처|받는분|보낸분|기재|상대/],
};

const cellText = (v) => (v instanceof Date ? stampNow(new Date(Math.round(v.getTime() / 1000) * 1000)) : String(v ?? "").trim());

const statementNumber = (v) => toNum(cellText(v).replace(/[−–]/g, "-"));

const statementAt = (date, time) => {
    const d = cellText(date).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?/);
    if (!d) return "";
    const hm = cellText(time).match(/(\d{1,2}):(\d{2})/) || (d[4] ? [, d[4], d[5]] : [, "0", "00"]);
    return `${d[1]}-${pad0(d[2])}-${pad0(d[3])} ${pad0(hm[1])}:${hm[2]}`;
};

function parseStatement(matrix) {
    const headerRow = matrix.findIndex((row) => row.some((c) => STATEMENT_COLUMNS.at[0].test(cellText(c))) && row.some((c) => /잔액/.test(cellText(c))));
    if (headerRow < 0) throw new Error("「거래일시」와 「잔액」 머리글을 찾지 못했습니다");
    const header = matrix[headerRow].map((c) => cellText(c).replace(/\s/g, ""));
    const col = Object.fromEntries(Object.entries(STATEMENT_COLUMNS).map(([key, [re, not]]) => [key, header.findIndex((h) => re.test(h) && !not?.test(h))]));
    if (col.amount < 0 && col.inflow < 0 && col.outflow < 0) throw new Error(`금액 열을 찾지 못했습니다 (머리글: ${header.filter(Boolean).join(", ")})`);
    const rows = matrix
        .slice(headerRow + 1)
        .map((r) => ({
            at: statementAt(r[col.at], r[col.time]),
            amount: col.amount >= 0 ? statementNumber(r[col.amount]) : statementNumber(r[col.inflow]) - statementNumber(r[col.outflow]),
            balance: cellText(r[col.balance]) === "" ? null : statementNumber(r[col.balance]),
            title: cellText(r[col.title]),
            type: cellText(r[col.type]),
        }))
        .filter((r) => r.at && r.amount);
    if (col.amount >= 0 && rows.every((r) => r.amount > 0)) {
        const chrono = String(rows[0]?.at) > String(rows.at(-1)?.at) ? [...rows].reverse() : rows;
        chrono.forEach((r, i) => {
            const prev = chrono[i - 1];
            const outflow = prev?.balance != null && r.balance != null ? r.balance < prev.balance : /출금|지급|결제|송금|납부|인출/.test(r.type);
            if (outflow) r.amount = -r.amount;
        });
    }
    return rows.map(({ type, ...r }) => r);
}

async function importStatement() {
    loadXlsx().catch(() => {});
    const { value } = await Swal.fire({
        title: "📥 거래내역 엑셀 가져오기",
        html: `<div class="text-left text-sm">
            ${fieldLabel("은행")}
            <select id="st_bank" class="swal2-input !m-0 !w-full !flex">${optionTags([{ value: "", label: "선택하세요" }, ...bankOptions("🏦 ")], ledgerBank)}</select>
            ${fieldLabel("엑셀 파일")}
            <input id="st_file" type="file" accept=".xlsx,.xls" class="block w-full text-sm text-slate-600" />
            ${fieldLabel("파일 비밀번호 (암호가 걸린 파일만)")}
            <input id="st_password" type="password" autocomplete="off" class="swal2-input !m-0 !w-full" />
            <p class="text-xs text-slate-400 mt-2">은행 앱에서 받은 거래내역 엑셀을 올리면 장부에 없는 거래만 추가하고, 마지막 거래 후 잔액으로 현재 잔액을 맞춥니다. 저장 전에 확인 화면을 보여 줍니다. 비밀번호는 이 브라우저에서 파일을 여는 데만 쓰고 서버로 보내지 않습니다.</p>
        </div>`,
        ...SAVE_DIALOG,
        confirmButtonText: "확인하기",
        showLoaderOnConfirm: true,
        didOpen: () => {
            document.getElementById("st_file").onchange = (e) => {
                const name = (e.target.files[0]?.name || "").replace(/\s/g, "");
                const bank = DB.banks.find((b) => name.includes(b.name.replace(/\s/g, "")));
                if (bank) document.getElementById("st_bank").value = bank.id;
            };
        },
        preConfirm: async () => {
            const bankId = document.getElementById("st_bank").value;
            const file = document.getElementById("st_file").files[0];
            if (!bankId || !file) return validated(bankId ? "엑셀 파일을 선택하세요" : "은행을 선택하세요");
            try {
                const rows = parseStatement(await readSheetRows(file, document.getElementById("st_password").value));
                if (!rows.length) throw new Error("가져올 거래 행이 없습니다");
                return { bankId, rows, preview: await api("POST", "/api/transactions/import", { bankId, rows }) };
            } catch (e) {
                return validated(e.message);
            }
        },
    });
    if (!value) return;
    const { bankId, rows, preview } = value;
    const added = preview.rows.filter((r) => !r.match).length;
    const applied = preview.balanceResult === "applied";
    const actionable = added > 0 || applied;
    const cur = preview.currentBalances[bankId];
    const balanceLine =
        {
            applied: () => `현재 잔액을 ${balanceText(cur)}으로 맞춥니다.`,
            same: () => `현재 잔액(${won(cur.amount)})이 엑셀과 이미 같습니다.`,
            older: () => "장부에 엑셀보다 최근 실제 잔액이 있어 현재 잔액은 그대로 둡니다.",
        }[preview.balanceResult]?.() || "엑셀에 잔액이 없어 현재 잔액은 그대로 둡니다.";
    const list = [...preview.rows]
        .reverse()
        .map(
            (r) => `<div class="flex items-center gap-2 py-1.5 border-b border-slate-100 last:border-0 ${r.match ? "text-slate-400" : "text-slate-700"}">
                <span class="text-[11px] tabular-nums w-20 shrink-0">${r.at.slice(5)}</span>
                <span class="flex-1 truncate">${esc(r.title)}</span>
                <span class="text-[11px] shrink-0">${r.match ? `있음 ${r.match.at.slice(5)}` : '<b class="text-indigo-600">새로 추가</b>'}</span>
                <span class="tabular-nums font-bold shrink-0 ${r.match ? "" : r.inflow ? "text-green-600" : "text-red-500"}">${r.inflow ? "+" : "−"}${won(r.amount)}</span>
            </div>`
        )
        .join("");
    const { isConfirmed } = await Swal.fire({
        title: `🏦 ${esc(bankName(bankId))} 가져오기 확인`,
        html: `<div class="text-left text-sm">
            <p class="mb-1">엑셀 ${preview.rows.length}건 중 <b class="text-indigo-600">새로 추가 ${added}건</b> · 이미 있음 ${preview.rows.length - added}건${preview.skipped ? ` · 읽지 못한 행 ${preview.skipped}개` : ""}</p>
            <p class="mb-2 text-slate-600">${balanceLine}</p>
            <div class="max-h-80 overflow-y-auto pr-1">${list}</div>
        </div>`,
        width: 640,
        ...SAVE_DIALOG,
        showCancelButton: actionable,
        confirmButtonText: added ? `${added}건 가져오기` : applied ? "잔액 맞추기" : "닫기",
    });
    if (!isConfirmed || !actionable) return;
    const result = await api("POST", "/api/transactions/import", { bankId, rows, commit: true });
    DB.currentBalances = result.currentBalances;
    ledgerBank = bankId;
    ledgerMonth = ledgerAnchorOf(result.rows.at(-1).at);
    await renderLedger();
    toast("success", `${result.rows.filter((r) => !r.match).length}건을 가져왔습니다`, balanceNote({ bankId }, result.balanceResult));
}

const monthlyEl = document.getElementById("tab-monthly");
const MONTH_KEY = "monthlyPeriod";
let selectedMonth = (() => {
    try {
        return sessionStorage.getItem(MONTH_KEY);
    } catch {
        return null;
    }
})();

function selectMonth(month) {
    selectedMonth = month;
    try {
        if (isCurrentCycle()) sessionStorage.removeItem(MONTH_KEY);
        else sessionStorage.setItem(MONTH_KEY, month);
    } catch {}
}

function moveMonthly(dir) {
    selectMonth(shiftMonth(selectedMonth, dir));
    renderMonthly();
}

const isCurrentCycle = () => selectedMonth === currentAnchor(cycleDay());
const isOpenCycle = () => selectedMonth >= currentAnchor(cycleDay());
const isLiveCycle = () => isOpenCycle() && !Object.keys(window._transfersDone || {}).length;

const stampNow = (d = new Date()) => `${d.getFullYear()}-${pad0(d.getMonth() + 1)}-${pad0(d.getDate())} ${pad0(d.getHours())}:${pad0(d.getMinutes())}`;

const today = () => stampNow().slice(0, 10);

const mmdd = (d) => d.slice(5).replace("-", ".");

const balanceBadge = (id, auto, manualAt) => {
    if (auto) return `<span class="text-xs text-sky-500" title="수집 잔액 (${auto.at})">${balanceSourceTag(auto)}</span>`;
    if (!manualAt) return "";
    const collected = isLiveCycle() && DB.currentBalances?.[id];
    const revert = collected ? ` <button type="button" onclick="useCollectedBalance('${id}')" class="underline" title="수집 잔액 ${balanceText(collected)}으로 되돌리기">↺ 수집값</button>` : "";
    return `<span class="text-xs text-amber-600" title="직접 입력 (${manualAt})">✏️ 직접 입력${revert}</span>`;
};

const setBalanceBadge = (id, auto) => {
    document.querySelector(`[data-balance-badge="${id}"]`).innerHTML = balanceBadge(id, auto, window._balancesManual[id]);
    renderSummary();
};

function editMonthlyBalance(input) {
    formatMoneyInput(input);
    const id = input.dataset.balance;
    if (input.value === "") delete window._balancesManual[id];
    else window._balancesManual[id] = stampNow();
    setBalanceBadge(id);
}

function useCollectedBalance(id) {
    const collected = DB.currentBalances[id];
    delete window._balancesManual[id];
    document.querySelector(`[data-balance="${id}"]`).value = comma(collected.amount);
    setBalanceBadge(id, collected);
}

async function renderMonthly() {
    if (!selectedMonth) selectedMonth = currentAnchor(cycleDay());
    const [record, previous] = await Promise.all([api("GET", `/api/monthly/${selectedMonth}`), api("GET", `/api/monthly/${shiftMonth(selectedMonth, -1)}`)]);
    const current = record || { month: selectedMonth, balances: {}, payments: {}, expenses: [] };
    window._monthlyExpenses = current.expenses?.length
        ? current.expenses
        : DB.fixedExpenses.map((e) => ({ name: e.name, amount: e.amount, bankId: e.bankId, memo: e.description || "" }));
    window._transfersDone = current.transfersDone || {};
    window._transferLog = current.transferLog || [];
    window._balancesManual = current.balancesManual || {};

    const live = isLiveCycle();
    const balanceRows = DB.banks.length
        ? DB.banks
              .map((b) => {
                  const saved = current.balances?.[b.id];
                  const collected = DB.currentBalances?.[b.id];
                  const manualAt = window._balancesManual[b.id];
                  const keepSaved = saved != null && (!live || !collected || manualAt >= collected.at);
                  return `<div class="flex items-center justify-between gap-3 py-2">
            <span class="text-slate-700">🏦 ${b.name} <span data-balance-badge="${b.id}">${balanceBadge(b.id, keepSaved ? null : collected, live && manualAt)}</span></span>
            <input data-balance="${b.id}" value="${comma(keepSaved ? saved : (collected?.amount ?? ""))}" type="text" inputmode="numeric" placeholder="잔액" oninput="editMonthlyBalance(this)"
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
            <p data-diff="${c.id}" class="text-xs text-right mt-1">${diffText(curVal, prev)}</p>
            <p data-updiff="${c.id}" class="text-xs text-right mt-0.5">${upDiffText(curVal, upRel?.amount)}</p>
        </div>`;
              })
              .join("")
        : emptyState("등록된 카드가 없습니다.");
    const paymentTotal = DB.cards.length ? `<div id="paymentTotal" class="pt-3 mt-1 border-t-2 border-slate-200"></div>` : "";

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
            ${card(`<h3 class="font-bold text-slate-700 mb-2">① 은행 잔액 <span id="balanceMode" class="text-xs font-normal text-slate-400"></span></h3>${balanceRows}`)}
            ${card(`<h3 class="font-bold text-slate-700 mb-2">② 카드 결제 금액 <span class="text-xs font-normal text-slate-400">(전월 대비 비교)</span></h3><div>${paymentRows}</div>${paymentTotal}`)}
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

const sumFilled = (vals) => {
    const filled = vals.filter((v) => v !== "");
    return filled.length ? filled.reduce((s, v) => s + toNum(v), 0) : "";
};

function renderPaymentTotal() {
    const el = document.getElementById("paymentTotal");
    if (!el) return;
    const inputs = [...document.querySelectorAll("[data-payment]")];
    const cur = sumFilled(inputs.map((i) => i.value));
    el.innerHTML = `<div class="flex items-center justify-between gap-3">
            <span class="font-bold text-slate-700">이번달 카드 결제 합계</span>
            <span class="text-lg font-bold text-red-500 tabular-nums">${won(cur)}</span>
        </div>
        <p class="text-xs text-right mt-1">${diffText(cur, sumFilled(inputs.map((i) => i.dataset.prev)))}</p>`;
}

const upDiffText = (cur, upAmount) => {
    if (upAmount == null || upAmount === "" || cur === "" || cur == null) return "";
    const d = toNum(cur) - Number(upAmount);
    if (d === 0) return `<span class="text-green-600">📩 안내 금액과 일치</span>`;
    return `<span class="text-amber-600">📩 안내 ${won(upAmount)}과 ${d > 0 ? "▲" : "▼"} ${won(Math.abs(d))} 차이</span>`;
};

const diffText = (cur, prev) => {
    const gray = (text) => `<span class="text-slate-400">${text}</span>`;
    if (prev == null || prev === "") return gray("전월 기록 없음");
    if (cur === "" || cur == null) return gray(`전월 ${won(prev)}`);
    const d = toNum(cur) - Number(prev);
    if (d === 0) return gray(`전월과 동일 (${won(prev)})`);
    return d > 0 ? `<span class="text-red-500">▲ 전월 대비 ${won(d)} 더 지출</span>` : `<span class="text-green-600">▼ 전월 대비 ${won(-d)} 절약</span>`;
};

function updateDiff(cardId) {
    const input = document.querySelector(`[data-payment="${cardId}"]`);
    const cur = input.value;
    document.querySelector(`[data-diff="${cardId}"]`).innerHTML = diffText(cur, input.dataset.prev);
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
    await copyText(memo, "메모가 복사되었습니다");
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
    renderPaymentTotal();
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

    const done = window._transfersDone || {};
    const open = isOpenCycle();
    const source = fundSource();
    const fundStep = source && { key: `${source.id}>${source.fundTarget}:s`, fromId: source.id, toId: source.fundTarget };
    const planWith = (amount, bal = balanceOf) => computeRelayPlan(bal, paymentByBank, expenseByBank, fundStep && amount > 0 ? { ...fundStep, amount } : null);
    const shortOf = (p) => p.shortfalls.reduce((s, x) => s + x.amount, 0);
    const base = planWith(0);
    const need = shortOf(base);
    const fundAmount = fundStep && need && (open || done[fundStep.key]) ? need - shortOf(planWith(need)) : 0;
    const plan = fundAmount > 0 ? planWith(fundAmount) : base;
    const { shortfalls } = plan;
    const shortTotal = shortOf(plan);
    const depositBank = shortfalls.find(({ bank }) => {
        const deposited = (id) => balanceOf(id) + (id === bank.id ? shortTotal : 0);
        return !planWith(fundAmount, deposited).shortfalls.length;
    })?.bank;
    const shortAmount = `<b class="text-base text-red-600 tabular-nums">${won(shortTotal)}</b>`;
    const depositNotice = open && shortTotal
        ? `<div class="mb-3 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            💰 <b>입금 필요</b> — ${depositBank ? `${depositBank.name}에 ${shortAmount}을 입금하면 이체 플랜대로 맞아떨어집니다.` : `합계 ${shortAmount}을 은행별로 나누어 입금해야 합니다.`}
            ${shortfalls.length > 1 ? `<span class="block text-xs text-amber-700 mt-0.5">은행별 부족분(남길 금액 포함): ${shortfalls.map((s) => `${s.bank.name} ${won(s.amount)}`).join(" · ")}</span>` : ""}
        </div>`
        : "";
    const modeEl = document.getElementById("balanceMode");
    if (modeEl) modeEl.textContent = !open ? "" : isLiveCycle() ? "(수집 잔액 자동 반영 · 이체 플랜 첫 체크 시 고정)" : "(🔒 이체 시작 시점 잔액으로 고정)";

    const remainClass = (v) => (v >= 0 ? "text-green-600" : "text-red-600");
    const num = (v, cls = "text-slate-700") => `<td class="text-right py-2 px-2 tabular-nums ${cls}">${won(v)}</td>`;
    const totals = { bal: 0, pay: 0, exp: 0, inf: 0, remain: 0 };
    const rows = DB.banks
        .map((b) => {
            const bal = balanceOf(b.id), pay = paymentByBank[b.id] || 0, exp = expenseByBank[b.id] || 0;
            const inf = plan.inflow[b.id] || 0;
            const remain = plan.remain[b.id];
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
                    ${t.fund ? tag("충당", "bg-sky-50 text-sky-700") : ""}
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
        ${depositNotice}
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

function computeRelayPlan(balanceOf, paymentByBank, expenseByBank, fund) {
    const chain = relayChain();
    const inflow = {}, outflow = {}, items = [];
    if (fund) {
        items.push({ kind: "transfer", ...fund, fund: true });
        inflow[fund.toId] = outflow[fund.fromId] = fund.amount;
    }
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
    const remain = Object.fromEntries(
        DB.banks.map((b) => [b.id, balanceOf(b.id) + (inflow[b.id] || 0) - (paymentByBank[b.id] || 0) - (expenseByBank[b.id] || 0) - (outflow[b.id] || 0)])
    );
    const shortfalls = chain.map((b) => ({ bank: b, amount: (Number(b.retainAmount) || 0) - remain[b.id] })).filter((s) => s.amount > 0);
    return { items, inflow, outflow, remain, shortfalls };
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
        balancesManual: window._balancesManual || {},
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
            fund: !!t.fund,
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
    const at = stampNow().slice(5);
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

let selectedTripId = null;

const SPLIT_MODES = { team: "참가 단위별 균등", head: "인원수 비례" };

const tripLinks = () => Object.fromEntries(DB.trips.flatMap((t) => t.items.filter((i) => i.txId).map((i) => [i.txId, t.name])));

const currentTrip = () => DB.trips.find((t) => t.id === selectedTripId) || DB.trips[DB.trips.length - 1];

const tripPeriod = (t) => (t.start || t.end ? `${t.start.replace(/-/g, ".")} ~ ${t.end.replace(/-/g, ".")}` : "");

const memberLabel = (m) => `${m.name}${m.heads > 1 ? ` (${m.heads}명)` : ""}`;

const sortedItems = (trip) => [...trip.items].sort((a, b) => a.at.localeCompare(b.at));

const meOf = (members) => members.find((m) => m.me) || members.find((m) => m.name === "나") || members[0];

const payerIdOf = (trip, item) => item.payerId || meOf(trip.members)?.id;

const itemNote = (trip, item) => {
    const sharers = trip.members.filter((m) => item.shareIds.includes(m.id)).map((m) => m.name);
    return `${trip.members.find((m) => m.id === payerIdOf(trip, item))?.name || "미지정"} 결제${sharers.length ? ` · ${sharers.join(", ")}만 부담` : ""}`;
};

const fieldLabel = (text) => `<label class="block font-medium text-slate-600 mt-3 mb-1">${text}</label>`;

const textButton = (label, onClick, cls) => `<button onclick="${onClick}" class="${cls} hover:underline text-sm">${label}</button>`;

const outlineButton = (label, onClick, cls = "border-slate-300 text-slate-600 hover:bg-slate-50") => `<button onclick="${onClick}" class="text-sm px-3 py-1.5 rounded-lg border ${cls}">${label}</button>`;

const statTile = (label, value, sub, color = "text-slate-800") => `<div class="rounded-xl border border-slate-200 bg-slate-50 px-2 py-3 text-center">
    <p class="text-xs text-slate-500">${label}</p>
    <p class="text-base font-bold tabular-nums whitespace-nowrap ${color}">${value}</p>
    <p class="text-[11px] text-slate-400">${sub}</p>
</div>`;

const moneyInput = (id, value = "") => `<input id="${id}" type="text" inputmode="numeric" class="swal2-input !m-0 !w-full text-right" value="${comma(value)}" oninput="formatMoneyInput(this)" />`;

function settleTrip(trip) {
    const weight = (m) => (trip.splitMode === "head" ? m.heads : 1);
    const rows = trip.members.map((m) => ({ ...m, paid: 0, owed: 0 }));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    let unpaid = 0;
    trip.items.forEach((it) => {
        const payer = byId[payerIdOf(trip, it)];
        if (payer) payer.paid += it.amount;
        else unpaid += it.amount;
        const picked = it.shareIds.map((id) => byId[id]).filter(Boolean);
        const targets = picked.length ? picked : rows;
        if (!targets.length) return;
        const totalWeight = targets.reduce((s, r) => s + weight(r), 0);
        let rest = it.amount;
        targets.forEach((r) => {
            const part = Math.trunc((it.amount * weight(r)) / totalWeight);
            r.owed += part;
            rest -= part;
        });
        (targets.includes(payer) ? payer : targets[0]).owed += rest;
    });
    rows.forEach((r) => (r.net = r.paid - r.owed));
    const pool = rows.map(({ name, net }) => ({ name, net }));
    const debtors = pool.filter((p) => p.net < 0).sort((a, b) => a.net - b.net);
    const creditors = pool.filter((p) => p.net > 0).sort((a, b) => b.net - a.net);
    const transfers = [];
    while (debtors.length && creditors.length) {
        const amount = Math.min(-debtors[0].net, creditors[0].net);
        transfers.push({ from: debtors[0].name, to: creditors[0].name, amount });
        debtors[0].net += amount;
        creditors[0].net -= amount;
        if (!debtors[0].net) debtors.shift();
        if (!creditors[0].net) creditors.shift();
    }
    return { rows, transfers, unpaid, total: trip.items.reduce((s, i) => s + i.amount, 0) };
}

function tripSummaryText(trip) {
    const s = settleTrip(trip);
    const period = tripPeriod(trip);
    return [
        `🧳 ${trip.name} 정산${period ? ` (${period})` : ""}`,
        `총 경비 ${won(s.total)} · ${trip.items.length}건 · ${SPLIT_MODES[trip.splitMode]}`,
        "",
        "[경비 내역]",
        ...sortedItems(trip).map((i) => `${mmdd(i.at)} ${i.title} ${won(i.amount)} (${itemNote(trip, i)})`),
        "",
        "[참가자별]",
        ...s.rows.map((r) => `${memberLabel(r)}: 낸 돈 ${won(r.paid)} / 부담 ${won(r.owed)}`),
        "",
        "[송금]",
        ...(s.transfers.length ? s.transfers.map((t) => `${t.from} → ${t.to} ${won(t.amount)}`) : ["송금할 내역이 없습니다."]),
    ].join("\n");
}

const copyTripSummary = () => copyText(tripSummaryText(currentTrip()), "정산 내용이 복사되었습니다");

function renderTrips() {
    const el = document.getElementById("tab-trips");
    const header = sectionHeader("모임·여행 정산", "+ 모임 추가", "saveTrip()");
    const trip = currentTrip();
    if (!trip) {
        el.innerHTML = header + emptyState("등록된 모임이 없습니다. 모임을 추가한 뒤 잔액·거래 탭의 거래를 눌러 담아 보세요.");
        return;
    }
    selectedTripId = trip.id;
    const s = settleTrip(trip);
    const me = meOf(trip.members);
    const period = tripPeriod(trip);
    const pills = [...DB.trips]
        .reverse()
        .map(
            (t) =>
                `<button onclick="selectTrip('${t.id}')" class="px-3 py-1.5 rounded-full text-sm border transition ${t.id === trip.id ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}">${t.closed ? "🔒" : "🧳"} ${esc(t.name)}</button>`
        )
        .join("");
    const itemRows = trip.items.length
        ? sortedItems(trip)
              .map(
                  (i) => `<div ${trip.closed ? "" : `onclick="editTripItem('${i.id}')"`} class="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 ${trip.closed ? "" : "cursor-pointer hover:bg-slate-50"}">
                <span class="text-xs text-slate-400 tabular-nums w-12 shrink-0">${i.at.slice(5) || "—"}</span>
                <span class="flex-1 text-sm text-slate-700 truncate">${esc(i.title)}
                    <span class="text-xs text-slate-400">(${esc(itemNote(trip, i))})</span>
                    ${i.txId ? `<span class="text-xs text-sky-500" title="수집된 거래에서 담은 항목">📩</span>` : ""}
                    ${i.memo ? `<span class="text-xs text-slate-400">${esc(i.memo)}</span>` : ""}
                </span>
                <span class="font-bold tabular-nums text-sm shrink-0 text-slate-800">${won(i.amount)}</span>
            </div>`
              )
              .join("")
        : emptyState("담긴 경비가 없습니다.");
    const settleRows = s.rows
        .map(
            ({ net, ...r }) => `<tr class="border-b border-slate-100">
                <td class="py-2 px-2 font-medium text-slate-700 whitespace-nowrap">${esc(memberLabel(r))}</td>
                <td class="py-2 px-2 text-right tabular-nums">${won(r.paid)}</td>
                <td class="py-2 px-2 text-right tabular-nums">${won(r.owed)}</td>
                <td class="py-2 px-2 text-right tabular-nums font-bold whitespace-nowrap ${net > 0 ? "text-green-600" : net < 0 ? "text-red-500" : "text-slate-400"}">${net > 0 ? `${won(net)} 받음` : net < 0 ? `${won(-net)} 보냄` : "정산 없음"}</td>
            </tr>`
        )
        .join("");
    const transferRows = s.transfers.length
        ? s.transfers
              .map(
                  (t) => `<div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0 text-sm">
                <span class="text-slate-700">${esc(t.from)} <span class="text-slate-400">→</span> ${esc(t.to)}</span>
                <span class="font-bold tabular-nums text-indigo-600">${won(t.amount)}</span>
            </div>`
              )
              .join("")
        : `<p class="text-sm text-slate-400 py-2">송금할 내역이 없습니다.</p>`;
    el.innerHTML =
        header +
        `<div class="flex flex-wrap gap-2 mb-4">${pills}</div>
        <div class="grid grid-cols-1 gap-4">
            ${card(`
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p class="text-lg font-bold text-slate-800">${esc(trip.name)} ${trip.closed ? `<span class="align-middle text-xs font-normal px-2 py-0.5 rounded bg-slate-100 text-slate-500">🔒 마감</span>` : ""}</p>
                    <p class="text-sm text-slate-500 mt-1">${period || "기간 미지정"} · ${SPLIT_MODES[trip.splitMode]}</p>
                    <div class="mt-2 flex flex-wrap gap-1">${trip.members.map((m) => `<span class="inline-block text-xs px-2 py-0.5 rounded ${m === me ? "bg-indigo-50 text-indigo-700" : "bg-slate-100 text-slate-600"}">${esc(memberLabel(m))}${m === me ? " · 본인" : ""}</span>`).join("")}</div>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    ${trip.closed ? "" : textButton("수정", "editTrip()", "text-indigo-600")}
                    ${textButton(trip.closed ? "마감 해제" : "마감", "toggleTripClosed()", "text-emerald-600")}
                    ${textButton("삭제", "deleteTrip()", "text-red-600")}
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2 mt-4">
                ${statTile("총 경비", won(s.total), `${trip.items.length}건`)}
                ${statTile("참가", `${trip.members.length}곳`, `총 ${trip.members.reduce((n, m) => n + m.heads, 0)}명`)}
                ${statTile("송금", `${s.transfers.length}건`, "정산 결과 기준")}
            </div>`)}
            ${card(`
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 class="font-bold text-slate-700">경비 내역 <span class="text-xs font-normal text-slate-400">(행을 누르면 수정)</span></h3>
                ${trip.closed ? "" : `<div class="flex items-center gap-2">
                    ${outlineButton("📩 기간 거래 불러오기", "importTripTx()")}
                    <button onclick="addTripItem()" class="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">+ 직접 추가</button>
                </div>`}
            </div>
            ${itemRows}`)}
            ${card(`
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 class="font-bold text-slate-700">정산 결과</h3>
                ${outlineButton("📋 정산 내용 복사", "copyTripSummary()")}
            </div>
            ${s.unpaid ? `<p class="text-xs text-amber-600 mb-2">⚠ 결제한 사람이 지정되지 않은 경비가 ${won(s.unpaid)} 있습니다. 지정해야 송금 목록이 맞습니다.</p>` : ""}
            ${trip.members.length < 2
                ? `<p class="text-sm text-slate-400 py-2">참가자를 2곳 이상 등록하면 정산 결과가 표시됩니다.</p>`
                : `<div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-slate-500 border-b-2 border-slate-200 text-xs">
                            <th class="text-left py-2 px-2">참가자</th>
                            <th class="text-right py-2 px-2">낸 돈</th>
                            <th class="text-right py-2 px-2">부담액</th>
                            <th class="text-right py-2 px-2">차액</th>
                        </tr>
                    </thead>
                    <tbody>${settleRows}</tbody>
                </table>
            </div>
            <h4 class="font-bold text-slate-600 text-sm mt-4 mb-1">송금 목록</h4>
            ${transferRows}`}`)}
        </div>`;
}

const selectTrip = (id) => {
    selectedTripId = id;
    renderTrips();
};

async function putTrip(trip, patch) {
    const saved = await api("PUT", `/api/trips/${trip.id}`, patch);
    DB.trips = DB.trips.map((t) => (t.id === saved.id ? saved : t));
    renderTrips();
}

const memberRowHtml = (m = {}, mine = false) => `<div class="tmRow flex items-center gap-2 mt-2" data-id="${m.id || ""}">
        <label class="flex items-center gap-1 text-xs text-slate-500 shrink-0 cursor-pointer"><input type="radio" name="tmMe" class="tmMe w-4 h-4 accent-indigo-600" ${mine ? "checked" : ""} /> 본인</label>
        <input class="tmName swal2-input !m-0 !flex-1 !w-0" value="${esc(m.name)}" placeholder="이름 (예: 형네, 홍길동)" />
        <input class="tmHeads swal2-input !m-0 !w-20 text-right" type="number" min="1" value="${m.heads || 1}" />
        <span class="text-xs text-slate-400 shrink-0">명</span>
        <button type="button" onclick="this.parentElement.remove()" class="text-red-500 text-sm px-1 [.tmRow:has(.tmMe:checked)_&]:invisible">✕</button>
    </div>`;

const addMemberRow = () => document.getElementById("tmList").insertAdjacentHTML("beforeend", memberRowHtml());

async function tripModal(trip) {
    const base = trip || { splitMode: "team", members: (currentTrip()?.members || []).map(({ name, heads, me }) => ({ name, heads, me })) };
    const members = base.members.length ? base.members : [{ name: "나" }];
    const me = meOf(members);
    const { value } = await Swal.fire({
        title: trip ? "모임 수정" : "모임 추가",
        html: `<div class="text-left text-sm">
            ${fieldLabel("모임 이름")}
            <input id="t_name" class="swal2-input !m-0 !w-full" value="${esc(base.name)}" placeholder="예: 12월 가족여행" />
            <div class="grid grid-cols-2 gap-2">
                <div>${fieldLabel("시작일")}<input id="t_start" type="date" class="swal2-input !m-0 !w-full" value="${base.start || ""}" /></div>
                <div>${fieldLabel("종료일")}<input id="t_end" type="date" class="swal2-input !m-0 !w-full" value="${base.end || ""}" /></div>
            </div>
            ${fieldLabel("나누는 기준")}
            <select id="t_mode" class="swal2-input !m-0 !w-full !flex">${Object.entries(SPLIT_MODES).map(([k, v]) => `<option value="${k}" ${k === base.splitMode ? "selected" : ""}>${v}</option>`).join("")}</select>
            <p class="text-xs text-slate-400 mt-1">참가 단위별 균등 = 아래 한 줄마다 같은 금액 · 인원수 비례 = 인원수만큼 부담</p>
            <div class="flex items-center justify-between gap-2 mt-4 mb-1">
                <span class="font-medium text-slate-600">참가자 <span class="text-xs font-normal text-slate-400">(본인 = 경비의 기본 결제자 · 가족은 한 줄에 인원수, 개인은 한 사람씩 1명)</span></span>
                <button type="button" onclick="addMemberRow()" class="text-indigo-600 text-xs hover:underline shrink-0">+ 추가</button>
            </div>
            <div id="tmList">${members.map((m) => memberRowHtml(m, m === me)).join("")}</div>
        </div>`,
        ...SAVE_DIALOG,
        preConfirm: () => {
            const v = {
                name: document.getElementById("t_name").value.trim(),
                start: document.getElementById("t_start").value,
                end: document.getElementById("t_end").value,
                splitMode: document.getElementById("t_mode").value,
                members: [...document.querySelectorAll("#tmList .tmRow")]
                    .map((r) => ({ id: r.dataset.id, me: r.querySelector(".tmMe").checked, name: r.querySelector(".tmName").value.trim(), heads: Number(r.querySelector(".tmHeads").value) || 1 }))
                    .map((m) => ({ ...m, name: m.name || (m.me ? "나" : "") }))
                    .filter((m) => m.name),
            };
            const error = !v.name ? "모임 이름을 입력하세요" : !v.start !== !v.end ? "시작일과 종료일을 함께 입력하세요" : v.start > v.end ? "종료일이 시작일보다 빠릅니다" : "";
            return validated(error, v);
        },
    });
    return value;
}

async function saveTrip() {
    const v = await tripModal();
    if (!v) return;
    selectedTripId = (await api("POST", "/api/trips", { ...v, closed: false, items: [] })).id;
    await reload();
    toast("success", "모임이 추가되었습니다");
}

async function editTrip() {
    const trip = currentTrip();
    const v = await tripModal(trip);
    if (!v) return;
    await putTrip(trip, v);
    toast("success", "모임이 수정되었습니다");
}

async function toggleTripClosed() {
    const trip = currentTrip();
    await putTrip(trip, { closed: !trip.closed });
    toast("success", trip.closed ? "마감이 해제되었습니다" : "정산이 마감되었습니다");
}

async function deleteTrip() {
    const trip = currentTrip();
    if (!(await confirmDelete(`경비 ${trip.items.length}건과 정산 내용이 삭제됩니다. 수집된 거래 내역은 유지됩니다.`))) return;
    await api("DELETE", `/api/trips/${trip.id}`);
    selectedTripId = null;
    await reload();
    toast("success", "모임이 삭제되었습니다");
}

async function tripItemModal(trip, item) {
    const sharers = item.shareIds?.length ? item.shareIds : trip.members.map((m) => m.id);
    const { value, isDenied } = await Swal.fire({
        title: item.id ? "경비 수정" : "경비 추가",
        html: `<div class="text-left text-sm">
            ${fieldLabel("내용")}
            <input id="ti_title" class="swal2-input !m-0 !w-full" value="${esc(item.title)}" placeholder="예: 저녁 식사" />
            <div class="grid grid-cols-2 gap-2">
                <div>${fieldLabel("날짜")}<input id="ti_at" type="date" class="swal2-input !m-0 !w-full" value="${item.at || ""}" /></div>
                <div>${fieldLabel("금액")}${moneyInput("ti_amount", item.amount ?? "")}</div>
            </div>
            ${fieldLabel("결제한 사람")}
            <select id="ti_payer" class="swal2-input !m-0 !w-full !flex">
                ${trip.members.map((m) => `<option value="${m.id}" ${m.id === payerIdOf(trip, item) ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
            </select>
            ${fieldLabel("부담 대상")}
            <div class="flex flex-wrap gap-x-4 gap-y-1">
                ${trip.members.map((m) => `<label class="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" class="tiShare w-4 h-4 accent-indigo-600" value="${m.id}" ${sharers.includes(m.id) ? "checked" : ""} /> ${esc(m.name)}</label>`).join("") || `<span class="text-xs text-slate-400">등록된 참가자가 없습니다.</span>`}
            </div>
            ${fieldLabel("메모")}
            <input id="ti_memo" class="swal2-input !m-0 !w-full" value="${esc(item.memo)}" />
        </div>`,
        ...SAVE_DIALOG,
        showDenyButton: !!item.id,
        denyButtonText: "삭제",
        denyButtonColor: "#dc2626",
        preConfirm: () => {
            const picked = [...document.querySelectorAll(".tiShare:checked")].map((c) => c.value);
            const v = {
                title: document.getElementById("ti_title").value.trim(),
                at: document.getElementById("ti_at").value,
                amount: toNum(document.getElementById("ti_amount").value),
                payerId: document.getElementById("ti_payer").value,
                shareIds: picked.length === trip.members.length ? [] : picked,
                memo: document.getElementById("ti_memo").value.trim(),
            };
            const error = !v.title || !v.amount ? "내용과 금액을 입력하세요" : trip.members.length && !picked.length ? "부담 대상을 1곳 이상 선택하세요" : "";
            return validated(error, v);
        },
    });
    return isDenied ? { remove: true } : value;
}

async function addTripItem() {
    const trip = currentTrip();
    const v = await tripItemModal(trip, { at: trip.start || today(), payerId: meOf(trip.members)?.id });
    if (!v) return;
    await putTrip(trip, { items: [...trip.items, v] });
    toast("success", "경비가 추가되었습니다");
}

async function editTripItem(id) {
    const trip = currentTrip();
    const v = await tripItemModal(trip, trip.items.find((i) => i.id === id));
    if (!v || (v.remove && !(await confirmDelete("이 경비를 모임에서 뺍니다. 수집된 거래 내역은 유지됩니다.")))) return;
    await putTrip(trip, { items: v.remove ? trip.items.filter((i) => i.id !== id) : trip.items.map((i) => (i.id === id ? { ...i, ...v } : i)) });
    toast("success", v.remove ? "경비가 삭제되었습니다" : "경비가 수정되었습니다");
}

const txToItem = (trip, t) => ({ txId: t.id, at: String(t.at).slice(0, 10), title: txName(t), amount: Math.abs(t.amount), payerId: meOf(trip.members)?.id || "", shareIds: [], memo: "" });

async function importTripTx() {
    const trip = currentTrip();
    if (!trip.start) return toast("info", "모임 수정에서 기간을 먼저 입력하세요");
    const linked = tripLinks();
    const txs = (await api("GET", `/api/transactions?from=${trip.start}&to=${trip.end}`)).filter((t) => ["카드", "출금", "이체"].includes(t.kind) && t.amount > 0 && !t.inflow && !linked[t.id]);
    if (!txs.length) return toast("info", "이 기간에 담을 수 있는 거래가 없습니다");
    const { value: picked } = await Swal.fire({
        title: "기간 거래 불러오기",
        html: `<div class="text-left text-sm">
            <p class="text-xs text-slate-400 mb-2">${tripPeriod(trip)} 카드·출금·이체 ${txs.length}건 — 모임 경비만 선택하세요.</p>
            <div class="max-h-96 overflow-y-auto pr-1">
                ${txs.map((t, i) => `<label class="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 cursor-pointer">
                    <input type="checkbox" class="txPick w-4 h-4 accent-indigo-600 shrink-0" value="${i}" />
                    <span class="text-[11px] text-slate-400 tabular-nums w-20 shrink-0">${String(t.at).slice(5)}</span>
                    <span class="flex-1 truncate text-slate-700">${txLabel(t)}</span>
                    <span class="font-bold tabular-nums shrink-0">${won(t.amount)}</span>
                </label>`).join("")}
            </div>
        </div>`,
        width: 620,
        showCancelButton: true,
        confirmButtonText: "선택한 거래 담기",
        cancelButtonText: "취소",
        confirmButtonColor: "#4f46e5",
        preConfirm: () => [...document.querySelectorAll(".txPick:checked")].map((c) => txs[c.value]),
    });
    if (!picked?.length) return;
    await putTrip(trip, { items: [...trip.items, ...picked.map((t) => txToItem(trip, t))] });
    toast("success", `${picked.length}건을 담았습니다`);
}

async function addTxToTrip(t) {
    const open = DB.trips.filter((x) => !x.closed).reverse();
    if (!open.length) return toast("info", "모임·여행 탭에서 모임을 먼저 추가하세요");
    const v = await formModal({
        title: "모임에 담기",
        fields: [
            { name: "tripId", label: "모임", type: "select", options: open.map((x) => ({ value: x.id, label: x.name })) },
            { name: "title", label: "내용", required: true },
            { name: "amount", label: "금액", type: "number", required: true },
        ],
        values: { tripId: open.find((x) => x.id === selectedTripId)?.id || open[0].id, title: txName(t), amount: Math.abs(t.amount) },
    });
    if (!v) return;
    const trip = DB.trips.find((x) => x.id === v.tripId);
    await putTrip(trip, { items: [...trip.items, { ...txToItem(trip, t), title: v.title, amount: v.amount }] });
    drawLedger();
    toast("success", `${trip.name}에 담았습니다`);
}

let addressQuery = "";
let CONTACTS = [];
let SALES = [];
let PRODUCTS = [];

const ADDRESS_FIELDS = [
    { name: "name", label: "이름", required: true, aliases: ["성명", "고객명"] },
    { name: "phone", label: "연락처", type: "tel", aliases: ["전화번호", "휴대폰", "핸드폰"] },
    { name: "address", label: "주소", aliases: [] },
    { name: "memo", label: "메모", aliases: ["비고"] },
];

const findAddress = (id) => CONTACTS.find((a) => a.id === id);

const personLine = (name, phone) => [name, phone].filter(Boolean).join(" ");

const telLink = (phone) => (phone ? `<a href="tel:${esc(phone)}" class="text-indigo-600 hover:underline">${esc(phone)}</a>` : "");

const searchKey = (s) => String(s).toLowerCase().replace(/[\s-]/g, "");

const koCompare = new Intl.Collator("ko").compare;

const byName = (a, b) => koCompare(a.name, b.name);

const excelButton = (onClick) => outlineButton("📥 엑셀", onClick, "border-emerald-600 text-emerald-700 hover:bg-emerald-50");

const selectBox = (onChange, options, value, cls = "") =>
    `<select onchange="${onChange}" class="${cls} px-2 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">${optionTags(options, value)}</select>`;

const sortOptions = (sorts) => Object.entries(sorts).map(([value, [label]]) => ({ value, label }));

const savedChoice = (key, options) => {
    try {
        const v = localStorage.getItem(key);
        if (v in options) return v;
    } catch {}
    return Object.keys(options)[0];
};

const saveChoice = (key, v) => {
    try {
        localStorage.setItem(key, v);
    } catch {}
};

const ADDRESS_SORTS = {
    name: ["이름순", byName],
    recent: ["최근 등록순", (a, b) => b.id.localeCompare(a.id)],
    address: ["주소순", (a, b) => !a.address - !b.address || koCompare(a.address || "", b.address || "") || byName(a, b)],
};

let addressSort = savedChoice("addressSort", ADDRESS_SORTS);

const setAddressSort = (v) => {
    addressSort = v;
    saveChoice("addressSort", v);
    drawAddressList();
};

const visibleAddresses = () => {
    const q = searchKey(addressQuery);
    return CONTACTS.filter((a) => !q || searchKey(ADDRESS_FIELDS.map((f) => a[f.name]).join("")).includes(q)).sort(ADDRESS_SORTS[addressSort][1]);
};

const ROW_ACTIONS = { show: ["🔒 보기", "text-amber-600"], copy: ["복사", "text-slate-600"], edit: ["수정", "text-indigo-600"], delete: ["삭제", "text-red-600"] };

const rowButtons = (kind, id, actions = ["copy", "edit", "delete"]) =>
    `<div class="flex gap-3 shrink-0">${actions.map((a) => textButton(ROW_ACTIONS[a][0], `${a}${kind}('${id}')`, ROW_ACTIONS[a][1])).join("")}</div>`;

async function saveList(collection, id, body) {
    const res = await api(id ? "PUT" : "POST", `/api/${collection}${id ? `/${id}` : ""}`, body);
    if (res.contacts) {
        CONTACTS = res.contacts;
        renderAddresses();
    }
    return res;
}

async function loadAddresses() {
    CONTACTS = await api("GET", "/api/addresses");
    renderAddresses();
}

function renderAddresses() {
    const count = CONTACTS.length;
    document.getElementById("tab-addresses").innerHTML =
        sectionHeader(`주소록 <span class="text-sm font-normal text-slate-400">${count}명</span>`, "+ 연락처 추가", "saveAddress()", "", outlineButton("📤 엑셀 등록", "importAddresses()") + (count ? excelButton("exportAddresses()") : "")) +
        (count
            ? `<div class="flex gap-2 mb-4">
                   <input type="search" value="${esc(addressQuery)}" oninput="filterAddresses(this.value)" placeholder="🔍 이름·연락처·주소 검색" class="flex-1 min-w-0 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                   ${selectBox("setAddressSort(this.value)", sortOptions(ADDRESS_SORTS), addressSort, "shrink-0")}
               </div>
               <div id="addressList" class="grid gap-3 md:grid-cols-2"></div>`
            : emptyState("등록된 연락처가 없습니다. 사과 판매를 등록하면 보내는 사람·받는 사람이 자동으로 추가됩니다."));
    if (count) drawAddressList();
}

function drawAddressList() {
    const list = visibleAddresses();
    document.getElementById("addressList").innerHTML = list.length
        ? list
              .map(
                  (a) => card(`
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-bold text-slate-800">${esc(a.name)} <span class="font-normal text-sm ml-1">${telLink(a.phone)}</span></p>
                    ${a.address ? `<p class="text-sm text-slate-600 mt-1 break-words">${esc(a.address)}</p>` : ""}
                    ${a.memo ? `<p class="text-xs text-slate-500 mt-1 break-words">📝 ${esc(a.memo)}</p>` : ""}
                </div>
                ${rowButtons("Address", a.id)}
            </div>`)
              )
              .join("")
        : `<div class="md:col-span-2">${emptyState("검색 결과가 없습니다.")}</div>`;
}

const filterAddresses = (v) => {
    addressQuery = v;
    drawAddressList();
};

const copyAddress = (id) => {
    const a = findAddress(id);
    copyText([personLine(a.name, a.phone), a.address].filter(Boolean).join("\n"), "연락처가 복사되었습니다");
};

async function submitAddress(id, values) {
    const v = await formModal({ title: id ? "연락처 수정" : "연락처 추가", fields: ADDRESS_FIELDS, values });
    if (!v) return;
    await saveList("addresses", id, v);
    toast("success", id ? "연락처가 수정되었습니다" : "연락처가 추가되었습니다");
}

const saveAddress = () => submitAddress(null);

const editAddress = (id) => submitAddress(id, findAddress(id));

async function deleteAddress(id) {
    if (!(await confirmDelete(`${findAddress(id).name}님 연락처가 삭제됩니다. 판매 기록은 그대로 남습니다.`))) return;
    await api("DELETE", `/api/addresses/${id}`);
    CONTACTS = CONTACTS.filter((a) => a.id !== id);
    renderAddresses();
    toast("success", "연락처가 삭제되었습니다");
}

const SALE_TEXT_FIELDS = ["date", "senderName", "senderPhone", "receiverName", "receiverPhone", "address", "product", "paidDate", "memo"];

const withItem = (list, item) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);

const thisYear = () => today().slice(0, 4);

const descYears = (years) => [...new Set(years.filter(Boolean))].sort().reverse();

const yearOptions = (years) => years.map((y) => ({ value: y, label: `${y}년` }));

const productYears = () => descYears(PRODUCTS.map((p) => p.year));

const productsOf = (year) => PRODUCTS.filter((p) => p.year === year).sort(byName);

const findProduct = (id) => PRODUCTS.find((p) => p.id === id);

function priceCard() {
    const years = productYears().filter((y) => !saleView.year || y === saleView.year);
    const line = (p) => `<div class="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 text-sm">
        <span class="text-slate-700">${esc(p.name)}</span>
        <span class="flex items-center gap-3 shrink-0"><b class="tabular-nums text-slate-800">${won(p.price)}</b>${rowButtons("Product", p.id, ["edit", "delete"])}</span>
    </div>`;
    return collapsible(
        "salePrices",
        "🍎 가격표",
        (years.length
            ? years.map((y) => `<div class="mb-3"><p class="text-xs font-bold text-slate-500">${y}년</p>${productsOf(y).map(line).join("")}</div>`).join("")
            : `<p class="text-sm text-slate-400 mb-3">가격을 등록해 두면 판매 등록 때 상품을 고르고 수량만 넣어도 금액이 계산됩니다.</p>`) + textButton("+ 가격 추가", "addProduct()", "text-indigo-600")
    );
}

async function submitProduct(id, values) {
    const years = descYears([String(Number(thisYear()) + 1), thisYear(), values.year, ...productYears()]);
    const v = await formModal({
        title: id ? "가격 수정" : "가격 추가",
        fields: [
            { name: "year", label: "연도", type: "select", options: yearOptions(years) },
            { name: "name", label: "상품 (예: 부사 10kg)", required: true },
            { name: "price", label: "한 박스 가격", type: "number", required: true },
        ],
        values,
        validate: (v) => (PRODUCTS.some((p) => p.id !== id && p.year === v.year && p.name === v.name) ? `${v.year}년 ${v.name} 가격이 이미 있습니다` : ""),
    });
    if (!v) return;
    const { item } = await saveList("products", id, v);
    PRODUCTS = withItem(PRODUCTS, item);
    drawSales();
    toast("success", "가격이 저장되었습니다");
}

const addProduct = () => submitProduct(null, { year: saleView.year || thisYear() });

const editProduct = (id) => submitProduct(id, findProduct(id));

async function deleteProduct(id) {
    const p = findProduct(id);
    if (!(await confirmDelete(`${p.year}년 ${p.name} 가격이 삭제됩니다. 이미 등록한 판매 기록은 그대로 남습니다.`))) return;
    await api("DELETE", `/api/products/${id}`);
    PRODUCTS = PRODUCTS.filter((x) => x.id !== id);
    drawSales();
    toast("success", "삭제되었습니다");
}

const productOptionTags = (year, current = "") => {
    const list = productsOf(year);
    const kept = current && !list.some((p) => p.name === current) ? [{ value: current, label: current }] : [];
    return optionTags([{ value: "", label: "직접 입력" }, ...list.map((p) => ({ value: p.name, label: `${p.name} · ${won(p.price)}` })), ...kept], current);
};

const saleYear = () => sl("date").value.slice(0, 4);

const calcSaleAmount = () => {
    const total = toNum(sl("qty").value) * toNum(sl("price").value);
    if (total) sl("amount").value = comma(total);
};

const saleProduct = () => PRODUCTS.find((x) => x.year === saleYear() && x.name === sl("product").value);

const lockSalePrice = (locked) => {
    sl("price").readOnly = locked;
    sl("price").classList.toggle("!bg-slate-100", locked);
};

function applySaleProduct() {
    const p = saleProduct();
    lockSalePrice(!!p);
    if (!p) return;
    sl("price").value = comma(p.price);
    if (!toNum(sl("qty").value)) sl("qty").value = 1;
    calcSaleAmount();
}

function refreshSaleProducts() {
    sl("product").innerHTML = productOptionTags(saleYear(), sl("product").value);
    applySaleProduct();
}

const findSale = (id) => SALES.find((s) => s.id === id);

const sl = (k) => document.getElementById(`sl_${k}`);

const saleTotals = (list) =>
    list.reduce(
        (t, s) => ({ qty: t.qty + s.qty, amount: t.amount + s.amount, unpaidCount: t.unpaidCount + !s.paid, unpaid: t.unpaid + (s.paid ? 0 : s.amount) }),
        { qty: 0, amount: 0, unpaidCount: 0, unpaid: 0 }
    );

const bySaleDate = (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

const byNewest = (a, b) => bySaleDate(b, a);

const SALE_SORTS = {
    sender: ["보낸 사람순", (a, b) => !a.senderName - !b.senderName || koCompare(a.senderName, b.senderName) || byNewest(a, b)],
    new: ["최신순", byNewest],
    old: ["오래된순", bySaleDate, true],
    name: ["받는 사람순", (a, b) => koCompare(a.receiverName, b.receiverName) || byNewest(a, b)],
    amount: ["금액 높은순", (a, b) => b.amount - a.amount || byNewest(a, b)],
    unpaid: ["미입금 먼저", (a, b) => a.paid - b.paid || byNewest(a, b)],
};

const saleView = { year: "", month: "", sort: savedChoice("saleOrder", SALE_SORTS) };

const setSaleView = (key, v) => {
    saleView[key] = v;
    if (key === "sort") saveChoice("saleOrder", v);
    drawSales();
};

const filteredSales = () => SALES.filter((s) => s.date.startsWith(saleView.year) && (!saleView.month || s.date.slice(5, 7) === saleView.month));

const salesByMonth = (list, cmp, asc) => {
    const groups = list.reduce((m, s) => ((m[s.date.slice(0, 7)] ||= []).push(s), m), {});
    const months = Object.keys(groups).sort();
    return (asc ? months : months.reverse()).map((m) => [m, groups[m].sort(cmp)]);
};

const visibleSaleGroups = (list) => salesByMonth(list, ...SALE_SORTS[saleView.sort].slice(1));

const groupBySender = (items) =>
    items.reduce((groups, s) => {
        const last = groups.at(-1);
        if (last?.[0] === s.senderName) last[1].push(s);
        else groups.push([s.senderName, [s]]);
        return groups;
    }, []);

const saleSummary = (items) => {
    const t = saleTotals(items);
    return `${items.length}건 · ${t.qty}박스 · ${won(t.amount)}${t.unpaidCount ? ` · <span class="text-red-500">미입금 ${t.unpaidCount}건</span>` : ""}`;
};

const senderPhones = (items) => [...new Set(items.map((s) => s.senderPhone).filter(Boolean))].map(telLink).join(" ");

const monthOnly = (ym) => `${Number(ym.slice(-2))}월`;

const monthLabel = (ym) => `${ym.slice(0, 4)}년 ${monthOnly(ym)}`;

const monthTotals = (list) => salesByMonth(list, bySaleDate, true).map(([month, items]) => ({ month, count: items.length, ...saleTotals(items) }));

const CHART_MONTHS = 12;

function monthChart(list) {
    const all = monthTotals(list);
    const months = all.slice(-CHART_MONTHS);
    const max = Math.max(0, ...months.map((t) => t.amount));
    if (!max) return "";
    const year = months[0].month.slice(0, 4);
    const oneYear = months.at(-1).month.startsWith(year);
    return collapsible(
        "saleChart",
        `📊 ${oneYear ? `${year}년 ` : ""}월별 매출${all.length > CHART_MONTHS ? ` <span class="text-sm font-normal text-slate-400">최근 ${CHART_MONTHS}달</span>` : ""}`,
        `<ul class="space-y-2.5 text-sm">${months
            .map(
                (t) => `<li class="flex flex-wrap items-baseline justify-between gap-x-3 md:flex-nowrap md:items-center">
                <span class="text-slate-600 md:w-24 md:shrink-0">${(oneYear ? monthOnly : monthLabel)(t.month)}</span>
                <div class="h-3 mt-1 basis-full order-last md:order-none md:basis-auto md:flex-1 md:mt-0" aria-hidden="true">${t.amount ? `<div class="h-full rounded-r-[4px] bg-[#2a78d6]" style="width: max(4px, ${(t.amount / max) * 100}%)"></div>` : ""}</div>
                <span class="md:w-44 md:shrink-0 md:text-right"><b class="tabular-nums text-slate-800">${won(t.amount)}</b>${t.qty ? ` <span class="text-xs text-slate-400">${t.qty}박스</span>` : ""}</span>
            </li>`
            )
            .join("")}</ul>`
    );
}

async function renderSales() {
    [SALES, CONTACTS, PRODUCTS] = await Promise.all([api("GET", "/api/sales"), api("GET", "/api/addresses"), api("GET", "/api/products")]);
    drawSales();
}

function drawSales() {
    const el = document.getElementById("tab-sales");
    const header = sectionHeader("사과 판매", "+ 판매 등록", "addSale()", "", outlineButton("🔄 들에촌愛", "syncApplebook()", "border-red-300 text-red-600 hover:bg-red-50") + (SALES.length ? excelButton("exportSales()") : ""));
    if (!SALES.length) {
        el.innerHTML = header + `<div class="grid gap-4">${priceCard()}${emptyState("등록된 판매 기록이 없습니다.")}</div>`;
        return;
    }
    const list = filteredSales();
    const total = saleTotals(list);
    const years = descYears([...SALES.map((s) => s.date.slice(0, 4)), saleView.year]);
    const bySender = saleView.sort === "sender";
    const row = (s) => `<div class="py-3 border-b border-slate-100 last:border-0">
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="text-sm"><span class="text-xs text-slate-400 tabular-nums mr-1">${mmdd(s.date)}</span><b class="text-slate-800">${esc(s.receiverName)}</b> ${telLink(s.receiverPhone)}</p>
                <p class="text-sm text-slate-600 break-words">${esc(s.address)}</p>
                <p class="text-xs text-slate-500">${[!bySender && (s.senderName || s.senderPhone) && `보낸 사람 ${esc(s.senderName)} ${telLink(s.senderPhone)}`, s.memo && esc(s.memo)].filter(Boolean).join(" · ")}</p>
            </div>
            <div class="text-right shrink-0">
                <p class="font-bold tabular-nums text-slate-800">${s.amount ? won(s.amount) : "-"}</p>
                <p class="text-xs text-slate-500">${[esc(s.product), s.qty && `${s.qty}박스`].filter(Boolean).join(" · ")}</p>
                <label class="inline-flex items-center gap-1 text-xs cursor-pointer ${s.paid ? "text-emerald-600" : "text-red-500"}"><input type="checkbox" class="w-4 h-4 accent-emerald-600" ${s.paid ? "checked" : ""} onchange="toggleSalePaid('${s.id}', this.checked)" /> ${s.paid ? `입금 ${s.paidDate ? mmdd(s.paidDate) : ""}` : "미입금"}</label>
            </div>
        </div>
        <div class="mt-1">${rowButtons("Sale", s.id)}</div>
    </div>`;
    const senderBox = ([name, items]) => `<div class="mt-3 rounded-xl border border-indigo-200 overflow-hidden">
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2 bg-indigo-50">
            <p class="text-sm"><span class="text-xs text-indigo-500 mr-1">보낸 사람</span><b class="text-indigo-800">${esc(name || "없음")}</b> ${senderPhones(items)}</p>
            <span class="text-xs text-slate-500">${saleSummary(items)}</span>
        </div>
        <div class="px-3">${items.map(row).join("")}</div>
    </div>`;
    const monthCard = ([month, items]) =>
        card(`<div class="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h3 class="font-bold text-slate-700">${monthLabel(month)}</h3>
            <div class="flex items-baseline gap-3">
                <span class="text-xs text-slate-500">${saleSummary(items)}</span>
                ${textButton("📥 엑셀", `exportSales('${month}')`, "text-emerald-700")}
            </div>
        </div>${(bySender ? groupBySender(items).map(senderBox) : items.map(row)).join("")}`);
    el.innerHTML =
        header +
        `<div class="grid gap-4">
            ${card(`<div class="grid grid-cols-3 gap-2">
                ${selectBox("setSaleView('year', this.value)", [{ value: "", label: "전체 연도" }, ...yearOptions(years)], saleView.year, "w-full")}
                ${selectBox("setSaleView('month', this.value)", [{ value: "", label: "전체 월" }, ...Array.from({ length: 12 }, (_, i) => ({ value: pad0(i + 1), label: `${i + 1}월` }))], saleView.month, "w-full")}
                ${selectBox("setSaleView('sort', this.value)", sortOptions(SALE_SORTS), saleView.sort, "w-full")}
            </div>
            <div class="grid grid-cols-3 gap-2 mt-3">
                ${statTile("판매", `${total.qty}박스`, `${list.length}건`)}
                ${statTile("매출", won(total.amount), "금액 입력 기준")}
                ${statTile("미입금", won(total.unpaid), `${total.unpaidCount}건`, total.unpaidCount ? "text-red-500" : undefined)}
            </div>`)}
            ${monthChart(list)}
            ${priceCard()}
            ${list.length ? visibleSaleGroups(list).map(monthCard).join("") : emptyState("조건에 맞는 판매 기록이 없습니다.")}
        </div>`;
}

function pickContact(who, key = sl(`${who}Name`).value) {
    const c = CONTACTS.find((x) => personLine(x.name, x.phone) === key);
    if (!c) return;
    sl(`${who}Name`).value = c.name;
    sl(`${who}Phone`).value = c.phone;
    if (who === "receiver" && c.address) sl("address").value = c.address;
}

function sameAsSender() {
    sl("receiverName").value = sl("senderName").value;
    sl("receiverPhone").value = sl("senderPhone").value;
    pickContact("receiver", personLine(sl("senderName").value, sl("senderPhone").value));
}

async function saleModal(s) {
    const input = (k, attrs = "") => `<input id="sl_${k}" class="swal2-input !m-0 !w-full" value="${esc(s[k])}" ${attrs} />`;
    const person = (who, label) => `<div class="grid grid-cols-2 gap-2">
        <div>${fieldLabel(label)}${input(`${who}Name`, `list="contactOptions" autocomplete="off" oninput="pickContact('${who}')"`)}</div>
        <div>${fieldLabel("연락처")}${input(`${who}Phone`, `type="tel"`)}</div>
    </div>`;
    const { value } = await Swal.fire({
        title: s.id ? "판매 수정" : "판매 등록",
        html: `<div class="text-left text-sm">
            <datalist id="contactOptions">${CONTACTS.map((c) => `<option value="${esc(personLine(c.name, c.phone))}">${esc(c.address)}</option>`).join("")}</datalist>
            ${fieldLabel("주문일")}${input("date", `type="date"`)}
            ${person("sender", "보내는 사람")}
            ${person("receiver", "받는 사람")}
            <button type="button" onclick="sameAsSender()" class="text-xs text-indigo-600 hover:underline mt-1">↑ 보내는 사람과 같음</button>
            ${fieldLabel("받는 사람 주소")}${input("address")}
            ${fieldLabel("상품")}<select id="sl_product" class="swal2-input !m-0 !w-full !flex">${productOptionTags(s.date.slice(0, 4), s.product)}</select>
            <div class="grid grid-cols-3 gap-2">
                <div>${fieldLabel("수량(박스)")}${input("qty", `type="number" inputmode="numeric" min="0"`)}</div>
                <div>${fieldLabel("단가")}${moneyInput("sl_price", s.price || "")}</div>
                <div>${fieldLabel("금액")}${moneyInput("sl_amount", s.amount || "")}</div>
            </div>
            <p class="text-xs text-slate-400 mt-1">상품을 고르면 단가는 가격표 값으로 고정되고(바꾸려면 가격표에서 수정), 금액은 수량 × 단가로 계산됩니다(금액은 직접 고칠 수 있음).</p>
            <div class="grid grid-cols-2 gap-2 items-end">
                <label class="inline-flex items-center gap-1.5 py-2 cursor-pointer"><input id="sl_paid" type="checkbox" class="w-4 h-4 accent-emerald-600" ${s.paid ? "checked" : ""} /> 입금 확인</label>
                <div>${fieldLabel("입금일")}${input("paidDate", `type="date"`)}</div>
            </div>
            ${fieldLabel("메모")}${input("memo")}
            <p class="text-xs text-slate-400 mt-3">직접 입력한 사람은 저장할 때 주소록에 자동 등록되고, 주소가 바뀌면 주소록도 새 주소로 갱신됩니다.</p>
        </div>`,
        ...SAVE_DIALOG,
        didOpen: () => {
            lockSalePrice(!!saleProduct());
            sl("product").addEventListener("change", applySaleProduct);
            sl("date").addEventListener("change", refreshSaleProducts);
            ["qty", "price"].forEach((k) => sl(k).addEventListener("input", calcSaleAmount));
            sl("paid").addEventListener("change", () => (sl("paidDate").value = sl("paid").checked ? sl("paidDate").value || today() : ""));
            sl("paidDate").addEventListener("change", () => (sl("paid").checked = !!sl("paidDate").value));
        },
        preConfirm: () => {
            const val = (k) => sl(k).value.trim();
            const v = { ...Object.fromEntries(SALE_TEXT_FIELDS.map((k) => [k, val(k)])), qty: toNum(val("qty")), price: toNum(val("price")), amount: toNum(val("amount")), paid: sl("paid").checked };
            return validated(!v.receiverName || !v.address ? "받는 사람과 주소를 입력하세요" : "", v);
        },
    });
    return value;
}

async function putSale(id, body) {
    const res = await saveList("sales", id, body);
    SALES = withItem(SALES, res.item);
    drawSales();
    return res;
}

const saleToast = ({ applebook }, message) => {
    if (applebook?.error) return toast("warning", "들에촌愛에 반영하지 못했습니다", `${applebook.error} · 「🔄 들에촌愛」로 다시 맞출 수 있습니다`);
    if (message) toast("success", message + (applebook ? " · 들에촌愛 반영" : ""));
};

async function submitSale(id, base) {
    const v = await saleModal(base);
    if (!v) return;
    const res = await putSale(id, v);
    saleToast(res, `저장되었습니다${res.contacts ? " · 주소록 반영" : ""}`);
}

const addSale = () => submitSale(null, { date: today() });

const editSale = (id) => submitSale(id, findSale(id));

const toggleSalePaid = async (id, paid) => saleToast(await putSale(id, { paid, paidDate: paid ? today() : "" }));

const SALE_LABELS = { date: "날짜", senderName: "보내는 사람", senderPhone: "보내는 사람 연락처", receiverName: "받는 사람", receiverPhone: "받는 사람 연락처", address: "주소", product: "상품", qty: "수량(박스)", price: "단가", amount: "금액", paid: "입금", paidDate: "입금일", memo: "메모" };

const APPLEBOOK_STEPS = [
    ["added", "새로 추가"],
    ["linked", "들에촌愛에 있던 같은 주문과 연결"],
    ["updated", "내용 맞춤"],
    ["removed", "들에촌愛에서 삭제"],
];

async function syncApplebook() {
    try {
        const plan = await api("POST", "/api/sales/applebook", { dryRun: true });
        const line = (s) => `<li class="py-1.5 border-b border-slate-100 last:border-0">
            <span class="text-xs text-slate-400 tabular-nums mr-1">${mmdd(s.date)}</span><b>${esc(s.receiverName)}</b>${s.senderName ? ` <span class="text-xs text-slate-500">보낸 사람 ${esc(s.senderName)}</span>` : ""} <span class="tabular-nums">${won(s.amount)}</span>
            ${s.changes.length ? `<p class="text-xs text-amber-600">바뀌는 칸: ${s.changes.map((k) => SALE_LABELS[k]).join(", ")}</p>` : ""}
        </li>`;
        const steps = APPLEBOOK_STEPS.filter(([k]) => plan[k].length);
        const notes = [plan.same && `이미 같음 ${plan.same}건`, plan.kept && `들에촌愛에서 지운 ${plan.kept}건은 그대로 둠`].filter(Boolean).join(" · ");
        if (!steps.length) return toast("success", "들에촌愛와 이미 같습니다", notes);
        const { isConfirmed } = await Swal.fire({
            title: "🔄 들에촌愛 동기화 확인",
            html: `<div class="text-left text-sm max-h-[60vh] overflow-y-auto overscroll-contain pr-1">
                ${steps.map(([k, label]) => `<p class="font-bold text-slate-700 mt-3 first:mt-0">${label} ${plan[k].length}건</p><ul>${plan[k].map(line).join("")}</ul>`).join("")}
                ${notes ? `<p class="text-xs text-slate-500 mt-3">${notes}</p>` : ""}
                <p class="text-xs text-slate-400 mt-2">가계부 판매를 기준으로 맞춥니다. 들에촌愛에서 직접 등록한 판매는 건드리지 않습니다.</p>
            </div>`,
            width: 560,
            ...SAVE_DIALOG,
            confirmButtonText: "동기화",
        });
        if (!isConfirmed) return;
        await api("POST", "/api/sales/applebook", { dryRun: false });
        toast("success", "들에촌愛에 반영했습니다");
    } catch (e) {
        toast("error", "들에촌愛 동기화 실패", e.message);
    }
}

const copySale = (id) => {
    const s = findSale(id);
    copyText(
        [`받는사람: ${personLine(s.receiverName, s.receiverPhone)}`, `주소: ${s.address}`, (s.senderName || s.senderPhone) && `보낸사람: ${personLine(s.senderName, s.senderPhone)}`].filter(Boolean).join("\n"),
        "배송 정보가 복사되었습니다"
    );
};

let xlsxLoading = null;

const loadXlsx = () =>
    (xlsxLoading ??= new Promise((resolve, reject) =>
        document.head.append(
            Object.assign(document.createElement("script"), {
                src: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
                onload: () => resolve(window.XLSX),
                onerror: () => {
                    xlsxLoading = null;
                    reject(new Error("엑셀 기능을 불러오지 못했습니다"));
                },
            })
        )
    ));

async function downloadXlsx(filename, sheets) {
    try {
        const XLSX = await loadXlsx();
        const book = XLSX.utils.book_new();
        const width = (v) => [...String(v ?? "")].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
        for (const [name, rows, header = Object.keys(rows[0] || {})] of sheets) {
            const sheet = XLSX.utils.json_to_sheet(rows, { header });
            sheet["!cols"] = header.map((k) => ({ wch: Math.min(60, Math.max(...[k, ...rows.map((r) => r[k])].map(width)) + 2) }));
            XLSX.utils.book_append_sheet(book, sheet, name);
        }
        XLSX.writeFile(book, filename);
    } catch (e) {
        toast("error", e.message);
    }
}

function exportSales(month = "") {
    const list = month ? SALES.filter((s) => s.date.startsWith(month)) : filteredSales();
    const rows = visibleSaleGroups(list)
        .flatMap(([, items]) => items)
        .map((s) => ({ ...Object.fromEntries(Object.entries(SALE_LABELS).map(([k, label]) => [label, s[k]])), 입금: s.paid ? "입금" : "미입금" }));
    const sheets = [["판매 내역", rows]];
    if (!month) {
        const summary = monthTotals(list).map((t) => ({ 월: t.month, 건수: t.count, "수량(박스)": t.qty, 금액: t.amount, "미입금 건수": t.unpaidCount, "미입금 금액": t.unpaid }));
        sheets.push(["월별 합계", summary]);
    }
    const period = [saleView.year && `${saleView.year}년`, saleView.month && monthOnly(saleView.month)].filter(Boolean).join("_");
    return downloadXlsx(`사과판매_${month || period || today()}.xlsx`, sheets);
}

const exportAddresses = (template = false) => {
    const rows = (template ? [] : visibleAddresses()).map((a) => Object.fromEntries(ADDRESS_FIELDS.map((f) => [f.label, a[f.name] || ""])));
    return downloadXlsx(template ? "주소록_양식.xlsx" : `주소록_${today()}.xlsx`, [["주소록", rows, ADDRESS_FIELDS.map((f) => f.label)]]);
};

const contactFromRow = (row) => {
    const cells = Object.entries(row).map(([header, v]) => [header.replace(/\s/g, ""), v]);
    const contact = Object.fromEntries(ADDRESS_FIELDS.map((f) => [f.name, cells.find(([header]) => [f.label, ...f.aliases].includes(header))?.[1] ?? ""]));
    if (typeof contact.phone === "number") contact.phone = `0${contact.phone}`;
    return contact;
};

async function importAddresses() {
    loadXlsx().catch(() => {});
    const { value: file } = await Swal.fire({
        title: "엑셀로 주소록 등록",
        html: `<div class="text-left text-sm text-slate-600 space-y-1.5">
            <p>첫 줄에 ${ADDRESS_FIELDS.map((f) => `<b>${f.label}</b>${f.required ? "(필수)" : ""}`).join("·")} 머리글이 있는 엑셀 파일을 올려 주세요.</p>
            <p>연락처가 같은 사람이 이미 있으면 새로 만들지 않고, 엑셀에 적힌 주소·메모로 갱신합니다.</p>
            <p>${textButton("📥 양식 받기", "exportAddresses(true)", "text-emerald-700")} <span class="text-xs text-slate-400">「📥 엑셀」로 받은 파일을 고쳐서 올려도 됩니다.</span></p>
        </div>`,
        input: "file",
        inputAttributes: { accept: ".xlsx,.xls" },
        inputValidator: (f) => (f ? undefined : "파일을 선택하세요"),
        ...SAVE_DIALOG,
        confirmButtonText: "등록",
    });
    if (!file) return;
    try {
        const XLSX = await loadXlsx();
        const book = XLSX.read(await file.arrayBuffer(), { sheets: 0 });
        const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "" }).map(contactFromRow);
        if (!rows.some((r) => r.name)) throw new Error("이름 열을 찾지 못했습니다. 첫 줄 머리글을 확인하세요");
        const r = await saveList("addresses/import", null, { rows });
        Swal.fire({
            icon: "success",
            title: "주소록 등록 완료",
            html: `새로 ${r.added}명 · 갱신 ${r.updated}명 · 변경 없음 ${r.same}명${r.invalid ? `<br><span class="text-xs text-slate-500">이름이 없어 제외한 행 ${r.invalid}개</span>` : ""}`,
            confirmButtonColor: "#4f46e5",
        });
    } catch (e) {
        toast("error", e.message);
    }
}

async function deleteSale(id) {
    if (!(await confirmDelete(`${findSale(id).receiverName}님 판매 기록이 삭제됩니다. 주소록은 그대로 남습니다.`))) return;
    const res = await api("DELETE", `/api/sales/${id}`);
    SALES = SALES.filter((s) => s.id !== id);
    drawSales();
    saleToast(res, "판매 기록이 삭제되었습니다");
}

function renderAll() {
    renderBanks();
    renderCards();
    renderFixed();
    renderOverview();
    renderTrips();
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
                <h3 class="font-bold text-slate-800 text-lg">${r.month} <span class="text-sm font-normal text-slate-400 tabular-nums">(${mmdd(p.start)} ~ ${mmdd(p.end)})</span></h3>
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
                        (x) => `<p class="text-xs text-slate-600 py-0.5">${r.transfersDone?.[x.key] ? "✅" : "⬜"} ${x.from} → ${x.to} <b class="tabular-nums">${won(x.amount)}</b>${x.fund ? ' <span class="text-sky-600">충당</span>' : ""}${x.fixed ? ' <span class="text-amber-600">고정</span>' : ""}${x.back ? ' <span class="text-emerald-600">반환</span>' : ""}${x.kind === "expense" ? ' <span class="text-orange-500">지출</span>' : ""}</p>`
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
    selectMonth(month);
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

async function showTab(name) {
    currentTab = name;
    localStorage.setItem("activeTab", name);
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    document.getElementById(`tab-${name}`).classList.remove("hidden");
    if (["ledger", "monthly", "trips"].includes(name)) await reload();
    if (name === "ledger") renderLedger();
    if (name === "sales") renderSales();
    if (name === "addresses") loadAddresses();
    if (name === "monthly") renderMonthly();
    if (name === "history") renderHistory();
    if (name === "system") renderSystem();
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("POST", "/api/logout");
    location.href = "/login.html";
});

document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

const addActions = { banks: saveBank, cards: saveCard, fixed: saveFixed, trips: saveTrip, addresses: saveAddress, sales: addSale };
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

showTab("ledger");
loadStorageBadge();
