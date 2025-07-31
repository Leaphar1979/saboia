document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "saboyaAppData";

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

  function calculateBalance(data) {
    const today = getTodayDate();

    const expensesToday = data.expenses.reduce((sum, e) => sum + e.amount, 0);
    const balance = data.lastBalance + data.dailyAmount - expensesToday;

    return balance;
  }

  function updateExpenseList(data) {
    expenseList.innerHTML = "";

    data.expenses.forEach((expense, index) => {
      const li = document.createElement("li");

      const amountSpan = document.createElement("span");
      amountSpan.className = "amount";
      amountSpan.textContent = `- ${expense.amount.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
      })}`;

      const editBtn = document.createElement("button");
      editBtn.textContent = "Editar";
      editBtn.className = "edit-btn";
      editBtn.addEventListener("click", () => {
        const newValue = prompt("Novo valor:", expense.amount);
        const parsed = parseFloat(newValue);
        if (!isNaN(parsed) && parsed > 0) {
          data.expenses[index].amount = parsed;
          saveData(data);
          updateDisplay(data);
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Apagar";
      deleteBtn.className = "delete-btn";
      deleteBtn.addEventListener("click", () => {
        data.expenses.splice(index, 1);
        saveData(data);
        updateDisplay(data);
      });

      li.appendChild(amountSpan);
      li.appendChild(editBtn);
      li.appendChild(deleteBtn);

      expenseList.appendChild(li);
    });
  }

  function checkNewDay(data) {
    const today = getTodayDate();
    if (data.currentDate !== today) {
      const yesterdayBalance = calculateBalance(data); // Salva o saldo do dia anterior
      data.lastBalance = yesterdayBalance;
      data.currentDate = today;
      data.expenses = [];
      saveData(data);
    }
  }

  function updateDisplay(data) {
    checkNewDay(data);

    const balance = calculateBalance(data);
    balanceDisplay.textContent = balance.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL"
    });

    updateExpenseList(data);
  }

  function initApp(data) {
    setupSection.classList.add("hidden");
    appSection.classList.remove("hidden");
    updateDisplay(data);
  }

  const existingData = loadData();
  if (existingData) {
    initApp(existingData);
  }

  startButton.addEventListener("click", () => {
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
  });

  addExpenseButton.addEventListener("click", () => {
    const value = parseFloat(expenseInput.value);
    if (isNaN(value) || value <= 0) {
      alert("Valor inválido.");
      return;
    }

    const data = loadData();
    data.expenses.push({ amount: value });
    saveData(data);
    expenseInput.value = "";
    updateDisplay(data);
  });

  resetButton.addEventListener("click", () => {
    if (confirm("Tem certeza que deseja apagar todos os dados?")) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });
});
