document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "saboyaAppData";

  // === SATS: chaves e helpers ===
  const SATS_SETTINGS_KEY = "satsSettings/v1";
  const SATS_VAULT_KEY = "satsVault/v1"; // valor acumulado em BRL (fica invisível na UI diária, mas continua funcionando)

  const CURRENCY = "pt-BR";
  const BRL = { style: "currency", currency: "BRL" };
  const fmtBRL = (n) => Number(n).toLocaleString(CURRENCY, BRL);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // aceita 100,50 ou 100.50 (remove . como milhar e usa , como decimal)
  function parseNumberSmart(s) {
    if (typeof s === "number") return s;
    if (s === null || s === undefined) return NaN;
    s = String(s).trim();
    if (!s) return NaN;
    s = s.replace(/\./g, "").replace(/,/g, "."); // remove milhar e normaliza decimal
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function loadSatsSettings() {
    const def = { enabled: false, rate: 10, countsAgainstBudget: true };
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

  // === elementos SATS (somente no setup) ===
  const satsEnabledEl = document.getElementById("satsEnabled");
  const satsRateEl = document.getElementById("satsRate");
  const satsCountsEl = document.getElementById("satsCountsAgainstBudget");

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

  // Soma gastos considerando effectiveDebit (para suportar modo A)
  function sumTodayDebits(data) {
    return data.expenses.reduce((sum, e) => {
      const debit = typeof e.effectiveDebit === "number" ? e.effectiveDebit : e.amount;
      return sum + debit;
    }, 0);
  }

  function calculateBalance(data) {
    const expensesToday = sumTodayDebits(data);
    const balance = data.lastBalance + data.dailyAmount - expensesToday;
    return balance;
  }

  function updateExpenseList(data) {
    expenseList.innerHTML = "";

    data.expenses.forEach((expense, index) => {
      const li = document.createElement("li");

      const left = document.createElement("div");
      left.className = "expense-meta";

      const amountSpan = document.createElement("span");
      amountSpan.className = "amount";
      amountSpan.textContent = `- ${fmtBRL(expense.amount)}`;

      left.appendChild(amountSpan);

      // Badge da taxa Sats, se houver
      if (expense.satsTaxApplied && expense.satsTaxApplied > 0) {
        const badge = document.createElement("span");
        badge.className = "badge";
        const counted = expense.satsCountsAgainstBudget ? "A" : "B";
        badge.textContent = `Taxa Sats: ${fmtBRL(expense.satsTaxApplied)} (modo ${counted})`;
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
    // somar taxa Sats do dia (V1 só mantém o dia corrente)
    const satsToday = data.expenses.reduce((sum, e) => sum + (Number(e.satsTaxApplied) || 0), 0);
    const satsMonth = satsToday; // placeholder (sem histórico mensal no V1)

    const elToday = document.getElementById("satsToday");
    const elMonth = document.getElementById("satsMonth");
    if (elToday) elToday.textContent = fmtBRL(round2(satsToday));
    if (elMonth) elMonth.textContent = fmtBRL(round2(satsMonth));
  }

  function updateDisplay(data) {
    checkNewDay(data);

    const balance = calculateBalance(data);
    balanceDisplay.textContent = fmtBRL(balance);

    // Definir cor: verde se >= 0, vermelho se < 0
    balanceDisplay.classList.toggle("balance-negative", balance < 0);
    balanceDisplay.classList.toggle("balance-positive", balance >= 0);

    updateExpenseList(data);
    updateSatsReport(data);
  }

  function initApp(data) {
    setupSection.classList.add("hidden");
    appSection.classList.remove("hidden");

    // Não há painel de Sats na tela diária — apenas usamos as configs salvas
    updateDisplay(data);
  }

  // === Aplicar Taxa Sats a um gasto ===
  /**
   * @param {number} amountBRL - valor da despesa (positivo)
   * @returns {{effectiveDebit:number, satsTax:number, counted:boolean}}
   */
  function applySatsOnSpend(amountBRL) {
    const s = loadSatsSettings();
    if (!s.enabled || s.rate <= 0 || amountBRL <= 0) {
      return { effectiveDebit: amountBRL, satsTax: 0, counted: false };
    }
    const satsTax = round2(amountBRL * (s.rate / 100));
    setSatsVaultBRL(getSatsVaultBRL() + satsTax); // ainda acumulamos no Cofre (sem exibir)

    const effective = s.countsAgainstBudget ? round2(amountBRL + satsTax) : amountBRL;
    return { effectiveDebit: effective, satsTax, counted: s.countsAgainstBudget };
  }

  // === Lançar gasto ===
  function onAddExpenseValue(value) {
    const data = loadData();
    // aplica taxa Sats
    const { effectiveDebit, satsTax, counted } = applySatsOnSpend(value);

    // salva despesa com campos extras
    data.expenses.push({
      amount: value,
      effectiveDebit: effectiveDebit,
      satsTaxApplied: satsTax,
      satsCountsAgainstBudget: counted
    });

    saveData(data);
    updateDisplay(data);
  }

  // === Exclusão de gasto: reverte cofre ===
  function onDeleteExpense(data, index) {
    const expense = data.expenses[index];
    if (!expense) return;

    // reverter cofre
    const tax = Number(expense.satsTaxApplied || 0);
    if (tax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - tax);
    }

    data.expenses.splice(index, 1);
    saveData(data);
    updateDisplay(data);
  }

  // === Edição de gasto: reverte taxa antiga, aplica nova ===
  function onEditExpense(data, index, newAmount) {
    const old = data.expenses[index];
    if (!old) return;

    // reverter cofre da taxa antiga
    const oldTax = Number(old.satsTaxApplied || 0);
    if (oldTax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - oldTax);
    }

    // aplicar nova taxa sobre o novo valor
    const { effectiveDebit, satsTax, counted } = applySatsOnSpend(Number(newAmount));

    // atualizar o registro
    data.expenses[index] = {
      ...old,
      amount: Number(newAmount),
      effectiveDebit: effectiveDebit,
      satsTaxApplied: satsTax,
      satsCountsAgainstBudget: counted
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
    s.countsAgainstBudget = !!satsCountsEl?.checked;
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
      // Reset TOTAL: também limpa configurações e cofre Sats
      localStorage.removeItem(SATS_SETTINGS_KEY);
      localStorage.removeItem(SATS_VAULT_KEY);
      location.reload();
    }
  };

  startButton?.addEventListener("click", startClick);
  addExpenseButton?.addEventListener("click", addExpenseClick);
  resetButton?.addEventListener("click", resetClick);
});
