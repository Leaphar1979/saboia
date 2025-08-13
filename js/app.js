document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "saboyaAppData";

  // === SATS: chaves e helpers ===
  const SATS_SETTINGS_KEY = "satsSettings/v1";
  const SATS_VAULT_KEY = "satsVault/v1"; // valor acumulado em BRL

  const CURRENCY = "pt-BR";
  const BRL = { style: "currency", currency: "BRL" };
  const fmtBRL = (n) => n.toLocaleString(CURRENCY, BRL);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

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
  function renderVault() {
    const el = document.getElementById("satsVaultBRL");
    if (el) el.textContent = fmtBRL(getSatsVaultBRL());
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

  // === elementos SATS UI ===
  const satsEnabledEl = document.getElementById("satsEnabled");
  const satsRateEl = document.getElementById("satsRate");
  const satsCountsEl = document.getElementById("satsCountsAgainstBudget");
  const satsConvertBtn = document.getElementById("satsConvertBtn");

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

  // Agora soma gastos considerando effectiveDebit (se existir) para suportar modo A
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
      amountSpan.textContent = `- ${expense.amount.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
      })}`;

      left.appendChild(amountSpan);

      // Exibir badge da taxa Sats, se houver
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
        const newValue = prompt("Novo valor:", expense.amount);
        const parsed = parseFloat(newValue);
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
    // somar taxa Sats do dia e do mês
    const todayStr = getTodayDate();
    let satsToday = 0;
    let satsMonth = 0;

    // Hoje: somatório das despesas do array atual (dia corrente)
    satsToday = data.expenses.reduce((sum, e) => sum + (Number(e.satsTaxApplied) || 0), 0);

    // Mês: vamos percorrer apenas o dia atual (porque o V1 não mantém histórico de dias anteriores no array)
    // Obs: Como o V1 só guarda o dia corrente em `expenses`, o total mensal não tem base histórica.
    // Para não perder utilidade, manteremos o total do dia e o Cofre Sats (que é acumulativo).
    // Se quiser histórico mensal real no futuro, precisamos persistir dias anteriores.
    satsMonth = satsToday;

    const elToday = document.getElementById("satsToday");
    const elMonth = document.getElementById("satsMonth");
    if (elToday) elToday.textContent = fmtBRL(round2(satsToday));
    if (elMonth) elMonth.textContent = fmtBRL(round2(satsMonth));
  }

  function updateDisplay(data) {
    checkNewDay(data);

    const balance = calculateBalance(data);
    balanceDisplay.textContent = balance.toLocaleString("pt-BR", BRL);

    // Definir cor: verde se >= 0, vermelho se < 0
    balanceDisplay.classList.toggle("balance-negative", balance < 0);
    balanceDisplay.classList.toggle("balance-positive", balance >= 0);

    updateExpenseList(data);
    renderVault();
    updateSatsReport(data);
  }

  function initApp(data) {
    setupSection.classList.add("hidden");
    appSection.classList.remove("hidden");

    // SATS: carregar UI atual
    const s = loadSatsSettings();
    if (satsEnabledEl) satsEnabledEl.checked = s.enabled;
    if (satsRateEl) satsRateEl.value = s.rate;
    if (satsCountsEl) satsCountsEl.checked = s.countsAgainstBudget;
    renderVault();

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
    setSatsVaultBRL(getSatsVaultBRL() + satsTax);

    const effective = s.countsAgainstBudget ? round2(amountBRL + satsTax) : amountBRL;

    renderVault();
    return { effectiveDebit: effective, satsTax, counted: s.countsAgainstBudget };
  }

  // === Lançar gasto ===
  function onAddExpenseValue(value) {
    const data = loadData();
    // aplica taxa Sats
    const { effectiveDebit, satsTax, counted } = applySatsOnSpend(value);

    // salva despesa com campos extras (sem quebrar o modelo)
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
      renderVault();
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
    renderVault();
    updateDisplay(data);
  }

  // === Boot do app ===
  const existingData = loadData();
  if (existingData) {
    initApp(existingData);
  }

  // === Listeners base ===
  const startClick = () => {
    const dailyAmount = parseFloat(dailyAmountInput.value);
    const startDate = startDateInput.value;
    const today = getTodayDate();

    if (!startDate || isNaN(dailyAmount) || dailyAmount <= 0) {
      alert("Preencha os campos corretamente.");
      return;
    }

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
    const value = parseFloat(expenseInput.value);
    if (isNaN(value) || value <= 0) {
      alert("Valor inválido.");
      return;
    }
    onAddExpenseValue(value);
    expenseInput.value = "";
  };

  const resetClick = () => {
    if (confirm("Tem certeza que deseja apagar todos os dados?")) {
      localStorage.removeItem(STORAGE_KEY);
      // Também zerar configurações e cofre, se desejar reset total:
      // localStorage.removeItem(SATS_SETTINGS_KEY);
      // localStorage.removeItem(SATS_VAULT_KEY);
      location.reload();
    }
  };

  startButton?.addEventListener("click", startClick);
  addExpenseButton?.addEventListener("click", addExpenseClick);
  resetButton?.addEventListener("click", resetClick);

  // === Listeners SATS UI ===
  satsEnabledEl?.addEventListener("change", () => {
    const cur = loadSatsSettings();
    cur.enabled = !!satsEnabledEl.checked;
    saveSatsSettings(cur);
  });

  satsRateEl?.addEventListener("input", () => {
    const cur = loadSatsSettings();
    cur.rate = Math.max(0, parseFloat(satsRateEl.value || "0"));
    saveSatsSettings(cur);
  });

  satsCountsEl?.addEventListener("change", () => {
    const cur = loadSatsSettings();
    cur.countsAgainstBudget = !!satsCountsEl.checked;
    saveSatsSettings(cur);
  });

  satsConvertBtn?.addEventListener("click", () => {
    const current = getSatsVaultBRL();
    if (current <= 0) return alert("Cofre Sats já está zerado.");
    if (!confirm(`Confirmar: zerar Cofre Sats (R$ ${current.toFixed(2)}) após registrar sua compra de BTC?`)) return;
    setSatsVaultBRL(0);
    renderVault();
  });
});
