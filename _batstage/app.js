/* Båtrute – korteste sjøvei mellom to punkter.
   Vannmaske og dybde-hint hentes fra Kartverkets sjøkart (rasterpiksler): gult = land
   (sperret), hvitt = dypt vann, blåtoner = grunt (skravert i sjøkartet). Ruta går alltid
   i vann, unngår land, og styrer utenom grunt-skravert vann i forhold til dypgangen (myk
   kostnad). Fartsgrenser (bl.a. 5-knops-soner) hentes fra Kystverket og brukes i tiden.
   Alt kjører i nettleseren – ingen backend.
   VIKTIG: planleggingsverktøy, ikke erstatning for sjøkart/navigasjon. */

'use strict';

// ---------- Kart ----------
var map = L.map('map', { zoomControl: true }).setView([58.6227, 8.9311], 12);
var sjokart = L.tileLayer(
  'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
  { maxZoom: 18, maxNativeZoom: 18, attribution: '© Kartverket sjøkart' }).addTo(map);
var topo = L.tileLayer(
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
  { maxZoom: 18, maxNativeZoom: 18, attribution: '© Kartverket' });
var speedLayer = L.tileLayer.wms('https://services.kystverket.no/wms.ashx', {
  layers: 'layer_759', format: 'image/png', transparent: true, version: '1.1.1',
  opacity: 0.55, attribution: '© Kystverket fartsgrenser' }).addTo(map);

// ---------- Tilstand ----------
var pts = { from: null, to: null };
var pickMode = null, routeLine = null, shallowMarks = [], busy = false;

// ---------- Geo-hjelpere ----------
function hav(a, b) {
  var R = 6371000, t = Math.PI / 180;
  var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
function lon2px(lon, z) { return (lon + 180) / 360 * 256 * Math.pow(2, z); }
function lat2px(lat, z) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * Math.pow(2, z); }
function setStatus(m) { document.getElementById('status').textContent = m || ''; }
function markerIcon(t) { return L.divIcon({ className: '', html: '<div class="mk">' + t + '</div>', iconSize: [30, 30], iconAnchor: [15, 28] }); }

function placePoint(which, lat, lng, label) {
  if (pts[which] && pts[which].marker) map.removeLayer(pts[which].marker);
  var m = L.marker([lat, lng], { icon: markerIcon(which === 'from' ? '🟢' : '🔴'), draggable: true }).addTo(map);
  m.on('dragend', function () { var p = m.getLatLng(); pts[which].lat = p.lat; pts[which].lng = p.lng; });
  pts[which] = { lat: lat, lng: lng, marker: m };
  if (label) document.getElementById(which + 'Search').value = label;
}

// ---------- Søk (Kartverket stedsnavn) ----------
function wireSearch(which) {
  var inp = document.getElementById(which + 'Search'), box = document.getElementById(which + 'Res'), t = null;
  inp.addEventListener('input', function () {
    clearTimeout(t); var q = inp.value.trim();
    if (q.length < 2) { box.innerHTML = ''; return; }
    t = setTimeout(function () { search(q, box, which); }, 300);
  });
}
function search(q, box, which) {
  var url = 'https://ws.geonorge.no/stedsnavn/v1/navn?sok=' + encodeURIComponent(q + '*') +
            '&fuzzy=true&utkoordsys=4326&treffPerSide=6&side=1';
  fetch(url).then(function (r) { return r.json(); }).then(function (j) {
    var arr = (j.navn || []).filter(function (n) { return n.representasjonspunkt; });
    box.innerHTML = '';
    arr.forEach(function (n) {
      var d = document.createElement('div');
      d.textContent = n.skrivemåte + ' – ' + (n.navneobjekttype || '') + (n.kommuner && n.kommuner[0] ? ', ' + n.kommuner[0].kommunenavn : '');
      d.onclick = function () { var p = n.representasjonspunkt; placePoint(which, p.nord, p.øst, n.skrivemåte); box.innerHTML = ''; map.panTo([p.nord, p.øst]); };
      box.appendChild(d);
    });
  }).catch(function () { box.innerHTML = ''; });
}

// ---------- Vannmaske fra sjøkart ----------
function pickZoom(bbox) {
  for (var z = 15; z >= 11; z--) {
    var cols = Math.floor(lon2px(bbox.e, z) / 256) - Math.floor(lon2px(bbox.w, z) / 256) + 1;
    var rows = Math.floor(lat2px(bbox.s, z) / 256) - Math.floor(lat2px(bbox.n, z) / 256) + 1;
    if (cols * rows <= 130) return z;
  }
  return 11;
}
function buildMask(bbox) {
  var z = pickZoom(bbox);
  var txMin = Math.floor(lon2px(bbox.w, z) / 256), txMax = Math.floor(lon2px(bbox.e, z) / 256);
  var tyMin = Math.floor(lat2px(bbox.n, z) / 256), tyMax = Math.floor(lat2px(bbox.s, z) / 256);
  var cols = txMax - txMin + 1, rows = tyMax - tyMin + 1, W = cols * 256, H = rows * 256;
  var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  var jobs = [];
  for (var tx = txMin; tx <= txMax; tx++) for (var ty = tyMin; ty <= tyMax; ty++) {
    (function (tx, ty) {
      var u = 'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/' + z + '/' + ty + '/' + tx + '.png';
      jobs.push(fetch(u).then(function (r) { return r.blob(); }).then(function (b) { return createImageBitmap(b); })
        .then(function (bmp) { cx.drawImage(bmp, (tx - txMin) * 256, (ty - tyMin) * 256); }).catch(function () {}));
    })(tx, ty);
  }
  return Promise.all(jobs).then(function () {
    return { im: cx.getImageData(0, 0, W, H).data, W: W, H: H, ox: txMin * 256, oy: tyMin * 256, z: z };
  });
}
// -1 = land, 0 = dypt (hvitt), 1..3 = grunt-skravert (økende «blåhet»)
function tierAt(mask, lat, lng) {
  var x = Math.round(lon2px(lng, mask.z) - mask.ox), y = Math.round(lat2px(lat, mask.z) - mask.oy);
  if (x < 0 || y < 0 || x >= mask.W || y >= mask.H) return 0;
  var i = (y * mask.W + x) * 4, r = mask.im[i], g = mask.im[i + 1], b = mask.im[i + 2];
  if ((g - b) > 12 && r > 140) return -1;          // gult = land
  if (Math.max(r, g, b) < 90) return 0;            // svart tekst/kontur over vann
  var br = b - r;
  if (br >= 90) return 3;
  if (br >= 40) return 2;
  if (br >= 10) return 1;
  return 0;
}

// ---------- Rutenett + A* ----------
function buildGrid(bbox, mask) {
  var midLat = (bbox.n + bbox.s) / 2;
  var wM = hav({ lat: midLat, lng: bbox.w }, { lat: midLat, lng: bbox.e });
  var hM = hav({ lat: bbox.s, lng: bbox.w }, { lat: bbox.n, lng: bbox.w });
  var cell = 35;
  var nx = Math.max(20, Math.min(900, Math.round(wM / cell)));
  var ny = Math.max(20, Math.min(900, Math.round(hM / cell)));
  var tier = new Int8Array(nx * ny);
  for (var r = 0; r < ny; r++) {
    var lat = bbox.n - (r + 0.5) / ny * (bbox.n - bbox.s);
    for (var c = 0; c < nx; c++) {
      var lng = bbox.w + (c + 0.5) / nx * (bbox.e - bbox.w);
      tier[r * nx + c] = tierAt(mask, lat, lng);
    }
  }
  return { tier: tier, nx: nx, ny: ny, bbox: bbox,
    cellLat: function (r) { return bbox.n - (r + 0.5) / ny * (bbox.n - bbox.s); },
    cellLng: function (c) { return bbox.w + (c + 0.5) / nx * (bbox.e - bbox.w); } };
}
function toIdx(g, lat, lng) {
  var c = Math.floor((lng - g.bbox.w) / (g.bbox.e - g.bbox.w) * g.nx);
  var r = Math.floor((g.bbox.n - lat) / (g.bbox.n - g.bbox.s) * g.ny);
  return [Math.max(0, Math.min(g.nx - 1, c)), Math.max(0, Math.min(g.ny - 1, r))];
}
function nearestWater(g, c, r) {
  if (g.tier[r * g.nx + c] >= 0) return [c, r];
  for (var rad = 1; rad < Math.max(g.nx, g.ny); rad++)
    for (var dr = -rad; dr <= rad; dr++) for (var dc = -rad; dc <= rad; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
      var nc = c + dc, nr = r + dr;
      if (nc >= 0 && nc < g.nx && nr >= 0 && nr < g.ny && g.tier[nr * g.nx + nc] >= 0) return [nc, nr];
    }
  return null;
}
function Heap() { this.a = []; }
Heap.prototype.push = function (n) { var a = this.a; a.push(n); var i = a.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; var t = a[p]; a[p] = a[i]; a[i] = t; i = p; } };
Heap.prototype.pop = function () { var a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; var i = 0, n = a.length; while (true) { var l = 2 * i + 1, r = l + 1, s = i; if (l < n && a[l].f < a[s].f) s = l; if (r < n && a[r].f < a[s].f) s = r; if (s === i) break; var t = a[s]; a[s] = a[i]; a[i] = t; i = s; } } return top; };
Heap.prototype.size = function () { return this.a.length; };

function astar(g, start, goal, draft) {
  var nx = g.nx, ny = g.ny, N = nx * ny;
  var gS = new Float64Array(N); gS.fill(Infinity);
  var came = new Int32Array(N); came.fill(-1);
  var closed = new Uint8Array(N);
  var si = start[1] * nx + start[0], gi = goal[1] * nx + goal[0];
  var mLatN = 111320, mLatE = 111320 * Math.cos((g.bbox.n + g.bbox.s) / 2 * Math.PI / 180);
  var dLat = (g.bbox.n - g.bbox.s) / ny * mLatN, dLng = (g.bbox.e - g.bbox.w) / nx * mLatE;
  // dypgang styrer hvor mye grunt-skravert vann skal unngås (myk kostnad)
  var dw = Math.max(0.3, draft / 2) * 1.2;
  function pen(t) { return t <= 0 ? 1 : (1 + t * dw); }
  function h(i) { var r = (i / nx) | 0, c = i % nx; var y = (r - goal[1]) * dLat, x = (c - goal[0]) * dLng; return Math.sqrt(x * x + y * y); }
  gS[si] = 0; var open = new Heap(); open.push({ i: si, f: h(si) });
  var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  while (open.size()) {
    var cur = open.pop(), ci = cur.i;
    if (closed[ci]) continue; closed[ci] = 1;
    if (ci === gi) break;
    var cr = (ci / nx) | 0, cc = ci % nx;
    for (var k = 0; k < 8; k++) {
      var nc = cc + dirs[k][0], nr = cr + dirs[k][1];
      if (nc < 0 || nc >= nx || nr < 0 || nr >= ny) continue;
      var ni = nr * nx + nc;
      if (g.tier[ni] < 0 || closed[ni]) continue;               // land sperret
      if (dirs[k][0] && dirs[k][1]) { if (g.tier[cr * nx + nc] < 0 || g.tier[nr * nx + cc] < 0) continue; }
      var stepM = Math.sqrt(Math.pow(dirs[k][0] * dLng, 2) + Math.pow(dirs[k][1] * dLat, 2));
      var t = gS[ci] + stepM * pen(g.tier[ni]);
      if (t < gS[ni]) { gS[ni] = t; came[ni] = ci; open.push({ i: ni, f: t + h(ni) }); }
    }
  }
  if (came[gi] === -1 && gi !== si) return null;
  var path = [], p = gi;
  while (p !== -1) { path.push(p); if (p === si) break; p = came[p]; }
  path.reverse();
  return path.map(function (i) { var r = (i / nx) | 0, c = i % nx; return { lat: g.cellLat(r), lng: g.cellLng(c), tier: g.tier[i] }; });
}
function simplify(pts) {
  if (pts.length < 3) return pts;
  var out = [pts[0]];
  for (var i = 1; i < pts.length - 1; i++) {
    var a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    var cross = (b.lat - a.lat) * (c.lng - a.lng) - (b.lng - a.lng) * (c.lat - a.lat);
    if (Math.abs(cross) > 8e-8 || b.tier >= 1) out.push(b);   // behold også der grunt begynner
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- Fartsgrenser ----------
var speedCache = {};
function speedAt(lat, lng) {
  var key = lat.toFixed(4) + ',' + lng.toFixed(4);
  if (speedCache[key] !== undefined) return Promise.resolve(speedCache[key]);
  var d = 0.0004, bbox = (lng - d) + ',' + (lat - d) + ',' + (lng + d) + ',' + (lat + d);
  var url = 'https://services.kystverket.no/wms.ashx?' + new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetFeatureInfo', LAYERS: 'layer_759', QUERY_LAYERS: 'layer_759',
    SRS: 'EPSG:4326', INFO_FORMAT: 'application/vnd.ogc.gml', WIDTH: '5', HEIGHT: '5', X: '2', Y: '2', BBOX: bbox }).toString();
  return fetch(url).then(function (r) { return r.text(); }).then(function (t) {
    var xml = new DOMParser().parseFromString(t, 'text/xml'), els = xml.getElementsByTagName('*'), min = null;
    for (var i = 0; i < els.length; i++) {
      if (els[i].tagName.replace(/^.*:/, '').toLowerCase() === 'hastighet') {
        var v = parseFloat((els[i].textContent || '').replace(',', '.'));
        if (isFinite(v) && v > 0) min = (min === null) ? v : Math.min(min, v);
      }
    }
    speedCache[key] = min; return min;
  }).catch(function () { speedCache[key] = null; return null; });
}
function densify(line, stepM) {
  var out = [line[0]];
  for (var i = 1; i < line.length; i++) {
    var a = line[i - 1], b = line[i], seg = hav(a, b), n = Math.max(1, Math.floor(seg / stepM));
    for (var j = 1; j <= n; j++) { var f = j / n; out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f }); }
  }
  return out;
}
function limitRun(fn, arr, conc) {
  return new Promise(function (resolve) {
    var i = 0, active = 0, results = new Array(arr.length), done = 0;
    function next() {
      while (active < conc && i < arr.length) {
        (function (idx) { active++; fn(arr[idx]).then(function (v) { results[idx] = v; active--; done++; if (done === arr.length) resolve(results); else next(); }); })(i++);
      }
    }
    if (!arr.length) resolve([]); else next();
  });
}

// ---------- Hovedberegning ----------
function computeRoute() {
  if (busy) return;
  if (!pts.from || !pts.to) { setStatus('Velg både «Fra» og «Til».'); return; }
  var draft = parseFloat(document.getElementById('draft').value) || 0;
  var speed = parseFloat(document.getElementById('speed').value) || 6;
  busy = true; document.getElementById('calc').disabled = true; clearRoute();

  var minLat = Math.min(pts.from.lat, pts.to.lat), maxLat = Math.max(pts.from.lat, pts.to.lat);
  var minLng = Math.min(pts.from.lng, pts.to.lng), maxLng = Math.max(pts.from.lng, pts.to.lng);
  var padLat = Math.max(0.012, (maxLat - minLat) * 0.3), padLng = Math.max(0.016, (maxLng - minLng) * 0.3);
  var bbox = { s: minLat - padLat, n: maxLat + padLat, w: minLng - padLng, e: maxLng + padLng };
  if ((bbox.e - bbox.w) > 1.2 || (bbox.n - bbox.s) > 0.8) {
    setStatus('For lang avstand for denne versjonen (fokus på Tvedestrand-området). Velg punkter nærmere hverandre.');
    return finish();
  }

  setStatus('Henter sjøkart…');
  buildMask(bbox).then(function (mask) {
    setStatus('Bygger rutenett…');
    var g = buildGrid(bbox, mask);
    var sN = nearestWater(g, toIdx(g, pts.from.lat, pts.from.lng)[0], toIdx(g, pts.from.lat, pts.from.lng)[1]);
    var tN = nearestWater(g, toIdx(g, pts.to.lat, pts.to.lng)[0], toIdx(g, pts.to.lat, pts.to.lng)[1]);
    if (!sN || !tN) { setStatus('Fant ikke sjøvann nær ett av punktene.'); return finish(); }
    setStatus('Beregner korteste sjøvei…');
    setTimeout(function () {
      var path = astar(g, sN, tN, draft);
      if (!path) { setStatus('Ingen sammenhengende sjøvei funnet mellom punktene. Ligger begge i tilknyttet farvann?'); return finish(); }
      var pathS = simplify(path);
      var line = [{ lat: pts.from.lat, lng: pts.from.lng, tier: 0 }].concat(pathS).concat([{ lat: pts.to.lat, lng: pts.to.lng, tier: 0 }]);
      routeLine = L.polyline(line.map(function (p) { return [p.lat, p.lng]; }), { color: '#e63946', weight: 4, opacity: 0.9 }).addTo(map);
      map.fitBounds(routeLine.getBounds().pad(0.15));

      var distM = 0, shallowM = 0;
      for (var i = 1; i < line.length; i++) { var d = hav(line[i - 1], line[i]); distM += d; if ((line[i].tier || 0) >= 1) shallowM += d; }

      setStatus('Sjekker fartsgrenser…');
      var samples = densify(line, 250);
      var stride = Math.max(1, Math.ceil(samples.length / 110));
      var pick = samples.filter(function (_, i) { return i % stride === 0; });
      limitRun(function (p) { return speedAt(p.lat, p.lng); }, pick, 5).then(function (limits) {
        var hours = 0, kmLimited = 0, minLimit = null;
        for (var i = 1; i < pick.length; i++) {
          var segNm = hav(pick[i - 1], pick[i]) / 1852, lim = limits[i], eff = speed;
          if (lim && lim > 0) { eff = Math.min(speed, lim); kmLimited += segNm * 1.852; minLimit = (minLimit === null) ? lim : Math.min(minLimit, lim); }
          hours += segNm / eff;
        }
        showResult(distM / 1000, distM / 1852, hours, kmLimited, minLimit, shallowM / 1000, draft);
        finish();
      });
    }, 30);
  }).catch(function (err) {
    setStatus('Klarte ikke å hente sjøkart. Prøv igjen. (' + (err && err.message ? err.message : err) + ')');
    finish();
  });
}
function finish() { busy = false; document.getElementById('calc').disabled = false; }

function showResult(km, nm, hours, kmLimited, minLimit, shallowKm, draft) {
  setStatus('');
  var h = Math.floor(hours), m = Math.round((hours - h) * 60); if (m === 60) { h++; m = 0; }
  var tid = (h > 0 ? h + ' t ' : '') + m + ' min';
  var html = '<div class="big">' + km.toFixed(1) + ' km <span style="font-size:15px;color:#667">(' + nm.toFixed(1) + ' nm)</span></div>';
  html += '<div class="sub">Estimert tid: <b>' + tid + '</b> (marsjfart tatt hensyn til fartsgrenser)</div>';
  if (minLimit) html += '<div class="sub">' + kmLimited.toFixed(1) + ' km i fartssone (ned til ' + minLimit + ' knop).</div>';
  else html += '<div class="sub">Ingen fartsgrenser funnet langs ruta.</div>';
  if (shallowKm > 0.05) html += '<div class="warn">⚠️ Ca. ' + shallowKm.toFixed(1) + ' km går gjennom grunt-skravert (blått) farvann. Sjekk dybden mot sjøkart for dypgang ' + draft + ' m.</div>';
  else html += '<div class="sub" style="color:#2a7">Ruta holder seg i dypt (hvitt) farvann.</div>';
  var el = document.getElementById('result'); el.innerHTML = html; el.classList.add('show');
}
function clearRoute() {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  shallowMarks.forEach(function (m) { map.removeLayer(m); }); shallowMarks = [];
  var el = document.getElementById('result'); el.classList.remove('show'); el.innerHTML = '';
}

// ---------- UI ----------
map.on('click', function (e) {
  if (!pickMode) return;
  placePoint(pickMode, e.latlng.lat, e.latlng.lng, e.latlng.lat.toFixed(4) + ', ' + e.latlng.lng.toFixed(4));
  document.getElementById(pickMode + 'Pick').classList.remove('active'); pickMode = null; setStatus('');
});
function togglePick(which) {
  var b = document.getElementById(which + 'Pick');
  if (pickMode === which) { pickMode = null; b.classList.remove('active'); }
  else { if (pickMode) document.getElementById(pickMode + 'Pick').classList.remove('active'); pickMode = which; b.classList.add('active'); setStatus('Klikk i kartet for å sette «' + (which === 'from' ? 'Fra' : 'Til') + '».'); }
}
document.getElementById('fromPick').onclick = function () { togglePick('from'); };
document.getElementById('toPick').onclick = function () { togglePick('to'); };
document.getElementById('calc').onclick = computeRoute;
document.getElementById('clear').onclick = function () {
  clearRoute();
  ['from', 'to'].forEach(function (w) { if (pts[w] && pts[w].marker) map.removeLayer(pts[w].marker); pts[w] = null; document.getElementById(w + 'Search').value = ''; document.getElementById(w + 'Res').innerHTML = ''; });
  setStatus('');
};
document.getElementById('tglSpeed').onchange = function () { if (this.checked) speedLayer.addTo(map); else map.removeLayer(speedLayer); };
document.getElementById('tglBase').onchange = function () {
  if (this.checked) { map.removeLayer(sjokart); topo.addTo(map); } else { map.removeLayer(topo); sjokart.addTo(map); }
  if (document.getElementById('tglSpeed').checked) speedLayer.bringToFront();
};
document.getElementById('collapse').onclick = function () { var b = document.getElementById('body'); b.classList.toggle('hidden'); this.textContent = b.classList.contains('hidden') ? '▸' : '▾'; };
wireSearch('from'); wireSearch('to');
