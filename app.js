const STORAGE_KEY = "control-pagos-accounts";
const RATE_CACHE_KEY = "control-pagos-rate-cache";
const FALLBACK_USD_TO_UYU = 39.9;

const accountForm = document.querySelector("#accountForm");
const accountIdInput = document.querySelector("#accountId");
const nameInput = document.querySelector("#name");
const dueDateInput = document.querySelector("#dueDate");
const amountInput = document.querySelector("#amount");
const currencyInput = document.querySelector("#currency");
const formTitle = document.querySelector("#formTitle");
const formSubtitle = document.querySelector("#formSubtitle");
const submitButton = document.querySelector("#submitButton");
const cancelEditButton = document.querySelector("#cancelEditButton");
const accountList = document.querySelector("#accountList");
const statsGrid = document.querySelector("#statsGrid");
const summaryText = document.querySelector("#summaryText");
const clearPaidButton = document.querySelector("#clearPaidButton");
const exchangeRateValue = document.querySelector("#exchangeRateValue");
const exchangeRateMeta = document.querySelector("#exchangeRateMeta");
const accountCardTemplate = document.querySelector("#accountCardTemplate");

const state = {
  accounts: loadAccounts(),
  editingAccountId: null,
  exchangeRate:
    loadRateCache() || {
      rate: FALLBACK_USD_TO_UYU,
      source: "Valor de respaldo",
      updatedAt: null,
    },
};

initialize();

function initialize() {
  resetForm();
  bindEvents();
  render();
  refreshExchangeRate();
}

function bindEvents() {
  accountForm.addEventListener("submit", handleSubmit);
  cancelEditButton.addEventListener("click", resetForm);
  clearPaidButton.addEventListener("click", clearPaidAccounts);
}

function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(accountForm);
  const accountId = String(formData.get("accountId") || "").trim();
  const name = String(formData.get("name") || "").trim();
  const dueDate = String(formData.get("dueDate") || "");
  const amount = Number(formData.get("amount"));
  const currency = String(formData.get("currency") || "UYU");

  if (!name || !dueDate || !Number.isFinite(amount) || amount <= 0) {
    return;
  }

  const startDate = new Date(`${dueDate}T12:00:00`);
  const baseAccount = {
    name,
    startDate: dueDate,
    dueDay: startDate.getDate(),
    amount,
    currency,
  };

  if (accountId) {
    state.accounts = state.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      const nextPaidThroughMonth = clampPaidThroughMonth(
        account.paidThroughMonth,
        dueDate,
      );

      return {
        ...account,
        ...baseAccount,
        paidThroughMonth: nextPaidThroughMonth,
        updatedAt: new Date().toISOString(),
      };
    });
  } else {
    const account = {
      id: crypto.randomUUID(),
      ...baseAccount,
      paidThroughMonth: null,
      createdAt: new Date().toISOString(),
    };

    state.accounts.unshift(account);
  }

  saveAccounts();
  resetForm();
  render();
}

function clearPaidAccounts() {
  const today = getLocalToday();
  state.accounts = state.accounts.filter((account) => {
    const details = buildAccountDetails(account, today, state.exchangeRate.rate);
    return details.statusKey !== "paid";
  });

  saveAccounts();
  render();
}

function render() {
  const today = getLocalToday();
  const detailsList = state.accounts
    .map((account) => buildAccountDetails(account, today, state.exchangeRate.rate))
    .sort(sortAccounts);

  renderStats(detailsList, today);
  renderAccounts(detailsList);
  renderExchangeRate();
}

function renderStats(detailsList, today) {
  const activeCount = detailsList.filter((item) => item.statusKey !== "paid").length;
  const dueTodayCount = detailsList.filter(
    (item) => item.statusKey !== "paid" && differenceInDays(today, item.currentDueDate) === 0,
  ).length;
  const dueThisWeekCount = detailsList.filter(
    (item) =>
      item.statusKey !== "paid" &&
      differenceInDays(today, item.currentDueDate) >= 0 &&
      differenceInDays(today, item.currentDueDate) <= 7,
  ).length;
  const overdueTotalUyu = detailsList
    .filter((item) => item.statusKey === "overdue")
    .reduce((total, item) => total + item.totalEstimatedUyu, 0);
  const totalEstimatedUyu = detailsList.reduce(
    (total, item) => total + item.totalEstimatedUyu,
    0,
  );

  const cards = [
    {
      label: "Cuentas activas",
      value: String(activeCount),
      small: `${detailsList.length} registradas`,
    },
    {
      label: "Vencen hoy",
      value: String(dueTodayCount),
      small: "Pagos que requieren atención inmediata",
    },
    {
      label: "Próximos 7 días",
      value: String(dueThisWeekCount),
      small: "Para anticiparte esta semana",
    },
    {
      label: "Deuda vencida",
      value: formatCurrency(overdueTotalUyu, "UYU"),
      small: `Total estimado a cubrir: ${formatCurrency(totalEstimatedUyu, "UYU")}`,
    },
  ];

  statsGrid.innerHTML = cards
    .map(
      (card) => `
        <article class="stat-card">
          <p>${card.label}</p>
          <strong>${card.value}</strong>
          ${card.small ? `<p>${card.small}</p>` : ""}
        </article>
      `,
    )
    .join("");

  summaryText.textContent =
    detailsList.length === 0
      ? "Todavía no hay pagos cargados."
      : `${activeCount} cuenta${activeCount === 1 ? "" : "s"} activas. Total estimado pendiente: ${formatCurrency(totalEstimatedUyu, "UYU")}.`;
}

function renderAccounts(detailsList) {
  accountList.innerHTML = "";

  if (detailsList.length === 0) {
    accountList.innerHTML = `
      <div class="empty-state">
        Agregá tu primera cuenta y la app empezará a controlar vencimientos,
        pagos y acumulación mensual automáticamente.
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  detailsList.forEach((details) => {
    const node = accountCardTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(`status-${details.statusKey}`);

    node.querySelector(".account-name").textContent = details.account.name;
    node.querySelector(".account-schedule").textContent = details.scheduleLabel;
    node.querySelector(".status-pill").textContent = details.statusLabel;
    node.querySelector(".primary-amount").textContent = details.totalDisplay;
    node.querySelector(".secondary-amount").textContent = details.secondaryAmount;
    renderMeta(node.querySelector(".account-meta"), details.metaLines);

    const markPaidButton = node.querySelector(".mark-paid-button");
    const undoPaidButton = node.querySelector(".undo-paid-button");

    markPaidButton.disabled = details.statusKey === "paid";
    markPaidButton.textContent =
      details.pendingInstallments > 1 ? "Marcar al día" : "Marcar pago del mes";
    markPaidButton.addEventListener("click", () => markAsPaid(details.account.id));

    undoPaidButton.disabled = !details.account.paidThroughMonth;
    undoPaidButton.textContent = details.account.paidThroughMonth
      ? "Desmarcar último pago"
      : "Sin pagos registrados";
    undoPaidButton.addEventListener("click", () => undoLastPayment(details.account.id));

    node
      .querySelector(".edit-button")
      .addEventListener("click", () => startEditing(details.account.id));

    node
      .querySelector(".delete-button")
      .addEventListener("click", () => deleteAccount(details.account.id));

    fragment.appendChild(node);
  });

  accountList.appendChild(fragment);
}

function renderMeta(container, lines) {
  container.textContent = "";

  lines.forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    container.appendChild(paragraph);
  });
}

function startEditing(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  state.editingAccountId = account.id;
  accountIdInput.value = account.id;
  nameInput.value = account.name;
  dueDateInput.value = account.startDate;
  amountInput.value = String(account.amount);
  currencyInput.value = account.currency;
  formTitle.textContent = "Editar cuenta";
  formSubtitle.textContent =
    "Ajustá nombre, vencimiento o monto sin perder el historial existente.";
  submitButton.textContent = "Guardar cambios";
  cancelEditButton.classList.remove("is-hidden");
  nameInput.focus();
  accountForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  state.editingAccountId = null;
  accountForm.reset();
  accountIdInput.value = "";
  formTitle.textContent = "Nueva cuenta";
  formSubtitle.textContent = "Agregá pagos mensuales y dejalos guardados localmente.";
  submitButton.textContent = "Guardar cuenta";
  cancelEditButton.classList.add("is-hidden");
  setDefaultDueDate();
}

function markAsPaid(accountId) {
  const today = getLocalToday();
  const currentMonthKey = toMonthKey(today);

  state.accounts = state.accounts.map((account) =>
    account.id === accountId
      ? {
          ...account,
          paidThroughMonth: currentMonthKey,
          lastPaidAt: new Date().toISOString(),
        }
      : account,
  );

  saveAccounts();
  render();
}

function undoLastPayment(accountId) {
  state.accounts = state.accounts.map((account) => {
    if (account.id !== accountId || !account.paidThroughMonth) {
      return account;
    }

    return {
      ...account,
      paidThroughMonth: getPreviousMonthKey(account.paidThroughMonth, account.startDate),
      lastPaidAt: new Date().toISOString(),
    };
  });

  saveAccounts();
  render();
}

function deleteAccount(accountId) {
  state.accounts = state.accounts.filter((account) => account.id !== accountId);

  if (state.editingAccountId === accountId) {
    resetForm();
  }

  saveAccounts();
  render();
}

function buildAccountDetails(account, today, exchangeRate) {
  const currentMonthKey = toMonthKey(today);
  const startMonthKey = toMonthKey(new Date(`${account.startDate}T12:00:00`));
  const totalCycles = Math.max(0, monthDiff(startMonthKey, currentMonthKey) + 1);
  const paidCycles = account.paidThroughMonth
    ? Math.max(0, monthDiff(startMonthKey, account.paidThroughMonth) + 1)
    : 0;
  const pendingInstallments = Math.max(0, totalCycles - paidCycles);
  const currentDueDate = buildDateForMonth(currentMonthKey, account.dueDay);
  const daysUntilDue = differenceInDays(today, currentDueDate);

  let statusKey = "upcoming";
  let statusLabel = "Por pagar";

  if (pendingInstallments <= 0) {
    statusKey = "paid";
    statusLabel = "Pagada";
  } else if (pendingInstallments > 1 || daysUntilDue <= 0) {
    statusKey = "overdue";
    statusLabel = pendingInstallments > 1 ? "Deuda acumulada" : "Vencida";
  } else if (daysUntilDue <= 2) {
    statusKey = "warning";
    statusLabel = "Vence pronto";
  }

  const totalOriginal = account.amount * pendingInstallments;
  const totalEstimatedUyu =
    account.currency === "USD" ? totalOriginal * exchangeRate : totalOriginal;

  const scheduleLabel = `Mensual, vence cada ${account.dueDay} · inicia ${formatDate(
    new Date(`${account.startDate}T12:00:00`),
  )}`;

  const secondaryAmount =
    account.currency === "USD"
      ? `Estimado en pesos: ${formatCurrency(totalEstimatedUyu, "UYU")}`
      : `Monto mensual: ${formatCurrency(account.amount, "UYU")}`;

  const metaLines = [];

  if (pendingInstallments > 1) {
    metaLines.push(
      `Tenés ${pendingInstallments} meses acumulados. La deuda ya incluye varios ciclos impagos.`,
    );
  } else if (statusKey === "paid") {
    metaLines.push("La cuenta está marcada como pagada para el mes actual.");
  } else if (statusKey === "warning") {
    metaLines.push(
      `Faltan ${daysUntilDue} día${daysUntilDue === 1 ? "" : "s"} para el vencimiento.`,
    );
  } else if (statusKey === "overdue" && pendingInstallments === 1) {
    metaLines.push(
      `El vencimiento fue ${daysUntilDue === 0 ? "hoy" : `hace ${Math.abs(daysUntilDue)} día${Math.abs(daysUntilDue) === 1 ? "" : "s"}`}.`,
    );
  } else {
    metaLines.push(`Próximo vencimiento: ${formatDate(currentDueDate)}.`);
  }

  if (account.currency === "USD") {
    metaLines.push(`Cotización usada: ${formatRate(exchangeRate)} por USD.`);
  }

  if (account.lastPaidAt) {
    metaLines.push(`Último cambio de pago: ${formatDateTime(account.lastPaidAt)}.`);
  }

  return {
    account,
    statusKey,
    statusLabel,
    pendingInstallments,
    totalEstimatedUyu,
    totalDisplay: formatCurrency(totalOriginal, account.currency),
    secondaryAmount,
    scheduleLabel,
    metaLines,
    daysUntilDue,
    currentDueDate,
  };
}

function sortAccounts(a, b) {
  const priority = {
    overdue: 0,
    warning: 1,
    upcoming: 2,
    paid: 3,
  };

  if (priority[a.statusKey] !== priority[b.statusKey]) {
    return priority[a.statusKey] - priority[b.statusKey];
  }

  return a.currentDueDate - b.currentDueDate;
}

async function refreshExchangeRate() {
  try {
    const bcuRate = await fetchBcuRate();
    if (bcuRate) {
      state.exchangeRate = bcuRate;
      saveRateCache();
      render();
      return;
    }
  } catch (error) {
    console.error("No se pudo obtener la cotización del BCU.", error);
  }

  try {
    const fallbackRate = await fetchOpenRate();
    if (fallbackRate) {
      state.exchangeRate = fallbackRate;
      saveRateCache();
      render();
      return;
    }
  } catch (error) {
    console.error("No se pudo obtener la cotización alternativa.", error);
  }

  renderExchangeRate(true);
}

async function fetchBcuRate() {
  const bcuUrl =
    "https://www.bcu.gub.uy/Estadisticas-e-Indicadores/Paginas/Cotizaciones.aspx?ID=9";
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(bcuUrl)}`;
  const response = await fetch(proxyUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Respuesta no válida desde el proxy del BCU.");
  }

  const html = await response.text();
  const parsed = parseBcuHtml(html);

  if (!parsed) {
    throw new Error("No se pudo interpretar la cotización del BCU.");
  }

  return {
    rate: parsed.rate,
    source: `BCU · ${parsed.date}`,
    updatedAt: new Date().toISOString(),
  };
}

function parseBcuHtml(html) {
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(html, "text/html");
  const row = Array.from(documentFragment.querySelectorAll("tr")).find((item) =>
    item.textContent?.includes("DLS. USA BILLETE"),
  );

  if (!row) {
    return null;
  }

  const cells = Array.from(row.querySelectorAll("td, th")).map((cell) =>
    cell.textContent.trim(),
  );
  const date = cells.find((value) => /^\d{2}\/\d{2}\/\d{4}$/.test(value));
  const rateText = cells.find((value) => /^\d{1,3},\d{1,3}$/.test(value));

  if (!date || !rateText) {
    return null;
  }

  const rate = Number(rateText.replace(".", "").replace(",", "."));

  if (!Number.isFinite(rate)) {
    return null;
  }

  return { date, rate };
}

async function fetchOpenRate() {
  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("No se pudo consultar la API alternativa.");
  }

  const data = await response.json();
  const rate = Number(data?.rates?.UYU);

  if (!Number.isFinite(rate)) {
    throw new Error("La API alternativa no devolvió UYU.");
  }

  return {
    rate,
    source: "open.er-api.com",
    updatedAt: new Date().toISOString(),
  };
}

function renderExchangeRate(withError = false) {
  exchangeRateValue.textContent = `${formatRate(state.exchangeRate.rate)} / USD`;

  if (withError) {
    exchangeRateMeta.textContent =
      "No se pudo actualizar en línea. Se muestra el último valor disponible o respaldo.";
    return;
  }

  const updatedText = state.exchangeRate.updatedAt
    ? `Actualizado ${formatDateTime(state.exchangeRate.updatedAt)}`
    : "Usando valor de respaldo";

  exchangeRateMeta.textContent = `${state.exchangeRate.source} · ${updatedText}`;
}

function setDefaultDueDate() {
  dueDateInput.value = toInputDate(getLocalToday());
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error("No se pudieron cargar las cuentas.", error);
    return [];
  }
}

function saveAccounts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.accounts));
}

function loadRateCache() {
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error("No se pudo cargar la cotización guardada.", error);
    return null;
  }
}

function saveRateCache() {
  localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(state.exchangeRate));
}

function clampPaidThroughMonth(paidThroughMonth, startDate) {
  if (!paidThroughMonth) {
    return null;
  }

  const startMonthKey = toMonthKey(new Date(`${startDate}T12:00:00`));
  return monthDiff(startMonthKey, paidThroughMonth) >= 0 ? paidThroughMonth : null;
}

function getPreviousMonthKey(currentMonthKey, startDate) {
  const currentDate = buildDateForMonth(currentMonthKey, 1);
  const previousDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const previousMonthKey = toMonthKey(previousDate);
  const startMonthKey = toMonthKey(new Date(`${startDate}T12:00:00`));

  return monthDiff(startMonthKey, previousMonthKey) >= 0 ? previousMonthKey : null;
}

function getLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildDateForMonth(monthKey, dueDay) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return new Date(year, month - 1, Math.min(dueDay, lastDay));
}

function monthDiff(fromMonthKey, toMonthKey) {
  const [fromYear, fromMonth] = fromMonthKey.split("-").map(Number);
  const [toYear, toMonth] = toMonthKey.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

function differenceInDays(fromDate, toDate) {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((toDate - fromDate) / msPerDay);
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("es-UY", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCurrency(value, currency) {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "UYU" ? 0 : 2,
  }).format(value);
}

function formatRate(value) {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
