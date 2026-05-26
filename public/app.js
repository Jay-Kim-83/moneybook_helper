let DB = { banks: [], cards: [], fixedExpenses: [], monthly: [] };

const api = async (method, url, body) => {
    const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error((await res.json()).error || "요청 실패");
    return res.json();
};

const won = (n) => `${new Intl.NumberFormat("ko-KR").format(Number(n) || 0)}원`;

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
        preConfirm: () => {
            const result = {};
            for (const f of fields) {
                const el = document.getElementById(`f_${f.name}`);
                const raw = el.value.trim();
                if (f.required && !raw) {
                    Swal.showValidationMessage(`${f.label}을(를) 입력하세요`);
                    return false;
                }
                result[f.name] = f.type === "number" ? Number(raw) || 0 : raw;
            }
            return result;
        },
    });
    return value;
};

const bankOptions = () => DB.banks.map((b) => ({ value: b.id, label: b.name }));

const card = (inner) => `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">${inner}</div>`;

const sectionHeader = (title, btnLabel, onClick) =>
    `<div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-bold text-slate-700">${title}</h2>
        <button onclick="${onClick}" class="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">${btnLabel}</button>
    </div>`;

const emptyState = (msg) => `<p class="text-center text-slate-400 py-10">${msg}</p>`;

const reload = async () => {
    DB = await api("GET", "/api/data");
    renderAll();
};

function renderBanks() {
    const list = DB.banks.length
        ? DB.banks
              .map(
                  (b) => card(`
            <div class="flex items-start justify-between">
                <div>
                    <p class="font-bold text-slate-800">${b.name}</p>
                    <p class="text-sm text-slate-500 mt-1">계좌번호: ${b.accountNumber || "-"}</p>
                    <p class="text-sm text-slate-500">비밀번호 힌트: ${b.passwordHint || "-"}</p>
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="editBank('${b.id}')" class="text-indigo-600 hover:underline text-sm">수정</button>
                    <button onclick="deleteBank('${b.id}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>`)
              )
              .join("")
        : emptyState("등록된 은행이 없습니다. 은행을 추가해 주세요.");
    document.getElementById("tab-banks").innerHTML =
        sectionHeader("나의 은행", "+ 은행 추가", "saveBank()") + `<div class="grid gap-3 md:grid-cols-2">${list}</div>`;
}

const bankFields = (v = {}) => [
    { name: "name", label: "은행명", required: true },
    { name: "accountNumber", label: "계좌번호" },
    { name: "passwordHint", label: "비밀번호 힌트" },
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
                    <p class="font-bold text-slate-800">${c.company}</p>
                    <p class="text-sm text-slate-500 mt-1">카드번호: ${c.cardNumber || "-"}</p>
                    <p class="text-sm text-slate-500">CVC: ${c.cvc || "-"}</p>
                    <span class="inline-block mt-2 text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded">🏦 ${bankName(c.bankId)}</span>
                </div>
                <div class="flex gap-2 shrink-0">
                    <button onclick="editCard('${c.id}')" class="text-indigo-600 hover:underline text-sm">수정</button>
                    <button onclick="deleteCard('${c.id}')" class="text-red-600 hover:underline text-sm">삭제</button>
                </div>
            </div>`)
              )
              .join("")
        : emptyState("등록된 카드가 없습니다.");
    document.getElementById("tab-cards").innerHTML =
        sectionHeader("나의 카드", "+ 카드 추가", "saveCard()") + `<div class="grid gap-3 md:grid-cols-2">${list}</div>`;
}

const cardFields = () => [
    { name: "company", label: "카드사", required: true },
    { name: "cardNumber", label: "카드번호" },
    { name: "cvc", label: "CVC" },
    { name: "bankId", label: "연결 은행", type: "select", options: bankOptions() },
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
        sectionHeader("카드 외 고정 지출", "+ 지출 추가", "saveFixed()") + `<div class="grid gap-3 md:grid-cols-2">${list}</div>`;
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
                            <p class="font-medium text-slate-700">💳 ${c.company}</p>
                            <p class="text-sm text-slate-500">${c.cardNumber || "-"}</p>
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

const prevMonth = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthlyEl = document.getElementById("tab-monthly");
let selectedMonth = new Date().toISOString().slice(0, 7);

async function renderMonthly() {
    const current = (await api("GET", `/api/monthly/${selectedMonth}`)) || { month: selectedMonth, balances: {}, payments: {}, expenses: [] };
    const previous = await api("GET", `/api/monthly/${prevMonth(selectedMonth)}`);
    window._monthlyExpenses = current.expenses?.length
        ? current.expenses
        : DB.fixedExpenses.map((e) => ({ name: e.name, amount: e.amount, bankId: e.bankId }));

    const balanceRows = DB.banks.length
        ? DB.banks
              .map(
                  (b) => `<div class="flex items-center justify-between gap-3 py-2">
            <span class="text-slate-700">🏦 ${b.name}</span>
            <input data-balance="${b.id}" value="${current.balances?.[b.id] ?? ""}" type="number" placeholder="잔액"
                class="border border-slate-300 rounded-lg px-3 py-1.5 w-40 text-right" />
        </div>`
              )
              .join("")
        : emptyState("등록된 은행이 없습니다.");

    const paymentRows = DB.cards.length
        ? DB.cards
              .map((c) => {
                  const prev = previous?.payments?.[c.id];
                  const curVal = current.payments?.[c.id] ?? "";
                  return `<div class="py-2 border-b border-slate-100 last:border-0">
            <div class="flex items-center justify-between gap-3">
                <span class="text-slate-700">💳 ${c.company} <span class="text-xs text-slate-400">(${bankName(c.bankId)})</span></span>
                <input data-payment="${c.id}" data-prev="${prev ?? ""}" value="${curVal}" type="number" placeholder="결제 금액" oninput="updateDiff('${c.id}')"
                    class="border border-slate-300 rounded-lg px-3 py-1.5 w-40 text-right" />
            </div>
            <p data-diff="${c.id}" class="text-xs text-right mt-1 text-slate-400">${diffText(curVal, prev)}</p>
        </div>`;
              })
              .join("")
        : emptyState("등록된 카드가 없습니다.");

    monthlyEl.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 class="text-lg font-bold text-slate-700">이번달 결제 입력</h2>
            <input type="month" id="monthPicker" value="${selectedMonth}" class="border border-slate-300 rounded-lg px-3 py-1.5" />
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

    document.getElementById("monthPicker").addEventListener("change", (e) => {
        selectedMonth = e.target.value;
        renderMonthly();
    });
    renderMonthlyExpenses();
    renderSummary();
}

const diffText = (cur, prev) => {
    if (prev === undefined || prev === null || prev === "" || cur === "" || cur === undefined) return "전월 기록 없음";
    const d = Number(cur) - Number(prev);
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
    el.className = "text-xs text-right mt-1 " + (cur === "" || prev === null ? "text-slate-400" : Number(cur) - prev > 0 ? "text-red-500" : Number(cur) - prev < 0 ? "text-green-600" : "text-slate-400");
    renderSummary();
}

function renderMonthlyExpenses() {
    const list = window._monthlyExpenses;
    const wrap = document.getElementById("monthlyExpenseList");
    wrap.innerHTML = list.length
        ? list
              .map(
                  (e, i) => `<div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
            <span class="flex-1 text-slate-700">${e.name} <span class="text-xs text-slate-400">(${bankName(e.bankId)})</span></span>
            <input data-expense="${i}" value="${e.amount}" type="number" oninput="onExpenseInput(${i}, this.value)"
                class="border border-slate-300 rounded-lg px-3 py-1.5 w-36 text-right" />
            <button onclick="removeMonthlyExpense(${i})" class="text-red-500 text-sm hover:underline">삭제</button>
        </div>`
              )
              .join("")
        : `<p class="text-sm text-slate-400 py-2">등록된 고정 지출이 없습니다.</p>`;
}

const onExpenseInput = (i, val) => {
    window._monthlyExpenses[i].amount = Number(val) || 0;
    renderSummary();
};

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
        ],
    });
    if (!v) return;
    window._monthlyExpenses.push(v);
    renderMonthlyExpenses();
    renderSummary();
}

function renderSummary() {
    const balances = [...document.querySelectorAll("[data-balance]")].reduce((s, el) => s + (Number(el.value) || 0), 0);
    const payments = [...document.querySelectorAll("[data-payment]")].reduce((s, el) => s + (Number(el.value) || 0), 0);
    const expenses = window._monthlyExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const remain = balances - payments - expenses;
    const item = (label, val, color) => `<div class="text-center"><p class="text-xs text-slate-500">${label}</p><p class="text-lg font-bold ${color}">${won(val)}</p></div>`;
    document.getElementById("monthlySummary").innerHTML = card(`
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            ${item("총 잔액", balances, "text-slate-800")}
            ${item("카드 결제", payments, "text-red-500")}
            ${item("카드 외 지출", expenses, "text-orange-500")}
            ${item("예상 잔액", remain, remain >= 0 ? "text-green-600" : "text-red-600")}
        </div>`);
}

async function saveMonthly() {
    const balances = {};
    document.querySelectorAll("[data-balance]").forEach((el) => {
        if (el.value !== "") balances[el.dataset.balance] = Number(el.value) || 0;
    });
    const payments = {};
    document.querySelectorAll("[data-payment]").forEach((el) => {
        if (el.value !== "") payments[el.dataset.payment] = Number(el.value) || 0;
    });
    await api("POST", "/api/monthly", { month: selectedMonth, balances, payments, expenses: window._monthlyExpenses });
    await reload();
    toast("success", `${selectedMonth} 결제 내역이 저장되었습니다`);
}

function renderAll() {
    renderBanks();
    renderCards();
    renderFixed();
    renderOverview();
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
        document.getElementById(`tab-${tab}`).classList.remove("hidden");
        if (tab === "monthly") renderMonthly();
    });
});

reload();
