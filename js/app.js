document.addEventListener("DOMContentLoaded", () => {
  // === CHAVES DE STORAGE ===
  const STORAGE_KEY = "saboyaAppData";         // estado do app (igual ao seu V1)
  const SATS_SETTINGS_KEY = "satsSettings/v1"; // { enabled, rate }
  const SATS_VAULT_KEY = "satsVault/v1";       // número BRL
  const SATS_LEDGER_KEY = "satsLedger/v1";     // [{ ts, date, delta, type }]

  // === FORMATADORES / HELPERS ===
  const fmtBRL = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  /**
   * Parser robusto para valores monetários.
   * - Aceita: "23,5", "23.5", "1.234,56", "1,234.56", "1.234.567", "R$ 1.234,56" etc.
   * - Usa o ÚLTIMO separador (vírgula ou ponto) como DECIMAL e remove os demais como milhar.
   * - Retorna NaN quando não há número válido.
   */
  function parseNumberSmart(input) {
    if (typeof input === "number") return input;
    if (input === null || input === undefined) return NaN;

    let s = String(input).trim();
    if (!s) return NaN;

    // Remove espaços (inclui espaço estreito U+202F) e símbolo de moeda
    s = s.replace(/\u202F/g, "").replace(/\s|R\$\s?/gi, "");

    const hasComma = s.includes(",");
    const hasDot   = s.includes(".");

    if (hasComma && hasDot) {
      const lastComma = s.lastIndexOf(",");
      const lastDot   = s.lastIndexOf(".");
      const decimalIsComma = lastComma > lastDot;

      if (decimalIsComma) {
        // Ponto é milhar → remove todos os pontos; última vírgula vira ponto decimal
        s = s.replace(/\./g, "");
        s = s.replace(/,([^,]*)$/, ".$1");
      } else {
        // Vírgula é milhar → remove todas as vírgulas; ponto final já é decimal
        s = s.replace(/,/g, "");
        // (mantém o ponto decimal final)
      }
    } else if (hasComma) {
      // Só vírgula: se houver mais de uma, a última é decimal; as demais são milhar
      const parts = s.split(",");
      if (parts.length > 2) {
        const dec = parts.pop();
        s = parts.join("");     // remove vírgulas de milhar
        s += "." + dec;         // define ponto como decimal
      } else {
        s = s.replace(",", "."); // vírgula decimal simples
      }
    } else if (hasDot) {
      // Só ponto: se houver mais de um, a última é decimal; os anteriores são milhar
      const parts = s.split(".");
      if (parts.length > 2) {
        const dec = parts.pop();
        s = parts.join("");     // remove pontos de milhar
        s += "." + dec;         // mantém o último como decimal
      }
      // Se tinha só um ponto, já está ok
    }

    // Remove qualquer coisa que não seja dígito, sinal ou ponto decimal
    s = s.replace(/[^0-9\.\-]/g, "");

    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Sanitizador leve para inputs numéricos (não altera layout)
  function attachNumericSanitizer(el) {
    if (!el) return;
    el.addEventListener("input", () => {
      const clean = el.value.replace(/[^\d,\.]/g, "");
      if (clean !== el.value) el.value = clean;
    }, { passive: true });
  }

  function getTodayDate() {
    const now = new Date();
    now.setUTCHours(now.getUTCHours() - 3); // Ajusta para UTC-3
    return now.toISOString().split("T")[0]; // YYYY-MM-DD
  }

  // === ESTADO / PERSISTÊNCIA (robustos) ===
  function isValidState(obj) {
    if (!obj || typeof obj !== "object") return false;
    const okCaixas = Array.isArray(obj.expenses);   // no V1 o dia corrente fica em expenses
    const okDaily = typeof obj.dailyAmount === "number";
    const okDates = typeof obj.currentDate === "string" && !!obj.currentDate;
    // shape mínimo suficiente para não travar
    return okCaixas && okDates && okDaily;
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!isValidState(data)) {
        // estado inválido → remove para não quebrar a UI
        try { localStorage.removeItem(STORAGE_KEY); } catch {}
        return null;
      }
      return data;
    } catch {
      // JSON quebrado → limpa e retorna null
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return null;
    }
  }

  function saveData(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn("Falha ao salvar dados do app:", e);
    }
  }

  function loadSatsSettings() {
    const def = { enabled: false, rate: 10 };
    try { return { ...def, ...JSON.parse(localStorage.getItem(SATS_SETTINGS_KEY) || "{}") }; }
    catch { return def; }
  }
  function saveSatsSettings(s) {
    try {
      localStorage.setItem(SATS_SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {
      console.warn("Falha ao salvar Sats Settings:", e);
    }
  }

  function getSatsVaultBRL() {
    const v = parseFloat(localStorage.getItem(SATS_VAULT_KEY) || "0");
    return isNaN(v) ? 0 : v;
  }
  function setSatsVaultBRL(v) {
    try {
      localStorage.setItem(SATS_VAULT_KEY, String(Math.max(0, round2(v))));
    } catch (e) {
      console.warn("Falha ao salvar Cofre (BRL):", e);
    }
  }

  // Ledger (histórico para o Cofre)
  function loadLedger() {
    try { return JSON.parse(localStorage.getItem(SATS_LEDGER_KEY) || "[]"); }
    catch { return []; }
  }
  function saveLedger(arr) {
    try {
      localStorage.setItem(SATS_LEDGER_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn("Falha ao salvar Ledger:", e);
    }
  }
  function addLedger(delta, type) {
    // delta positivo = entrada no cofre; negativo = saída/estorno
    if (!delta) return;
    const now = new Date();
    const item = {
      ts: now.toISOString(),
      date: now.toISOString().slice(0, 10), // YYYY-MM-DD
      delta: round2(delta),
      type // 'apply' | 'edit' | 'delete' | 'purchase'
    };
    const arr = loadLedger();
    arr.push(item);
    saveLedger(arr);
  }

  // === ELEMENTOS (IDs do seu V1) ===
  const startButton = document.getElementById("startButton");
  const resetButton  = document.getElementById("resetButton");
  const addExpenseButton = document.getElementById("addExpense");

  const startDateInput  = document.getElementById("startDate");
  const dailyAmountInput = document.getElementById("dailyAmount");
  const expenseInput = document.getElementById("expense");

  const balanceDisplay = document.getElementById("balanceDisplay");
  const expenseList = document.getElementById("expenseList");

  const setupSection = document.getElementById("setup");
  const appSection = document.getElementById("appSection");

  // elementos SATS do setup
  const satsEnabledEl = document.getElementById("satsEnabled");
  const satsRateEl = document.getElementById("satsRate");

  // aplica sanitizador nos inputs numéricos (sem mudar UI)
  attachNumericSanitizer(dailyAmountInput);
  attachNumericSanitizer(expenseInput);
  attachNumericSanitizer(satsRateEl);

  // === CÁLCULOS ===
  // Soma gastos considerando effectiveDebit (Modo A)
  function sumTodayDebits(data) {
    return (data.expenses || []).reduce((sum, e) => {
      const debit = typeof e.effectiveDebit === "number" ? e.effectiveDebit : e.amount;
      return sum + debit;
    }, 0);
  }

  function calculateBalance(data) {
    return (data.lastBalance || 0) + (data.dailyAmount || 0) - sumTodayDebits(data);
  }

  function checkNewDay(data) {
    const today = getTodayDate();
    if (data.currentDate !== today) {
      const yesterdayBalance = calculateBalance(data);
      data.lastBalance = round2(yesterdayBalance);
      data.currentDate = today;
      data.expenses = [];
      saveData(data);
    }
  }

  // === UI ===
  function updateExpenseList(data) {
    expenseList.innerHTML = "";

    (data.expenses || []).forEach((expense, index) => {
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
        if (!isNaN(parsed) && parsed > 0) onEditExpense(index, parsed);
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Apagar";
      deleteBtn.className = "delete-btn";
      deleteBtn.addEventListener("click", () => onDeleteExpense(index));

      right.appendChild(editBtn);
      right.appendChild(deleteBtn);

      li.appendChild(left);
      li.appendChild(right);

      expenseList.appendChild(li);
    });
  }

  function updateSatsReport(data) {
    // V1 armazena só o dia corrente. Usamos o total do dia como "Mês" (placeholder).
    const satsToday = (data.expenses || []).reduce((sum, e) => sum + (Number(e.satsTaxApplied) || 0), 0);
    const satsMonth = satsToday;

    const elToday = document.getElementById("satsToday");
    const elMonth = document.getElementById("satsMonth");
    if (elToday) elToday.textContent = fmtBRL(round2(satsToday));
    if (elMonth) elMonth.textContent = fmtBRL(round2(satsMonth));
  }

  function updateDisplay(data) {
    // guarda contra estado inválido (não quebra UI)
    if (!data || typeof data !== "object") return;

    checkNewDay(data);

    const balance = round2(calculateBalance(data));
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

  // === Taxa Sats (sempre Modo A) ===
  function applySatsOnSpend(amountBRL) {
    const s = loadSatsSettings();
    if (!s.enabled || !s.rate || amountBRL <= 0) {
      return { effectiveDebit: amountBRL, satsTax: 0 };
    }
    const satsTax = round2(amountBRL * (s.rate / 100));
    setSatsVaultBRL(getSatsVaultBRL() + satsTax); // cofre
    addLedger(+satsTax, "apply"); // registra entrada
    const effective = round2(amountBRL + satsTax);
    return { effectiveDebit: effective, satsTax };
  }

  // === AÇÕES ===
  function onStart() {
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
  }

  function onAddExpense() {
    const value = parseNumberSmart(expenseInput.value);
    if (isNaN(value) || value <= 0) {
      alert("Valor inválido.");
      return;
    }

    const data = loadData();
    if (!data) {
      alert("Configuração não encontrada. Inicie o app informando data e valor diário.");
      return;
    }

    const { effectiveDebit, satsTax } = applySatsOnSpend(value);

    data.expenses.push({
      amount: value,
      effectiveDebit: effectiveDebit,
      satsTaxApplied: satsTax
    });

    saveData(data);
    expenseInput.value = "";
    updateDisplay(data);
  }

  function onDeleteExpense(index) {
    const data = loadData();
    if (!data) return;

    const expense = data.expenses[index];
    if (!expense) return;

    // estorna cofre se houve taxa
    const tax = Number(expense.satsTaxApplied || 0);
    if (tax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - tax);
      addLedger(-tax, "delete");
    }

    data.expenses.splice(index, 1);
    saveData(data);
    updateDisplay(data);
  }

  function onEditExpense(index, newAmount) {
    const data = loadData();
    if (!data) return;
    const old = data.expenses[index];
    if (!old) return;

    // estorna taxa antiga, se houver
    const oldTax = Number(old.satsTaxApplied || 0);
    if (oldTax > 0) {
      setSatsVaultBRL(getSatsVaultBRL() - oldTax);
      addLedger(-oldTax, "edit");
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

  function onResetAll() {
    if (!confirm("Tem certeza que deseja apagar TODOS os dados (incluindo Taxa Sats, Cofre e Histórico)?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SATS_SETTINGS_KEY);
    localStorage.removeItem(SATS_VAULT_KEY);
    localStorage.removeItem(SATS_LEDGER_KEY);
    location.reload();
  }

  // === BOOT ===
  const existingData = loadData();
  if (existingData) {
    initApp(existingData);
  } else {
    // garante estado limpo na UI (mostra setup)
    setupSection.classList.remove("hidden");
    appSection.classList.add("hidden");
  }

  // === LISTENERS ===
  startButton?.addEventListener("click", onStart);
  addExpenseButton?.addEventListener("click", onAddExpense);
  resetButton?.addEventListener("click", onResetAll);
});
