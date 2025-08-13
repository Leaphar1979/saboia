document.addEventListener("DOMContentLoaded", () => {
  const STORAGE_KEY = "simpleAppData";
  const SATS_SETTINGS_KEY = "satsSettings/v1";
  const SATS_VAULT_KEY = "satsVault/v1";

  const fmtBRL = n => Number(n||0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  function parseNumberSmart(s) {
    if (typeof s === "number") return s;
    if (!s) return NaN;
    s = String(s).trim();
    s = s.replace(/\./g, '').replace(/,/g, '.');
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  function loadData() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch { return {}; }
  }
  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadVault() {
    return parseFloat(localStorage.getItem(SATS_VAULT_KEY) || "0") || 0;
  }
  function saveVault(val) {
    localStorage.setItem(SATS_VAULT_KEY, String(round2(val)));
  }

  const setupSection = document.getElementById("setupSection");
  const appSection = document.getElementById("appSection");
  const saldoDiaEl = document.getElementById("saldoDia");
  const listaGastos = document.getElementById("listaGastos");

  document.getElementById("startBtn").addEventListener("click", () => {
    const daily = parseNumberSmart(document.getElementById("dailyValue").value);
    const startDate = document.getElementById("startDate").value;
    const enableSats = document.getElementById("enableSats").checked;
    const satsRate = parseNumberSmart(document.getElementById("satsRate").value) || 0;

    if (!daily || !startDate) {
      alert("Informe o valor diário e a data de início.");
      return;
    }

    const data = {
      dailyValue: daily,
      startDate,
      saldo: daily,
      gastos: [],
    };
    saveData(data);

    const satsSettings = { enabled: enableSats, rate: satsRate };
    localStorage.setItem(SATS_SETTINGS_KEY, JSON.stringify(satsSettings));

    setupSection.style.display = "none";
    appSection.style.display = "block";
    render();
  });

  document.getElementById("addExpenseBtn").addEventListener("click", () => {
    const val = parseNumberSmart(document.getElementById("gasto").value);
    if (!val) return;
    const data = loadData();
    data.gastos.push(val);
    data.saldo = round2(data.saldo - val);

    // Taxa Sats
    const satsSettings = JSON.parse(localStorage.getItem(SATS_SETTINGS_KEY) || "{}");
    if (satsSettings.enabled && satsSettings.rate > 0) {
      const taxa = round2(val * (satsSettings.rate / 100));
      saveVault(loadVault() + taxa);
    }

    saveData(data);
    document.getElementById("gasto").value = "";
    render();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (confirm("Deseja realmente resetar tudo?")) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(SATS_SETTINGS_KEY);
      localStorage.removeItem(SATS_VAULT_KEY);
      setupSection.style.display = "block";
      appSection.style.display = "none";
    }
  });

  function render() {
    const data = loadData();
    saldoDiaEl.textContent = fmtBRL(data.saldo || 0);
    saldoDiaEl.className = "saldo " + ((data.saldo || 0) >= 0 ? "positivo" : "negativo");
    listaGastos.innerHTML = "";
    (data.gastos || []).forEach((g) => {
      const li = document.createElement("li");
      li.textContent = fmtBRL(g);
      listaGastos.appendChild(li);
    });
  }

  // Autoload
  const data = loadData();
  if (data.dailyValue && data.startDate) {
    setupSection.style.display = "none";
    appSection.style.display = "block";
    render();
  }
});
