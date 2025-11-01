/*
TUNABLES (easy to tweak)
----------------------------------------
PHYSICS
  SPRING_K            = 0.07      // link spring stiffness
  // Increase the repulsion strength and damping so that clusters separate
  // more decisively while still settling quickly.  Larger repulsion
  // encourages children to push away from each other and the higher
  // damping ensures movement decays promptly.  These values were tuned
  // specifically to reduce overlap in deep branches with long labels.
  REPULSION_K         = 700       // stronger repulsion to push nodes apart quickly
  DAMPING             = 0.92      // slightly higher damping so movement stops quickly
  COLLISION_PADDING   = 14        // extra padding added to collision radius
  POLAR_K             = 0.015     // radial "soft pin" for depth‑1 nodes
  GRAVITY_TO_PARENT_K = 0.005     // mild pull toward parent (helps settling)

LINK DISTANCES (pixels)
  L0_L1 = 160                     // root ↔ depth‑1
  // Increase link distances for successive depths to give more room
  // to deeper levels.  This, combined with larger dynamic radii in
  // layoutChildren(), reduces the chance that long labels overlap.
  L1_L2 = 220                     // depth‑1 ↔ depth‑2
  DEPTH_STEP = 60                 // +60 per depth after 2

RING & RADIAL
  R1_RADIUS = 160                 // nominal radius for depth‑1 ring (further reduced to tighten initial layout)
  R1_SPREAD = 0                   // additional spread per bucket (kept 0; we use equal radius)

CAMERA
  MIN_ZOOM = 0.40
  MAX_ZOOM = 2.50
  // Decrease pan and zoom easing durations.  Shorter easing times make
  // navigation feel more responsive, which is especially important on
  // mobile devices where long animations can feel sluggish.
  // Shorter durations for panning and wheel zooming improve the
  // responsiveness of navigation.  A 100 ms easing feels snappy on
  // desktop and mobile, making it easier to reposition and zoom
  // quickly without feeling sluggish.
  PAN_EASE_MS = 60               // shorter pan/zoom duration for faster navigation
  WHEEL_EASE_MS = 60             // shorter zoom easing for snappier scrolls

VISUAL
  BOX_PAD   = 12                 // inner padding for normal nodes
  CHIP_PADX = 14                 // horizontal padding for first‑ring "chips"
  CHIP_RAD  = 18                 // corner radius for chips
*/

// ----------------------------------------------------------------------------
// DATA (kept intact). Same as your v11 dataset; we only wrap under 7 buckets.
// ----------------------------------------------------------------------------
const DATA_CACHE_KEY = 'atlas_dataset_cache_v2';
const DATA_META_KEY = 'atlas_dataset_meta_v2';
const DATA_STALE_MS = 1000 * 60 * 60 * 24; // 24 hours
const loadingOverlayElem = document.getElementById('loadingOverlay');
const dataFreshnessElem = document.getElementById('dataFreshness');
const toastRegion = document.getElementById('toastRegion');
let datasetMeta = null;

function showFatalError(error){
  console.error(error);
  let target = document.getElementById('fatal');
  if (!target){
    target = document.createElement('div');
    target.id = 'fatal';
    const host = document.body || document.documentElement;
    if (host){
      host.appendChild(target);
    }
  }
  if (target){
    target.hidden = false;
    target.removeAttribute('hidden');
    target.textContent = `⚠️ Atlas failed to load: ${error?.message || error}`;
    target.style.cssText = 'position:fixed;inset:16px;z-index:9999;background:#2b2b2b;color:#fff;padding:12px;border-radius:8px;font:14px/1.4 ui-monospace,monospace;';
  }
}

function setLoadingState(active, message = 'Loading…'){
  if (!loadingOverlayElem) return;
  if (typeof message === 'string'){ const label = loadingOverlayElem.querySelector('p'); if (label){ label.textContent = message; } }
  loadingOverlayElem.hidden = !active;
}

function showToast(message, options = {}){
  if (!toastRegion || !message) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  const title = document.createElement('strong');
  title.textContent = options.title || 'Notice';
  const body = document.createElement('span');
  body.textContent = message;
  toast.appendChild(title);
  toast.appendChild(body);
  toastRegion.appendChild(toast);
  const lifetime = typeof options.duration === 'number' ? options.duration : 4000;
  setTimeout(() => { toast.remove(); }, lifetime);
}

function formatRelativeTime(timestamp){
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const units = [
    { limit: 1000 * 60, divisor: 1000, unit: 'second' },
    { limit: 1000 * 60 * 60, divisor: 1000 * 60, unit: 'minute' },
    { limit: 1000 * 60 * 60 * 24, divisor: 1000 * 60 * 60, unit: 'hour' },
    { limit: Infinity, divisor: 1000 * 60 * 60 * 24, unit: 'day' }
  ];
  for (const entry of units){
    if (Math.abs(diffMs) < entry.limit){
      const value = Math.round(diffMs / entry.divisor);
      try {
        const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
        return rtf.format(-value, entry.unit);
      } catch {
        return `${Math.abs(value)} ${entry.unit}${Math.abs(value) === 1 ? '' : 's'} ago`;
      }
    }
  }
  return '';
}

function updateDataFreshnessDisplay(meta, { usedCache = false, error = null } = {}){
  if (!dataFreshnessElem) return;
  dataFreshnessElem.innerHTML = '';
  const parts = [];
  if (meta && Number.isFinite(meta.fetchedAt)){
    parts.push(`Dataset loaded ${formatRelativeTime(meta.fetchedAt)}`);
    if (meta.lastModified){
      parts.push(`Last modified ${meta.lastModified}`);
    }
  }
  if (!parts.length){
    parts.push('Dataset freshness unknown');
  }
  const text = document.createElement('span');
  text.textContent = parts.join(' • ');
  dataFreshnessElem.appendChild(text);
  if (usedCache){
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Cached copy';
    dataFreshnessElem.appendChild(badge);
  }
  if (error){
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'Offline fallback';
    dataFreshnessElem.appendChild(badge);
  }
}

function throttle(fn, wait){
  let lastTime = 0;
  let timeout = null;
  let storedArgs = null;
  const later = () => {
    lastTime = Date.now();
    timeout = null;
    fn.apply(null, storedArgs);
    storedArgs = null;
  };
  return function throttled(...args){
    storedArgs = args;
    const now = Date.now();
    const remaining = wait - (now - lastTime);
    if (remaining <= 0 || remaining > wait){
      if (timeout){
        clearTimeout(timeout);
        timeout = null;
      }
      lastTime = now;
      fn.apply(null, args);
      storedArgs = null;
    } else if (!timeout){
      timeout = setTimeout(later, remaining);
    }
  };
}

async function boot(){
// ----------------------------------------------------------------------------
// DATA LOADING
// ----------------------------------------------------------------------------
setLoadingState(true, 'Loading atlas data…');
let data;
let usedCache = false;
let loadError = null;
let cachedMeta = null;
try {
  const cachedJson = localStorage.getItem(DATA_CACHE_KEY);
  const cachedMetaJson = localStorage.getItem(DATA_META_KEY);
  if (cachedJson){
    data = JSON.parse(cachedJson);
    usedCache = true;
  }
  if (cachedMetaJson){
    cachedMeta = JSON.parse(cachedMetaJson);
    datasetMeta = cachedMeta;
  }
} catch (error) {
  console.warn('Failed to read cached dataset', error);
}
try {
  const dataUrl = new URL('./data/atlas.json', document.baseURI);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const response = await fetch(dataUrl.href, { cache: 'no-store', signal: controller.signal });
  clearTimeout(timeout);
  if (!response.ok) {
    throw new Error(`Failed to fetch data/atlas.json: ${response.status}`);
  }
  const master = await response.json();
  data = JSON.parse(JSON.stringify(master));
  datasetMeta = {
    fetchedAt: Date.now(),
    lastModified: response.headers.get('last-modified') || null,
    etag: response.headers.get('etag') || null
  };
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(DATA_META_KEY, JSON.stringify(datasetMeta));
  } catch (error) {
    console.warn('Failed to persist dataset cache', error);
  }
  usedCache = false;
} catch (error) {
  console.error('Unable to refresh atlas dataset', error);
  loadError = error;
  if (!data){
    showFatalError(error);
    setLoadingState(false);
    return;
  }
  usedCache = true;
  showToast('Showing cached dataset. Refresh once you are back online.', { title: 'Offline mode' });
  if (!datasetMeta && cachedMeta){
    datasetMeta = cachedMeta;
  } else if (!datasetMeta){
    datasetMeta = { fetchedAt: Date.now(), lastModified: null };
  }
}
if (!datasetMeta){
  datasetMeta = { fetchedAt: Date.now(), lastModified: null };
}
updateDataFreshnessDisplay(datasetMeta, { usedCache, error: loadError });
if (datasetMeta && Number.isFinite(datasetMeta.fetchedAt) && Date.now() - datasetMeta.fetchedAt > DATA_STALE_MS){
  showToast('Atlas data may be older than a day. Refresh when online for the latest view.', { title: 'Stale cache', duration: 4200 });
}
setLoadingState(false);

function fallbackText(data, field, fallback = 'No data available') {
  if (!data || typeof data !== 'object') return fallback;
  const value = data[field];
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed === '—' || trimmed.toLowerCase() === 'loading...' ? fallback : trimmed;
}

const supportsHover = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover)').matches : true;
const flashStates = new Map();
let lastFocusedNode = null;
const activeTags = new Set();
const openNodeIds = new Set();
const activePathNodes = new Set();
const activePathLinks = new Set();
const currentPath = [];
const outlineItems = new Map();
let outlineOrder = [];
let outlineLastFocusedId = null;
const RECENT_SEARCH_LIMIT = 8;
let recentSearches = [];
let searchInSubtree = false;
let searchIncludeTags = false;
const MACRO_VISIBILITY_STORAGE_KEY = 'atlas_macro_filters_v1';
const TAG_FILTER_STORAGE_KEY = 'atlas_tag_filters_v1';
let fisheyeEnabled = false;
let applyingUrlState = false;
let contextMenuNode = null;
let contextMenuReturnFocus = null;
let detailsPopoverElem = null;
let detailsContentElem = null;
let detailsCloseBtn = null;
let detailsReturnFocus = null;
let detailsJustOpened = false;
let detailsLastAnchorRect = null;
const OVERVIEW_VISIBILITY_KEY = 'atlas_overview_visibility';
const OVERVIEW_DIM_KEY = 'atlas_overview_dim';
let showSyntheticNodes = true;
let dimSyntheticNodes = false;
const SEARCH_BATCH_SIZE = 240;
const SEARCH_PAGE_SIZE = 8;
let searchPageIndex = 0;
let searchMatchesAll = [];
let searchDropdownPinned = true;
let activeSearchTask = null;
let pendingAutoPan = false;
const OUTLINE_VISIBILITY_KEY = 'atlas_outline_collapsed';
let outlineCollapsed = false;
const TAG_RULES = [
  { label: 'Network', patterns: [/network/i, /tcp|udp/i, /osi/i, /dns/i] },
  { label: 'Web', patterns: [/web/i, /http/i, /browser/i, /api/i] },
  { label: 'OSINT', patterns: [/osint/i, /intelligence/i, /recon/i, /open-source/i] },
  { label: 'Malware', patterns: [/malware/i, /ransom/i, /botnet/i, /payload/i] },
  { label: 'Cloud', patterns: [/cloud/i, /aws/i, /azure/i, /gcp/i, /kubernetes/i] },
  { label: 'Identity', patterns: [/identity/i, /auth/i, /iam/i, /federation/i] },
  { label: 'Threat', patterns: [/threat/i, /hunting/i, /intel/i, /attack/i] },
  { label: 'Compliance', patterns: [/compliance/i, /policy/i, /grc/i, /standard/i] },
  { label: 'Forensics', patterns: [/forensic/i, /analysis/i, /incident/i] },
  { label: 'Automation', patterns: [/automation/i, /workflow/i, /scripting/i, /devsecops/i] }
];
const allTags = new Set();

function triggerNodeFlash(node, duration = 1200){
  if (!node) return;
  flashStates.set(node.id, performance.now() + duration);
}


// -----------------------------------------------------------------------------
// Enrich second‑level categories with a synthetic overview leaf.  In the
// original v11 canvas, some categories displayed additional details.  To
// preserve that behaviour in the radial map, we append a new child to each
// second‑level category summarising its immediate children.  For example,
// the category "Detection Engineering" gains an "Overview: SIEM…, Alerting…,"
// leaf.  This ensures that high‑level context lives within the hierarchy
// itself and can be viewed like any other leaf.
function addDetailNodesForDataset(node, depth=0) {
  if (node.children) {
    node.children.forEach(ch => addDetailNodesForDataset(ch, depth+1));
    // Depth 2 corresponds to second‑level categories (root → macro → category)
    if (depth === 2 && node.children.length > 0) {
      const summary = node.children.map(c => c.name).join(', ');
      node.children.push({ name: 'Overview: ' + summary, syntheticOverview: true });
    }
  }
}
addDetailNodesForDataset(data);

// ----------------------------------------------------------------------------
// L1 “macro bucket” wrapper nodes (same names as your edited draft).
// We *wrap* existing root categories; originals keep their names (unchanged).
// ----------------------------------------------------------------------------
const macroGroups = {
  "Foundations & Standards": ["Core Foundations","GRC & Standards"],
  "Identity, Crypto & Blockchain": ["Identity & Access","Crypto & Protocols","Blockchain / Web3 Security"],
  "Network, Cloud & OT/IoT": ["Network Security","Cloud Security","OT/ICS & Mobile/IoT","RF/SDR & Satellite"],
  "Endpoints & Data": ["Endpoint & Email Security","Data Protection"],
  "App & Emerging Security": ["AppSec & DevSecOps","AI / Quantum / Emerging Security Domains","AI in Security"],
  "Operations, Threat & OffSec": ["Detection Engineering & SOC","Threat Intel & Hunting","Offensive Security"],
  "Guidance & Resources": ["Metrics, Reporting & Blueprints","Careers & Learning","Toolbox (Examples)"]
};

// category colours (pastel on dark)
// Updated category palette to complement the blog’s dark theme.  Each colour
// provides a distinct pastel accent while maintaining harmony with the
// crimson accent used on fr33s0ul.tech.
const catColours = [
  "#c75c5c", // red accent (primary)
  "#4caf50", // green
  "#00bcd4", // cyan
  "#ffc107", // amber
  "#9c27b0", // purple
  "#03a9f4", // blue
  "#ff9800"  // orange
];

// ----------------------------------------------------------------------------
// Build tree nodes
// ----------------------------------------------------------------------------
let nextId = 0;
function mkNode(d, depth=0){
  const n = {
    id: ++nextId,
    name: d.name,
    depth,
    x: 0, y: 0, vx:0, vy:0,
    open: true,
    parent: null,
    children: [],
    isMacro:false,
    syntheticOverview: !!d.syntheticOverview,
    provenance: d.syntheticOverview ? 'synthetic' : 'primary',
    angleHome:0, // for depth‑1
    ringIndex:0,
    match:false,
    dimmed:false,
    tags:new Set(),
    appear:1 // 0..1 for fade/scale on spawn
  };
  if (d.children) n.children = d.children.map(ch => (mkNode(ch, depth+1)));
  n.children.forEach(c=>c.parent=n);
  return n;
}
const rawRoot = mkNode(data,0);

// Wrap under 7 macro buckets
function wrapIntoMacros(root){
  const byName = new Map(root.children.map(c=>[c.name,c]));
  const newChildren = [];
  Object.entries(macroGroups).forEach(([group, list], i)=>{
    // Macro buckets are initially collapsed (open:false) so that second-level categories are hidden by default.
    const g = {id:++nextId, name:group, depth:1, x:0,y:0,vx:0,vy:0,open:false,parent:root,children:[],isMacro:true, angleHome:0, ringIndex:i, match:false,appear:1};
    list.forEach(nm=>{
      const kid = byName.get(nm);
      if (kid){ kid.parent=g; reDepth(kid,2); g.children.push(kid); byName.delete(nm); }
    });
    if (g.children.length>0) newChildren.push(g);
  });
  // any leftover root children stay as additional macro groups of one
  for (const [nm, child] of byName){
    const g = {id:++nextId,name:nm,depth:1,x:0,y:0,vx:0,vy:0,open:false,parent:root,children:[child],isMacro:true,angleHome:0,ringIndex:newChildren.length,match:false,appear:1};
    child.parent=g; reDepth(child,2);
    newChildren.push(g);
  }
  root.children = newChildren;
  // After wrapping, assign angular spans to the macros and recursively assign
  // angles to all nodes.  This ensures each subtree is allocated a distinct
  // sector based on its position in the macro list.  The root receives the
  // full 360° span; each macro receives an equal fraction of that span.  The
  // assignAngles function defined below will further subdivide each macro's
  // span among its children.  Without this call, angleHome values remain
  // undefined and layoutChildren would fall back to default angles.
  root.angularSpan = Math.PI * 2;
  // Set a dummy angleHome for the root (not used for placement but needed for recursion)
  root.angleHome = 0;
  const N = root.children.length;
  root.children.forEach((macro,i) => {
    macro.angularSpan = (2 * Math.PI) / N;
    // Place macros evenly around the circle, starting from the top (-π/2).  Each
    // macro's angleHome is the centre of its assigned sector.  We subtract π/2
    // so that the first macro starts at the top of the circle.
    macro.angleHome = (i * (2 * Math.PI) / N) - Math.PI / 2;
  });
  // Recursively assign angles to all descendants.  We call this outside the
  // macro loop to ensure the root is visited.
  root.children.forEach((macro) => {
    assignAngles(macro);
  });
}

// Recursively assign angleHome and angularSpan to a node's descendants.  Each
// child receives a sub‑sector of its parent's angularSpan, divided equally
// among siblings.  The child's angleHome is set to the centre of its
// allocated sector.  This function should be called after macros are created
// to compute all angleHome/angularSpan properties used by layoutChildren.
function assignAngles(node){
  if (!node.children || node.children.length === 0) return;
  const m = node.children.length;
  const totalSpan = node.angularSpan || (2 * Math.PI);
  node.children.forEach((child, idx) => {
    // Each child receives an equal share of the parent's span
    const span = totalSpan / m;
    child.angularSpan = span;
    // Centre of child's sector: start at parent's start angle minus half the
    // parent's span, then add half the child's span and index*span
    const startAngle = (node.angleHome || 0) - (totalSpan / 2);
    child.angleHome = startAngle + (idx + 0.5) * span;
    // Recurse further down the tree
    assignAngles(child);
  });
}
function reDepth(n,d){ n.depth=d; n.children.forEach(c=>reDepth(c,d+1)); }
wrapIntoMacros(rawRoot);
const root = rawRoot;

const nodeById = new Map();

function deriveTags(name){
  const lower = (name || '').toLowerCase();
  const tags = new Set();
  TAG_RULES.forEach(rule => {
    if (rule.patterns.some(re => re.test(lower))) {
      tags.add(rule.label);
    }
  });
  return tags;
}

function annotateTags(node){
  node.tags = deriveTags(node.name || '');
  node.tags.forEach(tag => allTags.add(tag));
  node.children.forEach(annotateTags);
}

annotateTags(root);

try {
  const storedTagFilters = JSON.parse(localStorage.getItem(TAG_FILTER_STORAGE_KEY));
  if (Array.isArray(storedTagFilters)){
    storedTagFilters.slice(0, 120).forEach(tag => {
      if (typeof tag === 'string' && tag.trim() && allTags.has(tag)){
        activeTags.add(tag);
      }
    });
  }
} catch(e) {}

applyTagFilters();

// Set a custom root title for the map.  This updates both the data model
// and the UI breadcrumbs.  Without this override, the root would retain its
// original "InfoSec Universe — Ultimate Map" label from the dataset.  The
// chosen name "Cybersecurity Atlas" better reflects the content and ties
// into the blog theme.
root.name = "Cybersecurity Atlas";

// Only open the root and first‑level macro buckets on initial load.  Keeping
// deeper levels collapsed reduces empty space and prevents very long
// connectors from dominating the initial view.  Users can expand
// deeper branches interactively.
walk(root, n=>{ setNodeOpenState(n, n.depth < 2); });

// ----------------------------------------------------------------------------
// Additional state for filters, breadcrumb and mini‑map
// Each top-level macro bucket visibility can be toggled on/off via the Filters UI.
const macroVisibility = {};
root.children.forEach(n => { macroVisibility[n.id] = true; });

try {
  const storedMacros = localStorage.getItem(MACRO_VISIBILITY_STORAGE_KEY);
  if (storedMacros){
    const parsed = JSON.parse(storedMacros);
    if (parsed && typeof parsed === 'object'){
      root.children.forEach(n => {
        if (Object.prototype.hasOwnProperty.call(parsed, n.id)){
          macroVisibility[n.id] = !!parsed[n.id];
        }
      });
    }
  }
} catch(e) {}

try { recentSearches = JSON.parse(localStorage.getItem('atlas_recent_searches')) || []; } catch(e) { recentSearches = []; }
try { searchInSubtree = localStorage.getItem('atlas_search_subtree') === '1'; } catch(e) { searchInSubtree = false; }
try { searchIncludeTags = localStorage.getItem('atlas_search_tags') === '1'; } catch(e) { searchIncludeTags = false; }
try { showSyntheticNodes = localStorage.getItem(OVERVIEW_VISIBILITY_KEY) !== 'hidden'; } catch(e) { showSyntheticNodes = true; }
try { dimSyntheticNodes = localStorage.getItem(OVERVIEW_DIM_KEY) === '1'; } catch(e) { dimSyntheticNodes = false; }
try { outlineCollapsed = localStorage.getItem(OUTLINE_VISIBILITY_KEY) === '1'; } catch(e) { outlineCollapsed = false; }

// Currently hovered node for tooltip
let hoverNode = null;
// Store mini‑map scaling information for hit detection
let miniMapBounds = null;
let miniMapTouchBounds = null;

// ----------------------------------------------------------------------------
// Canvas & UI
// ----------------------------------------------------------------------------
const canvas = document.getElementById('c');
if (!canvas){
  showFatalError(new Error('Canvas element not found'));
  return;
}
const ctx = canvas.getContext('2d');
const exportCanvas = document.createElement('canvas');
const exportCtx = exportCanvas.getContext('2d');
const storedTheme = (typeof localStorage !== 'undefined') ? localStorage.getItem('atlas_theme') : null;
const prefersDark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let themeLocked = !!storedTheme;
const initialTheme = storedTheme || (prefersDark && prefersDark.matches ? 'dark' : 'light');
document.documentElement.setAttribute('data-theme', initialTheme);
const outlinePaneElem = document.getElementById('outlinePane');
const outlineTreeElem = document.getElementById('outlineTree');
const outlineStatusElem = document.getElementById('outlineStatus');
const contextMenuElem = document.getElementById('contextMenu');
const focusAnnounceElem = document.getElementById('focusAnnounce');
const fisheyeToggleBtn = document.getElementById('fisheyeToggleBtn');
const searchSubtreeElem = document.getElementById('searchSubtree');
const searchTagsElem = document.getElementById('searchTags');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const recentSearchesElem = document.getElementById('recentSearches');
const overviewToggleRowElem = document.getElementById('overviewToggleRow');
const appRootElem = document.querySelector('.app');
const primarySidebarElem = document.querySelector('aside.primary');
const minimapTouchToggle = document.getElementById('minimapTouchToggle');
const minimapTouchPanel = document.getElementById('minimapTouchPanel');
const minimapTouchClose = document.getElementById('minimapTouchClose');
const minimapTouchCanvas = document.getElementById('minimapTouchCanvas');
const touchPreviewElem = document.getElementById('touchPreview');
function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
window.addEventListener('resize', resize); resize();

// Camera
let offsetX=0, offsetY=0, scale=1;
const MIN_ZOOM=0.40, MAX_ZOOM=2.50;

function worldToScreen(wx,wy){ return [(wx+offsetX)*scale,(wy+offsetY)*scale]; }
function screenToWorld(sx,sy){ return [sx/scale - offsetX, sy/scale - offsetY]; }

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function walk(n,fn){ fn(n); n.children.forEach(c=>walk(c,fn)); }
function walkFrom(n, fn){ fn(n); (n.children || []).forEach(child => walkFrom(child, fn)); }

function markNodeOpen(node){
  if (!node || typeof node.id === 'undefined') return;
  node.open = true;
  openNodeIds.add(node.id);
}

function markNodeClosed(node){
  if (!node || typeof node.id === 'undefined') return;
  node.open = false;
  openNodeIds.delete(node.id);
}

function setNodeOpenState(node, isOpen){
  if (isOpen){
    markNodeOpen(node);
  } else {
    markNodeClosed(node);
  }
}

function syncOpenSetFromTree(){
  openNodeIds.clear();
  walk(root, node => {
    if (node && typeof node.id !== 'undefined' && node.open){
      openNodeIds.add(node.id);
    }
  });
}

walk(root, node => {
  if (node && typeof node.id !== 'undefined'){
    nodeById.set(node.id, node);
  }
});
function visible(n){
  if (n.syntheticOverview && !showSyntheticNodes) return false;
  // A node is visible if all its ancestors are expanded, and its top-level macro bucket is not filtered out.
  if (!n.parent) return true;
  // Check macro visibility: find first-level macro ancestor (child of root)
  let top = n;
  while (top.parent && top.parent !== root){ top = top.parent; }
  if (top.parent === root && !macroVisibility[top.id]) return false;
  if (!n.parent.open) return false;
  return visible(n.parent);
}
function pathTo(n){ const p=[]; let cur=n; while(cur){ p.push(cur); cur=cur.parent; } return p.reverse(); }

const visibleNodesCache = [];
const visibleLinksCache = [];
let visibilityCacheDirty = true;

function recomputeVisibilityCaches(){
  visibleNodesCache.length = 0;
  visibleLinksCache.length = 0;
  const visibleSet = new Set();
  walk(root, node => {
    if (visible(node)){
      visibleNodesCache.push(node);
      visibleSet.add(node.id);
    }
  });
  walk(root, node => {
    if (!visibleSet.has(node.id)) return;
    node.children.forEach(child => {
      if (!showSyntheticNodes && child.syntheticOverview) return;
      if (visibleSet.has(child.id)){
        visibleLinksCache.push([node, child]);
      }
    });
  });
  visibilityCacheDirty = false;
}
function ensureVisibilityCaches(){
  if (visibilityCacheDirty){
    recomputeVisibilityCaches();
  }
}
function invalidateVisibilityCaches(){
  visibilityCacheDirty = true;
}
function refreshVisibilityCaches(){
  invalidateVisibilityCaches();
  ensureVisibilityCaches();
}
function collectVisible(){ ensureVisibilityCaches(); return visibleNodesCache; }
function collectLinks(){ ensureVisibilityCaches(); return visibleLinksCache; }

refreshVisibilityCaches();

function revealPath(node){
  let cur = node;
  let changed = false;
  while (cur){
    markNodeOpen(cur);
    cur = cur.parent;
  }
  if (changed){
    refreshVisibilityCaches();
  }
}

function relayoutAncestors(node, { immediate = false } = {}){
  let cur = node;
  while (cur){
    if (cur.parent){
      queueLayout(cur.parent, { immediate });
    }
    cur = cur.parent;
  }
}

function updateActivePath(node){
  activePathNodes.clear();
  activePathLinks.clear();
  if (!node) return;
  const path = pathTo(node);
  for (let i = 0; i < path.length; i++){
    const segment = path[i];
    activePathNodes.add(segment.id);
    if (i > 0){
      const prev = path[i-1];
      activePathLinks.add(`${prev.id}-${segment.id}`);
    }
  }
}

function computeFocusScale(node){
  if (!node) return scale;
  if (!node.parent) return clamp(1, MIN_ZOOM, MAX_ZOOM);
  const metrics = measureNode(node);
  const desiredWidth = 220;
  const target = desiredWidth / (metrics.w + 80);
  return clamp(Math.max(scale, target), MIN_ZOOM, MAX_ZOOM);
}

function computeFrameZoom(node){
  const items = [node];
  if (node.children && node.children.length){
    node.children.forEach(child => items.push(child));
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach(item => {
    const metrics = measureNode(item);
    const halfW = metrics.w / 2 + 40;
    const halfH = metrics.h / 2 + 40;
    minX = Math.min(minX, item.x - halfW);
    maxX = Math.max(maxX, item.x + halfW);
    minY = Math.min(minY, item.y - halfH);
    maxY = Math.max(maxY, item.y + halfH);
  });
  const width = maxX - minX;
  const height = maxY - minY;
  if (!isFinite(width) || !isFinite(height) || width === 0 || height === 0){
    return clamp(scale, MIN_ZOOM, MAX_ZOOM);
  }
  const padding = 160;
  const targetScale = Math.min(canvas.width / (width + padding), canvas.height / (height + padding));
  return clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
}

function focusNode(node, options = {}){
  if (!node) return;
  const { animate = true, ensureVisible = true, exclusive = false, targetScale, keepZoom = false, frameChildren = false } = options;
  if (ensureVisible){
    if (exclusive){
      openPathOnly(node);
    } else {
      revealPath(node);
      relayoutAncestors(node, { immediate: true });
      kickPhysics();
    }
  }
  if (frameChildren && node.children && node.children.length){
    let openedForFrameChildren = false;
    if (!node.open){
      markNodeOpen(node);
      assignAngles(node);
      openedForFrameChildren = true;
    }
    layoutChildren(node);
    if (openedForFrameChildren){
      refreshVisibilityCaches();
    }
    updateOutlineTree(node.id);
    kickPhysics();
  } else {
    updateOutlineTree(node.id);
  }
  const computedScale = typeof targetScale === 'number' ? clamp(targetScale, MIN_ZOOM, MAX_ZOOM) : (frameChildren ? computeFrameZoom(node) : (keepZoom ? scale : computeFocusScale(node)));
  focusTo(node, computedScale, animate);
  updateBreadcrumb(node);
}

function focusParentNode(){
  if (!currentFocusNode || !currentFocusNode.parent) return;
  focusNode(currentFocusNode.parent, { animate: true, ensureVisible: true });
}

function focusSiblingNode(direction){
  if (!currentFocusNode || !currentFocusNode.parent) return;
  const siblings = currentFocusNode.parent.children || [];
  if (!siblings.length) return;
  const index = siblings.indexOf(currentFocusNode);
  if (index === -1) return;
  const nextIndex = (index + direction + siblings.length) % siblings.length;
  const target = siblings[nextIndex];
  focusNode(target, { animate: true, ensureVisible: true });
}

function focusFirstChild(){
  if (!currentFocusNode || !currentFocusNode.children || currentFocusNode.children.length === 0) return;
  if (!currentFocusNode.open){
    toggleNode(currentFocusNode, true);
  }
  const target = currentFocusNode.children.find(ch => visible(ch)) || currentFocusNode.children[0];
  if (target){
    focusNode(target, { animate: true, ensureVisible: true });
  }
}

function textLinesFor(n, maxWidth, isChip, measureCtx = ctx){
  // wrap by measuring.  We support two modes: simple space‑based wrapping
  // for normal labels, and bullet‑based splitting for labels containing
  // the "\u2022" (•) character.  Bullet splitting helps break up long
  // lists of items into separate lines, improving readability of
  // overview nodes and other leaves with many comma/semicolon separated
  // entries.
  measureCtx.save();
  measureCtx.font = (isChip? 14: 14) + "px Segoe UI, Arial, sans-serif";
  const lines = [];
  // Helper to push a word array into lines, wrapping at maxWidth
  function wrapWords(wordsArray){
    let cur="";
    for (const w of wordsArray){
      const t = cur ? cur + " " + w : w;
      if (measureCtx.measureText(t).width <= maxWidth || cur === ""){
        cur = t;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
  }
  const name = n.name || "";
  /*
    For non‑chip nodes, attempt to break very long labels into logical
    segments.  If the label contains a colon, split after the first
    colon to separate an "Overview" prefix.  Then split the remainder
    on common delimiters such as bullets (•) and slashes (/).  Each
    resulting segment is treated as its own line and prefixed with a
    bullet where appropriate.  This reduces the width of overview
    labels and makes long lists easier to scan.  If none of these
    delimiters are present or the name is short, fall back to simple
    whitespace wrapping.
  */
  if (!isChip && name.length > 35){
    let segments = [];
    let text = name;
    // Split off a prefix ending with the first colon, if present
    const colonIdx = text.indexOf(":");
    if (colonIdx !== -1){
      segments.push(text.slice(0, colonIdx+1).trim());
      text = text.slice(colonIdx+1).trim();
    }
    // Split on bullet or slash delimiters
    if (/\u2022|\//.test(text)){
      const parts = text.split(/\s*[\u2022\/]+\s*/);
      parts.forEach((part, idx) =>{
        // Prefix bullets for all but the first segment if a prefix exists
        const prefixNeeded = (idx > 0 || segments.length>0);
        const prefix = prefixNeeded ? "\u2022 " : "";
        segments.push(prefix + part.trim());
      });
    } else {
      segments.push(text);
    }
    segments.forEach(seg =>{
      const words = seg.split(/\s+/);
      wrapWords(words);
    });
  } else if (!isChip && name.includes("\u2022")){
    // If there are bullets but the label isn’t long, split on bullets only
    const parts = name.split(/\s*\u2022\s*/);
    parts.forEach((seg, idx) => {
      const prefix = idx === 0 ? "" : "\u2022 ";
      wrapWords((prefix + seg).trim().split(/\s+/));
    });
  } else {
    // Simple wrap on whitespace
    wrapWords(name.split(/\s+/));
  }
  measureCtx.restore();
  return lines.slice(0, Math.max(1, lines.length));
}
function measureNode(n, measureCtx = ctx){
  const isChip = n.depth===1;
  // Reduce the maximum line width for normal nodes to encourage
  // additional wrapping.  Narrower boxes make dense leaf lists easier
  // to read on both desktop and mobile screens.
  const maxW = isChip? Infinity : 280;
  const padX = isChip? 14 : 12;
  const padY = isChip? 8 : 10;
  const togglePadding = (!isChip && n.children && n.children.length) ? 28 : 0;
  const lines = textLinesFor(n, isChip ? maxW : Math.max(120, maxW - togglePadding), isChip, measureCtx);
  const w = (function(){
    measureCtx.save();
    measureCtx.font = (isChip? 14: 14) + "px Segoe UI, Arial, sans-serif";
    const lw = Math.max(...lines.map(l=>measureCtx.measureText(l).width));
    measureCtx.restore();
    // For normal nodes, restrict the width to a range to avoid overly
    // long boxes.  The minimum width is 140 and maximum is 320.  This
    // interacts with maxW above to produce comfortably sized labels.
    return isChip? (lw + padX*2) : Math.max(140, Math.min(340, lw + padX*2 + togglePadding));
  })();
  const h = (isChip? 34 : (lines.length*18 + padY*2));
  return {w,h,lines,isChip};
}

// colours
const ringColour = i => catColours[i % catColours.length];

// -----------------------------------------------------------------------------
// Animation helpers
// -----------------------------------------------------------------------------
// Pulsing counter for hover animation.  It increments continuously in the
// rendering loop and is used to create a subtle breathing effect on the
// hovered node.
let hoverPulse = 0;

// Lighten a colour by a given percentage (0–1).  Accepts hex codes, rgb(),
// or rgba() strings.  It returns an rgba string.  When passed an rgba
// string, the alpha channel is preserved.  For hex and rgb strings, alpha
// defaults to 1.  Lightening moves each channel towards 255 by the
// specified amount.  When percent is 0, the original colour is returned.
function lightenColor(col, percent){
  if (!col) return col;
  let r=0,g=0,b=0,a=1;
  // Normalize colour to rgba components
  if (col.startsWith('#')){
    const hex = col.replace('#','');
    const n = parseInt(hex,16);
    if (hex.length===6){
      r = (n>>16)&255; g = (n>>8)&255; b = n&255;
    } else if (hex.length===3){
      r = ((n>>8)&15)*17; g = ((n>>4)&15)*17; b = (n&15)*17;
    }
  } else if (col.startsWith('rgba')){
    const parts = col.replace(/rgba\(|\)/g,'').split(',');
    r = parseFloat(parts[0]); g = parseFloat(parts[1]); b = parseFloat(parts[2]); a = parseFloat(parts[3]);
  } else if (col.startsWith('rgb')){
    const parts = col.replace(/rgb\(|\)/g,'').split(',');
    r = parseFloat(parts[0]); g = parseFloat(parts[1]); b = parseFloat(parts[2]); a = 1;
  } else {
    // If unknown format, return original colour
    return col;
  }
  const pr = Math.min(255, Math.round(r + (255 - r) * percent));
  const pg = Math.min(255, Math.round(g + (255 - g) * percent));
  const pb = Math.min(255, Math.round(b + (255 - b) * percent));
  return `rgba(${pr},${pg},${pb},${a})`;
}

// ----------------------------------------------------------------------------
// Layout init: place macro buckets evenly around the root (radial)
// ----------------------------------------------------------------------------
const TWO_PI = Math.PI*2;
function placeInitial(){
  root.x = 0; root.y = 0;
  const N = root.children.length;
  // Use a smaller initial radius for macro buckets to reduce empty space
  // around the root.  This value is kept in sync with the dynamic
  // macro orbit radius used in tick().
  const R = 160;
  root.children.forEach((n,i)=>{
    const ang = (i * TWO_PI / N) - Math.PI/2;
    n.angleHome = ang; n.ringIndex=i;
    n.x = R * Math.cos(ang);
    n.y = R * Math.sin(ang);
  });
  walk(root, n=>{
    if (n.depth>=2){
      const p = n.parent;
      const d = linkDistance(p,n);
      const jitter = (Math.random()-0.5)*40;
      const ang = Math.atan2(p.y, p.x) + (Math.random()-0.5)*0.8;
      n.x = p.x + (d + jitter)*Math.cos(ang);
      n.y = p.y + (d + jitter)*Math.sin(ang);
    }
  });
}
placeInitial();

// center camera on root
function centerOnRoot(animated=true){ focusNode(root, { animate: animated, targetScale: 1, ensureVisible: true, keepZoom: false }); }

// ----------------------------------------------------------------------------
// Physics
// ----------------------------------------------------------------------------
// Base values for the physics constants.  These are used as starting points
// and scaled by the motion slider to adjust the feel of the layout on demand.
const BASE_SPRING_K = 0.07;
const BASE_REPULSION_K = 500;
const BASE_DAMPING = 0.90;

// Use let for physics constants so they can be updated via the motion slider.
// They start with the base values but can be changed at runtime.
let SPRING_K = BASE_SPRING_K;
let REPULSION_K = BASE_REPULSION_K;
let DAMPING = BASE_DAMPING;
// Collision padding remains constant; reduce to allow nodes to nestle closer
const COLLISION_PADDING = 12;
const POLAR_K = 0.015;
const GRAVITY_TO_PARENT_K = 0.005;

function linkDistance(a,b){
  const d = b.depth;
  // Use shorter base distances to keep branches tight and minimise
  // excessive empty space.  The first two levels stay roomy while deeper
  // branches step out in smaller increments.  See TUNABLES comment above.
  // Tune link distances to keep branches tight without creating long dangling lines.
  // Shallower levels remain roomy while deeper levels step out more gently.
  // Shorter link distances to keep branches compact.  The shallow
  // levels remain roomy while deeper levels step out in small increments.
  if (d === 1) return 120;            // root to macro
  if (d === 2) return 150;            // macro to category
  // Deeper levels: add 30px per depth to avoid long dangling edges
  return 120 + (d - 2) * 30;
}

function tick(dt){
  const nodes = collectVisible();
  const links = collectLinks();
  nodes.forEach(n=>{ n.fx=0; n.fy=0; });
  for (const [a,b] of links){
    const dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.hypot(dx,dy) || 0.0001;
    const L = linkDistance(a,b);
    const f = SPRING_K * (dist - L);
    const nx = dx/dist, ny=dy/dist;
    const fx = f*nx, fy=f*ny;
    b.fx -= fx; b.fy -= fy;
    a.fx += fx; a.fy += fy;
    b.fx += GRAVITY_TO_PARENT_K * (a.x - b.x);
    b.fy += GRAVITY_TO_PARENT_K * (a.y - b.y);
  }
  const N = root.children.length;
  root.children.forEach((n,i)=>{
    if (!visible(n)) return;
    // Reduce macro orbit radius further to tighten the initial layout.
    // A smaller radius brings first‑level categories closer to the root
    // and eliminates large empty areas at the centre, while still
    // preventing overlaps between macro chips.
    const R = 200;
    const tx = root.x + R*Math.cos(n.angleHome);
    const ty = root.y + R*Math.sin(n.angleHome);
    n.fx += POLAR_K * (tx - n.x);
    n.fy += POLAR_K * (ty - n.y);
  });
  for (let i=0;i<nodes.length;i++){
    for (let j=i+1;j<nodes.length;j++){
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      let dist2 = dx*dx + dy*dy;
      if (dist2===0){ dist2 = 0.01; }
      const dist = Math.sqrt(dist2);
      const ma = measureNode(a), mb = measureNode(b);
      // Use a larger portion of the label width to compute collision radius to increase spacing.
      const ra = (ma.w * 0.8 + COLLISION_PADDING);
      const rb = (mb.w * 0.8 + COLLISION_PADDING);
      const rep = REPULSION_K * ((ra+rb)/2) / dist2;
      const nx = dx/dist, ny = dy/dist;
      a.fx -= rep*nx; a.fy -= rep*ny;
      b.fx += rep*nx; b.fy += rep*ny;
      const overlap = (ra+rb) - dist;
      if (overlap>0){
        const push = overlap*0.20;
        a.fx -= push*nx; a.fy -= push*ny;
        b.fx += push*nx; b.fy += push*ny;
      }
    }
  }
  nodes.forEach(n=>{
    n.vx = (n.vx + n.fx*dt) * DAMPING;
    n.vy = (n.vy + n.fy*dt) * DAMPING;
    if (!n.isDragging){
      n.x += n.vx*dt;
      n.y += n.vy*dt;
    } else {
      n.vx*=0.4; n.vy*=0.4;
    }
  });
}

// ----------------------------------------------------------------------------
// Drawing
// ----------------------------------------------------------------------------
function nodeCategoryIndex(n){
  let cur=n; while(cur.parent && cur.parent!==root) cur=cur.parent; return cur.parent? cur.ringIndex : 0;
}
function renderScene(targetCtx, width, height, cameraState, options = {}){
  const { scale: renderScale, offsetX: renderOffsetX, offsetY: renderOffsetY } = cameraState;
  const worldToScreenLocal = (wx, wy) => [(wx + renderOffsetX) * renderScale, (wy + renderOffsetY) * renderScale];
  const shouldUpdateHitboxes = options.updateHitboxes !== false;
  targetCtx.save();
  targetCtx.clearRect(0,0,width,height);
  targetCtx.lineCap="round"; targetCtx.lineJoin="round";
  const vis = collectVisible();
  const links = collectLinks();
  const themeStyles = getComputedStyle(document.documentElement);
  const accentColourRaw = themeStyles.getPropertyValue('--accent') || '#ff9b6a';
  const accentColour = accentColourRaw.trim() || '#ff9b6a';
  const edgeColourRaw = themeStyles.getPropertyValue('--edge-soft') || '#4c4c80';
  const edgeColour = edgeColourRaw.trim() || '#4c4c80';
  const inkColourRaw = themeStyles.getPropertyValue('--ink') || '#e0e0ff';
  const inkColour = inkColourRaw.trim() || '#e0e0ff';
  const panelColourRaw = themeStyles.getPropertyValue('--panel') || '#34345c';
  const panelColour = panelColourRaw.trim() || '#34345c';
  const focusRef = lastFocusedNode;
  const lensRadius = 480;
  const lensStrength = 0.35;
  const now = performance.now();
  for (const [a,b] of links){
    const [x1,y1] = worldToScreenLocal(a.x,a.y);
    const [x2,y2] = worldToScreenLocal(b.x,b.y);
    targetCtx.save();
    const bothDimmed = activeTags.size>0 && a.dimmed && b.dimmed;
    const linkKey = `${a.id}-${b.id}`;
    const isActiveLink = activePathLinks.has(linkKey);
    targetCtx.setLineDash([]);
    if (isActiveLink){
      targetCtx.strokeStyle = accentColour;
      targetCtx.globalAlpha = 0.9;
      targetCtx.lineWidth = 2.4;
      targetCtx.setLineDash([6,4]);
    } else {
      targetCtx.strokeStyle = bothDimmed ? 'rgba(224,224,255,0.08)' : edgeColour;
      targetCtx.globalAlpha = bothDimmed ? 0.25 : 0.65;
      targetCtx.lineWidth = 1.2;
    }
    if (flashStates.has(a.id) || flashStates.has(b.id)){
      targetCtx.strokeStyle = accentColour;
      targetCtx.globalAlpha = 0.7;
    }
    const linkLength = Math.hypot(x2 - x1, y2 - y1);
    if (linkLength > 420){
      targetCtx.globalAlpha *= renderScale < 0.8 ? 0.55 : 0.75;
      if (!isActiveLink && renderScale < 0.6){
        targetCtx.strokeStyle = 'rgba(224,224,255,0.08)';
      }
    }
    if (fisheyeEnabled && focusRef){
      const distA = Math.hypot(a.x - focusRef.x, a.y - focusRef.y);
      const distB = Math.hypot(b.x - focusRef.x, b.y - focusRef.y);
      const nearDist = Math.min(distA, distB);
      if (nearDist > lensRadius){
        targetCtx.globalAlpha *= 0.7;
      }
    }
    targetCtx.beginPath();
    targetCtx.moveTo(x1,y1);
    const mx = (x1+x2)/2;
    targetCtx.bezierCurveTo(mx,y1,mx,y2,x2,y2);
    targetCtx.stroke();
    targetCtx.restore();
  }
  // Increment pulsing counter for hover animation.  This creates a subtle
  // breathing effect on the hovered node when drawing frames.
  hoverPulse += 0.1;
  if (hoverPulse > Math.PI * 2) hoverPulse -= Math.PI * 2;
  for (const n of vis){
    if (n.syntheticOverview && !showSyntheticNodes) continue;
    const flashExpiry = flashStates.get(n.id);
    if (flashExpiry && flashExpiry <= now){
      flashStates.delete(n.id);
    }
    const flashActive = flashExpiry && flashExpiry > now;
    const {w,h,lines,isChip} = measureNode(n, targetCtx);
    const [sx,sy] = worldToScreenLocal(n.x,n.y);
    const cat = nodeCategoryIndex(n);
    let fill, stroke, text;
    const themeDark = document.documentElement.getAttribute('data-theme')!=='light';
    const isActivePath = activePathNodes.has(n.id);
    const isFocused = lastFocusedNode && lastFocusedNode.id === n.id;
    const isSynthetic = !!n.syntheticOverview;
    if (n===root){
      fill = themeDark? "#111827" : "#ffffff";
      stroke = themeDark? "#334155" : "#cbd5e1";
      text = inkColour;
    } else if (n.depth===1){
      const base = ringColour(cat);
      const rgb = hexToRgb(base);
      const tint = themeDark? `rgba(${rgb.r},${rgb.g},${rgb.b},0.22)` : `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`;
      fill = tint;
      stroke = themeDark? "rgba(255,255,255,0.12)" : "#c9d4ea";
      text = inkColour;
    } else {
      const base = ringColour(cat);
      const rgb = hexToRgb(base);
      if (themeDark){
        fill = `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`;
        stroke = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
      } else {
        fill = `rgba(${rgb.r},${rgb.g},${rgb.b},0.12)`;
        stroke = `rgba(${rgb.r},${rgb.g},${rgb.b},0.35)`;
      }
      text = inkColour;
    }
    if (isActivePath){
      stroke = accentColour;
      if (isFocused){
        fill = lightenColor(fill, themeDark ? 0.28 : 0.18);
      }
    }
    if (isSynthetic){
      stroke = accentColour;
      fill = lightenColor(fill, themeDark ? 0.12 : 0.22);
    }
    // If this node is hovered, apply a subtle pulse animation: scale up and
    // lighten the fill and stroke slightly.  The star of the show is the
    // accent colour as stroke to draw the eye.  The pulsation uses the
    // hoverPulse counter to compute a small scaling factor between 1.0 and 1.05.
    let pulseScale = 1;
    let lensBoost = 1;
    if (fisheyeEnabled && focusRef){
      const dist = Math.hypot(n.x - focusRef.x, n.y - focusRef.y);
      if (dist < lensRadius){
        lensBoost += lensStrength * (1 - dist / lensRadius);
      }
    }
    if (n === hoverNode){
      fill = lightenColor(fill, 0.15);
      stroke = accentColour || stroke;
      pulseScale = 1.04;
    } else if (isFocused){
      pulseScale = Math.max(pulseScale, 1.03 + lensStrength * 0.3);
    }
    pulseScale *= lensBoost;
    targetCtx.save();
    const shouldDim = activeTags.size>0 && n.dimmed && !isActivePath;
    targetCtx.globalAlpha = shouldDim ? 0.35 : 1;
    if (isSynthetic && dimSyntheticNodes){
      targetCtx.globalAlpha *= 0.55;
    }
    if (!isActivePath && !n.match){
      targetCtx.globalAlpha *= 0.85;
    }
    if (fisheyeEnabled && focusRef){
      const dist = Math.hypot(n.x - focusRef.x, n.y - focusRef.y);
      if (dist > lensRadius && !isActivePath){
        targetCtx.globalAlpha *= 0.6;
      }
    }
    if (flashActive){
      targetCtx.shadowColor = accentColour;
      targetCtx.shadowBlur = 36*renderScale;
      stroke = accentColour || stroke;
      pulseScale = Math.max(pulseScale, 1.05);
    } else if (n.match){
      targetCtx.shadowColor = "rgba(234,179,8,0.6)";
      targetCtx.shadowBlur = 24*renderScale;
    } else if (isActivePath){
      targetCtx.shadowColor = 'rgba(255,155,106,0.35)';
      targetCtx.shadowBlur = 28*renderScale;
    } else {
      targetCtx.shadowColor = "transparent";
      targetCtx.shadowBlur = 0;
    }
    // Compute scaled width and height for pulsing effect
    const ww = w * renderScale * pulseScale;
    const hh = h * renderScale * pulseScale;
    const rx = (isChip? 18*renderScale : 12*renderScale) * pulseScale;
    const x = sx - ww/2;
    const y = sy - hh/2;
    targetCtx.fillStyle = fill;
    targetCtx.strokeStyle = stroke;
    const baseLine = (n===root? 2.2: 1.4) * renderScale;
    const lineMultiplier = isFocused ? 1.7 : (isActivePath ? 1.3 : 1);
    targetCtx.lineWidth = baseLine * lineMultiplier;
    roundRect(targetCtx,x,y,ww,hh,rx);
    targetCtx.fill(); targetCtx.stroke();
    targetCtx.shadowBlur=0;
    targetCtx.fillStyle = text;
    const fontWeight = isFocused ? '600 ' : (isActivePath ? '500 ' : '400 ');
    const baseFontSize = (isChip ? 14 : 14) * renderScale * pulseScale;
    targetCtx.font = fontWeight + baseFontSize + "px Segoe UI, Arial, sans-serif";
    targetCtx.textBaseline = 'middle';
    let renderText = true;
    if (!isChip && renderScale < 0.6 && lines.some(line => line.length > 20) && n !== hoverNode && !isFocused){
      renderText = false;
    }
    if (isChip){
      targetCtx.textAlign = 'center';
      targetCtx.fillText(n.name, sx, sy);
    } else if (renderText){
      targetCtx.textAlign = 'left';
      let ty = y + 10*renderScale*pulseScale + 9;
      for (const L of lines){
        targetCtx.fillText(L, x + 12*renderScale*pulseScale, ty);
        ty += 18*renderScale*pulseScale;
      }
    } else {
      targetCtx.textAlign = 'center';
      const label = fallbackText(n, 'name');
      const shortLabel = label.length > 18 ? label.slice(0, 17) + '…' : label;
      targetCtx.fillText(shortLabel, sx, sy);
    }
    if (isSynthetic){
      targetCtx.save();
      const badgeText = 'Overview';
      const badgeFontSize = Math.max(9, 8 * renderScale);
      targetCtx.font = '600 ' + badgeFontSize + 'px Segoe UI, Arial, sans-serif';
      const badgePaddingX = 6 * renderScale;
      const badgePaddingY = 4 * renderScale;
      const textWidth = targetCtx.measureText(badgeText).width;
      const badgeWidth = textWidth + badgePaddingX * 2;
      const badgeHeight = 14 * renderScale;
      const badgeX = x + 8 * renderScale;
      const badgeY = y + hh - badgeHeight - 6 * renderScale;
      targetCtx.fillStyle = themeDark ? 'rgba(255,155,106,0.16)' : 'rgba(255,155,106,0.22)';
      targetCtx.strokeStyle = accentColour;
      targetCtx.lineWidth = 1;
      roundRect(targetCtx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
      targetCtx.fill();
      targetCtx.stroke();
      targetCtx.fillStyle = accentColour;
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';
      targetCtx.fillText(badgeText, badgeX + badgeWidth / 2, badgeY + badgeHeight / 2 + 0.5);
      targetCtx.restore();
    }
    if (n.children && n.children.length > 0 && renderScale > 0.75){
      targetCtx.save();
      const badgeRadius = Math.max(10, 8 * renderScale * pulseScale);
      const badgeX = x + ww - badgeRadius - 6 * renderScale;
      const badgeY = y + hh - badgeRadius - 6 * renderScale;
      targetCtx.fillStyle = accentColour;
      targetCtx.globalAlpha = 0.85;
      targetCtx.beginPath();
      targetCtx.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.fillStyle = themeDark ? '#111827' : '#ffffff';
      targetCtx.font = '600 ' + Math.max(10, 9 * renderScale) + 'px Segoe UI, Arial, sans-serif';
      targetCtx.textAlign = 'center';
      targetCtx.textBaseline = 'middle';
      targetCtx.fillText(String(n.children.length), badgeX, badgeY + 0.5);
      targetCtx.restore();
    }
    // Update hit boxes to reflect the scaled rectangle for accurate interaction
    if (shouldUpdateHitboxes){
      n._hit = {x,y,w:ww,h:hh, sx,sy};
    }
    if (n.children && n.children.length>0){
      const toggleRadius = Math.max(9, 7 * renderScale * pulseScale);
      const toggleCx = isChip ? sx + (ww/2) - toggleRadius - 6*renderScale : x + ww - toggleRadius - 8*renderScale;
      const toggleCy = isChip ? sy : y + toggleRadius + 8*renderScale;
      targetCtx.save();
      targetCtx.fillStyle = panelColour;
      targetCtx.strokeStyle = isActivePath ? accentColour : (themeDark ? 'rgba(224,224,255,0.25)' : '#c5c9ff');
      targetCtx.lineWidth = 1.2;
      targetCtx.beginPath();
      targetCtx.arc(toggleCx, toggleCy, toggleRadius, 0, Math.PI*2);
      targetCtx.fill();
      targetCtx.stroke();
      targetCtx.strokeStyle = accentColour;
      targetCtx.lineWidth = 1.8;
      targetCtx.beginPath();
      targetCtx.moveTo(toggleCx - toggleRadius/2, toggleCy);
      targetCtx.lineTo(toggleCx + toggleRadius/2, toggleCy);
      if (!n.open){
        targetCtx.moveTo(toggleCx, toggleCy - toggleRadius/2);
        targetCtx.lineTo(toggleCx, toggleCy + toggleRadius/2);
      }
      targetCtx.stroke();
      targetCtx.restore();
      if (shouldUpdateHitboxes){
        n._toggle = {cx: toggleCx, cy: toggleCy, r: toggleRadius + 4};
      }
    } else if (shouldUpdateHitboxes){
      n._toggle = null;
    }
    targetCtx.restore();
  }
  targetCtx.restore();

  if (!options.skipMinimap && typeof updateMinimap === 'function') {
    updateMinimap();
  }
}

function draw(){
  renderScene(ctx, canvas.width, canvas.height, { scale, offsetX, offsetY });
}
function roundRect(ctx,x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.lineTo(x+w-rr,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
  ctx.lineTo(x+w,y+h-rr);
  ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
  ctx.lineTo(x+rr,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
  ctx.lineTo(x,y+rr);
  ctx.quadraticCurveTo(x,y,x+rr,y);
  ctx.closePath();
}
function hexToRgb(hex){ const h=hex.replace('#',''); const n=parseInt(h,16); return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}; }

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Layout helper: position the children of a node using the precomputed
// angleHome values.  Each node stores an angleHome (its polar orientation
// relative to its parent) and an angularSpan (the size of the sector
// allocated to its subtree).  This helper computes a suitable radial
// distance based on the combined widths of the children and the link
// distance, then positions each child along its angleHome.  Because the
// angles are assigned hierarchically during initialisation, subtrees will
// expand in non‑overlapping sectors reminiscent of a mycelium or root
// structure.
function layoutChildren(n){
  if (!n.children || n.children.length === 0) return;
  const m = n.children.length;
  // Base link distance between parent and a child. Use the first child as a
  // representative sample. This sets the minimum radius for the ring.
  // Base link distance between parent and a child. Use the first child as a
  // representative sample. This sets the minimum radius for the ring.
  const base = linkDistance(n, n.children[0]);
  // Compute total width of children to approximate the necessary arc length. A
  // larger total width results in a slightly increased radius to reduce
  // immediate overlaps.  We divide by 2π to approximate circumference and
  // add a small padding.
  // Compute widths of children to derive a dynamic radius.  We sum all
  // widths and track the maximum width.  The average width will later
  // determine how much arc length each child needs.
  let sumWidths = 0, maxWidth = 0;
  n.children.forEach(ch => {
    const metrics = measureNode(ch);
    sumWidths += metrics.w;
    if (metrics.w > maxWidth) maxWidth = metrics.w;
  });
  // Use the maximum width among children rather than the average to
  // derive a more generous ring radius.  Wider labels require more arc
  // length to remain readable.  We also take into account the number
  // of children relative to the allocated angular span to ensure that
  // crowded sectors get pushed outward.  The constants here have been
  // increased to further separate final leaves and avoid overlap.
  const avgWidth = sumWidths / m;
  const span = n.angularSpan || (2 * Math.PI);
  // Dynamic radius: based on the maximum width and number of children.
  // Increase the ring radius further for nodes with many children.  The
  // maximum width multiplied by the number of children, divided by the
  // angular span, provides a baseline for the arc length.  We add a
  // generous constant to push crowded clusters outward.  These values can
  // be tuned based on the dataset; larger constants yield more spacing
  // and reduce label overlap at the cost of a larger overall map.
  // Compute ring radius based on the total label width of all children.
  // The arc length of the sector (r * span) must be at least the sum of
  // child widths to avoid overlap.  We therefore divide the total
  // widths by the angular span to approximate a suitable radius, then
  // add a constant to provide padding.  This scales dynamically with
  // both the number of children and their label lengths.
  // Compute a generous ring radius.  We divide the total width by the
  // available angular span to approximate the required circumference
  // for placing all children without overlap, then multiply by a
  // factor to further separate large clusters.  An extra constant
  // padding ensures breathing space even for small groups.  These
  // values have been increased to spread out the final leaves and
  // accommodate very long labels.
  // Increase the dynamic radius multiplier and padding to further
  // separate children with long labels.  A higher multiplier on the
  // total widths and a larger constant push crowded clusters farther
  // outwards.  This change improves readability for deep branches.
  // Adjust the additional radius so that long labels still get breathing
  // space but the connecting lines are not excessively long.  A lower
  // multiplier and smaller padding shorten edges, especially for
  // overview leaves.  The constant is tuned based on typical label
  // widths in the data set.
  // Dynamically scale the additional radius based on the total widths
  // relative to the available angular span.  A smaller multiplier on
  // sumWidths produces a tighter ring, while a moderate constant
  // provides baseline spacing.  This reduces excessively long
  // connectors when navigating deep branches.
  // Compute a tighter additional radius for this level.  A smaller
  // multiplier on sumWidths and a lower constant shorten edges and
  // keep deep leaves closer to their ancestors.  These values were
  // tuned to balance readability and compactness on both desktop and
  // mobile devices.
  // Compute a compact additional radius.  A smaller multiplier on the
  // total width and a lower constant shorten edges and keep deep leaves
  // closer to their ancestors.  These values were tuned to minimise
  // long connectors when navigating deep branches.
  // Compute a compact additional radius.  We bound the dynamic radius to
  // prevent very long connectors when child labels are exceptionally wide.
  // A smaller multiplier on the total width and a lower constant shorten
  // edges; the radius is capped at three times the base link distance.
  const calcAdd = (sumWidths / span) * 0.05 + 20;
  // Cap the additional radius at 2.5× the base link distance to avoid
  // extremely long connectors for wide clusters.
  const additionalRadius = Math.min(calcAdd, base * 2.5);
  // Reduce the depth factor even further so successive levels stay close
  // to their parent.  A smaller value keeps the tree tight while still
  // giving each generation its own ring.
  const depthFactor = 20;
  // Compute the base radial distance for the first ring.  This is the
  // distance used when all children can fit comfortably on a single
  // circle.  We omit the additional radius here and instead
  // distribute it across rings below.  The depth factor pushes each
  // level outward, while the link distance sets a minimum separation
  // from the parent.
  const distanceBase = base + (n.depth * depthFactor);

  /*
    If a node has many children, placing them all on a single ring can
    produce overlapping labels.  To mitigate this, we spread siblings
    across multiple concentric rings.  Each ring hosts up to a fixed
    number of children (maxPerRing).  Outer rings get progressively
    larger radii so their arc length increases and labels have more
    room to breathe.

    We choose a modest default of six children per ring; if there are
    fewer children, they all occupy the first ring.  The number of
    rings is computed from the total number of children.  A ring
    spacing equal to the depth factor pushes each additional ring
    outward by a fixed distance, keeping siblings on separate
    orbits.  These constants can be tuned to taste: larger
    maxPerRing values reduce the number of rings but increase
    crowding; larger ringSpacing values create more separation
    between rings.
  */
  const maxPerRing = 8;
  const rings = Math.ceil(m / maxPerRing);

  // Position each child according to its assigned angleHome and ring.
  n.children.forEach((ch, idx) => {
    const ringIndex = Math.floor(idx / maxPerRing);
    // Distribute the additional radius evenly across the number of rings.
    // The first ring uses 1/rings of the additional radius, the second
    // ring uses 2/rings, etc.  This yields shorter connectors and
    // avoids unnecessary extra spacing between rings.
    const radius = distanceBase + additionalRadius * ((ringIndex + 1) / rings);
    const angle = (typeof ch.angleHome === 'number') ? ch.angleHome : Math.atan2(ch.y - n.y, ch.x - n.x);
    ch.x = n.x + radius * Math.cos(angle);
    ch.y = n.y + radius * Math.sin(angle);
    // Reset velocity so children don't drift during physics relaxation
    ch.vx = 0;
    ch.vy = 0;
  });
  // Recursively lay out open children to propagate the radial spacing deeper
  // into the tree.  Without this recursion, grandchildren retain positions
  // from previous layouts, which can cause asymmetric expansion.  By
  // repositioning open subtrees here, each level fans out within its
  // allocated sector, yielding a symmetrical, mycelium-like pattern.
  n.children.forEach(ch => {
    if (ch.open && ch.children && ch.children.length > 0) {
      layoutChildren(ch);
    }
  });
}

const layoutWorkQueue = [];
const layoutQueuedIds = new Set();
let layoutFrameHandle = null;
let layoutVisibilityPending = false;
let layoutPhysicsPending = false;
let pendingPhysicsDuration = null;

function runLayoutForNode(node){
  if (!node || !node.children || node.children.length === 0) return;
  assignAngles(node);
  layoutChildren(node);
}

function queueLayout(node, { includeAncestors = false, immediate = false } = {}){
  if (!node) return;
  if (includeAncestors){
    let cursor = node;
    while (cursor){
      queueLayout(cursor, { includeAncestors: false, immediate });
      cursor = cursor.parent || null;
    }
    return;
  }
  if (!node.children || node.children.length === 0){
    if (layoutQueuedIds.has(node?.id)){
      layoutQueuedIds.delete(node.id);
    }
    return;
  }
  if (immediate){
    if (layoutQueuedIds.has(node.id)){
      layoutQueuedIds.delete(node.id);
      const index = layoutWorkQueue.indexOf(node);
      if (index !== -1){
        layoutWorkQueue.splice(index, 1);
      }
    }
    runLayoutForNode(node);
    return;
  }
  if (layoutQueuedIds.has(node.id)) return;
  layoutQueuedIds.add(node.id);
  layoutWorkQueue.push(node);
  scheduleLayoutProcessing();
}

function scheduleLayoutProcessing(){
  if (layoutFrameHandle !== null) return;
  layoutFrameHandle = requestAnimationFrame(processLayoutQueue);
}

function processLayoutQueue(){
  layoutFrameHandle = null;
  const deadline = performance.now() + 8;
  while (layoutWorkQueue.length){
    const node = layoutWorkQueue.shift();
    layoutQueuedIds.delete(node.id);
    runLayoutForNode(node);
    if (performance.now() >= deadline){
      break;
    }
  }
  if (layoutWorkQueue.length){
    layoutFrameHandle = requestAnimationFrame(processLayoutQueue);
  } else {
    if (layoutVisibilityPending){
      refreshVisibilityCaches();
      layoutVisibilityPending = false;
    }
    if (layoutPhysicsPending){
      const duration = typeof pendingPhysicsDuration === 'number' ? pendingPhysicsDuration : undefined;
      pendingPhysicsDuration = null;
      layoutPhysicsPending = false;
      kickPhysics(duration);
    }
  }
}

function requestVisibilityRefresh(){
  layoutVisibilityPending = true;
  if (layoutWorkQueue.length === 0 && layoutFrameHandle === null){
    refreshVisibilityCaches();
    layoutVisibilityPending = false;
  }
}

function requestPhysicsKick(ms){
  layoutPhysicsPending = true;
  if (typeof ms === 'number'){
    pendingPhysicsDuration = Math.max(pendingPhysicsDuration || 0, ms);
  }
  if (layoutWorkQueue.length === 0 && layoutFrameHandle === null){
    const duration = typeof pendingPhysicsDuration === 'number' ? pendingPhysicsDuration : ms;
    pendingPhysicsDuration = null;
    layoutPhysicsPending = false;
    kickPhysics(duration);
  }
}

// ----------------------------------------------------------------------------
// Interaction (pan/zoom/drag, click toggle, wheel smooth zoom)
// ----------------------------------------------------------------------------
// Track dragging state. When dragging a node or panning the canvas, we set these flags.
let draggingCanvas=false, dragNode=null, dragStart=[0,0], grabStart=[0,0], lastMouse=[0,0];
// To prevent inadvertent expansion on drag, record whether the pointer moved beyond a small
// threshold while a button is held. If true, the click handler will skip toggling.
let movedDuringDrag = false;
// Track if a node drag just occurred so that the subsequent click event can be suppressed.
let justDraggedNode = false;
// Record the mouse position at the beginning of a potential drag (mousedown)
let mouseDownScreen = [0,0];
// Track which node (if any) was pressed on mousedown. This allows us to
// distinguish between clicking a node (to expand/collapse) and dragging it.  The
// click handler will only toggle the node if the mouse went down and up on
// the same node without significant movement.
let downNode = null;

function hitTestNodeAt(x, y){
  const vis = collectVisible();
  for (let i = vis.length - 1; i >= 0; i--){
    const candidate = vis[i];
    const hit = candidate._hit;
    if (!hit) continue;
    if (x >= hit.x && x <= hit.x + hit.w && y >= hit.y && y <= hit.y + hit.h){
      return candidate;
    }
  }
  return null;
}

let touchPressTimer = null;
let touchStartPoint = null;
let touchCandidateNode = null;
let touchPreviewNode = null;
let touchPreviewTimer = null;
let suppressNextClick = false;
let minimapTouchReturnFocus = null;
let mobileSidebarOpen = false;
let mobileSidebarReturnFocus = null;
let sidebarFocusTrapHandler = null;
let sidebarFocusInHandler = null;
canvas.addEventListener('mousedown',e=>{
  const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  lastMouse=[x,y];
  // Reset movement detection at the start of each mouse press
  movedDuringDrag = false;
  mouseDownScreen=[x,y];
  let target = hitTestNodeAt(x, y);
  if (target){
    dragNode=target; target.isDragging=true;
    const [wx,wy] = screenToWorld(x,y);
    target._grabDx = target.x - wx; target._grabDy = target.y - wy;
    // remember which node was initially pressed; used to distinguish click vs drag
    downNode = target;
  } else {
    draggingCanvas=true; dragStart=[x,y]; grabStart=[offsetX,offsetY]; canvas.classList.add('grabbing');
    downNode = null;
  }
});
window.addEventListener('mouseup',()=>{
  // On mouseup, end any drag operations. If a node was being dragged and
  // the pointer moved significantly (movedDuringDrag), set justDraggedNode
  // so that the subsequent click does not toggle the node. Otherwise,
  // leave justDraggedNode=false so a simple click toggles as expected.
  if (dragNode){
    dragNode.isDragging = false;
    dragNode = null;
    if (movedDuringDrag){
      justDraggedNode = true;
    }
  }
  draggingCanvas = false;
  canvas.classList.remove('grabbing');
  // Do not reset movedDuringDrag here; the click handler will do that on a true click.
});
canvas.addEventListener('mousemove',e=>{
  const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  if (draggingCanvas){
    const dx=(x - dragStart[0]) / scale, dy=(y - dragStart[1]) / scale;
    offsetX = grabStart[0] + dx; offsetY = grabStart[1] + dy;
    // flag as moved when panning beyond a small threshold
    if (!movedDuringDrag){
      const mdx = x - mouseDownScreen[0];
      const mdy = y - mouseDownScreen[1];
      // Use a larger threshold to reduce accidental toggles on minor movement when panning
      // Increase threshold to reduce accidental toggles on small pointer movements
      if (Math.abs(mdx) > 6 || Math.abs(mdy) > 6) movedDuringDrag = true;
    }
  } else if (dragNode){
    const [wx,wy] = screenToWorld(x,y);
    dragNode.x = wx + dragNode._grabDx;
    dragNode.y = wy + dragNode._grabDy;
    // flag as moved when dragging node beyond a small threshold
    if (!movedDuringDrag){
      const mdx = x - mouseDownScreen[0];
      const mdy = y - mouseDownScreen[1];
      // Use a larger threshold to reduce accidental toggles on minor movement
      // Increase threshold to reduce accidental toggles on small pointer movements
      if (Math.abs(mdx) > 6 || Math.abs(mdy) > 6) movedDuringDrag = true;
    }
  }
});
canvas.addEventListener('touchstart', (e) => {
  closeContextMenu();
  if (e.touches && e.touches.length > 1){
    clearTimeout(touchPressTimer);
    touchPressTimer = null;
    touchCandidateNode = null;
    return;
  }
  const point = pointerPositionFromEvent(e);
  if (!point) return;
  const rect = canvas.getBoundingClientRect();
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  lastMouse = [x, y];
  touchStartPoint = { x, y };
  touchCandidateNode = hitTestNodeAt(x, y);
  if (touchPressTimer){
    clearTimeout(touchPressTimer);
  }
  if (touchCandidateNode){
    touchPressTimer = setTimeout(() => {
      touchPressTimer = null;
      showTouchPreview(touchCandidateNode);
    }, 280);
  }
});
canvas.addEventListener('touchmove', (e) => {
  if (!touchStartPoint) return;
  const point = pointerPositionFromEvent(e);
  if (!point) return;
  const rect = canvas.getBoundingClientRect();
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  const dx = Math.abs(x - touchStartPoint.x);
  const dy = Math.abs(y - touchStartPoint.y);
  if (dx > 18 || dy > 18){
    if (touchPressTimer){
      clearTimeout(touchPressTimer);
      touchPressTimer = null;
    }
  }
});
canvas.addEventListener('touchend', (e) => {
  if (touchPressTimer){
    clearTimeout(touchPressTimer);
    touchPressTimer = null;
  }
  if (!touchStartPoint){
    touchCandidateNode = null;
    return;
  }
  const point = pointerPositionFromEvent(e);
  if (point && touchCandidateNode){
    const rect = canvas.getBoundingClientRect();
    const x = point.clientX - rect.left;
    const y = point.clientY - rect.top;
    const dx = Math.abs(x - touchStartPoint.x);
    const dy = Math.abs(y - touchStartPoint.y);
    if (dx <= 18 && dy <= 18){
      showTouchPreview(touchCandidateNode);
    }
  }
  touchCandidateNode = null;
  touchStartPoint = null;
});
canvas.addEventListener('touchcancel', () => {
  if (touchPressTimer){
    clearTimeout(touchPressTimer);
    touchPressTimer = null;
  }
  touchCandidateNode = null;
  touchStartPoint = null;
});
canvas.addEventListener('click',e=>{
  closeContextMenu();
  if (suppressNextClick){
    suppressNextClick = false;
    downNode = null;
    movedDuringDrag = false;
    return;
  }
  // Determine which node (if any) the mouse is over on click
  const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
  let target = hitTestNodeAt(x, y);
  // Determine if the pointer moved significantly since the press. Use the stored mouseDownScreen to avoid relying on mousemove events (which may not fire in all drag simulations).
  const dxMove = x - mouseDownScreen[0];
  const dyMove = y - mouseDownScreen[1];
  // Increase the movement threshold to better distinguish between a
  // deliberate click and a slight pointer wobble.  A higher threshold
  // makes it easier to expand/collapse nodes on touchpads where the
  // cursor may move a few pixels during a click.
  // Increase the movement threshold further to ensure clicks on
  // first‑level categories are interpreted as clicks even on
  // touchpads with jitter.  A threshold of 12px allows for minor
  // pointer drift.
  const moved = Math.abs(dxMove) > 12 || Math.abs(dyMove) > 12;
  // If a node drag just occurred, skip toggling entirely to prevent accidental expansion
  if (justDraggedNode){
    justDraggedNode = false;
  } else if (!moved && downNode && target && target === downNode){
    const toggle = target._toggle;
    const clickedToggle = toggle && Math.hypot(x - toggle.cx, y - toggle.cy) <= toggle.r;
    if (clickedToggle){
      toggleNode(target, true);
      focusNode(target, { animate: true, ensureVisible: false, targetScale: scale, keepZoom: true });
    } else {
      focusNode(target, { animate: true, ensureVisible: true });
    }
  }
  // Always reset state
  downNode = null;
  movedDuringDrag = false;
});
canvas.addEventListener('dblclick', e => {
  closeContextMenu();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const target = hitTestNodeAt(x, y);
  if (target){
    focusNode(target, { animate: true, ensureVisible: true, frameChildren: true });
  }
});
canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (!contextMenuElem) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const target = hitTestNodeAt(x, y);
  if (target){
    openContextMenu(target, e.pageX, e.pageY);
  } else {
    closeContextMenu();
  }
});
canvas.addEventListener('wheel', (e)=>{
  closeContextMenu();
  e.preventDefault();
  const r = canvas.getBoundingClientRect(); const cx=e.clientX-r.left, cy=e.clientY-r.top;
  const [wx,wy] = screenToWorld(cx,cy);
  // Apply a responsive zoom factor so wheels and trackpads reach the desired scale quickly without jumpy steps.
  const factor = e.deltaY > 0 ? 0.85 : 1.15;
  const targetScale = clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
  animateZoom(targetScale, wx, wy, WHEEL_EASE_MS);
}, { passive: false });
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function animateZoom(targetScale, anchorWx, anchorWy, ms){
  const startScale = scale;
  const startOffX = offsetX, startOffY = offsetY;
  const startTime = performance.now();
  const ease = t=> t<.5 ? 2*t*t : -1+(4-2*t)*t;
  function step(now){
    const t = Math.min(1,(now-startTime)/ms);
    const s = startScale + (targetScale-startScale)*ease(t);
    const [cx,cy] = worldToScreen(anchorWx,anchorWy);
    offsetX = (cx/s) - anchorWx; offsetY = (cy/s) - anchorWy; scale=s;
    if (t<1) {
      requestAnimationFrame(step);
    } else if (!applyingUrlState) {
      scheduleUrlUpdate();
    }
  }
  requestAnimationFrame(step);
}
function toggleNode(n, animated){
  if (!n.children || n.children.length === 0) return;
  const opening = !n.open;
  setNodeOpenState(n, opening);
  if (opening){
    // Automatically open immediate children when expanding so the first
    // interaction reveals the full branch.  Deeper descendants remain
    // collapsed so the user can drill down gradually.
    n.children.forEach(ch => {
      markNodeOpen(ch);
      ch.appear = 0;
    });
    // Schedule a progressive layout pass for the node and its ancestors.
    // This defers expensive angle assignment and radial layout work across
    // animation frames, preventing large branches from freezing the UI.
    queueLayout(n, { includeAncestors: true });
    // Animate the appearance quickly for a snappy feel (180 ms)
    const t0 = performance.now();
    (function anim(time){
      const t = Math.min(1, (time - t0) / 180);
      n.children.forEach(ch => ch.appear = t);
      if (t < 1 && n.open) requestAnimationFrame(anim);
    })(t0);
  } else {
    queueLayout(n, { includeAncestors: true });
  }
  requestVisibilityRefresh();
  // Let physics run briefly to settle the new layout, then freeze
  requestPhysicsKick();
  updateOutlineTree(n.id);
  if (!applyingUrlState){
    scheduleUrlUpdate();
  }
}
const qElem = document.getElementById('q'), resultsElem = document.getElementById('results');
let currentFocusNode=null;
let viewStack=[];
let searchMatches = [];
let highlightedResultIndex = -1;

if (qElem){
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement){
      try {
        qElem.focus({ preventScroll: true });
      } catch(e) {
        qElem.focus();
      }
      qElem.select();
    }
  });
}

function cancelActiveSearch(){
  if (activeSearchTask && typeof activeSearchTask.cancel === 'function'){
    activeSearchTask.cancel();
  }
  activeSearchTask = null;
}

function scheduleIdleWork(callback){
  if (typeof window.requestIdleCallback === 'function'){
    const id = window.requestIdleCallback(callback, { timeout: 160 });
    return { type: 'idle', id };
  }
  const wrapped = () => callback({ timeRemaining: () => 0, didTimeout: false });
  const id = window.requestAnimationFrame(wrapped);
  return { type: 'raf', id };
}

function cancelIdleWork(handle){
  if (!handle) return;
  if (handle.type === 'idle' && typeof window.cancelIdleCallback === 'function'){
    window.cancelIdleCallback(handle.id);
  } else {
    window.cancelAnimationFrame(handle.id);
  }
}

function computeSearchScore(node, tokens){
  if (!tokens.length) return null;
  const lowerName = (node.name || '').toLowerCase();
  let score = 0;
  for (const token of tokens){
    let tokenScore = 0;
    if (lowerName.includes(token)){
      const index = lowerName.indexOf(token);
      tokenScore += 6;
      if (index === 0) tokenScore += 4;
      tokenScore += Math.max(0, 3 - index / 12);
    }
    let matched = tokenScore > 0;
    if (!matched && searchIncludeTags && node.tags){
      for (const tag of node.tags){
        const lowerTag = String(tag).toLowerCase();
        if (lowerTag.includes(token)){
          tokenScore += 3;
          matched = true;
          break;
        }
      }
    }
    if (!matched){
      const pathText = pathTo(node).map(p => (p.name || '').toLowerCase()).join(' ');
      if (pathText.includes(token)){
        tokenScore += 1.5;
        matched = true;
      }
    }
    if (!matched){
      return null;
    }
    score += tokenScore;
  }
  score += (node.children ? node.children.length : 0) * 0.1;
  return score;
}

function renderSearchResults(rawTerm){
  if (!resultsElem) return;
  cancelActiveSearch();
  const term = (rawTerm || '').trim();
  searchMatches = [];
  searchMatchesAll = [];
  highlightedResultIndex = -1;
  pendingAutoPan = false;
  if (!term){
    lastSearchTokens = [];
    searchPageIndex = 0;
    resultsElem.innerHTML = '';
    resultsElem.classList.remove('visible');
    resultsElem.classList.remove('persist');
    resultsElem.setAttribute('aria-expanded', 'false');
    walk(root, n => { n.match = false; });
    updateRecentSearchesUI();
    draw();
    return;
  }
  const tokens = term.toLowerCase().split(/\s+/).filter(Boolean);
  lastSearchTokens = tokens;
  walk(root, n => { n.match = false; });
  pendingAutoPan = true;
  searchPageIndex = 0;
  resultsElem.innerHTML = '';
  const searching = document.createElement('div');
  searching.className = 'hit searching';
  searching.textContent = 'Searching…';
  searching.setAttribute('role', 'status');
  resultsElem.appendChild(searching);
  resultsElem.classList.add('visible');
  resultsElem.setAttribute('aria-expanded', 'true');
  resultsElem.classList.toggle('persist', searchDropdownPinned);

  const scopeRoot = (searchInSubtree && currentFocusNode) ? currentFocusNode : root;
  const queue = [scopeRoot];
  const matches = [];
  const seen = new Set();
  let lastRenderedCount = 0;

  const state = {
    cancelled: false,
    handle: null,
    cancel(){
      this.cancelled = true;
      if (this.handle){
        cancelIdleWork(this.handle);
        this.handle = null;
      }
    }
  };

  function processBatch(deadline){
    if (state.cancelled) return;
    let processed = 0;
    while(queue.length && (!deadline || deadline.timeRemaining() > 1) && processed < SEARCH_BATCH_SIZE){
      const node = queue.shift();
      processed += 1;
      if (!node) continue;
      const children = node.children || [];
      children.forEach(child => {
        if (!seen.has(child.id)){
          queue.push(child);
        }
      });
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      if (node.syntheticOverview && !showSyntheticNodes) continue;
      const score = computeSearchScore(node, tokens);
      if (score !== null){
        matches.push({ node, score });
        node.match = true;
      }
    }

    const shouldRender = matches.length !== lastRenderedCount || queue.length === 0;
    if (shouldRender){
      matches.sort((a,b) => b.score - a.score || fallbackText(a.node, 'name').localeCompare(fallbackText(b.node, 'name')));
      searchMatchesAll = matches.slice();
      lastRenderedCount = matches.length;
      const shouldAutoPan = pendingAutoPan && matches.length > 0;
      renderSearchResultsPage({ autopan: shouldAutoPan });
      if (shouldAutoPan){
        pendingAutoPan = false;
      }
    }

    if (queue.length && !state.cancelled){
      state.handle = scheduleIdleWork(processBatch);
    } else {
      activeSearchTask = null;
      if (!matches.length){
        searchMatchesAll = [];
        renderSearchResultsPage();
      }
    }
  }

  state.handle = scheduleIdleWork(processBatch);
  activeSearchTask = state;
}

function renderSearchResultsPage({ autopan = false } = {}){
  if (!resultsElem) return;
  resultsElem.innerHTML = '';
  const total = searchMatchesAll.length;
  if (!total){
    const empty = document.createElement('div');
    empty.className = 'hit';
    empty.textContent = 'No matches available';
    empty.setAttribute('role', 'status');
    resultsElem.appendChild(empty);
    resultsElem.classList.add('visible');
    resultsElem.setAttribute('aria-expanded', 'true');
    currentFocusNode = null;
    draw();
    return;
  }
  const start = Math.max(0, Math.min(searchPageIndex * SEARCH_PAGE_SIZE, Math.max(0, total - 1)));
  const pageMatches = searchMatchesAll.slice(start, start + SEARCH_PAGE_SIZE);
  searchMatches = pageMatches;
  pageMatches.forEach((entry, idx) => {
    const node = entry.node;
    const item = document.createElement('div');
    item.className = 'hit';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
    const title = document.createElement('span');
    title.innerHTML = highlightText(fallbackText(node, 'name'), lastSearchTokens);
    const pathSpan = document.createElement('small');
    const pathLabel = pathTo(node).slice(1, -1).map(p => fallbackText(p, 'name')).join(' › ');
    pathSpan.innerHTML = pathLabel ? highlightText(pathLabel, lastSearchTokens) : 'Top-level';
    item.appendChild(title);
    item.appendChild(pathSpan);
    item.onmouseenter = () => setActiveSearchResult(idx);
    item.onclick = () => {
      setActiveSearchResult(idx);
      jumpToMatch(node);
      if (!searchDropdownPinned){
        hideSearchResults();
      }
    };
    resultsElem.appendChild(item);
  });
  const nav = document.createElement('div');
  nav.className = 'search-nav';
  const info = document.createElement('span');
  const end = Math.min(total, start + pageMatches.length);
  info.textContent = `${start + 1}–${end} of ${total}`;
  nav.appendChild(info);
  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.textContent = searchDropdownPinned ? 'Unpin' : 'Pin';
  pinBtn.title = searchDropdownPinned ? 'Allow closing on outside click' : 'Keep results pinned open';
  pinBtn.onclick = () => {
    searchDropdownPinned = !searchDropdownPinned;
    pinBtn.textContent = searchDropdownPinned ? 'Unpin' : 'Pin';
    pinBtn.title = searchDropdownPinned ? 'Allow closing on outside click' : 'Keep results pinned open';
    resultsElem.classList.toggle('persist', searchDropdownPinned);
  };
  nav.appendChild(pinBtn);
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = 'Prev';
  prevBtn.disabled = start === 0;
  prevBtn.onclick = () => {
    if (start === 0) return;
    searchPageIndex = Math.max(0, searchPageIndex - 1);
    renderSearchResultsPage();
  };
  nav.appendChild(prevBtn);
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = 'Next';
  nextBtn.disabled = end >= total;
  nextBtn.onclick = () => {
    if (end >= total) return;
    searchPageIndex += 1;
    renderSearchResultsPage();
  };
  nav.appendChild(nextBtn);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = () => hideSearchResults();
  nav.appendChild(closeBtn);
  resultsElem.appendChild(nav);
  setActiveSearchResult(0, { autopan });
  resultsElem.classList.add('visible');
  resultsElem.setAttribute('aria-expanded', 'true');
  resultsElem.classList.toggle('persist', searchDropdownPinned);
  draw();
}
function snapshotView(){
  return {
    offsetX,
    offsetY,
    scale,
    openIds: Array.from(openNodeIds),
    focusId: lastFocusedNode ? lastFocusedNode.id : null
  };
}
function restoreView(v){
  offsetX=v.offsetX; offsetY=v.offsetY; scale=v.scale;
  if (Array.isArray(v.openIds)){
    const stored = new Set(v.openIds);
    stored.add(root.id);
    walk(root,n=>{ setNodeOpenState(n, stored.has(n.id)); });
  } else if (v.openMap && typeof v.openMap === 'object'){
    walk(root,n=>{ setNodeOpenState(n, !!v.openMap[n.id]); });
  } else {
    syncOpenSetFromTree();
  }
  updateOutlineTree(v.focusId || root.id);
  if (typeof v.focusId === 'number'){
    const node = findNodeById(v.focusId);
    if (node){
      updateBreadcrumb(node);
    }
  } else {
    updateBreadcrumb(root);
  }
}
let lastSearchTokens = [];
function escapeRegExp(str){
  return str.replace(/[\\^$.*+?()[\]{}|]/g, '\$&');
}

function highlightText(text, tokens){
  if (!tokens.length) return text;
  let result = text;
  tokens.forEach(token => {
    const pattern = new RegExp(`(${escapeRegExp(token)})`, 'ig');
    result = result.replace(pattern, '<mark>$1</mark>');
  });
  return result;
}

function rememberSearch(term){
  const clean = (term || '').trim();
  if (!clean) return;
  recentSearches = recentSearches.filter(item => item.toLowerCase() !== clean.toLowerCase());
  recentSearches.unshift(clean);
  if (recentSearches.length > RECENT_SEARCH_LIMIT){
    recentSearches = recentSearches.slice(0, RECENT_SEARCH_LIMIT);
  }
  try { localStorage.setItem('atlas_recent_searches', JSON.stringify(recentSearches)); } catch(e) {}
  updateRecentSearchesUI();
}

function updateRecentSearchesUI(){
  if (!recentSearchesElem) return;
  recentSearchesElem.innerHTML = '';
  if (!recentSearches.length){
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Recent searches appear here.';
    recentSearchesElem.appendChild(empty);
    return;
  }
  recentSearches.forEach(query => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'recent-pill';
    pill.textContent = query;
    pill.onclick = () => {
      qElem.value = query;
      renderSearchResults(query);
      qElem.focus();
    };
    recentSearchesElem.appendChild(pill);
  });
}

function queueClipboardWrite(text){
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
  if (clipboardWriteTimer === null){
    clipboardPendingText = null;
    navigator.clipboard.writeText(text).catch(() => {});
    clipboardWriteTimer = setTimeout(() => {
      clipboardWriteTimer = null;
      if (clipboardPendingText !== null){
        const next = clipboardPendingText;
        clipboardPendingText = null;
        queueClipboardWrite(next);
      }
    }, CLIPBOARD_WRITE_DELAY_MS);
  } else {
    clipboardPendingText = text;
  }
}

function closeContextMenu(){
  if (!contextMenuElem) return;
  contextMenuElem.setAttribute('aria-hidden', 'true');
  contextMenuElem.style.pointerEvents = 'none';
  contextMenuNode = null;
  const restore = contextMenuReturnFocus;
  contextMenuReturnFocus = null;
  if (restore && typeof restore.focus === 'function'){
    restore.focus();
  }
}

function expandSubtree(node){
  if (!node) return;
  walkFrom(node, child => {
    markNodeOpen(child);
  });
  queueLayout(node, { includeAncestors: true });
  requestVisibilityRefresh();
  updateOutlineTree(node.id);
  requestPhysicsKick(1000);
  if (!applyingUrlState){ scheduleUrlUpdate(); }
}

function collapseSubtree(node){
  if (!node) return;
  walkFrom(node, child => {
    if (child !== node){ markNodeClosed(child); }
  });
  queueLayout(node, { includeAncestors: true });
  requestVisibilityRefresh();
  updateOutlineTree(node.id);
  requestPhysicsKick();
  if (!applyingUrlState){ scheduleUrlUpdate(); }
}

function openContextMenu(node, pageX, pageY){
  if (!contextMenuElem || !node) return;
  contextMenuElem.innerHTML = '';
  contextMenuNode = node;
  contextMenuReturnFocus = document.activeElement;
  const actions = [
    { label: 'Focus & frame', handler: () => focusNode(node, { animate: true, ensureVisible: true, frameChildren: true }) },
    { label: 'Expand branch', handler: () => expandSubtree(node) },
    { label: 'Collapse branch', handler: () => collapseSubtree(node) },
    { label: 'Show details', handler: (btn) => {
        const rect = btn?.getBoundingClientRect();
        renderDetailsPanel(node, { anchorRect: rect || null, anchor: btn || null, open: true, restoreFocus: btn || null });
      } },
    { label: 'Copy link', handler: () => {
        const link = buildShareableLink(node);
        queueClipboardWrite(link);
      } }
  ];
  actions.forEach(action => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = action.label;
    btn.onclick = () => {
      action.handler(btn);
      closeContextMenu();
    };
    if ((action.label === 'Expand branch' || action.label === 'Collapse branch') && (!node.children || !node.children.length)){
      btn.disabled = true;
    }
    if (action.label === 'Copy link' && !navigator.clipboard){
      btn.disabled = true;
    }
    contextMenuElem.appendChild(btn);
  });
  contextMenuElem.style.left = `${pageX}px`;
  contextMenuElem.style.top = `${pageY}px`;
  contextMenuElem.setAttribute('aria-hidden', 'false');
  contextMenuElem.style.pointerEvents = 'auto';
  const bounds = contextMenuElem.getBoundingClientRect();
  const adjustedX = Math.min(pageX, window.innerWidth - bounds.width - 16);
  const adjustedY = Math.min(pageY, window.innerHeight - bounds.height - 16);
  contextMenuElem.style.left = `${Math.max(0, adjustedX)}px`;
  contextMenuElem.style.top = `${Math.max(0, adjustedY)}px`;
  const buttons = contextMenuElem.querySelectorAll('button');
  if (buttons.length){
    buttons[0].focus();
  }
  contextMenuElem.onkeydown = (event) => {
    const items = Array.from(contextMenuElem.querySelectorAll('button'));
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown'){
      event.preventDefault();
      const next = index === -1 ? 0 : (index + 1) % items.length;
      items[next].focus();
    } else if (event.key === 'ArrowUp'){
      event.preventDefault();
      const prev = index <= 0 ? items.length - 1 : index - 1;
      items[prev].focus();
    } else if (event.key === 'Escape'){
      event.preventDefault();
      closeContextMenu();
    }
  };
}

function buildShareableLink(node){
  const params = new URLSearchParams();
  params.set('node', String(node.id));
  const openList = [];
  const seenChains = new Set();
  for (const id of openNodeIds){
    if (id === root.id) continue;
    const current = findNodeById(id);
    if (!current || !current.parent) continue;
    const chain = [];
    let cursor = current;
    while (cursor && typeof cursor.id !== 'undefined'){
      chain.push(cursor.id);
      if (cursor === root) break;
      cursor = cursor.parent || null;
    }
    if (!chain.length || chain[chain.length - 1] !== root.id){
      continue;
    }
    const serialized = chain.reverse().join('.');
    if (!seenChains.has(serialized)){
      seenChains.add(serialized);
      openList.push(serialized);
      if (openList.length >= 50) break;
    }
  }
  const focusChain = pathTo(node).map(p => p.id).join('.');
  if (focusChain && !seenChains.has(focusChain)){
    seenChains.add(focusChain);
    openList.push(focusChain);
  }
  if (openList.length){ params.set('open', openList.join(',')); }
  params.set('x', offsetX.toFixed(2));
  params.set('y', offsetY.toFixed(2));
  params.set('z', scale.toFixed(3));
  params.set('theme', document.documentElement.getAttribute('data-theme') || 'dark');
  if (fisheyeEnabled){ params.set('lens', '1'); }
  if (activeTags.size){ params.set('tags', Array.from(activeTags).join(',')); }
  if (searchInSubtree){ params.set('subtree', '1'); }
  if (searchIncludeTags){ params.set('tagsearch', '1'); }
  const hash = '#' + params.toString();
  return window.location.origin + window.location.pathname + hash;
}

function setActiveSearchResult(index, { autopan = false } = {}){
  const items = Array.from(resultsElem.querySelectorAll('.hit'));
  if (!items.length){
    highlightedResultIndex = -1;
    currentFocusNode = null;
    return;
  }
  highlightedResultIndex = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((el, i) => {
    const active = i === highlightedResultIndex;
    el.classList.toggle('active', active);
    if (el.getAttribute('role') === 'option'){
      el.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  });
  const entry = searchMatches[highlightedResultIndex];
  currentFocusNode = entry ? entry.node : null;
  if (currentFocusNode){
    triggerNodeFlash(currentFocusNode, 1500);
    if (autopan){
      focusNode(currentFocusNode, { animate: true, ensureVisible: true, keepZoom: true });
    }
    draw();
  }
}

function hideSearchResults(){
  cancelActiveSearch();
  resultsElem.classList.remove('visible');
  resultsElem.innerHTML = '';
  highlightedResultIndex = -1;
  searchMatchesAll = [];
  searchPageIndex = 0;
  resultsElem.classList.remove('persist');
  if (!qElem.value.trim()){
    walk(root, n => { n.match = false; });
    currentFocusNode = lastFocusedNode || null;
  }
  resultsElem.setAttribute('aria-expanded', 'false');
  updateRecentSearchesUI();
}

qElem.addEventListener('input', () => {
  renderSearchResults(qElem.value);
});

qElem.addEventListener('focus', () => {
  const term = qElem.value.trim();
  if (term){ renderSearchResults(term); }
});

resultsElem.addEventListener('mousedown', (e) => {
  e.preventDefault();
});

qElem.addEventListener('keydown', (e) => {
  if (!resultsElem.classList.contains('visible')) return;
  if (e.key === 'ArrowDown'){
    e.preventDefault();
    if (searchMatches.length){
      const next = (highlightedResultIndex + 1) % searchMatches.length;
      setActiveSearchResult(next);
    }
  } else if (e.key === 'ArrowUp'){
    e.preventDefault();
    if (searchMatches.length){
      const prev = (highlightedResultIndex - 1 + searchMatches.length) % searchMatches.length;
      setActiveSearchResult(prev);
    }
  } else if (e.key === 'Enter'){
    const entry = searchMatches[highlightedResultIndex] || searchMatches[0];
    if (entry){
      e.preventDefault();
      jumpToMatch(entry.node);
      hideSearchResults();
      qElem.blur();
    }
  } else if (e.key === 'Escape'){
    hideSearchResults();
    highlightedResultIndex = -1;
    qElem.blur();
  }
});

document.addEventListener('click', (e) => {
  if (resultsElem.classList.contains('visible') && !searchDropdownPinned && !resultsElem.contains(e.target) && e.target !== qElem){
    hideSearchResults();
  }
  if (contextMenuElem && contextMenuElem.style.display === 'flex' && !contextMenuElem.contains(e.target)){
    closeContextMenu();
  }
  if (detailsPopoverElem && !detailsPopoverElem.hidden && !detailsJustOpened && !detailsPopoverElem.contains(e.target)){
    hideDetailsPopover();
  }
  if (touchPreviewElem && touchPreviewElem.classList.contains('visible') && !touchPreviewElem.contains(e.target)){
    hideTouchPreview();
  }
});
function openPathOnly(n){
  walk(root,x=>{ markNodeClosed(x); });
  const pathNodes = pathTo(n);
  // Mark nodes along the path as open
  pathNodes.forEach(x=> markNodeOpen(x));
  // Radially lay out children of each node along the opened path.  This
  // minimises overlap when jumping directly to a deep node via search.
  pathNodes.forEach(x => {
    if (x.children && x.children.length>0) {
      // Force an immediate layout so the subsequent focus animation uses the
      // latest geometry.  We bypass the progressive queue here because this
      // path is taken when jumping directly to a node via search, where the
      // view should update synchronously.
      queueLayout(x, { immediate: true });
    }
  });

  // After laying out the opened path, allow physics to run briefly to
  // settle the arrangement, then freeze.  This avoids jitter while
  // preserving the new configuration.
  refreshVisibilityCaches();
  kickPhysics();
}
function jumpToMatch(n){
  viewStack.push(snapshotView());
  rememberSearch(qElem.value);
  focusNode(n, { animate: true, ensureVisible: true, exclusive: true, frameChildren: true });
  triggerNodeFlash(n);
}
const backBtn = document.getElementById('backBtn');
if (backBtn){
  backBtn.onclick = () => {
    const v = viewStack.pop();
    if (!v) return;
    restoreView(v);
  };
}
const centerBtn = document.getElementById('centerBtn');
if (centerBtn){
  centerBtn.onclick = () => centerOnRoot(true);
}
const resetViewBtn = document.getElementById('resetViewBtn');
if (resetViewBtn){
  resetViewBtn.addEventListener('click', () => {
    const target = lastFocusedNode || root;
    focusNode(target, { animate: true, ensureVisible: true, targetScale: 1, keepZoom: false });
  });
}
if (fisheyeToggleBtn){
  fisheyeToggleBtn.addEventListener('click', () => {
    fisheyeEnabled = !fisheyeEnabled;
    fisheyeToggleBtn.classList.toggle('active', fisheyeEnabled);
    fisheyeToggleBtn.setAttribute('aria-pressed', fisheyeEnabled ? 'true' : 'false');
    if (!applyingUrlState){
      scheduleUrlUpdate();
    }
  });
  fisheyeToggleBtn.setAttribute('aria-pressed', fisheyeEnabled ? 'true' : 'false');
}
const expandBtn = document.getElementById('expandBtn');
if (expandBtn){
  expandBtn.onclick = () => {
    // Expand every node in the tree
    walk(root, n => { markNodeOpen(n); });
    queueLayout(root);
    requestVisibilityRefresh();
    updateOutlineTree(root.id);
    if (!applyingUrlState){ scheduleUrlUpdate(); }
    requestPhysicsKick(1500);
  };
}
// Collapse All handled below with layout and physics adjustments
// Freeze the layout after collapsing to keep macros stable
const collapseBtn = document.getElementById('collapseBtn');
if (collapseBtn){
  collapseBtn.onclick = () => {
    walk(root,n=>{ if(n===root){ markNodeOpen(n); } else { markNodeClosed(n); } });
    queueLayout(root);
    requestVisibilityRefresh();
    updateOutlineTree(root.id);
    requestPhysicsKick();
    if (!applyingUrlState){
      scheduleUrlUpdate();
    }
    updateBreadcrumb(root);
  };
}
const themeBtnElem = document.getElementById('themeBtn');
function syncThemeControl(){
  if (!themeBtnElem) return;
  const label = themeBtnElem.querySelector('span');
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (label) label.textContent = isLight ? 'Dark' : 'Light';
  themeBtnElem.setAttribute('aria-pressed', isLight ? 'true' : 'false');
  themeBtnElem.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
}
if (themeBtnElem){
  themeBtnElem.onclick = () => {
    themeLocked = true;
    const html = document.documentElement;
    const isLight = html.getAttribute('data-theme') === 'light';
    const nextTheme = isLight ? 'dark' : 'light';
    html.setAttribute('data-theme', nextTheme);
    try { localStorage.setItem('atlas_theme', nextTheme); } catch(e) {}
    syncThemeControl();
    if (!applyingUrlState){ scheduleUrlUpdate(); }
  };
  syncThemeControl();
}
if (prefersDark){
  prefersDark.addEventListener('change', (event) => {
    if (themeLocked) return;
    const nextTheme = event.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nextTheme);
    syncThemeControl();
    if (!applyingUrlState){ scheduleUrlUpdate(); }
  });
}
if (searchSubtreeElem){
  searchSubtreeElem.checked = searchInSubtree;
  searchSubtreeElem.addEventListener('change', () => {
    searchInSubtree = searchSubtreeElem.checked;
    try { localStorage.setItem('atlas_search_subtree', searchInSubtree ? '1' : '0'); } catch(e) {}
    if (qElem.value.trim()){
      renderSearchResults(qElem.value);
    }
    scheduleUrlUpdate();
  });
}
if (searchTagsElem){
  searchTagsElem.checked = searchIncludeTags;
  searchTagsElem.addEventListener('change', () => {
    searchIncludeTags = searchTagsElem.checked;
    try { localStorage.setItem('atlas_search_tags', searchIncludeTags ? '1' : '0'); } catch(e) {}
    if (qElem.value.trim()){
      renderSearchResults(qElem.value);
    }
    scheduleUrlUpdate();
  });
}

const collapseOutlineBtn = document.getElementById('collapseOutlineBtn');
if (outlinePaneElem && collapseOutlineBtn){
  if (outlineCollapsed){
    outlinePaneElem.classList.add('collapsed');
    collapseOutlineBtn.textContent = 'Show';
    collapseOutlineBtn.setAttribute('aria-expanded', 'false');
    outlinePaneElem.setAttribute('aria-hidden', 'true');
  }
  collapseOutlineBtn.addEventListener('click', () => {
    const collapsed = outlinePaneElem.classList.toggle('collapsed');
    collapseOutlineBtn.textContent = collapsed ? 'Show' : 'Hide';
    collapseOutlineBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    outlinePaneElem.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    try { localStorage.setItem(OUTLINE_VISIBILITY_KEY, collapsed ? '1' : '0'); } catch(e) {}
    if (focusAnnounceElem){
      focusAnnounceElem.textContent = collapsed ? 'Outline collapsed' : 'Outline expanded';
    }
  });
}

const bucketTagsElem = document.getElementById('bucketTags');
if (bucketTagsElem){
  root.children.forEach((n,i)=>{
    const s=document.createElement('span'); s.className='pill'; s.textContent=n.name;
    s.style.borderColor = ringColour(i);
    s.onclick=()=>focusNode(n, { animate: true, ensureVisible: true, targetScale: 1.05 });
    bucketTagsElem.appendChild(s);
  });
}
function exportPNG(mult){
  const pixelRatio = window.devicePixelRatio || 1;
  const baseWidth = canvas.clientWidth || canvas.width;
  const baseHeight = canvas.clientHeight || canvas.height;
  const outputWidth = baseWidth * mult;
  const outputHeight = baseHeight * mult;
  exportCanvas.width = Math.round(outputWidth * pixelRatio);
  exportCanvas.height = Math.round(outputHeight * pixelRatio);
  const cameraState = { scale: scale * mult, offsetX, offsetY };
  showToast(`Rendering ${Math.round(mult * pixelRatio * 100)}% scale snapshot…`, { title: 'Export', duration: 1800 });
  exportCtx.save();
  exportCtx.scale(pixelRatio, pixelRatio);
  renderScene(exportCtx, outputWidth, outputHeight, cameraState, { skipMinimap: true, updateHitboxes: false });
  exportCtx.restore();
  const a=document.createElement('a'); a.href=exportCanvas.toDataURL('image/png'); a.download='infosec_universe_'+mult+'x.png'; a.click();
  showToast('Export ready—check your downloads.', { title: 'Export complete', duration: 2400 });
}
const png1Btn = document.getElementById('png1');
if (png1Btn){ png1Btn.onclick = () => exportPNG(1); }
const png2Btn = document.getElementById('png2');
if (png2Btn){ png2Btn.onclick = () => exportPNG(2); }
const png4Btn = document.getElementById('png4');
if (png4Btn){ png4Btn.onclick = () => exportPNG(4); }
window.addEventListener('keydown', e=>{
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
  const key = e.key;
  if (isTyping && key !== '?' && key !== 'Escape'){ return; }
  const step = 60/scale;
  const lower = key.toLowerCase();
  let cameraChanged = false;
  if (lower==='w'){ offsetY += step; cameraChanged = true; e.preventDefault(); }
  else if (lower==='s'){ offsetY -= step; cameraChanged = true; e.preventDefault(); }
  else if (lower==='a'){ offsetX += step; cameraChanged = true; e.preventDefault(); }
  else if (lower==='d'){ offsetX -= step; cameraChanged = true; e.preventDefault(); }
  else if (e.shiftKey && lower==='j'){ e.preventDefault(); for (let i=0;i<5;i++){ focusSiblingNode(1); } }
  else if (e.shiftKey && lower==='k'){ e.preventDefault(); for (let i=0;i<5;i++){ focusSiblingNode(-1); } }
  else if (lower==='h'){ e.preventDefault(); focusParentNode(); }
  else if (lower==='l'){ e.preventDefault(); focusFirstChild(); }
  else if (lower==='j'){ e.preventDefault(); focusSiblingNode(1); }
  else if (lower==='k'){ e.preventDefault(); focusSiblingNode(-1); }
  else if (key==='ArrowUp'){ e.preventDefault(); focusParentNode(); }
  else if (key==='ArrowDown'){ e.preventDefault(); focusFirstChild(); }
  else if (key==='ArrowLeft'){ e.preventDefault(); focusSiblingNode(-1); }
  else if (key==='ArrowRight'){ e.preventDefault(); focusSiblingNode(1); }
  else if (key==='+'){ animateZoom(clamp(scale*1.1,MIN_ZOOM,MAX_ZOOM), 0,0, 240); }
  else if (key==='-'){ animateZoom(clamp(scale/1.1,MIN_ZOOM,MAX_ZOOM), 0,0, 240); }
  else if (key==='Enter' && currentFocusNode){ focusNode(currentFocusNode, { animate: true, ensureVisible: true, frameChildren: true }); }
  else if (lower==='f' && currentFocusNode){ focusNode(currentFocusNode, { animate: true, ensureVisible: true }); }
  else if (key === 'Backspace'){ e.preventDefault(); const v = viewStack.pop(); if (v){ restoreView(v); } }
  if (cameraChanged && !applyingUrlState){ scheduleUrlUpdate(); }
});
function focusTo(n, targetScale=1, animated=true){
  const desiredX = (canvas.width/2)/targetScale - n.x;
  const desiredY = (canvas.height/2)/targetScale - n.y;
  if (!animated){ offsetX=desiredX; offsetY=desiredY; scale=targetScale; return; }
  const sx0=offsetX, sy0=offsetY, sc0=scale;
  const dx=desiredX-sx0, dy=desiredY-sy0, ds=targetScale-sc0;
  const t0=performance.now();
  const ease = t=> t<.5? 2*t*t : -1+(4-2*t)*t;
  (function anim(ts){
    const t = Math.min(1,(ts-t0)/240);
    offsetX = sx0 + dx*ease(t);
    offsetY = sy0 + dy*ease(t);
    scale   = sc0 + ds*ease(t);
    if (t<1) requestAnimationFrame(anim);
  })(t0);
}
let lastTime = performance.now();
// Physics can be toggled on/off via the Freeze button.  When disabled,
// tick() is skipped so node positions remain fixed.  This is useful for
// reading and presenting static layouts.
let physicsEnabled = true;

// Automatically enable and disable physics for a short period.  When the
// graph needs to rearrange (e.g. after expanding a node or performing a
// search), call kickPhysics(ms).  It enables physics immediately and then
// disables it again after the specified duration (default 1000 ms).  This
// keeps the layout fluid for a moment while settling into place, then
// freezes it so there is no continued drift during reading.
function kickPhysics(ms = 800){
  physicsEnabled = true;
  if (kickPhysics.timer) clearTimeout(kickPhysics.timer);
  kickPhysics.timer = setTimeout(() => {
    physicsEnabled = false;
  }, ms);
}
function loop(now){
  const dt = Math.min(0.05, (now-lastTime)/1000); lastTime=now;
  if (physicsEnabled){
    tick(dt);
  }
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setTimeout(()=>{
  // Assign fresh angular spans and positions for the initial view.  This
  // ensures macro buckets are evenly spaced around the root when only
  // the first level is open.  Without this call, angleHome values
  // inherited from previous layouts may place macros off‑screen.
  root.children.forEach(macro => assignAngles(macro));
  root.children.forEach(macro => layoutChildren(macro));
  centerOnRoot(true);
  // Kick physics on initial load so the partially expanded map settles,
  // then freeze.  Shorter duration improves responsiveness on initial
  // render.
  kickPhysics(1200);
}, 0);

// ----------------------------------------------------------------------------
// UI helpers: breadcrumb, filters, tooltip, minimap, help modal, sidebar collapse
// ----------------------------------------------------------------------------

// Finds a node by its id. Useful for cross-component lookups.
function findNodeById(id){ return nodeById.get(id) || null; }

function safeParseStateFromHash(){
  const rawHash = typeof window.location.hash === 'string' ? window.location.hash : '';
  const paramString = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  const params = new URLSearchParams(paramString);
  const coerceNumber = (value, fallback) => {
    if (value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const clampNumber = (value, min, max, fallback) => {
    const parsed = coerceNumber(value, fallback);
    if (!Number.isFinite(parsed)) return fallback;
    if (typeof min === 'number' && parsed < min) return min;
    if (typeof max === 'number' && parsed > max) return max;
    return parsed;
  };
  const tagsParam = params.get('tags');
  const openChains = [];
  const openParam = params.get('open');
  if (openParam){
    openParam.split(',').slice(0, 80).forEach(chain => {
      const ids = chain.split('.')
        .map(part => Number(part))
        .filter(id => Number.isInteger(id));
      if (ids.length){
        openChains.push(ids);
      }
    });
  }
  const nodeParam = params.get('node');
  const nodeId = nodeParam !== null ? Number(nodeParam) : null;
  return {
    nodeId: Number.isInteger(nodeId) ? nodeId : null,
    openChains,
    x: coerceNumber(params.get('x'), offsetX),
    y: coerceNumber(params.get('y'), offsetY),
    z: clampNumber(params.get('z'), MIN_ZOOM, MAX_ZOOM, scale),
    theme: params.get('theme'),
    lens: params.get('lens') === '1',
    subtree: params.get('subtree') === '1',
    tagsearch: params.get('tagsearch') === '1',
    tags: tagsParam === null ? null : tagsParam.split(',').map(t => t.trim()).filter(Boolean).slice(0, 50)
  };
}

function applyOpenChains(chains){
  walk(root, node => {
    if (node === root){
      markNodeOpen(node);
    } else {
      markNodeClosed(node);
    }
  });
  if (!Array.isArray(chains) || !chains.length) return;
  for (const chain of chains){
    if (!Array.isArray(chain) || !chain.length) continue;
    let current = root;
    let startIndex = chain[0] === root.id ? 1 : 0;
    for (let i = startIndex; i < chain.length; i++){
      const children = current && current.children;
      if (!Array.isArray(children) || !children.length){
        current = null;
        break;
      }
      const nextId = chain[i];
      const next = children.find(ch => ch.id === nextId);
      if (!next){
        current = null;
        break;
      }
      markNodeOpen(current);
      current = next;
    }
    if (current){
      markNodeOpen(current);
    }
  }
  if (changed){
    refreshVisibilityCaches();
  }
}

function updateUrlFromState(){
  if (applyingUrlState) return;
  const params = new URLSearchParams();
  const focus = lastFocusedNode || currentFocusNode || root;
  if (focus && Number.isFinite(focus.id)){
    params.set('node', String(focus.id));
  }
  const openList = [];
  const seenChains = new Set();
  for (const id of openNodeIds){
    if (id === root.id) continue;
    const node = findNodeById(id);
    if (!node || !node.parent) continue;
    const ids = [];
    let current = node;
    while (current && typeof current.id !== 'undefined'){
      ids.push(current.id);
      if (current === root) break;
      current = current.parent || null;
    }
    if (!ids.length || ids[ids.length - 1] !== root.id){
      continue;
    }
    const serialized = ids.reverse().join('.');
    if (!seenChains.has(serialized)){
      seenChains.add(serialized);
      openList.push(serialized);
      if (openList.length >= 50) break;
    }
  }
  if (openList.length){
    params.set('open', openList.join(','));
  }
  if (Number.isFinite(offsetX)){
    params.set('x', offsetX.toFixed(2));
  }
  if (Number.isFinite(offsetY)){
    params.set('y', offsetY.toFixed(2));
  }
  const safeScale = Number.isFinite(scale) ? clamp(scale, MIN_ZOOM, MAX_ZOOM) : clamp(1, MIN_ZOOM, MAX_ZOOM);
  params.set('z', safeScale.toFixed(3));
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  params.set('theme', theme);
  if (fisheyeEnabled){
    params.set('lens', '1');
  }
  if (activeTags.size){
    params.set('tags', Array.from(activeTags).slice(0, 50).join(','));
  }
  if (searchInSubtree){
    params.set('subtree', '1');
  }
  if (searchIncludeTags){
    params.set('tagsearch', '1');
  }
  const serialized = params.toString();
  const nextHash = serialized ? `#${serialized}` : '#';
  if (window.location.hash === nextHash) return;
  try {
    history.replaceState(null, '', nextHash);
  } catch(e) {
    window.location.hash = nextHash;
  }
}

const scheduleUrlUpdate = throttle(() => updateUrlFromState(), 250);

function restoreStateFromUrl(){
  if (!window.location.hash){
    updateBreadcrumb(root);
    return;
  }
  applyingUrlState = true;
  let focusTarget = root;
  try {
    const state = safeParseStateFromHash();
    if (state.theme){
      document.documentElement.setAttribute('data-theme', state.theme);
      try { localStorage.setItem('atlas_theme', state.theme); } catch(e) {}
      syncThemeControl();
    }
    fisheyeEnabled = state.lens;
    if (fisheyeToggleBtn){
      fisheyeToggleBtn.classList.toggle('active', fisheyeEnabled);
      fisheyeToggleBtn.setAttribute('aria-pressed', fisheyeEnabled ? 'true' : 'false');
    }
    searchInSubtree = state.subtree;
    searchIncludeTags = state.tagsearch;
    if (searchSubtreeElem){
      searchSubtreeElem.checked = searchInSubtree;
    }
    if (searchTagsElem){
      searchTagsElem.checked = searchIncludeTags;
    }
    if (Number.isFinite(state.x)) offsetX = state.x;
    if (Number.isFinite(state.y)) offsetY = state.y;
    if (Number.isFinite(state.z)) scale = clamp(state.z, MIN_ZOOM, MAX_ZOOM);
    if (state.tags !== null){
      activeTags.clear();
      state.tags.forEach(t => activeTags.add(t));
      updateTagFiltersUI();
      applyTagFilters();
      persistTagFilters();
    }
    applyOpenChains(state.openChains);
    walk(root, node => {
      if (node.open && node.children && node.children.length > 0){
        queueLayout(node, { immediate: true });
      }
    });
    const target = state.nodeId !== null ? findNodeById(state.nodeId) : root;
    focusTarget = target || root;
    updateOutlineTree(focusTarget.id);
  } catch(error) {
    console.error('Failed to restore state from URL', error);
    updateOutlineTree(root.id);
    focusTarget = root;
  } finally {
    applyingUrlState = false;
    focusNode(focusTarget, { animate: false, ensureVisible: true });
  }
}

// Update breadcrumb trail based on a node's path
function updateBreadcrumb(n){
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  bc.innerHTML = '';
  if (!n) return;
  currentFocusNode = n;
  lastFocusedNode = n;
  updateActivePath(n);
  currentPath.length = 0;
  pathTo(n).forEach(node => currentPath.push(node));
  renderDetailsPanel(n);
  const segments = [];
  if (currentPath.length <= 5){
    currentPath.forEach(node => segments.push(node));
  } else {
    segments.push(currentPath[0]);
    segments.push(currentPath[1]);
    segments.push('ellipsis');
    segments.push(currentPath[currentPath.length - 2]);
    segments.push(currentPath[currentPath.length - 1]);
  }
  segments.forEach((segment, idx) => {
    if (segment === 'ellipsis'){
      const ellipsis = document.createElement('span');
      ellipsis.className = 'ellipsis';
      ellipsis.textContent = '…';
      bc.appendChild(ellipsis);
      if (idx < segments.length - 1){
        const sep = document.createElement('span');
        sep.textContent = '›';
        sep.className = 'separator';
        bc.appendChild(sep);
      }
      return;
    }
    const span = document.createElement('span');
    span.textContent = fallbackText(segment, 'name');
    span.className = 'crumb';
    if (segment === n){
      span.classList.add('active');
      span.setAttribute('aria-current', 'page');
    }
    span.onclick = () => { focusNode(segment, { animate: true, ensureVisible: true }); };
    bc.appendChild(span);
    if (idx < segments.length -1){
      const sep = document.createElement('span');
      sep.textContent = '›';
      sep.className = 'separator';
      bc.appendChild(sep);
    }
  });
  updateOutlineSelection();
  announceFocus(n);
  if (!applyingUrlState){
    scheduleUrlUpdate();
  }
}

function ensureDetailsPopover(){
  if (detailsPopoverElem) return detailsPopoverElem;
  const popover = document.createElement('div');
  popover.className = 'details-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-modal', 'false');
  popover.setAttribute('aria-hidden', 'true');
  popover.setAttribute('aria-live', 'polite');
  popover.hidden = true;

  const header = document.createElement('div');
  header.className = 'details-header';
  detailsCloseBtn = document.createElement('button');
  detailsCloseBtn.type = 'button';
  detailsCloseBtn.className = 'details-close';
  detailsCloseBtn.textContent = 'Close';
  detailsCloseBtn.addEventListener('click', () => hideDetailsPopover());
  header.appendChild(detailsCloseBtn);
  popover.appendChild(header);

  detailsContentElem = document.createElement('div');
  detailsContentElem.id = 'detailsPopoverContent';
  detailsContentElem.className = 'details-content';
  popover.appendChild(detailsContentElem);

  popover.addEventListener('keydown', (event) => {
    if (event.key === 'Escape'){
      event.preventDefault();
      hideDetailsPopover();
    }
  });

  document.body.appendChild(popover);
  detailsPopoverElem = popover;
  return popover;
}

function hideDetailsPopover(){
  if (!detailsPopoverElem || detailsPopoverElem.hidden) return;
  detailsPopoverElem.hidden = true;
  detailsPopoverElem.setAttribute('aria-hidden', 'true');
  detailsPopoverElem.style.left = '';
  detailsPopoverElem.style.top = '';
  detailsPopoverElem.style.right = '';
  detailsLastAnchorRect = null;
  const restoreTarget = detailsReturnFocus;
  detailsReturnFocus = null;
  if (restoreTarget && typeof restoreTarget.focus === 'function'){
    requestAnimationFrame(() => {
      if (document.contains(restoreTarget)){
        restoreTarget.focus();
      } else if (document.body && typeof document.body.focus === 'function'){
        document.body.focus();
      }
    });
  }
  detailsJustOpened = false;
}

function positionDetailsPopover(anchorRect){
  if (!detailsPopoverElem) return;
  const margin = 16;
  if (anchorRect){
    const size = detailsPopoverElem.getBoundingClientRect();
    let left = anchorRect.left + window.scrollX;
    let top = anchorRect.bottom + window.scrollY + 8;
    const maxLeft = window.scrollX + window.innerWidth - size.width - margin;
    const maxTop = window.scrollY + window.innerHeight - size.height - margin;
    left = Math.min(Math.max(window.scrollX + margin, left), maxLeft);
    top = Math.min(Math.max(window.scrollY + margin, top), maxTop);
    detailsPopoverElem.style.left = `${left}px`;
    detailsPopoverElem.style.top = `${top}px`;
    detailsPopoverElem.style.right = 'auto';
  } else {
    detailsPopoverElem.style.right = `${margin}px`;
    detailsPopoverElem.style.top = `${margin}px`;
    detailsPopoverElem.style.left = 'auto';
  }
}

function renderDetailsPanel(node, options = {}){
  const shouldOpen = !!options.open;
  const popoverIsOpen = detailsPopoverElem && !detailsPopoverElem.hidden;
  if (!shouldOpen && !popoverIsOpen){
    return;
  }

  const popover = ensureDetailsPopover();
  if (!detailsContentElem) return;

  detailsContentElem.innerHTML = '';
  if (!node){
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Select a node to inspect its context.';
    detailsContentElem.appendChild(empty);
  } else {
    const title = document.createElement('h2');
    title.textContent = fallbackText(node, 'name');
    detailsContentElem.appendChild(title);

    const pathNodes = currentPath.map(p => fallbackText(p, 'name')).slice(1, -1).join(' › ');
    if (pathNodes){
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = pathNodes;
      detailsContentElem.appendChild(meta);
    }

    if (node.tags && node.tags.size > 0){
      const tagLine = document.createElement('div');
      tagLine.className = 'muted';
      tagLine.textContent = 'Tags: ' + Array.from(node.tags).join(', ');
      detailsContentElem.appendChild(tagLine);
    }

    const neighbors = document.createElement('div');
    neighbors.className = 'neighbor-section';
    neighbors.setAttribute('role', 'navigation');
    neighbors.setAttribute('aria-label', 'Neighbor nodes');

    function appendGroup(label, nodes){
      const heading = document.createElement('h3');
      heading.textContent = label;
      neighbors.appendChild(heading);
      if (!nodes.length){
        const emptyGroup = document.createElement('div');
        emptyGroup.className = 'neighbor-empty';
        emptyGroup.textContent = 'None';
        neighbors.appendChild(emptyGroup);
        return;
      }
      const list = document.createElement('ul');
      list.className = 'nav-group';
      list.setAttribute('role', 'list');
      nodes.forEach(targetNode => {
        const item = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'nav-chip';
        btn.textContent = fallbackText(targetNode, 'name');
        btn.onclick = () => focusNode(targetNode, { animate: true, ensureVisible: true });
        item.appendChild(btn);
        list.appendChild(item);
      });
      neighbors.appendChild(list);
    }

    const parentNode = node.parent ? [node.parent] : [];
    appendGroup('Parent', parentNode);
    const siblings = node.parent ? node.parent.children.filter(ch => ch !== node) : [];
    appendGroup('Siblings', siblings);
    appendGroup('Children', node.children || []);
    detailsContentElem.appendChild(neighbors);

    const stats = document.createElement('div');
    stats.className = 'muted';
    stats.textContent = `${(node.children || []).length} child${(node.children || []).length === 1 ? '' : 'ren'} • depth ${node.depth}`;
    detailsContentElem.appendChild(stats);
  }

  const labelText = node ? `Context for ${fallbackText(node, 'name')}` : 'Context unavailable';
  popover.setAttribute('aria-label', labelText);
  if (detailsContentElem.id){
    popover.setAttribute('aria-describedby', detailsContentElem.id);
  }
  popover.setAttribute('aria-hidden', 'false');

  if (shouldOpen){
    const anchorRect = options.anchorRect || (options.anchor instanceof HTMLElement ? options.anchor.getBoundingClientRect() : null);
    detailsLastAnchorRect = anchorRect || null;
    const restore = options.restoreFocus instanceof HTMLElement ? options.restoreFocus : (options.anchor instanceof HTMLElement ? options.anchor : document.activeElement);
    detailsReturnFocus = restore;
    detailsPopoverElem.hidden = false;
    detailsJustOpened = true;
    requestAnimationFrame(() => {
      if (!detailsPopoverElem) return;
      detailsPopoverElem.hidden = false;
      positionDetailsPopover(detailsLastAnchorRect);
      detailsJustOpened = false;
      if (detailsCloseBtn){
        detailsCloseBtn.focus();
      }
    });
  } else if (detailsPopoverElem) {
    detailsPopoverElem.hidden = false;
    requestAnimationFrame(() => positionDetailsPopover(detailsLastAnchorRect));
  }
}

function renderOutlineTree(){
  if (!outlineTreeElem) return;
  const previousFocus = outlineLastFocusedId || (lastFocusedNode ? lastFocusedNode.id : root.id);
  outlineTreeElem.innerHTML = '';
  outlineItems.clear();
  outlineOrder = [];
  const build = (node, depth) => {
    if (node.syntheticOverview && !showSyntheticNodes) return null;
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.dataset.nodeId = node.id;
    li.setAttribute('aria-level', String(depth + 1));
    const row = document.createElement('div');
    row.className = 'tree-item';
    row.dataset.nodeId = node.id;
    row.tabIndex = -1;
    const hasChildren = node.children && node.children.length > 0;
    if (hasChildren){
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tree-toggle';
      toggle.textContent = node.open ? '−' : '+';
      toggle.setAttribute('aria-label', node.open ? 'Collapse branch' : 'Expand branch');
      toggle.onclick = (ev) => {
        ev.stopPropagation();
        toggleNode(node, true);
      };
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'tree-toggle';
      spacer.style.visibility = 'hidden';
      spacer.textContent = '·';
      row.appendChild(spacer);
    }
    const label = document.createElement('div');
    label.className = 'tree-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = fallbackText(node, 'name');
    if (!visible(node)){
      nameSpan.style.opacity = '0.6';
    }
    label.appendChild(nameSpan);
    if (node.syntheticOverview){
      const badge = document.createElement('span');
      badge.className = 'overview-badge';
      badge.textContent = 'Overview';
      label.appendChild(badge);
    }
    if (hasChildren){
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = String(node.children.length);
      label.appendChild(count);
    }
    row.appendChild(label);
    row.addEventListener('click', () => {
      outlineLastFocusedId = node.id;
      focusNode(node, { animate: true, ensureVisible: true });
      row.focus();
    });
    row.addEventListener('focus', () => {
      outlineLastFocusedId = node.id;
    });
    li.appendChild(row);
    outlineItems.set(node.id, row);
    outlineOrder.push(node.id);
    if (hasChildren){
      li.setAttribute('aria-expanded', String(!!node.open));
      if (node.open){
        const group = document.createElement('ul');
        group.className = 'tree-children';
        group.setAttribute('role', 'group');
        node.children.forEach(child => {
          const childLi = build(child, depth + 1);
          if (childLi){ group.appendChild(childLi); }
        });
        li.appendChild(group);
      }
    } else {
      li.setAttribute('aria-expanded', 'false');
    }
    return li;
  };
  outlineTreeElem.appendChild(build(root, 0));
  outlineLastFocusedId = outlineItems.has(previousFocus) ? previousFocus : (lastFocusedNode ? lastFocusedNode.id : root.id);
  updateOutlineSelection();
}

function updateOutlineSelection(){
  if (!outlineTreeElem) return;
  const focusId = lastFocusedNode ? lastFocusedNode.id : root.id;
  outlineOrder.forEach(id => {
    const row = outlineItems.get(id);
    if (!row) return;
    const selected = id === focusId;
    row.setAttribute('aria-selected', selected ? 'true' : 'false');
    row.tabIndex = selected ? 0 : -1;
  });
  const status = outlineStatusElem;
  if (status){
    status.textContent = `Focused ${fallbackText(lastFocusedNode || root, 'name')}`;
  }
  if (outlineTreeElem === document.activeElement){
    const row = outlineItems.get(focusId);
    if (row && row !== document.activeElement){
      row.focus();
    }
  }
}

function announceFocus(node){
  if (focusAnnounceElem){
    focusAnnounceElem.textContent = `${fallbackText(node, 'name')} focused`;
  }
  if (outlineStatusElem){
    outlineStatusElem.textContent = `${fallbackText(node, 'name')} focused`;
  }
}

function updateOutlineTree(focusId){
  renderOutlineTree();
  if (focusId && outlineItems.has(focusId)){
    const targetRow = outlineItems.get(focusId);
    if (targetRow){
      requestAnimationFrame(() => targetRow.focus());
    }
  }
}

function moveOutlineFocus(delta){
  if (!outlineOrder.length) return;
  const currentId = outlineLastFocusedId || (lastFocusedNode ? lastFocusedNode.id : outlineOrder[0]);
  let index = outlineOrder.indexOf(currentId);
  if (index === -1) index = 0;
  let nextIndex = index + delta;
  nextIndex = Math.max(0, Math.min(outlineOrder.length - 1, nextIndex));
  const nextId = outlineOrder[nextIndex];
  const row = outlineItems.get(nextId);
  if (row){
    outlineLastFocusedId = nextId;
    row.focus();
  }
}

function handleOutlineKeyDown(event){
  const row = event.target.closest('.tree-item');
  if (!row) return;
  const nodeId = Number(row.dataset.nodeId);
  const node = findNodeById(nodeId);
  if (!node) return;
  switch(event.key){
    case 'ArrowDown':
      event.preventDefault();
      moveOutlineFocus(1);
      break;
    case 'ArrowUp':
      event.preventDefault();
      moveOutlineFocus(-1);
      break;
    case 'ArrowRight':
      if (node.children && node.children.length){
        event.preventDefault();
        if (!node.open){
          outlineLastFocusedId = node.id;
          toggleNode(node, true);
        } else {
          const childId = node.children[0].id;
          outlineLastFocusedId = childId;
          const childRow = outlineItems.get(childId);
          if (childRow){
            childRow.focus();
          }
        }
      }
      break;
    case 'ArrowLeft':
      if (node.children && node.children.length && node.open){
        event.preventDefault();
        outlineLastFocusedId = node.id;
        toggleNode(node, true);
      } else if (node.parent){
        event.preventDefault();
        outlineLastFocusedId = node.parent.id;
        focusNode(node.parent, { animate: true, ensureVisible: true });
        const parentRow = outlineItems.get(node.parent.id);
        if (parentRow){ parentRow.focus(); }
      }
      break;
    case 'Home':
      event.preventDefault();
      outlineLastFocusedId = outlineOrder[0];
      const first = outlineItems.get(outlineOrder[0]);
      if (first){ first.focus(); }
      break;
    case 'End':
      event.preventDefault();
      outlineLastFocusedId = outlineOrder[outlineOrder.length - 1];
      const last = outlineItems.get(outlineOrder[outlineOrder.length - 1]);
      if (last){ last.focus(); }
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      focusNode(node, { animate: true, ensureVisible: true, frameChildren: true });
      break;
    default:
      break;
  }
}

if (outlineTreeElem){
  outlineTreeElem.addEventListener('focus', () => {
    const focusId = outlineLastFocusedId || (lastFocusedNode ? lastFocusedNode.id : root.id);
    const row = outlineItems.get(focusId);
    if (row){ row.focus(); }
  });
  outlineTreeElem.addEventListener('keydown', handleOutlineKeyDown);
}

// Render Filters UI for macro buckets
function persistMacroVisibility(){
  try { localStorage.setItem(MACRO_VISIBILITY_STORAGE_KEY, JSON.stringify(macroVisibility)); } catch(e) {}
}

function persistTagFilters(){
  try { localStorage.setItem(TAG_FILTER_STORAGE_KEY, JSON.stringify(Array.from(activeTags).sort())); } catch(e) {}
}

function updateFiltersUI(){
  const filtersElem = document.getElementById('filters');
  if (!filtersElem) return;
  filtersElem.innerHTML = '';
  root.children.forEach(n => {
    const label = document.createElement('label');
    label.className = 'filter-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = macroVisibility[n.id];
    label.classList.toggle('is-active', cb.checked);
    cb.onchange = () => {
      macroVisibility[n.id] = cb.checked;
      label.classList.toggle('is-active', cb.checked);
      persistMacroVisibility();
      refreshVisibilityCaches();
      updateOutlineTree(lastFocusedNode ? lastFocusedNode.id : root.id);
      draw();
      if (!applyingUrlState){ scheduleUrlUpdate(); }
    };
    const span = document.createElement('span');
    span.textContent = fallbackText(n, 'name');
    label.appendChild(cb);
    label.appendChild(span);
    filtersElem.appendChild(label);
  });
}


function applySyntheticVisibilityChanges(){
  refreshVisibilityCaches();
  updateOutlineTree(lastFocusedNode ? lastFocusedNode.id : root.id);
  draw();
  updateMinimap();
  if (!applyingUrlState){ scheduleUrlUpdate(); }
}

function updateOverviewControls(){
  if (!overviewToggleRowElem) return;
  overviewToggleRowElem.innerHTML = '';
  const showLabel = document.createElement('label');
  showLabel.className = 'muted';
  const showInput = document.createElement('input');
  showInput.type = 'checkbox';
  showInput.checked = showSyntheticNodes;
  showInput.addEventListener('change', () => {
    showSyntheticNodes = showInput.checked;
    try { localStorage.setItem(OVERVIEW_VISIBILITY_KEY, showSyntheticNodes ? 'shown' : 'hidden'); } catch(e) {}
    if (!showSyntheticNodes){
      dimSyntheticNodes = false;
      try { localStorage.setItem(OVERVIEW_DIM_KEY, '0'); } catch(e) {}
    }
    updateOverviewControls();
    applySyntheticVisibilityChanges();
  });
  showLabel.appendChild(showInput);
  showLabel.appendChild(document.createTextNode(' Display overview summaries'));
  overviewToggleRowElem.appendChild(showLabel);

  const dimLabel = document.createElement('label');
  dimLabel.className = 'muted';
  const dimInput = document.createElement('input');
  dimInput.type = 'checkbox';
  dimInput.checked = dimSyntheticNodes;
  dimInput.disabled = !showSyntheticNodes;
  dimInput.addEventListener('change', () => {
    dimSyntheticNodes = dimInput.checked;
    try { localStorage.setItem(OVERVIEW_DIM_KEY, dimSyntheticNodes ? '1' : '0'); } catch(e) {}
    applySyntheticVisibilityChanges();
  });
  dimLabel.appendChild(dimInput);
  dimLabel.appendChild(document.createTextNode(' Dim overview nodes'));
  overviewToggleRowElem.appendChild(dimLabel);
}


// Render subcategory quick links (depth‑2 categories).  These pills make it
// easy to jump directly to common subdomains without typing in the search
// field.  Clicking a pill expands just that branch and recentres the view.
function updateSubFiltersUI(){
  const subElem = document.getElementById('subFilters');
  if (!subElem) return;
  subElem.innerHTML = '';
  // Iterate over each macro bucket and its immediate children (depth‑2 categories)
  root.children.forEach((macro) => {
    macro.children.forEach((child) => {
      const pill = document.createElement('span');
      pill.className = 'sub-pill';
      // Colour the pill border according to its macro bucket for orientation
      pill.style.borderColor = ringColour(macro.ringIndex);
      pill.textContent = fallbackText(child, 'name');
      pill.onclick = () => {
        focusNode(child, { animate: false, ensureVisible: true, exclusive: true });
        triggerNodeFlash(child, 900);
      };
      subElem.appendChild(pill);
    });
  });
}

function applyTagFilters(){
  const hasActive = activeTags.size > 0;
  function mark(node){
    let direct = false;
    if (node.tags && node.tags.size > 0){
      for (const tag of node.tags){
        if (activeTags.has(tag)){ direct = true; break; }
      }
    }
    let childMatch = false;
    (node.children || []).forEach(child => {
      if (mark(child)) childMatch = true;
    });
    const relevant = direct || childMatch;
    node.dimmed = hasActive && !relevant;
    return relevant;
  }
  mark(root);
}

function updateTagFiltersUI(){
  const tagElem = document.getElementById('tagFilters');
  if (!tagElem) return;
  tagElem.innerHTML = '';
  const sorted = Array.from(allTags).sort();
  if (sorted.length === 0){
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Tags appear automatically as topics are annotated.';
    tagElem.appendChild(empty);
    return;
  }
  sorted.forEach(tag => {
    const label = document.createElement('label');
    label.className = 'filter-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = tag;
    input.checked = activeTags.has(tag);
    label.classList.toggle('is-active', input.checked);
    input.onchange = () => {
      if (input.checked){ activeTags.add(tag); } else { activeTags.delete(tag); }
      applyTagFilters();
      label.classList.toggle('is-active', input.checked);
      persistTagFilters();
      draw();
      if (!applyingUrlState){ scheduleUrlUpdate(); }
    };
    const span = document.createElement('span');
    span.textContent = tag;
    label.appendChild(input);
    label.appendChild(span);
    tagElem.appendChild(label);
  });
}

if (clearFiltersBtn){
  clearFiltersBtn.addEventListener('click', () => {
    let visibilityChanged = false;
    root.children.forEach(n => {
      if (!macroVisibility[n.id]){
        macroVisibility[n.id] = true;
        visibilityChanged = true;
      }
    });
    const hadActiveTags = activeTags.size > 0;
    if (hadActiveTags){
      activeTags.clear();
    }
    persistMacroVisibility();
    persistTagFilters();
    applyTagFilters();
    refreshVisibilityCaches();
    updateFiltersUI();
    updateTagFiltersUI();
    updateOutlineTree(lastFocusedNode ? lastFocusedNode.id : root.id);
    draw();
    if (!applyingUrlState){ scheduleUrlUpdate(); }
    if (visibilityChanged || hadActiveTags){
      showToast('All filters restored to their defaults.', { title: 'Filters reset', duration: 2600 });
    }
  });
}

// Real‑time alert feed.  Fetches the latest CVEs from a public API via a
// permissive proxy.  If the request fails (likely due to CORS or network
// restrictions), falls back to a static sample list.  Each alert shows the
// CVE identifier and a truncated summary.  Users can click the refresh
// button to reload the feed.
// Removed real‑time alert feed: function stub replaced with no‑op.
function fetchRealTimeFeed(){
  // Intentionally empty. Real‑time alerts have been removed.
}

// Tooltip handling: show/hide
const tooltipElem = document.getElementById('tooltip');
function showTooltip(n, pageX, pageY){
  if (!tooltipElem || !n) return;
  // Clear previous content
  tooltipElem.innerHTML = '';
  tooltipElem.style.display = 'block';
  // Node name (bold)
  const title = document.createElement('div');
  title.textContent = fallbackText(n, 'name');
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  tooltipElem.appendChild(title);
  // Full path (excluding root for brevity)
  const pathNodes = pathTo(n).slice(1); // skip root
  if (pathNodes.length > 1){
    const pathDiv = document.createElement('div');
    pathDiv.style.color = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    pathDiv.style.fontSize = '11px';
    pathDiv.style.marginBottom = '4px';
    pathDiv.textContent = pathNodes.map(node => fallbackText(node, 'name')).join(' › ');
    tooltipElem.appendChild(pathDiv);
  }
  if (n.tags && n.tags.size > 0){
    const tagDiv = document.createElement('div');
    tagDiv.style.fontSize = '11px';
    tagDiv.style.marginBottom = '4px';
    tagDiv.textContent = 'Tags: ' + Array.from(n.tags).join(', ');
    tooltipElem.appendChild(tagDiv);
  }
  const provenance = document.createElement('div');
  provenance.className = 'badge';
  provenance.textContent = n.syntheticOverview ? 'Synthetic overview summary' : 'Curated dataset node';
  tooltipElem.appendChild(provenance);
  // Children count
  if (n.children && n.children.length > 0){
    const countDiv = document.createElement('div');
    countDiv.style.fontSize = '11px';
    countDiv.style.color = getComputedStyle(document.documentElement).getPropertyValue('--muted');
    countDiv.textContent = `${n.children.length} child${n.children.length===1?'':'ren'}`;
    tooltipElem.appendChild(countDiv);
  }
  // Position tooltip near the cursor, offset to avoid covering the pointer
  tooltipElem.style.left = (pageX + 12) + 'px';
  tooltipElem.style.top = (pageY + 12) + 'px';
}
function hideTooltip(){ if (tooltipElem) tooltipElem.style.display = 'none'; }

function showTouchPreview(node){
  if (!touchPreviewElem || !node) return;
  hideTooltip();
  touchPreviewElem.innerHTML = '';
  const header = document.createElement('header');
  const title = document.createElement('h3');
  title.textContent = fallbackText(node, 'name');
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss node preview');
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => hideTouchPreview();
  header.appendChild(title);
  header.appendChild(closeBtn);
  touchPreviewElem.appendChild(header);
  const pathNodes = pathTo(node).slice(1);
  if (pathNodes.length){
    const pathDiv = document.createElement('div');
    pathDiv.className = 'path';
    pathDiv.textContent = pathNodes.map(p => fallbackText(p, 'name')).join(' › ');
    touchPreviewElem.appendChild(pathDiv);
  }
  if (node.tags && node.tags.size){
    const tagsDiv = document.createElement('div');
    tagsDiv.className = 'tags';
    node.tags.forEach(tag => {
      const tagChip = document.createElement('span');
      tagChip.textContent = tag;
      tagsDiv.appendChild(tagChip);
    });
    touchPreviewElem.appendChild(tagsDiv);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  const details = [];
  details.push(node.syntheticOverview ? 'Synthetic overview summary' : 'Curated dataset node');
  if (node.children && node.children.length){
    details.push(`${node.children.length} child${node.children.length === 1 ? '' : 'ren'}`);
  }
  meta.textContent = details.join(' • ');
  touchPreviewElem.appendChild(meta);
  touchPreviewElem.hidden = false;
  touchPreviewElem.classList.add('visible');
  touchPreviewNode = node;
  suppressNextClick = true;
  if (touchPreviewTimer){
    clearTimeout(touchPreviewTimer);
  }
  touchPreviewTimer = setTimeout(() => hideTouchPreview(), 6000);
}

function hideTouchPreview(){
  if (!touchPreviewElem) return;
  if (touchPreviewTimer){
    clearTimeout(touchPreviewTimer);
    touchPreviewTimer = null;
  }
  touchPreviewElem.classList.remove('visible');
  touchPreviewElem.hidden = true;
  touchPreviewElem.innerHTML = '';
  touchPreviewNode = null;
}

// Mini‑map update. Draw small representation of nodes and a viewport rectangle. Save bounds for interaction.
function computeVisibleBounds(nodes){
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  });
  const margin = 80;
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin
  };
}

function drawMinimapTo(canvasEl, nodes, bounds){
  if (!canvasEl) return null;
  const ctxMini = canvasEl.getContext('2d');
  if (!ctxMini) return null;
  const { minX, minY, maxX, maxY } = bounds;
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const cw = canvasEl.width;
  const ch = canvasEl.height;
  const scaleFactor = Math.min(cw / worldW, ch / worldH);
  const offsetXMini = (cw - worldW * scaleFactor) / 2;
  const offsetYMini = (ch - worldH * scaleFactor) / 2;
  ctxMini.clearRect(0, 0, cw, ch);
  nodes.forEach(n => {
    const cat = nodeCategoryIndex(n);
    ctxMini.fillStyle = ringColour(cat);
    const x = offsetXMini + (n.x - minX) * scaleFactor;
    const y = offsetYMini + (n.y - minY) * scaleFactor;
    ctxMini.beginPath();
    ctxMini.arc(x, y, 3, 0, Math.PI * 2);
    ctxMini.fill();
  });
  if (lastFocusedNode){
    const accent = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ff9b6a').trim() || '#ff9b6a';
    const x = offsetXMini + (lastFocusedNode.x - minX) * scaleFactor;
    const y = offsetYMini + (lastFocusedNode.y - minY) * scaleFactor;
    ctxMini.strokeStyle = accent;
    ctxMini.lineWidth = 2;
    ctxMini.beginPath();
    ctxMini.arc(x, y, 6, 0, Math.PI * 2);
    ctxMini.stroke();
  }
  const tl = screenToWorld(0, 0);
  const br = screenToWorld(canvas.width, canvas.height);
  const vw = br[0] - tl[0];
  const vh = br[1] - tl[1];
  const vx = offsetXMini + (tl[0] - minX) * scaleFactor;
  const vy = offsetYMini + (tl[1] - minY) * scaleFactor;
  const vwMini = vw * scaleFactor;
  const vhMini = vh * scaleFactor;
  ctxMini.strokeStyle = 'rgba(234,179,8,0.8)';
  ctxMini.lineWidth = 2;
  ctxMini.strokeRect(vx, vy, vwMini, vhMini);
  return { minX, minY, scale: scaleFactor, offsetX: offsetXMini, offsetY: offsetYMini };
}

function updateMinimap(){
  const nodes = collectVisible();
  const mini = document.getElementById('minimap');
  if (!nodes.length){
    if (mini){
      const ctxMini = mini.getContext('2d');
      if (ctxMini){ ctxMini.clearRect(0, 0, mini.width, mini.height); }
    }
    if (minimapTouchCanvas){
      const ctxTouch = minimapTouchCanvas.getContext('2d');
      if (ctxTouch){ ctxTouch.clearRect(0, 0, minimapTouchCanvas.width, minimapTouchCanvas.height); }
    }
    miniMapBounds = null;
    miniMapTouchBounds = null;
    return;
  }
  const bounds = computeVisibleBounds(nodes);
  miniMapBounds = drawMinimapTo(mini, nodes, bounds);
  miniMapTouchBounds = drawMinimapTo(minimapTouchCanvas, nodes, bounds);
}

// Mini‑map interaction: drag on minimap to recenter main view
let draggingMini = false;
let activeMiniCanvas = null;
const minimapCanvas = document.getElementById('minimap');

function pointerPositionFromEvent(event){
  if (event.touches && event.touches.length){
    return { clientX: event.touches[0].clientX, clientY: event.touches[0].clientY };
  }
  if (event.changedTouches && event.changedTouches.length){
    return { clientX: event.changedTouches[0].clientX, clientY: event.changedTouches[0].clientY };
  }
  return { clientX: event.clientX, clientY: event.clientY };
}

function beginMinimapDrag(event, canvasEl){
  const bounds = canvasEl === minimapTouchCanvas ? miniMapTouchBounds : miniMapBounds;
  if (!bounds) return;
  draggingMini = true;
  activeMiniCanvas = canvasEl;
  handleMiniDrag(event, bounds, canvasEl);
}

function continueMinimapDrag(event){
  if (!draggingMini || !activeMiniCanvas) return;
  const bounds = activeMiniCanvas === minimapTouchCanvas ? miniMapTouchBounds : miniMapBounds;
  handleMiniDrag(event, bounds, activeMiniCanvas);
}

function endMinimapDrag(){
  draggingMini = false;
  activeMiniCanvas = null;
}

if (minimapCanvas){
  minimapCanvas.addEventListener('mousedown', (e) => beginMinimapDrag(e, minimapCanvas));
  minimapCanvas.addEventListener('mousemove', (e) => continueMinimapDrag(e));
  minimapCanvas.addEventListener('touchstart', (e) => beginMinimapDrag(e, minimapCanvas), { passive: true });
  minimapCanvas.addEventListener('touchmove', (e) => {
    if (!draggingMini || activeMiniCanvas !== minimapCanvas) return;
    continueMinimapDrag(e);
    e.preventDefault();
  }, { passive: false });
}
if (minimapTouchCanvas){
  minimapTouchCanvas.addEventListener('mousedown', (e) => beginMinimapDrag(e, minimapTouchCanvas));
  minimapTouchCanvas.addEventListener('mousemove', (e) => continueMinimapDrag(e));
  minimapTouchCanvas.addEventListener('touchstart', (e) => beginMinimapDrag(e, minimapTouchCanvas), { passive: true });
  minimapTouchCanvas.addEventListener('touchmove', (e) => {
    if (!draggingMini || activeMiniCanvas !== minimapTouchCanvas) return;
    continueMinimapDrag(e);
    e.preventDefault();
  }, { passive: false });
}
window.addEventListener('mouseup', endMinimapDrag);
window.addEventListener('touchend', endMinimapDrag);
window.addEventListener('touchcancel', endMinimapDrag);

function handleMiniDrag(event, bounds, canvasEl){
  if (!bounds || !canvasEl) return;
  const point = pointerPositionFromEvent(event);
  if (!point) return;
  const rect = canvasEl.getBoundingClientRect();
  const x = point.clientX - rect.left;
  const y = point.clientY - rect.top;
  const wx = (x - bounds.offsetX) / bounds.scale + bounds.minX;
  const wy = (y - bounds.offsetY) / bounds.scale + bounds.minY;
  offsetX = (canvas.width / 2) / scale - wx;
  offsetY = (canvas.height / 2) / scale - wy;
  if (!applyingUrlState){
    scheduleUrlUpdate();
  }
}

function closeMinimapTouchPanel(){
  if (!minimapTouchPanel) return;
  minimapTouchPanel.hidden = true;
  minimapTouchPanel.setAttribute('aria-hidden', 'true');
  if (minimapTouchToggle){
    minimapTouchToggle.setAttribute('aria-expanded', 'false');
  }
  const restore = minimapTouchReturnFocus || minimapTouchToggle;
  minimapTouchReturnFocus = null;
  if (restore && typeof restore.focus === 'function'){
    restore.focus();
  }
}

if (minimapTouchToggle && minimapTouchPanel){
  minimapTouchToggle.addEventListener('click', () => {
    if (!minimapTouchPanel.hidden){
      closeMinimapTouchPanel();
    } else {
      minimapTouchReturnFocus = document.activeElement;
      minimapTouchPanel.hidden = false;
      minimapTouchPanel.setAttribute('aria-hidden', 'false');
      minimapTouchToggle.setAttribute('aria-expanded', 'true');
      updateMinimap();
      if (minimapTouchClose){
        requestAnimationFrame(() => minimapTouchClose.focus());
      }
    }
  });
}
if (minimapTouchClose){
  minimapTouchClose.addEventListener('click', () => closeMinimapTouchPanel());
}
if (minimapTouchPanel){
  minimapTouchPanel.addEventListener('click', (event) => {
    if (event.target === minimapTouchPanel){
      closeMinimapTouchPanel();
    }
  });
  minimapTouchPanel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape'){
      event.preventDefault();
      closeMinimapTouchPanel();
    }
  });
}

// Sidebar collapse toggle
const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
if (toggleSidebarBtn){
  toggleSidebarBtn.onclick = () => {
    const appElem = document.querySelector('.app');
    if (!appElem) return;
    const collapsed = appElem.classList.toggle('collapsed');
    appElem.classList.remove('show-sidebar');
    const reopenBtn = document.getElementById('sidebarReopenBtn');
    if (reopenBtn) {
      reopenBtn.style.display = collapsed ? 'block' : 'none';
    }
    toggleSidebarBtn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    if (mobileSidebarOpen){
      closeMobileSidebar({ restoreFocus: false });
    }
  };
}

const sidebarFocusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function getSidebarFocusableElements(){
  if (!primarySidebarElem) return [];
  return Array.from(primarySidebarElem.querySelectorAll(sidebarFocusableSelector))
    .filter(el => el.offsetParent !== null && el.getAttribute('aria-hidden') !== 'true');
}

function activateSidebarFocusTrap(){
  if (sidebarFocusTrapHandler || !primarySidebarElem) return;
  sidebarFocusTrapHandler = (event) => {
    if (!mobileSidebarOpen) return;
    if (event.key === 'Tab'){
      const focusable = getSidebarFocusableElements();
      if (!focusable.length){
        event.preventDefault();
        primarySidebarElem.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey){
        if (active === first){
          event.preventDefault();
          last.focus();
        }
      } else if (active === last){
        event.preventDefault();
        first.focus();
      }
    } else if (event.key === 'Escape'){
      event.preventDefault();
      closeMobileSidebar();
    }
  };
  sidebarFocusInHandler = (event) => {
    if (!mobileSidebarOpen || !primarySidebarElem) return;
    if (!primarySidebarElem.contains(event.target)){
      event.stopPropagation();
      const focusable = getSidebarFocusableElements();
      const target = focusable[0] || primarySidebarElem;
      if (target && typeof target.focus === 'function'){
        target.focus();
      }
    }
  };
  document.addEventListener('keydown', sidebarFocusTrapHandler, true);
  document.addEventListener('focusin', sidebarFocusInHandler, true);
}

function deactivateSidebarFocusTrap(){
  if (sidebarFocusTrapHandler){
    document.removeEventListener('keydown', sidebarFocusTrapHandler, true);
    sidebarFocusTrapHandler = null;
  }
  if (sidebarFocusInHandler){
    document.removeEventListener('focusin', sidebarFocusInHandler, true);
    sidebarFocusInHandler = null;
  }
}

function openMobileSidebar(trigger){
  if (!appRootElem || !primarySidebarElem) return;
  appRootElem.classList.add('show-sidebar');
  appRootElem.classList.remove('collapsed');
  const reopenBtn = document.getElementById('sidebarReopenBtn');
  if (reopenBtn) reopenBtn.style.display = 'none';
  mobileSidebarOpen = true;
  mobileSidebarReturnFocus = trigger || document.activeElement;
  if (!primarySidebarElem.hasAttribute('tabindex')){
    primarySidebarElem.setAttribute('tabindex', '-1');
  }
  if (hamburgerBtn){
    hamburgerBtn.setAttribute('aria-expanded', 'true');
  }
  activateSidebarFocusTrap();
  const focusable = getSidebarFocusableElements();
  const target = focusable[0] || primarySidebarElem;
  if (target && typeof target.focus === 'function'){
    target.focus();
  }
}

function closeMobileSidebar(options = {}){
  if (!appRootElem) return;
  const wasOpen = mobileSidebarOpen || appRootElem.classList.contains('show-sidebar');
  appRootElem.classList.remove('show-sidebar');
  if (hamburgerBtn){
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }
  if (!wasOpen) return;
  mobileSidebarOpen = false;
  deactivateSidebarFocusTrap();
  const shouldRestore = options.restoreFocus !== false;
  const restoreTarget = shouldRestore ? (mobileSidebarReturnFocus || hamburgerBtn) : null;
  mobileSidebarReturnFocus = null;
  if (restoreTarget && typeof restoreTarget.focus === 'function'){
    restoreTarget.focus();
  }
}

const hamburgerBtn = document.getElementById('hamburgerBtn');
if (hamburgerBtn){
  hamburgerBtn.addEventListener('click', () => {
    if (mobileSidebarOpen){
      closeMobileSidebar();
    } else {
      openMobileSidebar(hamburgerBtn);
    }
  });
}

document.addEventListener('click', (event) => {
  if (!mobileSidebarOpen) return;
  if (primarySidebarElem && !primarySidebarElem.contains(event.target) && event.target !== hamburgerBtn){
    closeMobileSidebar();
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 1100){
    closeMobileSidebar({ restoreFocus: false });
  }
});

// Help modal toggling
const helpBtn = document.getElementById('helpBtn');
const helpCloseBtn = document.getElementById('helpCloseBtn');
const helpModal = document.getElementById('helpModal');
const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let helpModalReturnFocus = null;

function getFocusableElements(container){
  if (!container) return [];
  return Array.from(container.querySelectorAll(focusableSelector));
}

function openHelpModal(trigger){
  if (!helpModal) return;
  helpModal.hidden = false;
  helpModal.classList.add('open');
  helpModal.setAttribute('aria-hidden', 'false');
  helpModalReturnFocus = trigger || document.activeElement;
  if (appRootElem){ appRootElem.setAttribute('aria-hidden', 'true'); }
  document.body.classList.add('modal-open');
  const focusable = getFocusableElements(helpModal);
  const target = focusable[0] || helpModal;
  if (target){ target.focus(); }
}

function closeHelpModal(){
  if (!helpModal || helpModal.hidden) return;
  helpModal.classList.remove('open');
  helpModal.setAttribute('aria-hidden', 'true');
  helpModal.hidden = true;
  if (appRootElem){ appRootElem.removeAttribute('aria-hidden'); }
  document.body.classList.remove('modal-open');
  const focusTarget = helpModalReturnFocus;
  helpModalReturnFocus = null;
  if (focusTarget && typeof focusTarget.focus === 'function'){
    focusTarget.focus();
  }
}

if (helpModal){
  helpModal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape'){
      event.preventDefault();
      closeHelpModal();
      return;
    }
    if (event.key === 'Tab'){
      const focusable = getFocusableElements(helpModal).filter(el => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey){
        if (document.activeElement === first){
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last){
          event.preventDefault();
          first.focus();
        }
      }
    }
  });
}

if (helpBtn){
  helpBtn.addEventListener('click', () => openHelpModal(helpBtn));
}
if (helpCloseBtn){
  helpCloseBtn.addEventListener('click', () => closeHelpModal());
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    closeContextMenu();
    hideDetailsPopover();
    closeHelpModal();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '?'){
    e.preventDefault();
    if (helpModal && helpModal.classList.contains('open')){
      closeHelpModal();
    } else {
      openHelpModal(helpBtn);
    }
  }
});
window.addEventListener('keydown', (event) => {
  if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))){
    const node = lastFocusedNode || currentFocusNode;
    if (!node) return;
    event.preventDefault();
    const [sx, sy] = worldToScreen(node.x, node.y);
    const rect = canvas.getBoundingClientRect();
    const pageX = rect.left + sx;
    const pageY = rect.top + sy;
    openContextMenu(node, pageX, pageY);
  }
});

// Initialise filters UI
updateFiltersUI();
updateOverviewControls();
updateSubFiltersUI();
updateTagFiltersUI();
renderOutlineTree();
updateRecentSearchesUI();

// Sidebar reopen button: when clicked, restore the sidebar and hide the
// overlay.  Also update the main toggle arrow to reflect the state.
const reopenButton = document.getElementById('sidebarReopenBtn');
if (reopenButton){
  reopenButton.onclick = () => {
    const appElem = document.querySelector('.app');
    if (appElem){
      appElem.classList.remove('collapsed');
      appElem.classList.remove('show-sidebar');
    }
    const toggleBtn = document.getElementById('toggleSidebarBtn');
    if (toggleBtn){ toggleBtn.setAttribute('title', 'Collapse sidebar'); }
    reopenButton.style.display = 'none';
  };
}

// Update breadcrumb and restore state from the URL on first load
restoreStateFromUrl();
window.addEventListener('hashchange', () => {
  restoreStateFromUrl();
});

// Real‑time alerts removed: no initialization required
// const realtimeBtn = document.getElementById('realtimeRefreshBtn');
// if (realtimeBtn){ realtimeBtn.onclick = () => fetchRealTimeFeed(); }
// fetchRealTimeFeed();

// -----------------------------------------------------------------------------
// Motion control UI removed
//
// The force-directed graph now runs with fixed physics constants (SPRING_K,
// REPULSION_K, DAMPING, etc.).  If you wish to customise motion behaviour,
// adjust these constants near the top of this script.  Removing the slider
// simplifies the interface while retaining the breathing animation on expand.

// -----------------------------------------------------------------------------
// Initial layout: fully expanded tree repositioning
//
// Because we set every node to open by default (via walk(root, n => { n.open = true; })),
// the children retain whatever positions they had when initially created.  Without
// recalculating angles and re‑laying out each subtree, the expanded map looks
// cluttered and asymmetric.  Here we schedule a one‑time recalculation of
// angular spans for all macros and radial positions for all open nodes.  This
// produces the same mycelium‑style symmetry as when clicking “Expand All”.
setTimeout(() => {
  try {
    // Reassign angles for all top‑level macro buckets.  Each macro gets an
    // equal portion of the full circle.  assignAngles will recurse down and
    // subdivide its sector among its children, so deeper levels inherit
    // appropriate angleHome values.
    root.children.forEach((macro) => {
      assignAngles(macro);
    });
    // Radially lay out every open node’s children according to their
    // angleHome.  This ensures the fully expanded tree starts in a neat,
    // non‑overlapping configuration.  Without this call, many nodes remain
    // clumped together near their parent from the initial random placement.
    walk(root, n => {
      if (n.open && n.children && n.children.length > 0) {
        layoutChildren(n);
      }
    });
  } catch(e) {
    console.error('Initial layout error', e);
  }
}, 0);

// Track hovered node and show tooltip (desktop only)
if (supportsHover){
  canvas.addEventListener('mousemove', (ev) => {
    if (draggingCanvas || dragNode) {
      hideTooltip();
      return;
    }
    if (tooltipElem && tooltipElem.style.display !== 'none'){
      const tr = tooltipElem.getBoundingClientRect();
      if (ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom) {
        return;
      }
    }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const vis = collectVisible();
    let found = null;
    for (let i = vis.length - 1; i >= 0; i--) {
      const n = vis[i]; const h = n._hit;
      if (!h) continue;
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h){ found = n; break; }
    }
    if (found){
      hoverNode = found;
      showTooltip(found, ev.pageX, ev.pageY);
    } else {
      hoverNode = null;
      hideTooltip();
    }
  });
  canvas.addEventListener('mouseleave', () => { hideTooltip(); });
}

}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch(showFatalError);
});

