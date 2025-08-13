document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "saboyaAppData";

  // === SATS: chaves e helpers (somente Modo A) ===
  const SATS_SETTINGS_KEY = "satsSettings/v1"; // { enabled, rate }
  const SATS_VAULT_KEY = "satsVault/v1";      // número em BRL (sem UI)

  const CURRENCY = "pt-BR";
  const BRL = { style: "currency", currency: "BRL" };
  const fmtBRL = (n) => Number(n).toLocaleString(CURRENCY, BRL);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // aceita 100,50 ou 100.50
  function parseNumberSmart(s) {
    if (typeof s === "number") return s;
    if (s === null || s === undefined) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    s = s.replace(/\./g, "").replace(/,/g, "."); // remove milhar / normaliza decimal
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function loadSatsSettings() {
    const def = { enabled: false, rate: 10 };
    try {
      return { ...def, ...JSON.parse(localStorage.getItem(SATS_SETTINGS_KEY) || "{}") };
    } catch {
      return def;
    }
  }
  function saveSatsSettings(s) {
    localStorage.setItem(SATS_SETTINGS_KEY, JSON.stringify(s));
  }
  function getSatsVaultBRL() {
    const v = parseFloat(localStorage.getItem(SATS_VAULT_KEY) || "0");
    return isNaN(v) ? 0 : v;
  }
  function setSatsVaultBRL(v) {
    localStorage.setItem(SATS_VAULT_KEY, String(Math.max(0, round2(v))));
  }

  // === elementos base ===
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

  // === elementos SATS do setup ===
  const satsEnabledEl = document.getElementById("satsEnabled");
  const satsRateEl = document.getElementById("satsRate");

  function getTodayDate() {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() - 3); // Ajusta para UTC-3
    return now.toISOString().split("T")[0]; // YYYY-MM-DD
  }

  function loadData() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  // Soma gastos considerando effectiveDebit (Modo A)
  function sumTodayDebits(data) {
    return data.expenses.reduce((sum, e) => {
      const debit = typeof e.effectiveDebit === "number" ? e.effectiveDebit : e.amount;
      return sum + debit;
    }, 0);
  }

  function calculateBalance(data) {
    const expensesToday = sumTodayDebits(data);
    return data.lastBalance + data.dailyAmount - expensesToday;
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

      // Badge da Taxa Sats (se aplicada)
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
        if (!isNaN(parsed) && parsed > 0) {
          onEditExpense(data, index, parsed);
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Apagar";
      deleteBtn.className = "delete-btn";
      deleteBtn.addEventListener("click", () => {
        onDeleteExpense(data, index);
      });

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
    const yesterdayBalance = calculateBalance(data);
      data.lastBalance = yesterdayBalance;
      data.currentDate = today;
      data.expenses = [];
      saveData(data);
    }
  }

  function updateSatsReport(data) {
    // V1 armazena apenas o dia corrente. Usamos o total do dia para "Mês" como placeholder.
    const satsToday = data.expenses.reduce((sum, e) => sum + (Number(e.satsTaxApplied) || 0), 0);
    const satsMonth = satsToday;

    const elToday = document.getElementById("satsToday");
    const elMonth = document.getElementById("satsMonth");
    if (elToday) elToday.textContent = fmtBRL(round2(satsToday));
    if (elMonth) elMonth.textContent = fmtBRL(round2(satsMonth));
  }

  function updateDisplay(data) {
    checkNewDay(data);

    const balance = calculateBalance(data);
    balanceDisplay.textContent = fmtBRL(balance);

    // cor: verde se >= 0, vermelho se < 0
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

  // === Aplicar Taxa Sats (sempre Modo A) ===
  /**
   * @param {number} amountBRL - valor da despesa
   * @returns {{effectiveDebit:number, satsTax:number}}
   */
  function applySatsOnSpend(amountBRL) {
    const s = loadSatsSettings();
    if (!s.enabled || s.rate <= 0 || amountBRL <= 0) {
      return { effectiveDebit: amountBRL, satsTax: 0 };
    }
    const satsTax = round2(amountBRL * (s.rate / 100));
    setSatsVaultBRL(getSatsVaultBRL() + satsTax); // cofre silencioso
    const effective = round2(amountBRL + satsTax); // SEMPRE modo A
    return { effectiveDebit: effective, satsTax };
  }

  // === Lançar gasto ===
  function onAddExpenseValue(value) {
    const data = loadData();
    const { effectiveDebit, satsTax } = applySatsOnSpend(value);

    data.expenses.push({
      amount: value,
      effectiveDebit: effectiveDebit,
      satsTaxApplied: satsTax
    });

    saveData(data);
    updateDisplay(data);
  }

  // === Exclusão de gasto: reverte cofre ===
  function onDeleteExpense(data, index) {
    const expense = data.expenses[index];
    if (!expense) return;

    const tax = Number(expense.satsTaxApplied || 0);
    if (tax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - tax);
    }

    data.expenses.splice(index, 1);
    saveData(data);
    updateDisplay(data);
  }

  // === Edição de gasto: reverte taxa antiga, aplica nova (modo A) ===
  function onEditExpense(data, index, newAmount) {
    const old = data.expenses[index];
    if (!old) return;

    const oldTax = Number(old.satsTaxApplied || 0);
    if (oldTax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - oldTax);
    }

    const { effectiveDebit, satsTax } = applySatsOnSpend(Number(newAmount));

    data.expenses[index] = {
      ...old,
      amount: Number(newAmount),
      effectiveDebit: effectiveDebit,
      satsTaxApplied: satsTax
    };

    saveData(data);
    updateDisplay(data);
  }

  // === Boot do app ===
  const existingData = loadData();
  if (existingData) {
    initApp(existingData);
  }

  // === Listeners base ===
  const startClick = () => {
    const dailyAmount = parseNumberSmart(dailyAmountInput.value);
    const startDate = startDateInput.value;
    const today = getTodayDate();

    if (!startDate || isNaN(dailyAmount) || dailyAmount <= 0) {
      alert("Preencha os campos corretamente.");
      return;
    }

    // Salva configurações da Taxa Sats a partir do SETUP
    const s = loadSatsSettings();
    s.enabled = !!satsEnabledEl?.checked;
    s.rate = Math.max(0, parseNumberSmart(satsRateEl?.value || "0"));
    saveSatsSettings(s);

    const data = {
      startDate,
      dailyAmount,
      expenses: [],
      currentDate: today,
      lastBalance: 0
    };

    saveData(data);
    initApp(data);
  };

  const addExpenseClick = () => {
    const value = parseNumberSmart(expenseInput.value);
    if (isNaN(value) || value <= 0) {
      alert("Valor inválido.");
      return;
    }
    onAddExpenseValue(value);
    expenseInput.value = "";
  };

  const resetClick = () => {
    if (confirm("Tem certeza que deseja apagar TODOS os dados (incluindo Taxa Sats e Cofre)?")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SATS_SETTINGS_KEY);
      localStorage.removeItem(SATS_VAULT_KEY);
      location.reload();
    }
  };

  document.getElementById("startButton")?.addEventListener("click", startClick);
  document.getElementById("addExpense")?.addEventListener("click", addExpenseClick);
  document.getElementById("resetButton")?.addEventListener("click", resetClick);
});
