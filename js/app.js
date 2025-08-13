document.addEventListener("DOMContentLoaded", () => {
  // === CHAVES DE STORAGE ===
  const STORAGE_KEY = "saboyaAppData";    // estado do app
  const SATS_SETTINGS_KEY = "satsSettings/v1"; // { rate }
  const SATS_VAULT_KEY = "satsVault/v1";       // número BRL
  const SATS_LEDGER_KEY = "satsLedger/v1";     // [{ ts, date, delta, type }]

  // === FORMATADORES / HELPERS ===
  const fmtBRL = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // aceita 100,50 e 100.50 (remove . milhar e normaliza , para .)
  function parseNumberSmart(s) {
    if (typeof s === "number") return s;
    if (s === null || s === undefined) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    s = s.replace(/\./g, "").replace(/,/g, ".");
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function getTodayISO() {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() - 3); // Brasília (UTC-3)
    return now.toISOString().split("T")[0];
  }

  // === ESTADO / PERSISTÊNCIA ===
  function loadData() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  }
  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadSatsSettings() {
    const def = { rate: 10 }; // apenas alíquota; modo A implícito
    try { return { ...def, ...JSON.parse(localStorage.getItem(SATS_SETTINGS_KEY) || "{}") }; }
    catch { return def; }
  }
  function saveSatsSettings(s) {
    localStorage.setItem(SATS_SETTINGS_KEY, JSON.stringify(s));
  }

  function getVault() {
    const v = parseFloat(localStorage.getItem(SATS_VAULT_KEY) || "0");
    return isNaN(v) ? 0 : v;
  }
  function setVault(v) {
    localStorage.setItem(SATS_VAULT_KEY, String(Math.max(0, round2(v))));
  }

  function loadLedger() {
    try { return JSON.parse(localStorage.getItem(SATS_LEDGER_KEY) || "[]"); }
    catch { return []; }
  }
  function saveLedger(arr) {
    localStorage.setItem(SATS_LEDGER_KEY, JSON.stringify(arr));
  }
  function addLedger(delta, type) {
    // delta positivo = entrada no cofre; negativo = saída/estorno
    if (!delta) return;
    const now = new Date();
    const item = {
      ts: now.toISOString(),
      date: now.toISOString().slice(0, 10), // YYYY-MM-DD
      delta: round2(delta),
      type, // 'apply' | 'edit' | 'delete' | 'purchase' (purchase é feito pelo cofre.html)
    };
    const arr = loadLedger();
    arr.push(item);
    saveLedger(arr);
  }

  // === ELEMENTOS (IDs compatíveis com seu index.html atual) ===
  const $setup = document.getElementById("setup");
  const $app = document.getElementById("appSection");

  const $dailyAmount = document.getElementById("dailyAmount");
  const $startDate = document.getElementById("startDate");
  const $satsRate = document.getElementById("satsRate");
  const $startBtn = document.getElementById("startBtn");

  const $dailyBalance = document.getElementById("dailyBalance");
  const $expenseName = document.getElementById("expenseName");
  const $expenseAmount = document.getElementById("expenseAmount");
  const $addExpenseBtn = document.getElementById("addExpenseBtn");
  const $expenseList = document.getElementById("expenseList");
  const $resetBtn = document.getElementById("resetBtn");

  // === CÁLCULOS ===
  function sumEffectiveDebits(data) {
    return (data.expenses || []).reduce((sum, e) => sum + (typeof e.effectiveDebit === "number" ? e.effectiveDebit : e.amount), 0);
  }

  function calculateDailyBalance(data) {
    // saldo do dia atual = lastBalance + dailyAmount - soma(débitos efetivos do dia)
    return round2((data.lastBalance || 0) + (data.dailyAmount || 0) - sumEffectiveDebits(data));
  }

  function checkRollover(data) {
    const today = getTodayISO();
    if (data.currentDate !== today) {
      // fecha o dia anterior carregando saldo
      data.lastBalance = calculateDailyBalance(data);
      data.expenses = [];
      data.currentDate = today;
      saveData(data);
    }
  }

  // === UI ===
  function renderExpenses(data) {
    $expenseList.innerHTML = "";

    (data.expenses || []).forEach((exp, idx) => {
      const li = document.createElement("li");

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";

      const topLine = document.createElement("div");
      topLine.textContent = (exp.name ? exp.name + " — " : "") + `- ${fmtBRL(exp.amount)}`;
      left.appendChild(topLine);

      if (exp.satsTaxApplied && exp.satsTaxApplied > 0) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = `Taxa Sats: ${fmtBRL(exp.satsTaxApplied)}`;
        left.appendChild(badge);
      }

      const right = document.createElement("div");
      const btnEdit = document.createElement("button");
      btnEdit.textContent = "Editar";
      btnEdit.className = "edit-btn";
      btnEdit.addEventListener("click", () => {
        const newValStr = prompt("Novo valor:", String(exp.amount).replace(".", ","));
        const parsed = parseNumberSmart(newValStr);
        if (isNaN(parsed) || parsed <= 0) return;
        onEditExpense(idx, parsed);
      });

      const btnDel = document.createElement("button");
      btnDel.textContent = "Apagar";
      btnDel.className = "delete-btn";
      btnDel.addEventListener("click", () => onDeleteExpense(idx));

      right.appendChild(btnEdit);
      right.appendChild(btnDel);

      li.appendChild(left);
      li.appendChild(right);
      $expenseList.appendChild(li);
    });
  }

  function renderBalance(data) {
    $dailyBalance.textContent = fmtBRL(calculateDailyBalance(data));
    $dailyBalance.classList.toggle("balance-negative", calculateDailyBalance(data) < 0);
    $dailyBalance.classList.toggle("balance-positive", calculateDailyBalance(data) >= 0);
  }

  function updateUI() {
    const data = loadData();
    if (!data) return;

    checkRollover(data);
    renderBalance(data);
    renderExpenses(data);
  }

  // === LÓGICA DA TAXA SATS (sempre modo A) ===
  function applySatsOn(amountBRL) {
    const { rate } = loadSatsSettings();
    if (!rate || amountBRL <= 0) {
      return { effectiveDebit: amountBRL, satsTax: 0 };
    }
    const satsTax = round2(amountBRL * (rate / 100));
    // entra no cofre
    setVault(getVault() + satsTax);
    addLedger(+satsTax, "apply");
    // modo A: taxa impacta o débito do dia
    return { effectiveDebit: round2(amountBRL + satsTax), satsTax };
  }

  // === AÇÕES ===
  function onStart() {
    const daily = parseNumberSmart($dailyAmount.value);
    const startDate = $startDate.value;
    const rate = parseNumberSmart($satsRate.value);

    if (!startDate || isNaN(daily) || daily <= 0) {
      alert("Preencha corretamente o valor diário e a data de início.");
      return;
    }

    // salva sats
    saveSatsSettings({ rate: Math.max(0, isNaN(rate) ? 0 : rate) });

    // inicia app
    const data = {
      startDate,
      dailyAmount: daily,
      lastBalance: 0,
      currentDate: getTodayISO(),
      expenses: []
    };
    saveData(data);

    // troca de tela
    $setup.style.display = "none";
    $app.style.display = "";
    updateUI();
  }

  function onAddExpense() {
    const data = loadData();
    if (!data) return;

    const name = ($expenseName.value || "").trim();
    const val = parseNumberSmart($expenseAmount.value);
    if (isNaN(val) || val <= 0) {
      alert("Informe um valor válido para o gasto.");
      return;
    }

    const { effectiveDebit, satsTax } = applySatsOn(val);
    data.expenses.push({
      name,
      amount: val,
      effectiveDebit,
      satsTaxApplied: satsTax
    });
    saveData(data);

    // limpa campos
    $expenseName.value = "";
    $expenseAmount.value = "";

    updateUI();
  }

  function onDeleteExpense(index) {
    const data = loadData();
    if (!data) return;
    const exp = data.expenses[index];
    if (!exp) return;

    // estorna a taxa do cofre (se existir)
    const tax = Number(exp.satsTaxApplied || 0);
    if (tax > 0) {
      setVault(getVault() - tax);
      addLedger(-tax, "delete");
    }

    data.expenses.splice(index, 1);
    saveData(data);
    updateUI();
  }

  function onEditExpense(index, newAmount) {
    const data = loadData();
    if (!data) return;
    const exp = data.expenses[index];
    if (!exp) return;

    // estorna taxa antiga do cofre, se houver
    const oldTax = Number(exp.satsTaxApplied || 0);
    if (oldTax > 0) {
      setVault(getVault() - oldTax);
      addLedger(-oldTax, "edit");
    }

    // aplica taxa nova sobre o novo valor
    const { effectiveDebit, satsTax } = applySatsOn(Number(newAmount));
    data.expenses[index] = {
      ...exp,
      amount: Number(newAmount),
      effectiveDebit,
      satsTaxApplied: satsTax
    };
    saveData(data);
    updateUI();
  }

  function onResetAll() {
    if (!confirm("Tem certeza que deseja resetar TUDO (dados, Taxa Sats, Cofre e histórico)?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SATS_SETTINGS_KEY);
    localStorage.removeItem(SATS_VAULT_KEY);
    localStorage.removeItem(SATS_LEDGER_KEY);
    location.reload();
  }

  // === BOOT ===
  const existing = loadData();
  if (existing) {
    $setup.style.display = "none";
    $app.style.display = "";
    updateUI();
  } else {
    $setup.style.display = "";
    $app.style.display = "none";
  }

  // === LISTENERS ===
  $startBtn?.addEventListener("click", onStart);
  $addExpenseBtn?.addEventListener("click", onAddExpense);
  $resetBtn?.addEventListener("click", onResetAll);
});
