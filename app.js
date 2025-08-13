/* Tiny IndexedDB helper (no libs) */
const DB_NAME = "simple_spa_db";
const DB_VERSION = 1;
// Stores:
//  - projects: { id (auto), name, createdAt }
//  - tasks:    { id (auto), projectId, title, status, createdAt } with indexes on projectId, status

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id", autoIncrement: true })
          .createIndex("name", "name", { unique: false });
      }
      if (!db.objectStoreNames.contains("tasks")) {
        const s = db.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
        s.createIndex("projectId", "projectId", { unique: false });
        s.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeNames, mode = "readonly") {
  return db.transaction(storeNames, mode);
}

function add(db, store, value) {
  return new Promise((resolve, reject) => {
    const r = tx(db, [store], "readwrite").objectStore(store).add(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const r = tx(db, [store], "readwrite").objectStore(store).put(value);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function getAll(db, store, indexName = null, query = null) {
  return new Promise((resolve, reject) => {
    const storeObj = tx(db, [store]).objectStore(store);
    const source = indexName ? storeObj.index(indexName) : storeObj;
    const r = source.getAll(query);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

function del(db, store, key) {
  return new Promise((resolve, reject) => {
    const r = tx(db, [store], "readwrite").objectStore(store).delete(key);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

/* App logic */
const els = {
  projectForm: document.getElementById("project-form"),
  projectName: document.getElementById("project-name"),
  taskForm: document.getElementById("task-form"),
  taskProject: document.getElementById("task-project"),
  taskTitle: document.getElementById("task-title"),
  taskStatus: document.getElementById("task-status"),
  projectList: document.getElementById("project-list"),
  taskList: document.getElementById("task-list"),
  filterProject: document.getElementById("filter-project"),
  filterStatus: document.getElementById("filter-status"),
  clearFilters: document.getElementById("clear-filters"),
};

let db;

async function refreshProjectsUI() {
  const projects = await getAll(db, "projects");
  // fill project dropdowns
  els.taskProject.innerHTML = "";
  els.filterProject.innerHTML = `<option value="">All</option>`;
  for (const p of projects) {
    const opt1 = new Option(p.name, p.id);
    const opt2 = new Option(p.name, p.id);
    els.taskProject.add(opt1);
    els.filterProject.add(opt2);
  }
  // list
  els.projectList.innerHTML = projects.map(p => `
    <li>
      <div class="row">
        <span class="badge">#${p.id}</span>
        <strong>${escapeHtml(p.name)}</strong>
      </div>
      <div class="actions">
        <button data-del-project="${p.id}">Delete</button>
      </div>
    </li>
  `).join("");
}

async function refreshTasksUI() {
  const pid = els.filterProject.value;
  const status = els.filterStatus.value;
  let tasks = await getAll(db, "tasks");
  if (pid) tasks = tasks.filter(t => String(t.projectId) === String(pid));
  if (status) tasks = tasks.filter(t => t.status === status);

  // join with projects to show names
  const projects = await getAll(db, "projects");
  const byId = new Map(projects.map(p => [p.id, p]));

  els.taskList.innerHTML = tasks.map(t => `
    <li>
      <div class="row">
        <span class="badge">${byId.get(t.projectId)?.name ?? "Unknown"}</span>
        <span>${escapeHtml(t.title)}</span>
        <span class="badge">${t.status}</span>
      </div>
      <div class="actions">
        <button data-advance="${t.id}">Advance</button>
        <button data-del-task="${t.id}">Delete</button>
      </div>
    </li>
  `).join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function nextStatus(s) {
  return s === "todo" ? "doing" : s === "doing" ? "done" : "todo";
}

/* Event wiring */
document.addEventListener("DOMContentLoaded", async () => {
  db = await openDB();

  els.projectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.projectName.value.trim();
    if (!name) return;
    await add(db, "projects", { name, createdAt: Date.now() });
    els.projectName.value = "";
    await refreshProjectsUI();
    await refreshTasksUI();
  });

  els.taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const projectId = Number(els.taskProject.value);
    const title = els.taskTitle.value.trim();
    const status = els.taskStatus.value;
    if (!projectId || !title) return;
    await add(db, "tasks", { projectId, title, status, createdAt: Date.now() });
    els.taskTitle.value = "";
    els.taskStatus.value = "todo";
    await refreshTasksUI();
  });

  els.projectList.addEventListener("click", async (e) => {
    const id = Number(e.target.getAttribute("data-del-project"));
    if (!id) return;
    // delete project and its tasks (simple cascade)
    await del(db, "projects", id);
    const allTasks = await getAll(db, "tasks");
    await Promise.all(allTasks.filter(t => t.projectId === id).map(t => del(db, "tasks", t.id)));
    await refreshProjectsUI();
    await refreshTasksUI();
  });

  els.taskList.addEventListener("click", async (e) => {
    const delId = Number(e.target.getAttribute("data-del-task"));
    const advId = Number(e.target.getAttribute("data-advance"));
    if (delId) {
      await del(db, "tasks", delId);
      await refreshTasksUI();
    } else if (advId) {
      const tasks = await getAll(db, "tasks");
      const t = tasks.find(x => x.id === advId);
      if (t) {
        t.status = nextStatus(t.status);
        await put(db, "tasks", t);
        await refreshTasksUI();
      }
    }
  });

  els.filterProject.addEventListener("change", refreshTasksUI);
  els.filterStatus.addEventListener("change", refreshTasksUI);
  els.clearFilters.addEventListener("click", () => {
    els.filterProject.value = "";
    els.filterStatus.value = "";
    refreshTasksUI();
  });

  await refreshProjectsUI();
  await refreshTasksUI();
});
