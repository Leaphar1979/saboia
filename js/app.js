document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "saboyaAppData";

  // === SATS: chaves e helpers (somente Modo A) ===
  const SATS_SETTINGS_KEY = "satsSettings/v1"; // { enabled, rate }
  const SATS_VAULT_KEY = "satsVault/v1";      // número em BRL (sem UI)
  const SATS_LEDGER_KEY = "satsLedger/v1";    // histórico [{ts,date,delta,type}]

  const CURRENCY = "pt-BR";
  const BRL = { style: "currency", currency: "BRL" };
  const fmtBRL = (n) => Number(n).toLocaleString(CURRENCY, BRL);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  function parseNumberSmart(s) {
    if (typeof s === "number") return s;
    if (s === null || s === undefined) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    s = s.replace(/\./g, "").replace(/,/g, ".");
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  // settings & vault
  function loadSatsSettings() {
    const def = { enabled: false, rate: 10 };
    try { return { ...def, ...JSON.parse(localStorage.getItem(SATS_SETTINGS_KEY) || "{}") }; }
    catch { return def; }
  }
  function saveSatsSettings(s) { localStorage.setItem(SATS_SETTINGS_KEY, JSON.stringify(s)); }
  function getSatsVaultBRL() {
    const v = parseFloat(localStorage.getItem(SATS_VAULT_KEY) || "0");
    return isNaN(v) ? 0 : v;
  }
  function setSatsVaultBRL(v) {
    localStorage.setItem(SATS_VAULT_KEY, String(Math.max(0, round2(v))));
  }

  // ledger
  function loadLedger() {
    try { return JSON.parse(localStorage.getItem(SATS_LEDGER_KEY) || "[]"); } catch { return []; }
  }
  function saveLedger(arr) { localStorage.setItem(SATS_LEDGER_KEY, JSON.stringify(arr)); }
  function addLedger(delta, type) {
    if (!delta) return;
    const now = new Date();
    const item = {
      ts: now.toISOString(),
      date: now.toISOString().slice(0,10),
      delta: round2(delta),
      type // 'apply'|'edit'|'delete'|'purchase'
    };
    const arr = loadLedger();
    arr.push(item);
    saveLedger(arr);
  }

  // elementos base
  const startButton = document.getElementById("startButton");
  const resetButton = document.getElementById("resetButton");
  const addExpenseButton = document.getElementById("addExpense");

  const startDateInput = document.getElementById("startDate");
  const dailyAmountInput = document.getElementById("dailyAmount");
  const expenseInput = document.getElementById("expense");

  const balanceDisplay = document.getElementById("balanceDisplay");
  const expenseList = document.getElementById("expenseList");

  const setupSection = document.getElementById("setup");
  const appSection = document.getElementById("appSection");

  // sats no setup
  const satsEnabledEl = document.getElementById("satsEnabled");
  const satsRateEl = document.getElementById("satsRate");

  function getTodayDate() {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() - 3); // UTC-3
    return now.toISOString().split("T")[0];
  }

  function loadData() { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
  function saveData(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }

  // débito efetivo (Modo A)
  function sumTodayDebits(data) {
    return data.expenses.reduce((sum, e) => {
      const debit = typeof e.effectiveDebit === "number" ? e.effectiveDebit : e.amount;
      return sum + debit;
    }, 0);
  }
  function calculateBalance(data) {
    return data.lastBalance + data.dailyAmount - sumTodayDebits(data);
  }

  function updateExpenseList(data) {
    expenseList.innerHTML = "";
    data.expenses.forEach((expense, index) => {
      const li = document.createElement("li");

      const left = document.createElement("div");
      const amountSpan = document.createElement("span");
      amountSpan.className = "amount";
      amountSpan.textContent = `- ${fmtBRL(expense.amount)}`;
      left.appendChild(amountSpan);

      if (expense.satsTaxApplied && expense.satsTaxApplied > 0) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = `Taxa Sats: ${fmtBRL(expense.satsTaxApplied)}`;
        left.appendChild(badge);
      }

      const right = document.createElement("div");
      const editBtn = document.createElement("button");
      editBtn.textContent = "Editar";
      editBtn.className = "edit-btn";
      editBtn.addEventListener("click", () => {
        const newValue = prompt("Novo valor:", String(expense.amount).replace(".", ","));
        const parsed = parseNumberSmart(newValue);
        if (!isNaN(parsed) && parsed > 0) onEditExpense(data, index, parsed);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Apagar";
      deleteBtn.className = "delete-btn";
      deleteBtn.addEventListener("click", () => onDeleteExpense(data, index));

      right.appendChild(editBtn);
      right.appendChild(deleteBtn);
      li.appendChild(left);
      li.appendChild(right);
      expenseList.appendChild(li);
    });
  }

  function checkNewDay(data) {
    const today = getTodayDate();
    if (data.currentDate !== today) {
      data.lastBalance = calculateBalance(data);
      data.currentDate = today;
      data.expenses = [];
      saveData(data);
    }
  }

  function updateSatsReport(data) {
    const satsToday = data.expenses.reduce((sum, e) => sum + (Number(e.satsTaxApplied) || 0), 0);
    const satsMonth = satsToday; // placeholder com base no V1
    const elToday = document.getElementById("satsToday");
    const elMonth = document.getElementById("satsMonth");
    if (elToday) elToday.textContent = fmtBRL(round2(satsToday));
    if (elMonth) elMonth.textContent = fmtBRL(round2(satsMonth));
  }

  function updateDisplay(data) {
    checkNewDay(data);
    const balance = calculateBalance(data);
    balanceDisplay.textContent = fmtBRL(balance);
    balanceDisplay.classList.toggle("balance-negative", balance < 0);
    balanceDisplay.classList.toggle("balance-positive", balance >= 0);
    updateExpenseList(data);
    updateSatsReport(data);
  }

  function initApp(data) {
    setupSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    updateDisplay(data);
  }

  // === Taxa Sats (aplica e registra no ledger) ===
  function applySatsOnSpend(amountBRL) {
    const s = loadSatsSettings();
    if (!s.enabled || s.rate <= 0 || amountBRL <= 0) {
      return { effectiveDebit: amountBRL, satsTax: 0 };
    }
    const satsTax = round2(amountBRL * (s.rate / 100));
    setSatsVaultBRL(getSatsVaultBRL() + satsTax);
    addLedger(+satsTax, "apply");
    const effective = round2(amountBRL + satsTax);
    return { effectiveDebit: effective, satsTax };
  }

  // ações de gasto
  function onAddExpenseValue(value) {
    const data = loadData();
    const { effectiveDebit, satsTax } = applySatsOnSpend(value);
    data.expenses.push({ amount: value, effectiveDebit, satsTaxApplied: satsTax });
    saveData(data);
    updateDisplay(data);
  }

  function onDeleteExpense(data, index) {
    const expense = data.expenses[index];
    if (!expense) return;
    const tax = Number(expense.satsTaxApplied || 0);
    if (tax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - tax);
      addLedger(-tax, "delete");
    }
    data.expenses.splice(index, 1);
    saveData(data);
    updateDisplay(data);
  }

  function onEditExpense(data, index, newAmount) {
    const old = data.expenses[index];
    if (!old) return;
    const oldTax = Number(old.satsTaxApplied || 0);
    if (oldTax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - oldTax);
      addLedger(-oldTax, "edit");
    }
    const { effectiveDebit, satsTax } = applySatsOnSpend(Number(newAmount));
    data.expenses[index] = { ...old, amount: Number(newAmount), effectiveDebit, satsTaxApplied: satsTax };
    saveData(data);
    updateDisplay(data);
  }

  // Boot
  const existingData = loadData();
  if (existingData) initApp(existingData);

  // Listeners
  document.getElementById("startButton")?.addEventListener("click", () => {
    const dailyAmount = parseNumberSmart(dailyAmountInput.value);
    const startDate = startDateInput.value;
    const today = getTodayDate();
    if (!startDate || isNaN(dailyAmount) || dailyAmount <= 0) {
      alert("Preencha os campos corretamente.");
      return;
    }
    const s = loadSatsSettings();
    s.enabled = !!document.getElementById("satsEnabled")?.checked;
    s.rate = Math.max(0, parseNumberSmart(document.getElementById("satsRate")?.value || "0"));
    saveSatsSettings(s);
    const data = { startDate, dailyAmount, expenses: [], currentDate: today, lastBalance: 0 };
    saveData(data);
    initApp(data);
  });

  document.getElementById("addExpense")?.addEventListener("click", () => {
    const value = parseNumberSmart(expenseInput.value);
    if (isNaN(value) || value <= 0) return alert("Valor inválido.");
    onAddExpenseValue(value);
    expenseInput.value = "";
  });

  document.getElementById("resetButton")?.addEventListener("click", () => {
    if (!confirm("Tem certeza que deseja apagar TODOS os dados (incluindo Taxa Sats, Cofre e Ledger)?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SATS_SETTINGS_KEY);
    localStorage.removeItem(SATS_VAULT_KEY);
    localStorage.removeItem(SATS_LEDGER_KEY);
    location.reload();
  });
});
