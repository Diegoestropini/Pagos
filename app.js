const STORAGE_KEY = "control-pagos-accounts";
const RATE_CACHE_KEY = "control-pagos-rate-cache";
const FALLBACK_USD_TO_UYU = 39.9;
const VALID_CURRENCIES = new Set(["UYU", "USD"]);
const STATUS_PRIORITY = {
  overdue: 0,
  today: 1,
  warning: 2,
  upcoming: 3,
  scheduled: 4,
  paid: 5,
};

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
const filterBar = document.querySelector("#filterBar");
const exchangeRateValue = document.querySelector("#exchangeRateValue");
const exchangeRateMeta = document.querySelector("#exchangeRateMeta");
const exchangeRateInput = document.querySelector("#exchangeRateInput");
const saveExchangeRateButton = document.querySelector("#saveExchangeRateButton");
const resetExchangeRateButton = document.querySelector("#resetExchangeRateButton");
const accountCardTemplate = document.querySelector("#accountCardTemplate");
const toast = document.querySelector("#toast");

const state = {
  accounts: loadAccounts(),
  editingAccountId: null,
  activeFilter: "all",
  exchangeRate: loadRateCache(),
};

let toastTimeoutId = null;

initialize();

function initialize() {
  persistSanitizedState();
  resetForm();
  bindEvents();
  render();
}

function bindEvents() {
  accountForm.addEventListener("submit", handleSubmit);
  cancelEditButton.addEventListener("click", resetForm);
  filterBar.addEventListener("click", handleFilterSelection);
  saveExchangeRateButton.addEventListener("click", saveManualExchangeRate);
  resetExchangeRateButton.addEventListener("click", resetExchangeRate);
}

function handleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(accountForm);
  const accountId = String(formData.get("accountId") || "").trim();
  const name = normalizeName(formData.get("name"));
  const dueDate = String(formData.get("dueDate") || "").trim();
  const amount = normalizePositiveAmount(formData.get("amount"));
  const currency = normalizeCurrency(formData.get("currency"));

  if (!name || !isValidIsoDate(dueDate) || !Number.isFinite(amount) || amount <= 0) {
    showToast("Completa un nombre, fecha y monto válidos.");
    return;
  }

  const dueDay = getDueDayFromDate(dueDate);

  if (!Number.isInteger(dueDay)) {
    showToast("La fecha ingresada no es válida.");
    return;
  }

  const baseAccount = {
    name,
    startDate: dueDate,
    dueDay,
    amount,
    currency,
  };

  if (accountId) {
    state.accounts = state.accounts.map((account) => {
      if (account.id !== accountId) {
        return account;
      }

      return {
        ...account,
        ...baseAccount,
        payments: rebasePayments(account.payments, account.startDate, dueDate),
        updatedAt: new Date().toISOString(),
      };
    });
  } else {
    state.accounts.unshift({
      id: createId(),
      ...baseAccount,
      payments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  saveAccounts();
  resetForm();
  render();
  showToast(accountId ? "Cuenta actualizada." : "Cuenta guardada.");
}

function handleFilterSelection(event) {
  const button = event.target.closest("[data-filter]");
  if (!button) {
    return;
  }

  state.activeFilter = button.dataset.filter;
  render();
}

function saveManualExchangeRate() {
  const nextRate = normalizePositiveAmount(exchangeRateInput.value);

  if (!Number.isFinite(nextRate) || nextRate <= 0) {
    showToast("Ingresa una cotización válida mayor a cero.");
    return;
  }

  state.exchangeRate = buildManualRate(nextRate);
  saveRateCache();
  render();
  showToast("Cotización guardada localmente.");
}

function resetExchangeRate() {
  state.exchangeRate = buildFallbackRate();
  saveRateCache();
  render();
  showToast("Se restableció la cotización de respaldo.");
}

function render() {
  const today = getLocalToday();
  const detailsList = state.accounts
    .map((account) => buildAccountDetails(account, today, state.exchangeRate.rate))
    .sort(sortAccounts);

  renderStats(detailsList, today);
  renderFilters(detailsList);
  renderAccounts(detailsList);
  renderExchangeRate();
}

function renderStats(detailsList, today) {
  const scheduledDetails = detailsList.filter((item) => item.statusKey === "scheduled");
  const actionableDetails = detailsList.filter(
    (item) => item.statusKey !== "paid" && item.statusKey !== "scheduled",
  );
  const overdueEntries = detailsList.filter((item) => item.statusKey === "overdue");
  const dueThisWeekCount = actionableDetails.filter((item) => {
    const days = differenceInDays(today, item.currentDueDate);
    return days >= 0 && days <= 7;
  }).length;
  const actionableTotalUyu = actionableDetails.reduce(
    (total, item) => total + item.totalEstimatedUyu,
    0,
  );
  const overdueTotalUyu = overdueEntries.reduce(
    (total, item) => total + item.totalEstimatedUyu,
    0,
  );
  const scheduledMonthlyUyu = scheduledDetails.reduce(
    (total, item) => total + item.monthlyEstimatedUyu,
    0,
  );

  const cards = [
    {
      tone: "upcoming",
      label: "Exigibles este mes",
      value: String(actionableDetails.length),
      small: `Pendiente: ${formatCurrency(actionableTotalUyu, "UYU")}`,
    },
    {
      tone: "neutral",
      label: "Programadas",
      value: String(scheduledDetails.length),
      small:
        scheduledDetails.length === 0
          ? "Sin cuentas futuras"
          : `Proyección mensual: ${formatCurrency(scheduledMonthlyUyu, "UYU")}`,
    },
    {
      tone: "today",
      label: "Próximos 7 días",
      value: String(dueThisWeekCount),
      small: "Pagos para anticiparte esta semana",
    },
    {
      tone: "overdue",
      label: "Vencidas / acumuladas",
      value: formatCurrency(overdueTotalUyu, "UYU"),
      small: `${overdueEntries.length} cuenta${overdueEntries.length === 1 ? "" : "s"} con atraso`,
    },
  ];

  statsGrid.replaceChildren(
    ...cards.map((card) => {
      const article = document.createElement("article");
      article.className = `stat-card stat-card-${card.tone}`;

      const label = document.createElement("p");
      label.textContent = card.label;

      const value = document.createElement("strong");
      value.textContent = card.value;

      article.append(label, value);

      if (card.small) {
        const small = document.createElement("small");
        small.textContent = card.small;
        article.appendChild(small);
      }

      return article;
    }),
  );

  summaryText.textContent =
    detailsList.length === 0
      ? "Todavía no hay pagos cargados."
      : `${actionableDetails.length} exigible${
          actionableDetails.length === 1 ? "" : "s"
        } este mes, ${scheduledDetails.length} programada${
          scheduledDetails.length === 1 ? "" : "s"
        } y ${formatCurrency(actionableTotalUyu, "UYU")} pendientes.`;
}

function renderFilters(detailsList) {
  const counts = {
    all: detailsList.length,
    pending: detailsList.filter(
      (item) => item.statusKey !== "paid" && item.statusKey !== "scheduled",
    ).length,
    overdue: detailsList.filter((item) => item.statusKey === "overdue").length,
    paid: detailsList.filter((item) => item.statusKey === "paid").length,
  };

  filterBar.querySelectorAll("[data-filter]").forEach((button) => {
    const filterKey = button.dataset.filter;
    const label = button.dataset.label || button.textContent.split(" (")[0];
    button.dataset.label = label;
    button.classList.toggle("is-active", filterKey === state.activeFilter);
    button.textContent = `${label} (${counts[filterKey] || 0})`;
  });
}

function renderAccounts(detailsList) {
  if (detailsList.length === 0) {
    setEmptyState(
      accountList,
      "Agrega tu primera cuenta y la app empezará a controlar vencimientos y pagos sin salir de tu navegador.",
    );
    return;
  }

  const filteredDetails = detailsList.filter(matchesActiveFilter);

  if (filteredDetails.length === 0) {
    setEmptyState(accountList, "No hay cuentas para el filtro seleccionado.");
    return;
  }

  const fragment = document.createDocumentFragment();

  filteredDetails.forEach((details) => {
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

    markPaidButton.disabled =
      details.statusKey === "paid" || details.statusKey === "scheduled";

    if (details.statusKey === "scheduled") {
      markPaidButton.textContent = "Aún no corresponde";
    } else if (details.nextPaymentShortLabel) {
      markPaidButton.textContent = `Pagar ${details.nextPaymentShortLabel}`;
    } else {
      markPaidButton.textContent = "Marcar pago del mes";
    }

    markPaidButton.addEventListener("click", () => markAsPaid(details.account.id));

    undoPaidButton.disabled = !details.lastPayment;
    undoPaidButton.textContent = details.lastPayment
      ? `Deshacer ${details.lastPaymentShortLabel}`
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

  accountList.replaceChildren(fragment);
}

function renderMeta(container, lines) {
  container.replaceChildren(
    ...lines.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );
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
    "Ajusta nombre, vencimiento o monto sin perder el historial existente.";
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
  formSubtitle.textContent =
    "Agregá pagos mensuales y dejalos guardados localmente.";
  submitButton.textContent = "Guardar cuenta";
  cancelEditButton.classList.add("is-hidden");
  setDefaultDueDate();
}

function markAsPaid(accountId) {
  const today = getLocalToday();

  state.accounts = state.accounts.map((account) => {
    if (account.id !== accountId) {
      return account;
    }

    const details = buildAccountDetails(account, today, state.exchangeRate.rate);
    if (details.statusKey === "scheduled") {
      return account;
    }

    const nextPayment = buildNextPaymentRecord(account, today, state.exchangeRate.rate);
    if (!nextPayment) {
      return account;
    }

    return {
      ...account,
      payments: [...account.payments, nextPayment],
      updatedAt: new Date().toISOString(),
    };
  });

  saveAccounts();
  render();
  showToast("Se registró un pago.");
}

function undoLastPayment(accountId) {
  state.accounts = state.accounts.map((account) => {
    if (account.id !== accountId || account.payments.length === 0) {
      return account;
    }

    const paymentToRemove = getLastPayment(account);
    if (!paymentToRemove) {
      return account;
    }

    return {
      ...account,
      payments: account.payments.filter((payment) => payment.id !== paymentToRemove.id),
      updatedAt: new Date().toISOString(),
    };
  });

  saveAccounts();
  render();
  showToast("Último pago desmarcado.");
}

function deleteAccount(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  const confirmed = window.confirm(`Se va a eliminar la cuenta "${account.name}".`);
  if (!confirmed) {
    return;
  }

  state.accounts = state.accounts.filter((item) => item.id !== accountId);

  if (state.editingAccountId === accountId) {
    resetForm();
  }

  saveAccounts();
  render();
  showToast("Cuenta eliminada.");
}

function buildAccountDetails(account, today, exchangeRate) {
  const currentMonthKey = toMonthKey(today);
  const startDate = parseLocalDate(account.startDate);
  const startMonthKey = toMonthKey(startDate);
  const cyclesDue = Math.max(0, monthDiff(startMonthKey, currentMonthKey) + 1);
  const paymentCoverage = getPaymentCoverage(account, startMonthKey);
  const paidCycles = paymentCoverage.count;
  const pendingInstallments = Math.max(0, cyclesDue - paidCycles);
  const currentDueDate =
    cyclesDue > 0
      ? buildDateForMonth(currentMonthKey, account.dueDay)
      : buildDateForMonth(startMonthKey, account.dueDay);
  const daysUntilDue = differenceInDays(today, currentDueDate);
  const isScheduled = cyclesDue === 0;

  let statusKey = "upcoming";
  let statusLabel = "Por pagar";

  if (isScheduled) {
    statusKey = "scheduled";
    statusLabel = "Programada";
  } else if (pendingInstallments <= 0) {
    statusKey = "paid";
    statusLabel = "Pagada";
  } else if (pendingInstallments > 1 || daysUntilDue < 0) {
    statusKey = "overdue";
    statusLabel = pendingInstallments > 1 ? "Deuda acumulada" : "Vencida";
  } else if (daysUntilDue === 0) {
    statusKey = "today";
    statusLabel = "Vence hoy";
  } else if (daysUntilDue <= 2) {
    statusKey = "warning";
    statusLabel = "Vence pronto";
  }

  const totalOriginal = account.amount * pendingInstallments;
  const totalEstimatedUyu =
    account.currency === "USD" ? totalOriginal * exchangeRate : totalOriginal;
  const monthlyEstimatedUyu =
    account.currency === "USD" ? account.amount * exchangeRate : account.amount;
  const nextPaymentMonthKey =
    pendingInstallments > 0 ? shiftMonthKeySafe(startMonthKey, paidCycles) : null;
  const nextPaymentLabel = nextPaymentMonthKey ? formatMonthKey(nextPaymentMonthKey) : null;
  const nextPaymentShortLabel = nextPaymentMonthKey
    ? formatMonthKeyShort(nextPaymentMonthKey)
    : null;
  const remainingAfterNext = Math.max(0, pendingInstallments - 1);
  const lastPayment = getLastPayment(account);
  const lastPaymentLabel = lastPayment ? formatMonthKey(lastPayment.monthKey) : null;
  const lastPaymentShortLabel = lastPayment ? formatMonthKeyShort(lastPayment.monthKey) : null;

  const scheduleLabel = `Mensual, vence cada ${account.dueDay} | inicia ${formatDate(
    startDate,
  )}`;
  const totalDisplay = isScheduled || statusKey === "paid"
    ? formatCurrency(account.amount, account.currency)
    : formatCurrency(totalOriginal, account.currency);
  const secondaryAmount = buildSecondaryAmount(
    account,
    exchangeRate,
    totalEstimatedUyu,
    isScheduled,
  );
  const metaLines = buildMetaLines(
    account,
    statusKey,
    pendingInstallments,
    currentDueDate,
    daysUntilDue,
    exchangeRate,
    nextPaymentLabel,
    remainingAfterNext,
    lastPayment,
    lastPaymentLabel,
  );

  return {
    account,
    statusKey,
    statusLabel,
    pendingInstallments,
    totalEstimatedUyu,
    monthlyEstimatedUyu,
    totalDisplay,
    secondaryAmount,
    scheduleLabel,
    metaLines,
    daysUntilDue,
    currentDueDate,
    nextPaymentShortLabel,
    lastPayment,
    lastPaymentShortLabel,
  };
}

function buildSecondaryAmount(account, exchangeRate, totalEstimatedUyu, isScheduled) {
  if (account.currency === "USD") {
    const hasPendingTotal = !isScheduled && totalEstimatedUyu > 0;
    const uyuValue = hasPendingTotal ? totalEstimatedUyu : account.amount * exchangeRate;
    return `${hasPendingTotal ? "Estimado en pesos" : "Monto mensual estimado"}: ${formatCurrency(
      uyuValue,
      "UYU",
    )}`;
  }

  return isScheduled
    ? `Monto mensual previsto: ${formatCurrency(account.amount, "UYU")}`
    : `Monto mensual: ${formatCurrency(account.amount, "UYU")}`;
}

function buildMetaLines(
  account,
  statusKey,
  pendingInstallments,
  currentDueDate,
  daysUntilDue,
  exchangeRate,
  nextPaymentLabel,
  remainingAfterNext,
  lastPayment,
  lastPaymentLabel,
) {
  const metaLines = [];

  if (statusKey === "scheduled") {
    metaLines.push(`Esta cuenta empieza a correr el ${formatDate(currentDueDate)}.`);
  } else if (pendingInstallments > 1) {
    metaLines.push(
      `Tienes ${pendingInstallments} meses acumulados. La deuda ya incluye varios ciclos impagos.`,
    );
    metaLines.push(
      `Si registras un pago ahora, cancelas ${nextPaymentLabel} y quedarán ${remainingAfterNext} pendientes.`,
    );
  } else if (statusKey === "paid") {
    metaLines.push("La cuenta está marcada como pagada para el mes actual.");
  } else if (statusKey === "today") {
    metaLines.push("El vencimiento es hoy.");
  } else if (statusKey === "warning") {
    metaLines.push(
      `Faltan ${daysUntilDue} día${daysUntilDue === 1 ? "" : "s"} para el vencimiento.`,
    );
  } else if (statusKey === "overdue" && pendingInstallments === 1) {
    metaLines.push(
      `El vencimiento fue hace ${Math.abs(daysUntilDue)} día${
        Math.abs(daysUntilDue) === 1 ? "" : "s"
      }.`,
    );
  } else {
    metaLines.push(`Próximo vencimiento: ${formatDate(currentDueDate)}.`);
  }

  if (
    pendingInstallments === 1 &&
    statusKey !== "paid" &&
    statusKey !== "scheduled" &&
    nextPaymentLabel
  ) {
    metaLines.push(`Si lo pagas ahora, quedará al día con ${nextPaymentLabel}.`);
  }

  if (account.currency === "USD") {
    metaLines.push(`Cotización usada: ${formatRate(exchangeRate)} por USD.`);
  }

  if (lastPayment && lastPaymentLabel) {
    metaLines.push(
      `Último pago registrado: ${lastPaymentLabel} por ${formatCurrency(
        lastPayment.amount,
        lastPayment.currency,
      )} el ${formatDateTime(lastPayment.paidAt)}.`,
    );
  }

  return metaLines;
}

function matchesActiveFilter(details) {
  if (state.activeFilter === "pending") {
    return details.statusKey !== "paid" && details.statusKey !== "scheduled";
  }

  if (state.activeFilter === "overdue") {
    return details.statusKey === "overdue";
  }

  if (state.activeFilter === "paid") {
    return details.statusKey === "paid";
  }

  return true;
}

function sortAccounts(a, b) {
  if (STATUS_PRIORITY[a.statusKey] !== STATUS_PRIORITY[b.statusKey]) {
    return STATUS_PRIORITY[a.statusKey] - STATUS_PRIORITY[b.statusKey];
  }

  return a.currentDueDate - b.currentDueDate;
}

function renderExchangeRate() {
  exchangeRateValue.textContent = `${formatRate(state.exchangeRate.rate)} / USD`;
  exchangeRateInput.value = String(state.exchangeRate.rate);

  const updatedText = state.exchangeRate.updatedAt
    ? `Actualizado ${formatDateTime(state.exchangeRate.updatedAt)}`
    : "Usando valor de respaldo";

  exchangeRateMeta.textContent = `${state.exchangeRate.source} | ${updatedText}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");

  if (toastTimeoutId) {
    window.clearTimeout(toastTimeoutId);
  }

  toastTimeoutId = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 2200);
}

function setDefaultDueDate() {
  dueDateInput.value = toInputDate(getLocalToday());
}

function loadAccounts() {
  try {
    return sanitizeAccounts(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch (error) {
    console.error("No se pudieron cargar las cuentas.", error);
    return [];
  }
}

function saveAccounts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.accounts));
  } catch (error) {
    console.error("No se pudieron guardar las cuentas.", error);
    showToast("No se pudieron guardar los cambios localmente.");
  }
}

function loadRateCache() {
  try {
    return sanitizeRate(JSON.parse(localStorage.getItem(RATE_CACHE_KEY) || "null"));
  } catch (error) {
    console.error("No se pudo cargar la cotización guardada.", error);
    return buildFallbackRate();
  }
}

function saveRateCache() {
  try {
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(state.exchangeRate));
  } catch (error) {
    console.error("No se pudo guardar la cotización.", error);
    showToast("No se pudo guardar la cotización localmente.");
  }
}

function persistSanitizedState() {
  saveAccounts();
  saveRateCache();
}

function sanitizeAccounts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(sanitizeAccount)
    .filter((account) => account !== null)
    .sort((a, b) => compareIsoDates(b.updatedAt || b.createdAt, a.updatedAt || a.createdAt));
}

function sanitizeAccount(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
  const name = normalizeName(value.name);
  const startDate = typeof value.startDate === "string" ? value.startDate.trim() : "";
  const dueDay = Number(value.dueDay);
  const amount = normalizePositiveAmount(value.amount);
  const currency = normalizeCurrency(value.currency);
  const createdAt = sanitizeIsoDateTime(value.createdAt);
  const updatedAt = sanitizeIsoDateTime(value.updatedAt) || createdAt;

  if (
    !id ||
    !name ||
    !isValidIsoDate(startDate) ||
    !Number.isInteger(dueDay) ||
    dueDay < 1 ||
    dueDay > 31 ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return null;
  }

  return {
    id,
    name,
    startDate,
    dueDay,
    amount,
    currency,
    payments: sanitizePayments(value.payments, {
      startDate,
      amount,
      currency,
      paidThroughMonth: sanitizeMonthKey(value.paidThroughMonth, startDate),
      legacyPaidAt:
        sanitizeIsoDateTime(value.lastPaidAt) || updatedAt || createdAt || new Date().toISOString(),
    }),
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: updatedAt || new Date().toISOString(),
  };
}

function sanitizeRate(value) {
  if (!value || typeof value !== "object") {
    return buildFallbackRate();
  }

  const rate = normalizePositiveAmount(value.rate);

  if (!Number.isFinite(rate) || rate <= 0) {
    return buildFallbackRate();
  }

  return {
    rate,
    source:
      typeof value.source === "string" && value.source.trim()
        ? value.source.trim().slice(0, 80)
        : "Manual",
    updatedAt: sanitizeIsoDateTime(value.updatedAt),
  };
}

function buildFallbackRate() {
  return {
    rate: FALLBACK_USD_TO_UYU,
    source: "Respaldo local",
    updatedAt: null,
  };
}

function buildManualRate(rate) {
  return {
    rate,
    source: "Manual",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizeCurrency(value) {
  return VALID_CURRENCIES.has(value) ? value : "UYU";
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : Number.NaN;
}

function sanitizeIsoDateTime(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function sanitizeMonthKey(value, startDate) {
  if (!isValidMonthKey(value)) {
    return null;
  }

  const startMonthKey = toMonthKey(parseLocalDate(startDate));
  return monthDiff(startMonthKey, value) >= 0 ? value : null;
}

function isValidMonthKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }

  const [, month] = value.split("-").map(Number);
  return month >= 1 && month <= 12;
}

function sanitizePayments(value, legacyConfig) {
  if (!Array.isArray(value) || value.length === 0) {
    return migrateLegacyPayments(legacyConfig);
  }

  const validPayments = value
    .map((payment) => sanitizePayment(payment, legacyConfig))
    .filter((payment) => payment !== null);

  if (validPayments.length === 0) {
    return migrateLegacyPayments(legacyConfig);
  }

  const byMonth = new Map();

  validPayments
    .sort(comparePayments)
    .forEach((payment) => {
      byMonth.set(payment.monthKey, payment);
    });

  return [...byMonth.values()].sort(comparePayments);
}

function sanitizePayment(value, legacyConfig) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const monthKey = sanitizeMonthKey(value.monthKey, legacyConfig.startDate);
  const paidAt = sanitizeIsoDateTime(value.paidAt);
  const amount = normalizePositiveAmount(value.amount);
  const currency = normalizeCurrency(value.currency || legacyConfig.currency);
  const estimatedUyu = normalizePositiveAmount(value.estimatedUyu);
  const exchangeRateUsed = normalizePositiveAmount(value.exchangeRateUsed);
  const id =
    typeof value.id === "string" && value.id.trim() ? value.id.trim().slice(0, 120) : null;

  if (!monthKey || !paidAt || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    id: id || createId(),
    monthKey,
    paidAt,
    amount,
    currency,
    estimatedUyu:
      Number.isFinite(estimatedUyu) && estimatedUyu > 0
        ? estimatedUyu
        : currency === "USD"
          ? amount * FALLBACK_USD_TO_UYU
          : amount,
    exchangeRateUsed:
      currency === "USD" && Number.isFinite(exchangeRateUsed) && exchangeRateUsed > 0
        ? exchangeRateUsed
        : null,
    inferred: Boolean(value.inferred),
  };
}

function migrateLegacyPayments({ startDate, amount, currency, paidThroughMonth, legacyPaidAt }) {
  if (!paidThroughMonth) {
    return [];
  }

  const startMonthKey = toMonthKey(parseLocalDate(startDate));
  const totalMonths = monthDiff(startMonthKey, paidThroughMonth) + 1;

  return Array.from({ length: totalMonths }, (_, index) => {
    const monthKey = shiftMonthKeySafe(startMonthKey, index);
    return {
      id: createId(),
      monthKey,
      paidAt: legacyPaidAt,
      amount,
      currency,
      estimatedUyu: currency === "USD" ? amount * FALLBACK_USD_TO_UYU : amount,
      exchangeRateUsed: currency === "USD" ? FALLBACK_USD_TO_UYU : null,
      inferred: true,
    };
  });
}

function rebasePayments(payments, previousStartDate, nextStartDate) {
  const previousStartMonthKey = toMonthKey(parseLocalDate(previousStartDate));
  const nextStartMonthKey = toMonthKey(parseLocalDate(nextStartDate));

  return payments
    .filter((payment) => monthDiff(nextStartMonthKey, payment.monthKey) >= 0)
    .sort(comparePayments)
    .map((payment, index) => ({
      ...payment,
      id: payment.id || `${previousStartMonthKey}-${index}`,
    }));
}

function getLocalToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = parseLocalDate(value);
  return toInputDate(parsed) === value;
}

function getDueDayFromDate(value) {
  if (!isValidIsoDate(value)) {
    return null;
  }

  return parseLocalDate(value).getDate();
}

function compareIsoDates(a, b) {
  const timeA = sanitizeIsoDateTime(a) ? new Date(a).getTime() : 0;
  const timeB = sanitizeIsoDateTime(b) ? new Date(b).getTime() : 0;
  return timeA - timeB;
}

function comparePayments(a, b) {
  if (a.monthKey < b.monthKey) {
    return -1;
  }

  if (a.monthKey > b.monthKey) {
    return 1;
  }

  return compareIsoDates(a.paidAt, b.paidAt);
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
  return Math.round((toDate - fromDate) / msPerDay);
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setEmptyState(container, message) {
  const emptyState = document.createElement("div");
  emptyState.className = "empty-state";
  emptyState.textContent = message;
  container.replaceChildren(emptyState);
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

function formatMonthKey(monthKey) {
  return new Intl.DateTimeFormat("es-UY", {
    month: "long",
    year: "numeric",
  }).format(buildDateForMonth(monthKey, 1));
}

function formatMonthKeyShort(monthKey) {
  return new Intl.DateTimeFormat("es-UY", {
    month: "short",
    year: "numeric",
  })
    .format(buildDateForMonth(monthKey, 1))
    .replace(".", "");
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

function shiftMonthKeySafe(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  return toMonthKey(new Date(year, month - 1 + delta, 1));
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function"
      ? Array.from(crypto.getRandomValues(new Uint32Array(2)), (value) =>
          value.toString(36),
        ).join("")
      : Math.random().toString(36).slice(2);

  return `id-${Date.now().toString(36)}-${randomPart}`;
}

function getPaymentCoverage(account, startMonthKey) {
  const paymentsByMonth = new Set(account.payments.map((payment) => payment.monthKey));
  let count = 0;

  while (paymentsByMonth.has(shiftMonthKeySafe(startMonthKey, count))) {
    count += 1;
  }

  return {
    count,
    paidThroughMonth: count > 0 ? shiftMonthKeySafe(startMonthKey, count - 1) : null,
  };
}

function getLastPayment(account) {
  if (!Array.isArray(account.payments) || account.payments.length === 0) {
    return null;
  }

  const sortedPayments = [...account.payments].sort(comparePayments);
  return sortedPayments[sortedPayments.length - 1] || null;
}

function buildNextPaymentRecord(account, today, exchangeRate) {
  const startDate = parseLocalDate(account.startDate);
  const startMonthKey = toMonthKey(startDate);
  const currentMonthKey = toMonthKey(today);
  const paymentCoverage = getPaymentCoverage(account, startMonthKey);
  const nextMonthKey = shiftMonthKeySafe(startMonthKey, paymentCoverage.count);

  if (nextMonthKey > currentMonthKey) {
    return null;
  }

  return {
    id: createId(),
    monthKey: nextMonthKey,
    paidAt: new Date().toISOString(),
    amount: account.amount,
    currency: account.currency,
    estimatedUyu: account.currency === "USD" ? account.amount * exchangeRate : account.amount,
    exchangeRateUsed: account.currency === "USD" ? exchangeRate : null,
    inferred: false,
  };
}
