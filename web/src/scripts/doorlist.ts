import { api, apiRaw, ApiError, consumeSsoFragment, logout, staffLogin, whoAmI, type Identity } from '../lib/session';

interface EventRow {
  id: number;
  name: string;
  event_date: string | null;
}

interface DoorTicket {
  ticket_id: string;
  checkin_status: 'checked_in' | 'not_checked_in';
}

interface DoorOrder {
  id: number;
  order_number: string;
  buyer_first_name: string | null;
  buyer_last_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  tickets_total: number;
  tickets_checked_in: number;
  ticket_type: string;
  tickets: DoorTicket[];
}

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

const els = {
  boot: $('[data-boot]'),
  banner: $('[data-banner]'),
  login: $('#login'),
  loginForm: $('[data-login-form]') as HTMLFormElement,
  loginError: $('[data-login-error]'),
  who: $('[data-who]'),
  logout: $('[data-logout]'),
  eventSelect: $('[data-event-select]') as HTMLSelectElement,
  search: $('[data-search]') as HTMLInputElement,
  openExport: $('[data-open-export]') as HTMLButtonElement,
  print: $('[data-print]') as HTMLButtonElement,
  stats: $('[data-stats]'),
  progress: $('[data-progress]'),
  empty: $('[data-empty]'),
  tableWrap: $('[data-table-wrap]'),
  tbody: $('[data-tbody]'),
  dialog: $('#export-dialog') as HTMLDialogElement,
  exportForm: $('[data-export-form]') as HTMLFormElement,
  exportSubmit: $('[data-export-submit]') as HTMLButtonElement,
  exportError: $('[data-export-error]'),
};

let identity: Identity | null = null;
let orders: DoorOrder[] = [];
let currentEventId: number | null = null;

const isStaff = () => identity?.kind === 'staff';

function showBanner(message: string | null): void {
  els.banner.textContent = message ?? '';
  els.banner.hidden = !message;
}

function setAuthed(authed: boolean): void {
  els.boot.hidden = true;
  els.login.hidden = authed;
  document.querySelectorAll<HTMLElement>('[data-when="authed"]').forEach((el) => { el.hidden = !authed; });
  document.querySelectorAll<HTMLElement>('[data-staff-only]').forEach((el) => { el.hidden = !isStaff(); });
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function statusBadge(order: DoorOrder): HTMLElement {
  const span = document.createElement('span');
  const { tickets_checked_in: inCount, tickets_total: total } = order;
  if (total > 0 && inCount === total) {
    span.className = 'badge in';
    span.textContent = 'Checked in';
  } else if (inCount > 0) {
    span.className = 'badge partial';
    span.textContent = `${inCount}/${total} in`;
  } else {
    span.className = 'badge';
    span.textContent = 'Not in';
  }
  return span;
}

function searchText(o: DoorOrder): string {
  return [o.buyer_last_name, o.buyer_first_name, o.buyer_email, o.buyer_phone, o.order_number]
    .filter(Boolean).join(' ').toLowerCase();
}

function renderStats(): void {
  const tickets = orders.reduce((s, o) => s + o.tickets_total, 0);
  const checked = orders.reduce((s, o) => s + o.tickets_checked_in, 0);
  const set = (key: string, value: number) => { $(`[data-stat="${key}"]`).textContent = String(value); };
  set('orders', orders.length);
  set('tickets', tickets);
  set('checked', checked);
  set('remaining', tickets - checked);
  els.progress.style.width = tickets ? `${Math.round((checked / tickets) * 100)}%` : '0';
}

function renderRow(order: DoorOrder): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.className = 'door-row';
  tr.dataset.search = searchText(order);
  tr.append(
    cell(order.buyer_last_name ?? '', 'last'),
    cell(order.buyer_first_name ?? ''),
    cell(String(order.tickets_total), 'num'),
    cell(order.ticket_type || 'General Admission', 'muted'),
    cell(order.order_number, 'mono'),
    cell(order.buyer_email ?? '', 'muted'),
    cell(order.buyer_phone ?? '', 'muted'),
  );
  const status = document.createElement('td');
  status.append(statusBadge(order));
  tr.append(status);

  if (isStaff()) {
    const actions = document.createElement('td');
    actions.className = 'actions-cell';
    if (order.tickets_checked_in < order.tickets_total) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'checkin-btn';
      btn.textContent = 'Check in';
      btn.addEventListener('click', () => { void checkInOrder(order, btn); });
      actions.append(btn);
    }
    tr.append(actions);
  }
  return tr;
}

function renderTable(): void {
  els.tbody.replaceChildren(...orders.map(renderRow));
  const has = orders.length > 0;
  els.tableWrap.hidden = !has;
  els.stats.hidden = !has;
  els.empty.hidden = has;
  els.empty.textContent = currentEventId ? 'No orders for this event yet.' : 'Select an event to view the door list.';
  els.search.disabled = !has;
  els.openExport.disabled = !currentEventId;
  els.print.disabled = !has;
  renderStats();
  applyFilter();
}

function applyFilter(): void {
  const q = els.search.value.trim().toLowerCase();
  els.tbody.querySelectorAll<HTMLTableRowElement>('tr').forEach((tr) => {
    tr.hidden = Boolean(q) && !(tr.dataset.search ?? '').includes(q);
  });
}

async function checkInOrder(order: DoorOrder, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = '…';
  let failed = 0;
  for (const ticket of order.tickets) {
    if (ticket.checkin_status === 'checked_in') continue;
    try {
      await api(`/api/tickets/checkin/${encodeURIComponent(ticket.ticket_id)}`, { method: 'POST' });
      ticket.checkin_status = 'checked_in';
    } catch (err) {
      // 409 = ya estaba dentro (otro dispositivo): cuenta como hecho.
      if (err instanceof ApiError && err.status === 409) ticket.checkin_status = 'checked_in';
      else failed++;
    }
  }
  order.tickets_checked_in = order.tickets.filter((t) => t.checkin_status === 'checked_in').length;
  if (failed) showBanner(`${failed} ticket(s) of ${order.order_number} could not be checked in. Try again.`);
  renderTable();
}

async function loadEvents(): Promise<void> {
  const events = await api<EventRow[]>('/api/events');
  const options = events.map((e) => {
    const opt = document.createElement('option');
    opt.value = String(e.id);
    const date = e.event_date ? new Date(e.event_date).toLocaleDateString() : '';
    opt.textContent = date ? `${e.name} — ${date}` : e.name;
    return opt;
  });
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = events.length ? 'Select event…' : 'No events available yet';
  els.eventSelect.replaceChildren(placeholder, ...options);
  if (events.length === 1) {
    els.eventSelect.value = String(events[0].id);
    await loadDoorList();
  }
}

async function loadDoorList(): Promise<void> {
  const id = Number(els.eventSelect.value);
  currentEventId = Number.isInteger(id) && id > 0 ? id : null;
  orders = [];
  showBanner(null);
  if (currentEventId) {
    try {
      const data = await api<{ orders: DoorOrder[] }>(`/api/events/${currentEventId}/door-list`);
      orders = data.orders;
    } catch (err) {
      if (!(await handleAuthError(err))) showBanner(err instanceof Error ? err.message : 'Could not load the door list.');
    }
  }
  renderTable();
}

function filenameFrom(res: Response, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  return match?.[1] ?? fallback;
}

async function downloadExport(): Promise<void> {
  if (!currentEventId) return;
  const data = new FormData(els.exportForm);
  const format = String(data.get('format') ?? 'csv');
  const include = data.getAll('include').map(String);
  const params = new URLSearchParams({ format });
  if (include.length) params.set('include', include.join(','));

  els.exportSubmit.disabled = true;
  els.exportSubmit.textContent = 'Preparing…';
  els.exportError.textContent = '';
  try {
    const res = await apiRaw(`/api/events/${currentEventId}/door-list/export?${params}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameFrom(res, `door-list.${format}`);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    els.dialog.close();
  } catch (err) {
    if (!(await handleAuthError(err))) els.exportError.textContent = err instanceof Error ? err.message : 'Download failed.';
  } finally {
    els.exportSubmit.disabled = false;
    els.exportSubmit.textContent = 'Download';
  }
}

// Sesión vencida o rol retirado: vuelve al login. Devuelve true si lo manejó.
async function handleAuthError(err: unknown): Promise<boolean> {
  if (!(err instanceof ApiError) || err.status !== 401) return false;
  const wasPublisher = identity?.kind === 'publisher';
  logout();
  identity = null;
  if (els.dialog.open) els.dialog.close();
  setAuthed(false);
  showBanner(wasPublisher
    ? 'Your session ended. Open the door list again from your Silver Glider dashboard.'
    : 'Your session expired. Sign in again.');
  return true;
}

async function startSession(): Promise<void> {
  identity = await whoAmI();
  if (!identity) {
    setAuthed(false);
    return;
  }
  els.who.textContent = identity.first_name ? `${identity.first_name} · ${identity.role}` : identity.role;
  setAuthed(true);
  try {
    await loadEvents();
  } catch (err) {
    if (!(await handleAuthError(err))) showBanner('Could not load events.');
  }
}

els.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(els.loginForm);
  els.loginError.textContent = '';
  staffLogin(String(data.get('email') ?? ''), String(data.get('password') ?? ''))
    .then(() => { showBanner(null); return startSession(); })
    .catch((err: unknown) => {
      els.loginError.textContent = err instanceof ApiError ? err.message : 'Connection error';
    });
});

els.logout.addEventListener('click', () => {
  logout();
  identity = null;
  orders = [];
  currentEventId = null;
  els.eventSelect.replaceChildren();
  renderTable();
  showBanner(null);
  // Si queda la sesión del staff (el publicador entró en el mismo navegador), se retoma.
  void startSession();
});

els.eventSelect.addEventListener('change', () => { void loadDoorList(); });
els.search.addEventListener('input', applyFilter);
els.print.addEventListener('click', () => window.print());
els.openExport.addEventListener('click', () => {
  els.exportError.textContent = '';
  els.dialog.showModal();
});
els.exportSubmit.addEventListener('click', () => { void downloadExport(); });

(async () => {
  try {
    await consumeSsoFragment();
  } catch (err) {
    showBanner(err instanceof Error
      ? `Could not open your session: ${err.message}. Open the door list again from your Silver Glider dashboard.`
      : 'Could not open your session.');
  }
  try {
    await startSession();
  } catch {
    setAuthed(false);
    showBanner('Connection error. Reload the page.');
  }
})();
